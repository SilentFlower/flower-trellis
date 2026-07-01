#!/usr/bin/env bash
# craft-slides 生命周期封装:把 Slidev 的脚手架 / 预览 / 导出收口成可被 AI 后台代跑的子命令。
#
# 设计要点(对齐 craft-rpa 范式):
#   - 运行时状态(PID / 日志 / 真实 URL)写「当前工作目录」下的 .slidev-craft/,与 skill 代码解耦;
#     可用环境变量 SLIDEV_CRAFT_HOME 覆盖到任意路径。
#   - dev 是长跑服务:后台 nohup 起,轮询日志解析真实 URL(端口被占时 Slidev 会在 3030~4000 自增)。
#   - export 是一次性产出:先幂等确保 playwright-chromium(npm 包)+ chromium 浏览器,再透传 Slidev 成功输出(✓ exported to ...)。
#   - 主题包(含 default,Slidev v52 起为独立 npm 包)在 dev/export 前按 headmatter 的 theme 自动预装 ——
#     后台 nohup 模式无法交互式确认安装,缺包会导致 dev 启动即退出。
#   - 所有 Slidev 命令字串与默认值均依据 Slidev 源码核实(dev 默认端口 3030、export --format pdf|png|pptx|md)。
set -euo pipefail

# 解析 skill 自身目录,以定位 templates/(脚本可能被装到任意项目的 .claude/.codex 下)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"            # craft-slides/ 根
TEMPLATES_DIR="$SKILL_DIR/templates"

DEFAULT_PORT=3030
DEFAULT_ENTRY="slides.md"

# 状态目录:优先 SLIDEV_CRAFT_HOME,否则落在当前项目根
STATE_DIR="${SLIDEV_CRAFT_HOME:-$PWD/.slidev-craft}"
PID_FILE="$STATE_DIR/.dev.pid"
LOG_FILE="$STATE_DIR/.dev.log"

usage() {
  cat <<'EOF'
craft-slides / slidev.sh —— Slidev 演示生命周期封装

用法:
  slidev.sh new <dir> [--theme <name>]   生成最小 Slidev 项目(package.json + slides.md 骨架)
                                         精选主题短名: seriph / geist / nord / apple-basic / dracula
                                         (有同名 templates/slides.<name>.md 时用其适配模板,否则用通用模板)
  slidev.sh dev [entry] [--port N]       后台起预览(默认 slides.md / 端口 3030),返回真实 URL
  slidev.sh status                       查看 dev 是否在跑 + URL + 入口 + 日志路径
  slidev.sh stop                         优雅停止 dev(SIGINT,3s 未退再 SIGTERM)
  slidev.sh export [entry] [--format pdf|png|pptx|md] [--output <path>] [更多 slidev 透传参数]
                                         导出(默认 pdf);先幂等确保 playwright-chromium 包 + chromium 浏览器 + 主题包
  slidev.sh build [entry] [更多 slidev 透传参数]
                                         构建可托管静态站到 dist/

说明:
  - dev / export / build 默认在「当前目录」作为 Slidev 项目运行(需有 slides.md 与已安装依赖)。
  - new 之后请 `cd <dir> && npm install` 再 dev。
  - 主题包(含 default,v52 起为独立包)在 dev/export 前按 headmatter 的 theme 自动预装;手动装: npm i @slidev/theme-<name>。
  - 彩色 emoji 需系统装有 emoji 字体(如 fonts-noto-color-emoji),否则预览/导出里 emoji 会显示成 □ 豆腐块。
  - 运行时状态写 ./.slidev-craft/(可用 SLIDEV_CRAFT_HOME 覆盖),建议在仓库根 .gitignore 加一行 .slidev-craft/。
EOF
}

# 判断 dev 进程是否存活
_is_running() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# 打印已记录的真实 URL(若有)
_report_url() {
  if [ -f "$STATE_DIR/.dev.url" ]; then
    echo "  URL: $(cat "$STATE_DIR/.dev.url")"
  fi
}

# 把 headmatter 的 theme 名解析成 npm 包名,逻辑对齐 Slidev 源码
# (packages/slidev/node/integrations/themes.ts + resolver.ts):
#   官方短名经 officialThemes 映射;@ 前缀原样;其余社区主题用 slidev-theme-<name> 惯例;
#   none / 空 → 无主题包(不安装)。
_theme_pkg() {
  local name="$1"
  case "$name" in
    ""|default)   echo "@slidev/theme-default" ;;   # 未写 theme 时 Slidev 默认用 default
    none)         echo "" ;;                          # 显式无主题
    seriph)       echo "@slidev/theme-seriph" ;;
    apple-basic)  echo "@slidev/theme-apple-basic" ;;
    shibainu)     echo "@slidev/theme-shibainu" ;;
    bricks)       echo "@slidev/theme-bricks" ;;
    # 精选社区主题:显式列出便于自文档化、防社区改名(逻辑上与下方惯例分支等价)
    geist)        echo "slidev-theme-geist" ;;         # Vercel / Geist 风
    nord)         echo "slidev-theme-nord" ;;          # Nord 冷色
    dracula)      echo "slidev-theme-dracula" ;;       # Dracula 深色紫
    @*)           echo "$name" ;;                      # 已是 @scope/pkg 完整包名
    *)            echo "slidev-theme-$name" ;;         # 社区主题命名惯例
  esac
}

# 依据入口 headmatter 的 theme 预装主题包。
# Slidev v52 起 default 主题也是独立 npm 包;后台 nohup 模式无法交互式自动安装,
# 缺包会让 dev 启动即退出(日志:theme "..." was not found and cannot prompt for installation),
# 故 dev / export 前先确保安装。
_ensure_theme() {
  local entry="${1:-$DEFAULT_ENTRY}" name pkg
  [ -f "$entry" ] || return 0
  # headmatter 必在文件头;只扫前 40 行取第一处 theme:
  name="$(sed -n '1,40p' "$entry" | grep -oE '^theme:[[:space:]]*[^[:space:]#]+' | head -n1 | sed -E 's/^theme:[[:space:]]*//')"
  pkg="$(_theme_pkg "$name")"
  [ -n "$pkg" ] || return 0
  [ -d "node_modules/$pkg" ] && return 0
  echo "[craft-slides] 预装主题包 $pkg ..."
  npm i "$pkg" >/dev/null 2>&1 \
    || echo "  (主题安装失败;若 dev/export 报找不到主题,手动执行: npm i $pkg)"
}

cmd_new() {
  local dir="" theme=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --theme) theme="${2:-}"; shift 2 ;;
      --theme=*) theme="${1#*=}"; shift ;;
      -*) echo "[craft-slides] 未知参数: $1" >&2; shift ;;
      *) dir="$1"; shift ;;
    esac
  done
  [ -n "$dir" ] || { echo "用法: slidev.sh new <dir> [--theme <name>]" >&2; return 1; }

  mkdir -p "$dir"

  # 1) slides.md 入口:优先用每主题适配模板 templates/slides.<theme>.md
  #    (其 headmatter 已含 theme + colorSchema + 中文友好配置,原样复制即可);
  #    无匹配主题模板时回退通用 slides.md,并按 --theme 替换 headmatter 第一处 theme 行。
  #    已存在则不覆盖。
  local slides="$dir/slides.md"
  local themed_tmpl=""
  [ -n "$theme" ] && [ -f "$TEMPLATES_DIR/slides.$theme.md" ] && themed_tmpl="$TEMPLATES_DIR/slides.$theme.md"
  if [ -f "$slides" ]; then
    echo "[craft-slides] $slides 已存在,跳过(不覆盖)"
  elif [ -n "$themed_tmpl" ]; then
    cp "$themed_tmpl" "$slides"
    echo "[craft-slides] 已写入 $slides (主题模板: slides.$theme.md)"
  else
    cp "$TEMPLATES_DIR/slides.md" "$slides"
    # 通用模板:指定主题时替换 headmatter 第一处 theme 行(兜底任意社区主题短名)
    if [ -n "$theme" ]; then
      sed -i.bak "0,/^theme: .*/s//theme: $theme/" "$slides" && rm -f "$slides.bak"
    fi
    echo "[craft-slides] 已写入 $slides"
  fi

  # 2) package.json:最小可跑配置。注意 v52 起 default 主题亦为独立 npm 包,必须写入依赖,
  #    否则 `npm install` 后 dev 仍会因找不到主题而启动即退出。
  local pkg="$dir/package.json"
  local theme_pkg theme_dep=""
  theme_pkg="$(_theme_pkg "$theme")"
  # theme: none 时 theme_pkg 为空,不写入依赖(避免非法的空键)
  [ -n "$theme_pkg" ] && theme_dep=",
    \"$theme_pkg\": \"latest\""
  if [ -f "$pkg" ]; then
    echo "[craft-slides] $pkg 已存在,跳过"
  else
    cat >"$pkg" <<JSON
{
  "name": "slidev-deck",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "slidev --open",
    "build": "slidev build",
    "export": "slidev export"
  },
  "dependencies": {
    "@slidev/cli": "^52.0.0"$theme_dep
  }
}
JSON
    echo "[craft-slides] 已写入 $pkg${theme_pkg:+ (主题包: $theme_pkg)}"
  fi

  echo
  echo "下一步:"
  echo "  cd $dir && npm install"
  echo "  bash \"$SCRIPT_DIR/slidev.sh\" dev        # 或 npm run dev"
}

cmd_dev() {
  local entry="$DEFAULT_ENTRY" port="$DEFAULT_PORT"
  while [ $# -gt 0 ]; do
    case "$1" in
      --port|-p) port="${2:-$DEFAULT_PORT}"; shift 2 ;;
      --port=*) port="${1#*=}"; shift ;;
      -*) echo "[craft-slides] 未知参数: $1" >&2; shift ;;
      *) entry="$1"; shift ;;
    esac
  done

  mkdir -p "$STATE_DIR"

  if _is_running; then
    echo "[craft-slides] dev 已在运行 (pid=$(cat "$PID_FILE"))"
    _report_url
    return 0
  fi

  if [ ! -f "$entry" ]; then
    echo "[craft-slides] 找不到入口文件: $entry (cwd=$PWD)" >&2
    echo "  请先 cd 进 Slidev 项目目录,或用 'slidev.sh new <dir>' 创建" >&2
    return 1
  fi

  # 预装 headmatter 指定的主题包(含 default);后台模式缺主题会启动即退出
  _ensure_theme "$entry"

  echo "[craft-slides] 启动 dev: npx slidev $entry --port $port"
  nohup npx slidev "$entry" --port "$port" >"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" >"$PID_FILE"
  echo "$entry" >"$STATE_DIR/.dev.entry"

  # 轮询日志拿真实 URL(最多 ~15s);端口被占时 Slidev 会自增,故以日志为准
  local url="" i=0
  while [ "$i" -lt 30 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[craft-slides] dev 进程启动后立即退出,最后日志:" >&2
      tail -n 20 "$LOG_FILE" >&2 2>/dev/null || true
      if grep -q "was not found and cannot prompt" "$LOG_FILE" 2>/dev/null; then
        echo "  提示:主题包缺失。检查 slides.md headmatter 的 theme,并执行 npm i @slidev/theme-<name> 后重试" >&2
      fi
      rm -f "$PID_FILE"
      return 1
    fi
    url="$(grep -oE 'http://localhost:[0-9]+/?' "$LOG_FILE" 2>/dev/null | head -n1 || true)"
    [ -n "$url" ] && break
    sleep 0.5
    i=$((i + 1))
  done

  if [ -n "$url" ]; then
    echo "$url" >"$STATE_DIR/.dev.url"
    echo "[craft-slides] dev 就绪: $url  (pid=$pid)"
    echo "  日志: $LOG_FILE"
  else
    echo "[craft-slides] dev 已后台启动 (pid=$pid),但 15s 内未解析到 URL"
    echo "  查看日志: $LOG_FILE"
  fi
}

cmd_status() {
  if _is_running; then
    echo "[craft-slides] dev 运行中 (pid=$(cat "$PID_FILE"))"
    [ -f "$STATE_DIR/.dev.entry" ] && echo "  入口: $(cat "$STATE_DIR/.dev.entry")"
    _report_url
    echo "  日志: $LOG_FILE"
  else
    echo "[craft-slides] dev 未运行"
    rm -f "$PID_FILE" 2>/dev/null || true
  fi
}

cmd_stop() {
  if ! _is_running; then
    echo "[craft-slides] dev 未运行"
    rm -f "$PID_FILE" 2>/dev/null || true
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  echo "[craft-slides] 停止 dev (pid=$pid) ..."
  kill -INT "$pid" 2>/dev/null || true
  local i=0
  while [ "$i" -lt 6 ] && kill -0 "$pid" 2>/dev/null; do
    sleep 0.5
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE" 2>/dev/null || true
  echo "[craft-slides] 已停止"
}

cmd_export() {
  local entry="$DEFAULT_ENTRY" fmt="pdf" output=""
  local passthru=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --format|-f) fmt="${2:-pdf}"; shift 2 ;;
      --format=*) fmt="${1#*=}"; shift ;;
      --output|-o) output="${2:-}"; shift 2 ;;
      --output=*) output="${1#*=}"; shift ;;
      -*) passthru+=("$1"); shift ;;
      *) entry="$1"; shift ;;
    esac
  done

  if [ ! -f "$entry" ]; then
    echo "[craft-slides] 找不到入口文件: $entry (cwd=$PWD)" >&2
    return 1
  fi

  # 幂等确保导出依赖:Slidev export 由 playwright-chromium(npm 包)驱动 ——
  # 仅 `npx playwright install chromium`(浏览器二进制)不够,缺 npm 包会报
  # "please install it via `npm i -D playwright-chromium`"。
  if [ ! -d node_modules/playwright-chromium ]; then
    echo "[craft-slides] 安装导出依赖 playwright-chromium ..."
    npm i -D playwright-chromium >/dev/null 2>&1 \
      || echo "  (playwright-chromium 安装失败;手动执行: npm i -D playwright-chromium)"
  fi
  echo "[craft-slides] 确保 Playwright chromium 浏览器 ..."
  npx playwright install chromium >/dev/null 2>&1 \
    || echo "  (浏览器安装跳过/失败;若导出报缺浏览器,手动执行: npx playwright install chromium)"

  # 导出同样需要主题包(否则渲染阶段报找不到主题)
  _ensure_theme "$entry"

  local args=(slidev export "$entry" --format "$fmt")
  [ -n "$output" ] && args+=(--output "$output")
  [ ${#passthru[@]} -gt 0 ] && args+=("${passthru[@]}")
  echo "[craft-slides] 导出: npx ${args[*]}"
  npx "${args[@]}"
}

cmd_build() {
  local entry="$DEFAULT_ENTRY"
  local passthru=()
  while [ $# -gt 0 ]; do
    case "$1" in
      -*) passthru+=("$1"); shift ;;
      *) entry="$1"; shift ;;
    esac
  done
  echo "[craft-slides] 构建静态站: npx slidev build $entry"
  if [ ${#passthru[@]} -gt 0 ]; then
    npx slidev build "$entry" "${passthru[@]}"
  else
    npx slidev build "$entry"
  fi
}

main() {
  local cmd="${1:-help}"
  shift 2>/dev/null || true
  case "$cmd" in
    new) cmd_new "$@" ;;
    dev) cmd_dev "$@" ;;
    status) cmd_status "$@" ;;
    stop) cmd_stop "$@" ;;
    export) cmd_export "$@" ;;
    build) cmd_build "$@" ;;
    help | -h | --help) usage ;;
    *) echo "[craft-slides] 未知子命令: $cmd" >&2; usage; return 1 ;;
  esac
}

main "$@"
