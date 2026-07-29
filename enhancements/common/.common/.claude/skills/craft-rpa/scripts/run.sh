#!/usr/bin/env bash
# craft-rpa lifecycle —— start / stop / status / sessions / logs / craft
#
# 数据位置(per-project,与 skill 实现解耦):
#   ${CRAFT_RPA_HOME:-<cwd>/.craft-rpa}/
#     ├── sessions/<YYYY-MM-DD_HH-MM-SS>/session.jsonl   每次 start 新建,不覆盖
#     ├── profile/                                       Chrome 持久 profile(登录态)
#     ├── runtime/recorder/node_modules/                  可重建运行时依赖
#     ├── .launch.{pid,log}                              进程管理 + 日志
#     └── .current-session                               最近一次 start 的 ts
#
# skill 内 recorder/ 只保留静态代码资产；运行时路径通过环境变量显式传给 launch.js。
#
# 用法:
#   bash run.sh start [URL]
#   bash run.sh stop
#   bash run.sh status
#   bash run.sh sessions
#   bash run.sh logs [N]
#   bash run.sh craft [--session <ts>] [--format trace|playwright] [OUT]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RECORDER_DIR="$SKILL_DIR/recorder"

# 数据根:env 覆盖 > cwd/.craft-rpa
CRAFT_RPA_HOME="${CRAFT_RPA_HOME:-$(pwd)/.craft-rpa}"
SESSIONS_DIR="$CRAFT_RPA_HOME/sessions"
PROFILE_DIR="$CRAFT_RPA_HOME/profile"
PID_FILE="$CRAFT_RPA_HOME/.launch.pid"
LOG_FILE="$CRAFT_RPA_HOME/.launch.log"
CURRENT_FILE="$CRAFT_RPA_HOME/.current-session"
RUNTIME_DIR="$CRAFT_RPA_HOME/runtime/recorder"
RUNTIME_MODULES_DIR="$RUNTIME_DIR/node_modules"
LEGACY_SESSION_PATH="$RECORDER_DIR/session.jsonl"
LEGACY_PROFILE_PATH="$RECORDER_DIR/profile"
LEGACY_MODULES_DIR="$RECORDER_DIR/node_modules"

DASHBOARD_URL="http://localhost:7777/dashboard"

prepare_runtime_dependencies() {
    mkdir -p "$RUNTIME_DIR"
    RUNTIME_CHANGED=false
    for MANIFEST in package.json package-lock.json; do
        if [ ! -f "$RECORDER_DIR/$MANIFEST" ]; then
            continue
        fi
        if [ ! -f "$RUNTIME_DIR/$MANIFEST" ] || ! cmp -s "$RECORDER_DIR/$MANIFEST" "$RUNTIME_DIR/$MANIFEST"; then
            cp "$RECORDER_DIR/$MANIFEST" "$RUNTIME_DIR/$MANIFEST"
            RUNTIME_CHANGED=true
        fi
    done
    if [ "$RUNTIME_CHANGED" = true ] || [ ! -d "$RUNTIME_MODULES_DIR/playwright" ]; then
        echo "[craft-rpa] installing deps under $RUNTIME_DIR (one-time, ~30-60s) ..."
        if [ -f "$RUNTIME_DIR/package-lock.json" ]; then
            (cd "$RUNTIME_DIR" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund)
        else
            (cd "$RUNTIME_DIR" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund)
        fi
    fi
}

cleanup_legacy_recorder_runtime() {
    if [ -L "$LEGACY_SESSION_PATH" ]; then
        # 只删除旧软链本身，真实 session 目标继续留在数据根。
        rm -f "$LEGACY_SESSION_PATH"
        echo "[craft-rpa] removed legacy recorder/session.jsonl symlink"
    elif [ -e "$LEGACY_SESSION_PATH" ]; then
        if [ -s "$LEGACY_SESSION_PATH" ]; then
            LEGACY_TS=$(date +"%Y-%m-%d_%H-%M-%S")
            LEGACY_DIR="$SESSIONS_DIR/legacy-$LEGACY_TS"
            mkdir -p "$LEGACY_DIR"
            mv "$LEGACY_SESSION_PATH" "$LEGACY_DIR/session.jsonl"
            echo "[craft-rpa] migrated legacy recorder/session.jsonl → sessions/legacy-$LEGACY_TS/"
        else
            rm -f "$LEGACY_SESSION_PATH"
        fi
    fi

    if [ -L "$LEGACY_PROFILE_PATH" ]; then
        # 只删除旧软链本身，真实 profile 目标继续留在数据根。
        rm -f "$LEGACY_PROFILE_PATH"
        echo "[craft-rpa] removed legacy recorder/profile symlink"
    elif [ -e "$LEGACY_PROFILE_PATH" ]; then
        LEGACY_TS=$(date +"%Y-%m-%d_%H-%M-%S")
        mv "$LEGACY_PROFILE_PATH" "$CRAFT_RPA_HOME/profile-legacy-$LEGACY_TS"
        echo "[craft-rpa] migrated legacy recorder/profile → .craft-rpa/profile-legacy-$LEGACY_TS"
    fi

    if [ -L "$LEGACY_MODULES_DIR" ]; then
        rm -f "$LEGACY_MODULES_DIR"
        echo "[craft-rpa] removed legacy recorder/node_modules symlink"
    elif [ -e "$LEGACY_MODULES_DIR" ]; then
        # node_modules 只是可重建缓存，精确删除受管目录中的旧副本，避免 Plugin 重放再次扫描它。
        rm -rf "$LEGACY_MODULES_DIR"
        echo "[craft-rpa] removed legacy recorder/node_modules cache"
    fi
}

cmd="${1:-status}"

case "$cmd" in
    start)
        URL="${2:-}"
        if [ -z "$URL" ]; then
            if [ -t 0 ]; then
                read -r -p "目标 URL(回车留空开 about:blank): " URL
            fi
            URL="${URL:-about:blank}"
        fi

        if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo "[craft-rpa] already running (pid=$(cat "$PID_FILE"))"
            echo "[craft-rpa] data:      $CRAFT_RPA_HOME"
            echo "[craft-rpa] dashboard: $DASHBOARD_URL"
            exit 0
        fi

        mkdir -p "$CRAFT_RPA_HOME" "$SESSIONS_DIR" "$PROFILE_DIR"
        cleanup_legacy_recorder_runtime
        prepare_runtime_dependencies

        TS=$(date +"%Y-%m-%d_%H-%M-%S")
        NEW_SESSION_DIR="$SESSIONS_DIR/$TS"
        mkdir -p "$NEW_SESSION_DIR"
        : > "$NEW_SESSION_DIR/session.jsonl"

        echo "$TS" > "$CURRENT_FILE"

        cd "$RECORDER_DIR"
        CRAFT_RPA_SESSION_FILE="$NEW_SESSION_DIR/session.jsonl" \
            CRAFT_RPA_PROFILE_DIR="$PROFILE_DIR" \
            CRAFT_RPA_PLAYWRIGHT_MODULE="$RUNTIME_MODULES_DIR/playwright" \
            nohup node launch.js "$URL" > "$LOG_FILE" 2>&1 &
        PID=$!
        echo "$PID" > "$PID_FILE"
        sleep 1

        if ! kill -0 "$PID" 2>/dev/null; then
            echo "[craft-rpa] launch failed, see $LOG_FILE"
            rm -f "$PID_FILE"
            tail -20 "$LOG_FILE" 2>/dev/null || true
            exit 1
        fi

        echo "[craft-rpa] started (pid=$PID, url=$URL)"
        echo "[craft-rpa] data:      $CRAFT_RPA_HOME"
        echo "[craft-rpa] session:   $TS"
        echo "[craft-rpa] jsonl:     $NEW_SESSION_DIR/session.jsonl"
        echo "[craft-rpa] dashboard: $DASHBOARD_URL"
        echo "[craft-rpa] logs:      $LOG_FILE"
        ;;

    stop)
        if [ ! -f "$PID_FILE" ]; then
            echo "[craft-rpa] no pid file ($PID_FILE), nothing to stop"
            exit 0
        fi
        PID=$(cat "$PID_FILE")
        if ! kill -0 "$PID" 2>/dev/null; then
            echo "[craft-rpa] pid $PID not running, cleaning pid file"
            rm -f "$PID_FILE"
            exit 0
        fi

        echo "[craft-rpa] sending SIGINT to pid $PID ..."
        kill -INT "$PID"

        for _ in 1 2 3 4 5 6 7 8 9 10; do
            sleep 0.3
            kill -0 "$PID" 2>/dev/null || break
        done

        if kill -0 "$PID" 2>/dev/null; then
            echo "[craft-rpa] SIGINT timed out, sending SIGTERM"
            kill "$PID" 2>/dev/null || true
            sleep 1
            kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"

        if [ -f "$CURRENT_FILE" ]; then
            CUR=$(cat "$CURRENT_FILE")
            JSONL="$SESSIONS_DIR/$CUR/session.jsonl"
            if [ -f "$JSONL" ]; then
                COUNT=$(wc -l < "$JSONL")
                echo "[craft-rpa] stopped (session=$CUR, $COUNT events)"
            else
                echo "[craft-rpa] stopped"
            fi
        else
            echo "[craft-rpa] stopped"
        fi
        ;;

    status)
        echo "[craft-rpa] data root: $CRAFT_RPA_HOME"
        if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo "[craft-rpa] running (pid=$(cat "$PID_FILE"))"
            if [ -f "$CURRENT_FILE" ]; then
                CUR=$(cat "$CURRENT_FILE")
                JSONL="$SESSIONS_DIR/$CUR/session.jsonl"
                COUNT=0
                [ -f "$JSONL" ] && COUNT=$(wc -l < "$JSONL")
                echo "[craft-rpa] session:   $CUR ($COUNT events)"
            fi
            echo "[craft-rpa] dashboard: $DASHBOARD_URL"
            [ -f "$LOG_FILE" ] && echo "[craft-rpa] logs:      $LOG_FILE"
        else
            [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
            echo "[craft-rpa] not running"
        fi
        if [ -d "$SESSIONS_DIR" ]; then
            TOTAL=$(ls -1 "$SESSIONS_DIR" 2>/dev/null | wc -l)
            echo "[craft-rpa] history:   $TOTAL session(s)"
        fi
        ;;

    sessions)
        if [ ! -d "$SESSIONS_DIR" ] || [ -z "$(ls -A "$SESSIONS_DIR" 2>/dev/null)" ]; then
            echo "[craft-rpa] no sessions yet under $CRAFT_RPA_HOME"
            exit 0
        fi
        echo "[craft-rpa] sessions in $SESSIONS_DIR (newest first):"
        CUR=""
        [ -f "$CURRENT_FILE" ] && CUR=$(cat "$CURRENT_FILE")
        for D in $(ls -1 "$SESSIONS_DIR" | sort -r); do
            JSONL="$SESSIONS_DIR/$D/session.jsonl"
            MARK=" "
            [ "$D" = "$CUR" ] && MARK="*"
            if [ -f "$JSONL" ]; then
                COUNT=$(wc -l < "$JSONL")
                SIZE=$(du -h "$JSONL" 2>/dev/null | cut -f1)
                printf "  %s %s   %s events / %s\n" "$MARK" "$D" "$COUNT" "$SIZE"
            else
                printf "  %s %s   (empty / missing jsonl)\n" "$MARK" "$D"
            fi
        done
        echo "  (* = 当前 / 最近一次 start 的会话)"
        ;;

    logs)
        N="${2:-50}"
        if [ -f "$LOG_FILE" ]; then
            tail -n "$N" "$LOG_FILE"
        else
            echo "[craft-rpa] no log file ($LOG_FILE)"
        fi
        ;;

    craft)
        SESSION=""
        OUT=""
        shift
        while [ $# -gt 0 ]; do
            case "$1" in
                --session) SESSION="${2:-}"; shift 2;;
                --*)       echo "[craft-rpa] unknown flag: $1"; exit 2;;
                *)         OUT="$1"; shift;;
            esac
        done

        if [ -z "$SESSION" ]; then
            if [ -f "$CURRENT_FILE" ]; then
                SESSION=$(cat "$CURRENT_FILE")
            elif [ -d "$SESSIONS_DIR" ]; then
                SESSION=$(ls -1 "$SESSIONS_DIR" 2>/dev/null | sort -r | head -1)
            fi
        fi

        if [ -z "$SESSION" ]; then
            echo "[craft-rpa] no session found under $CRAFT_RPA_HOME"
            exit 1
        fi

        JSONL="$SESSIONS_DIR/$SESSION/session.jsonl"
        if [ ! -f "$JSONL" ]; then
            echo "[craft-rpa] session not found: $SESSION ($JSONL)"
            exit 1
        fi

        [ -z "$OUT" ] && OUT="trace.md"
        node "$SKILL_DIR/scripts/jsonl-to-trace.js" "$JSONL" > "$OUT"

        LINES=$(wc -l < "$OUT")
        echo "[craft-rpa] wrote $OUT ($LINES lines, session=$SESSION)"
        ;;

    *)
        cat <<EOF
Usage: bash $(basename "$0") <cmd> [args]

数据位置: $CRAFT_RPA_HOME
  覆盖: export CRAFT_RPA_HOME=/path/to/data
  默认: <cwd>/.craft-rpa(每个项目自动隔离)

  start [URL]                              启动录制(新时间戳会话目录)
  stop                                     停止录制(SIGINT 优雅退出)
  status                                   运行状态 + 当前会话 + 历史数 + 数据根
  sessions                                 列所有历史会话(* 标当前)
  logs [N]                                 tail launch 日志(默认 50)
  craft [--session <ts>] [OUT]             转 jsonl → trace.md
                                           --session 默认 = 当前 / 最新
                                           OUT       默认 = ./trace.md
EOF
        exit 2
        ;;
esac
