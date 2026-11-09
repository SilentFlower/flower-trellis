#!/usr/bin/env python3
"""将 Claude 原生事件交给当前 Flower 运行时，不要求额外全局安装。"""

import json
import shutil
import subprocess
import sys
from pathlib import Path


def main():
    """只转发当前事件，失败时由正式入口拒绝自动确认。

    Returns:
        Hook 返回码；错误不阻止用户继续普通对话。
    """
    if sys.platform != "linux":
        return 0
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            return 0
        payload = json.loads(raw.decode("utf-8"))
        root = Path(payload["cwd"]).resolve(strict=True)
        package = root / "package.json"
        local = (root / "bin/flower-trellis.js").is_file() and package.is_file()
        local = local and json.loads(package.read_text(encoding="utf-8")).get("name") == "flower-trellis"
        executable = shutil.which("node" if local else "flower-trellis")
        if not executable:
            return 0
        command = [executable] + ([str(root / "bin/flower-trellis.js")] if local else [])
        result = subprocess.run(command + ["confirm", "hook"], input=raw, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, cwd=str(root), timeout=4)
        if result.returncode == 0:
            value = json.loads(result.stdout.decode("utf-8"))
            sys.stdout.write(json.dumps(value, ensure_ascii=True) + "\n")
    except (ValueError, KeyError, OSError, subprocess.SubprocessError):
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
