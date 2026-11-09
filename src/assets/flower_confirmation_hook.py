#!/usr/bin/env python3
"""将两平台原生事件交给当前 Flower 运行时，不要求额外全局安装。"""

import json
import shutil
import subprocess
import sys
from pathlib import Path


def resolve_confirmation_entry(root):
    """解析当前项目已有的 Flower 命令，优先源码入口，不启动子进程。

    @param root: 已解析的项目根目录。
    @return: 精确 argv；入口缺失时抛出异常。
    """
    package = root / "package.json"
    local = (root / "bin/flower-trellis.js").is_file() and package.is_file()
    local = local and json.loads(package.read_text(encoding="utf-8")).get("name") == "flower-trellis"
    executable = shutil.which("node" if local else "flower-trellis")
    if not executable:
        raise ValueError("未找到项目所需的 Node/Flower 入口，保持人工确认")
    return [executable] + ([str(root / "bin/flower-trellis.js")] if local else [])


def main():
    """只转发当前事件，失败时由正式入口拒绝自动确认。

    Returns:
        Hook 返回码；错误不阻止用户继续普通对话。
    """
    if sys.argv[1:] == ["--entry"]:
        try:
            command = resolve_confirmation_entry(Path.cwd().resolve(strict=True))
            sys.stdout.write(json.dumps({"entry": command}, ensure_ascii=True) + "\n")
            return 0
        except (ValueError, OSError) as error:
            sys.stdout.write(json.dumps({"entry": None, "reason": str(error)}, ensure_ascii=True) + "\n")
            return 1
    if sys.platform != "linux":
        return 0
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            return 0
        payload = json.loads(raw.decode("utf-8"))
        root = Path(payload["cwd"]).resolve(strict=True)
        command = resolve_confirmation_entry(root)
        platform = "codex" if "--platform" in sys.argv and sys.argv[-1] == "codex" else "claude"
        result = subprocess.run(command + ["confirm", "hook", "--platform", platform], input=raw, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, cwd=str(root), timeout=4)
        if result.returncode == 0:
            value = json.loads(result.stdout.decode("utf-8"))
            sys.stdout.write(json.dumps(value, ensure_ascii=True) + "\n")
    except (ValueError, KeyError, OSError, subprocess.SubprocessError):
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
