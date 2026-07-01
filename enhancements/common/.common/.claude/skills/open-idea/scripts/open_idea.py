#!/usr/bin/env python3
"""跨平台唤起 IntelliJ IDEA 并打开项目目录。"""

from __future__ import annotations

import argparse
import glob
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable, Sequence


IJENT_PROBLEM_PLUGIN_IDS = ("com.jetbrains.station", "intellij.platform.ijent.impl")
IJENT_PROBLEM_PATTERNS = (
    "Station",
    "Remote Execution Agent",
    "ijent",
    "IJent",
    "WslIjent",
)
WSL_WORKING_DIRECTORY_PROBLEM_PATTERNS = (
    "DOS working directory is expected",
    "Failed to get WSL mount root",
)


def is_wsl() -> bool:
    """判断当前 Python 是否运行在 WSL 中。"""
    if "WSL_DISTRO_NAME" in os.environ or "WSL_INTEROP" in os.environ:
        return True

    try:
        release = Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8").lower()
    except OSError:
        return False

    return "microsoft" in release or "wsl" in release


def current_platform() -> str:
    """返回当前平台标识。"""
    if is_wsl():
        return "wsl"

    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    if system == "windows":
        return "windows"
    return "linux"


def run_text(command: Sequence[str]) -> str | None:
    """执行命令并返回去除空白后的 stdout，失败时返回 None。"""
    try:
        result = subprocess.run(command, check=True, text=True, capture_output=True)
    except (OSError, subprocess.CalledProcessError):
        return None

    value = result.stdout.strip()
    return value or None


def powershell_text(script: str) -> str | None:
    """通过 Windows PowerShell 执行脚本并返回 stdout。"""
    return run_text(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script])


def powershell_json(script: str) -> list[dict[str, object]]:
    """通过 Windows PowerShell 执行脚本并解析 JSON 对象列表。"""
    output = powershell_text(script)
    if not output:
        return []

    try:
        value = json.loads(output)
    except json.JSONDecodeError:
        return []

    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def powershell_literal(value: str) -> str:
    """把字符串转成 PowerShell 单引号字面量。"""
    return "'" + value.replace("'", "''") + "'"


def windows_user_profile() -> str | None:
    """读取 Windows 用户目录，用作从 WSL 启动 Windows IDEA 时的安全工作目录。"""
    return powershell_text("$env:USERPROFILE")


def resolve_project_path(raw_path: str) -> Path:
    """解析并校验项目路径。"""
    project_path = Path(raw_path).expanduser()
    if not project_path.is_absolute():
        project_path = Path.cwd() / project_path

    project_path = project_path.resolve()
    if not project_path.exists():
        raise FileNotFoundError(f"项目路径不存在：{project_path}")
    if not project_path.is_dir():
        raise NotADirectoryError(f"项目路径不是目录：{project_path}")

    return project_path


def wsl_to_windows_path(path: Path) -> str:
    """把 WSL 路径转换为 Windows 可识别路径。"""
    converted = run_text(["wslpath", "-w", str(path)])
    if converted:
        return converted

    raise RuntimeError("无法通过 wslpath 转换项目路径，请确认当前环境是 WSL。")


def legacy_wsl_unc(windows_path: str) -> str:
    """把 wsl.localhost UNC 路径转换成旧版 wsl$ UNC 路径。"""
    prefix = "\\\\wsl.localhost\\"
    if windows_path.startswith(prefix):
        return "\\\\wsl$\\" + windows_path[len(prefix) :]
    return windows_path


def wsl_distro_name(windows_path: str | None = None) -> str | None:
    """推断当前 WSL 发行版名，用于预热对应实例。

    优先读环境变量 WSL_DISTRO_NAME；取不到时再从 wsl.localhost / wsl$ 形式的
    UNC 路径里解析发行版名。
    """
    distro = os.environ.get("WSL_DISTRO_NAME")
    if distro:
        return distro

    if windows_path:
        match = re.match(r"\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\", windows_path)
        if match:
            return match.group(1)

    return None


def warm_wsl(distro: str | None) -> None:
    """启动 IDEA 前预热 WSL 互操作，降低 2025.3 IJent 文件系统冷启动崩溃概率。

    WSL 未完全就绪时用 Windows 侧 IDEA 打开 wsl.localhost 上的项目，IDEA 早期初始化
    WSL 文件系统后端（IJent/EEL）可能竞态抛 NPE 导致启动失败。这里先在目标发行版里
    跑一条空命令把 WSL 互操作与后端服务拉起来。best-effort，失败不阻断启动。
    """
    command = ["wsl.exe", "-d", distro, "-e", "true"] if distro else ["wsl.exe", "-e", "true"]
    print(f"预热 WSL 互操作：{distro or '默认发行版'} …")
    run_text(command)


def assert_windows_path_accessible(path: str, attempts: int = 6, delay: float = 0.5) -> None:
    """确认 Windows 侧能访问传给 IDEA 的项目目录。

    轮询重试若干次：WSL 刚启动时 wsl.localhost 共享可能短暂不可达，多等几次既能确认
    可访问，也顺带给 WSL 文件系统预热，进一步降低 IDEA 冷启动崩溃概率。
    """
    script = f"if (Test-Path -LiteralPath {powershell_literal(path)} -PathType Container) {{ 'OK' }} else {{ 'MISSING' }}"
    for index in range(attempts):
        if powershell_text(script) == "OK":
            return
        # 末次失败不再等待，直接抛错
        if index < attempts - 1:
            time.sleep(delay)

    raise RuntimeError(
        "Windows 侧无法访问转换后的 WSL 项目路径："
        f"{path}。请先在 Windows 文件资源管理器中确认该路径可打开，"
        "或把项目放到 Windows 盘 / WSL 普通用户目录后重试。"
    )


def assert_preferred_wsl_path_accessible(path: str) -> str:
    """校验首选 WSL UNC 路径，不可用时回退到 wsl$ 形式。"""
    try:
        assert_windows_path_accessible(path)
        return path
    except RuntimeError:
        fallback = legacy_wsl_unc(path)
        if fallback == path:
            raise
        assert_windows_path_accessible(fallback)
        print(f"提示：{path} 不可访问，已回退到 {fallback}")
        return fallback


def normalize_wsl_windows_executable(executable: str) -> str:
    """把 WSL 中的 Windows 可执行文件路径转换为 PowerShell 可识别路径。"""
    if executable.startswith("/") and Path(executable).exists():
        converted = run_text(["wslpath", "-w", executable])
        if converted:
            return converted

    return executable


def windows_normalize_path(path: Path) -> str:
    """返回 Windows 本机可使用的绝对路径字符串。"""
    return str(path)


def version_key_from_text(text: str) -> tuple[int, ...]:
    """从路径或版本文本里提取可排序的 IDEA 版本号。"""
    candidates: list[tuple[int, ...]] = []

    for match in re.finditer(r"(?<!\d)(20\d{2}(?:\.\d+){0,4})(?!\d)", text):
        candidates.append(tuple(int(part) for part in match.group(1).split(".")))

    for match in re.finditer(r"(?<!\d)(2\d{2}(?:\.\d+){1,4})(?!\d)", text):
        parts = [int(part) for part in match.group(1).split(".")]
        branch = parts[0]
        # JetBrains 构建号 253.x 表示 2025.3.x，用它补足 Toolbox 这类不含年份的路径。
        candidates.append((2000 + branch // 10, branch % 10, *parts[1:]))

    return max(candidates, default=(0,))


def best_idea_candidate(candidates: Iterable[tuple[str, str, float]]) -> str | None:
    """按路径版本号优先选择最新 IDEA，版本相同再看产品版本和修改时间。"""
    items = list(candidates)
    if not items:
        return None

    def sort_key(item: tuple[str, str, float]) -> tuple[tuple[int, ...], tuple[int, ...], float]:
        path, metadata, mtime = item
        return version_key_from_text(path), version_key_from_text(metadata), mtime

    return max(items, key=sort_key)[0]


def newest_match(patterns: Iterable[str]) -> str | None:
    """返回通配符匹配到的最高版本 IDEA 文件。"""
    matches: list[tuple[str, str, float]] = []
    for pattern in patterns:
        for item in glob.glob(os.path.expandvars(os.path.expanduser(pattern))):
            path = Path(item)
            if path.is_file():
                matches.append((str(path), "", path.stat().st_mtime))

    return best_idea_candidate(matches)


def windows_idea_candidates_from_powershell() -> list[tuple[str, str, float]]:
    """从 Windows 侧扫描 IDEA 安装目录并返回候选项。"""
    script = r"""
$ErrorActionPreference = "SilentlyContinue"
$patterns = @(
  "$env:LOCALAPPDATA\JetBrains\Toolbox\apps\IDEA-U\ch-0\*\bin\idea64.exe",
  "$env:LOCALAPPDATA\JetBrains\Toolbox\apps\IDEA-C\ch-0\*\bin\idea64.exe",
  "$env:ProgramFiles\JetBrains\IntelliJ IDEA*\bin\idea64.exe",
  "${env:ProgramFiles(x86)}\JetBrains\IntelliJ IDEA*\bin\idea64.exe"
)
Get-PSDrive -PSProvider FileSystem | ForEach-Object {
  $patterns += "$($_.Root)IntelliJ IDEA*\bin\idea64.exe"
  $patterns += "$($_.Root)JetBrains\IntelliJ IDEA*\bin\idea64.exe"
}
$seen = @{}
foreach ($pattern in $patterns) {
  Get-ChildItem -Path $pattern -File | ForEach-Object {
    if (-not $seen.ContainsKey($_.FullName)) {
      $seen[$_.FullName] = $true
      "{0}`t{1}`t{2}" -f $_.FullName, $_.VersionInfo.ProductVersion, $_.LastWriteTimeUtc.Ticks
    }
  }
}
exit 0
"""
    output = powershell_text(script)
    if not output:
        return []

    candidates: list[tuple[str, str, float]] = []
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        path, product_version, ticks = parts
        try:
            mtime = float(ticks)
        except ValueError:
            mtime = 0.0
        candidates.append((path, product_version, mtime))
    return candidates


def find_windows_idea(user_idea: str | None = None, from_wsl: bool = False) -> str | None:
    """查找 Windows 侧 IDEA 可执行文件。"""
    if user_idea:
        return user_idea

    env_idea = os.environ.get("IDEA_EXECUTABLE")
    if env_idea:
        return env_idea

    if from_wsl:
        idea_from_scan = best_idea_candidate(windows_idea_candidates_from_powershell())
        if idea_from_scan:
            return idea_from_scan

        path_idea = powershell_text(
            "$cmd = Get-Command idea64.exe,idea.exe,idea -ErrorAction SilentlyContinue | "
            "Select-Object -First 1; if ($cmd) { $cmd.Source }"
        )
        if path_idea:
            return path_idea

        return None

    common_paths = [
        r"%LOCALAPPDATA%\JetBrains\Toolbox\apps\IDEA-U\ch-0\*\bin\idea64.exe",
        r"%LOCALAPPDATA%\JetBrains\Toolbox\apps\IDEA-C\ch-0\*\bin\idea64.exe",
        r"%ProgramFiles%\JetBrains\IntelliJ IDEA*\bin\idea64.exe",
        r"%ProgramFiles(x86)%\JetBrains\IntelliJ IDEA*\bin\idea64.exe",
        r"C:\IntelliJ IDEA*\bin\idea64.exe",
        r"D:\IntelliJ IDEA*\bin\idea64.exe",
        r"E:\IntelliJ IDEA*\bin\idea64.exe",
        r"C:\JetBrains\IntelliJ IDEA*\bin\idea64.exe",
        r"D:\JetBrains\IntelliJ IDEA*\bin\idea64.exe",
        r"E:\JetBrains\IntelliJ IDEA*\bin\idea64.exe",
    ]
    idea_from_scan = newest_match(common_paths)
    if idea_from_scan:
        return idea_from_scan

    return shutil.which("idea64.exe") or shutil.which("idea.exe") or shutil.which("idea")


def find_macos_idea(user_idea: str | None = None) -> str | None:
    """查找 macOS 侧 IDEA 启动入口。"""
    if user_idea:
        return user_idea

    env_idea = os.environ.get("IDEA_EXECUTABLE")
    if env_idea:
        return env_idea

    path_idea = shutil.which("idea")
    if path_idea:
        return path_idea

    for app_name in ("IntelliJ IDEA.app", "IntelliJ IDEA CE.app"):
        app_path = Path("/Applications") / app_name
        if app_path.exists():
            return str(app_path)

    return None


def find_linux_idea(user_idea: str | None = None) -> str | None:
    """查找 Linux 侧 IDEA 启动入口。"""
    if user_idea:
        return user_idea

    env_idea = os.environ.get("IDEA_EXECUTABLE")
    if env_idea:
        return env_idea

    path_idea = shutil.which("idea") or shutil.which("idea.sh")
    if path_idea:
        return path_idea

    common_paths = [
        "~/.local/share/JetBrains/Toolbox/apps/IDEA-U/ch-0/*/bin/idea.sh",
        "~/.local/share/JetBrains/Toolbox/apps/IDEA-C/ch-0/*/bin/idea.sh",
        "/opt/idea*/bin/idea.sh",
        "/opt/intellij-idea*/bin/idea.sh",
        "/snap/bin/intellij-idea-ultimate",
        "/snap/bin/intellij-idea-community",
    ]
    return newest_match(common_paths)


def build_command(platform_name: str, project_path: Path, target: str, idea: str | None) -> tuple[list[str], str, str]:
    """生成启动 IDEA 的命令、展示用项目路径和启动入口。"""
    if platform_name == "wsl" and target != "linux":
        project_arg = wsl_to_windows_path(project_path)
        # 预热 WSL 并轮询等待共享就绪，规避 2025.3 IJent 文件系统冷启动竞态崩溃
        warm_wsl(wsl_distro_name(project_arg))
        project_arg = assert_preferred_wsl_path_accessible(project_arg)
        idea_entry = find_windows_idea(idea, from_wsl=True)
        if not idea_entry:
            raise RuntimeError("未找到 Windows 侧 IDEA。请设置 IDEA_EXECUTABLE 或使用 --idea 指定 idea64.exe。")

        idea_entry = normalize_wsl_windows_executable(idea_entry)
        working_directory = windows_user_profile() or "C:\\"
        command = [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            (
                f"Start-Process -FilePath {powershell_literal(idea_entry)} "
                f"-ArgumentList @({powershell_literal(project_arg)}) "
                f"-WorkingDirectory {powershell_literal(working_directory)}"
            ),
        ]
        return command, project_arg, idea_entry

    if platform_name == "windows":
        project_arg = windows_normalize_path(project_path)
        idea_entry = find_windows_idea(idea)
        if not idea_entry:
            raise RuntimeError("未找到 Windows IDEA。请设置 IDEA_EXECUTABLE 或使用 --idea 指定 idea64.exe。")
        return [idea_entry, project_arg], project_arg, idea_entry

    if platform_name == "macos":
        project_arg = str(project_path)
        idea_entry = find_macos_idea(idea)
        if not idea_entry:
            raise RuntimeError("未找到 macOS IDEA。请设置 IDEA_EXECUTABLE、安装 idea 命令，或使用 --idea 指定 IDEA。")

        if idea_entry.endswith(".app"):
            return ["open", "-a", idea_entry, project_arg], project_arg, idea_entry
        return [idea_entry, project_arg], project_arg, idea_entry

    project_arg = str(project_path)
    idea_entry = find_linux_idea(idea)
    if not idea_entry:
        raise RuntimeError("未找到 Linux IDEA。请设置 IDEA_EXECUTABLE、安装 idea 命令，或使用 --idea 指定 idea.sh。")

    return [idea_entry, project_arg], project_arg, idea_entry


def windows_idea_processes() -> list[dict[str, object]]:
    """读取 Windows 侧 IDEA 进程、窗口句柄和命令行。"""
    script = r"""
$items = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @("idea64.exe", "idea.exe")
} | ForEach-Object {
  $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    ProcessId = $_.ProcessId
    ExecutablePath = $_.ExecutablePath
    CommandLine = $_.CommandLine
    MainWindowHandle = if ($process) { $process.MainWindowHandle } else { 0 }
    MainWindowTitle = if ($process) { $process.MainWindowTitle } else { "" }
    Responding = if ($process) { $process.Responding } else { $null }
  }
}
$items | ConvertTo-Json -Compress
"""
    return powershell_json(script)


def windows_latest_idea_logs(limit: int = 3) -> list[str]:
    """返回 Windows 侧最近的 IDEA 日志路径。"""
    script = f"""
$root = Join-Path $env:LOCALAPPDATA 'JetBrains'
if (Test-Path $root) {{
  Get-ChildItem -Path (Join-Path $root 'IntelliJIdea*\\log\\idea.log') -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First {limit} -ExpandProperty FullName
}}
"""
    output = powershell_text(script)
    if not output:
        return []
    return [line.strip() for line in output.splitlines() if line.strip()]


def windows_log_tail(path: str, lines: int = 260) -> list[str]:
    """读取 Windows 侧 IDEA 日志尾部。"""
    script = (
        f"Get-Content -LiteralPath {powershell_literal(path)} -Tail {lines} "
        "-ErrorAction SilentlyContinue"
    )
    output = powershell_text(script)
    if not output:
        return []
    return output.splitlines()


def text_contains_any(value: str, patterns: Iterable[str]) -> bool:
    """判断文本是否包含任一模式，忽略大小写。"""
    lowered = value.lower()
    return any(pattern.lower() in lowered for pattern in patterns)


def ijent_wsl_markers(lines: Iterable[str]) -> set[str]:
    """从 IDEA 日志中提取 IJent 使用过的 WSL 发行版标记。"""
    markers: set[str] = set()
    for line in lines:
        for match in re.finditer(r"IjentId\([^)]*wsl-([^)]+)\)", line):
            markers.add(match.group(1))
    return markers


def normalize_wsl_marker(value: str) -> str:
    """把日志中的 WSL 标记归一化，便于和发行版名做保守比较。"""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def diagnose_windows_start_failure(project_arg: str) -> list[str]:
    """根据 IDEA 日志给出 Windows/WSL 启动失败诊断。"""
    messages: list[str] = []
    logs = windows_latest_idea_logs()
    for log_path in logs:
        tail = windows_log_tail(log_path)
        related_lines = [
            line
            for line in tail
            if text_contains_any(line, (*IJENT_PROBLEM_PATTERNS, *WSL_WORKING_DIRECTORY_PROBLEM_PATTERNS, "SEVERE", "ERROR", project_arg))
        ]
        if not related_lines:
            continue

        messages.append(f"最近日志：{log_path}")
        if any(text_contains_any(line, WSL_WORKING_DIRECTORY_PROBLEM_PATTERNS) for line in related_lines):
            messages.append(
                "检测到 IDEA/WSL 认为进程工作目录不是 Windows 本地目录。"
                "从 WSL 启动 Windows IDEA 时必须给 Start-Process 显式设置 Windows 本地 WorkingDirectory，"
                "例如用户目录；项目 UNC 路径只作为参数传入。"
            )

        project_distro = wsl_distro_name(project_arg)
        if project_distro:
            expected_marker = normalize_wsl_marker(project_distro)
            unexpected_markers = sorted(
                marker
                for marker in ijent_wsl_markers(related_lines)
                if normalize_wsl_marker(marker) != expected_marker
            )
            if unexpected_markers:
                messages.append(
                    "检测到 IDEA 日志中的 IJent WSL 发行版与项目路径不一致："
                    f"项目使用 {project_distro}，日志出现 {', '.join(unexpected_markers)}。"
                    "请先清理不用的旧 WSL 发行版、旧 SDK 或 JetBrains WSL 缓存后重试。"
                )

        if any(text_contains_any(line, IJENT_PROBLEM_PATTERNS) for line in related_lines):
            plugin_list = "、".join(IJENT_PROBLEM_PLUGIN_IDS)
            messages.append(
                "检测到 Station / Remote Execution Agent / IJent 相关启动异常。"
                "优先检查 WSL 发行版是否仍存在、项目路径是否指向当前发行版、"
                "IDEA 是否使用 Windows 本地 WorkingDirectory 启动，以及 JetBrains WSL 缓存是否残留旧发行版。"
                f"仅在临时隔离问题时再考虑禁用插件 {plugin_list}；脚本不会自动修改用户 IDEA 配置。"
            )
        break

    if not messages:
        messages.append("未在最近 IDEA 日志中识别到明确原因，请查看 IDEA 日志进一步排查。")
    return messages


def verify_windows_idea_started(project_arg: str, idea_entry: str, project_name: str, timeout: float) -> bool:
    """验证 Windows 侧 IDEA 是否创建了目标项目窗口。"""
    deadline = time.time() + timeout
    normalized_project = project_arg.lower()
    normalized_idea = idea_entry.lower()
    normalized_project_name = project_name.lower()
    last_matching: list[dict[str, object]] = []

    while time.time() < deadline:
        processes = windows_idea_processes()
        last_matching = [
            process
            for process in processes
            if (
                normalized_project in str(process.get("CommandLine") or "").lower()
                or normalized_project_name in str(process.get("MainWindowTitle") or "").lower()
                or normalized_idea == str(process.get("ExecutablePath") or "").lower()
            )
        ]
        for process in last_matching:
            title = str(process.get("MainWindowTitle") or "")
            handle = int(process.get("MainWindowHandle") or 0)
            if handle and normalized_project_name in title.lower():
                print(f"已确认 IDEA 打开项目窗口：PID {process.get('ProcessId')}，标题：{title}")
                return True
        time.sleep(1)

    print("警告：已发起 IDEA 启动，但未确认目标项目窗口已打开。", file=sys.stderr)
    if last_matching:
        for process in last_matching[:5]:
            print(
                "进程："
                f"PID={process.get('ProcessId')} "
                f"MainWindowHandle={process.get('MainWindowHandle')} "
                f"MainWindowTitle={process.get('MainWindowTitle')}",
                file=sys.stderr,
            )
    for message in diagnose_windows_start_failure(project_arg):
        print(f"诊断：{message}", file=sys.stderr)
    return False


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="跨平台唤起 IntelliJ IDEA 并打开项目目录。")
    parser.add_argument("project", nargs="?", default=".", help="要打开的项目目录，默认是当前目录。")
    parser.add_argument("--idea", help="IDEA 可执行文件路径或命令。")
    parser.add_argument(
        "--target",
        choices=("auto", "windows", "macos", "linux"),
        default="auto",
        help="启动目标。WSL 中默认 auto 会唤起 Windows IDEA；需要 Linux IDEA 时传 linux。",
    )
    parser.add_argument("--dry-run", action="store_true", help="只打印命令，不真正启动 IDEA。")
    parser.add_argument("--no-verify", action="store_true", help="启动后不校验 IDEA 项目窗口。")
    parser.add_argument("--verify-timeout", type=float, default=35.0, help="等待 IDEA 项目窗口的秒数，默认 35。")
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    """命令入口。"""
    args = parse_args(argv)
    platform_name = current_platform()
    target = args.target

    if target == "auto":
        target = "windows" if platform_name == "wsl" else platform_name

    try:
        project_path = resolve_project_path(args.project)
        command, project_arg, idea_entry = build_command(platform_name, project_path, target, args.idea)
    except Exception as error:
        print(f"错误：{error}", file=sys.stderr)
        return 1

    print(f"平台：{platform_name}")
    print(f"IDEA：{idea_entry}")
    print(f"项目：{project_arg}")
    print("命令：" + " ".join(f'"{part}"' if " " in part else part for part in command))

    if args.dry_run:
        print("dry-run：未启动 IDEA。")
        return 0

    try:
        subprocess.Popen(command)
    except OSError as error:
        print(f"错误：启动 IDEA 失败：{error}", file=sys.stderr)
        return 1

    print("已发起 IDEA 启动请求。")
    if not args.no_verify and target == "windows":
        if not verify_windows_idea_started(project_arg, idea_entry, project_path.name, args.verify_timeout):
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
