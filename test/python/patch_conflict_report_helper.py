"""输出 Python Patch 冲突报告，供 JS/Python parity 测试调用。"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "vendor/skill-garden/scripts/apply-trellis-patches.py"


def main() -> int:
    """读取共享 fixture 并输出 Python consumer 的 JSON 报告。

    Returns:
        成功返回 0，参数不足返回 2。
    """
    if len(sys.argv) != 2:
        return 2
    spec = importlib.util.spec_from_file_location("skill_garden_patches", RUNNER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    fixture = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    report = module.build_patch_conflict_report(
        fixture["version"],
        fixture["plan"],
        fixture["policy"],
    )
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
