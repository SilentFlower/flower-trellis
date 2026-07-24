"""输出 Python Patch plan 与 provenance，供 JS/Python parity 测试调用。"""

from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "vendor/skill-garden/scripts/apply-trellis-patches.py"
FIXTURE = ROOT / "test/fixtures/patch-engine/core"


def _load_runner():
    """加载独立 Python consumer 模块。

    Returns:
        已加载的 runner 模块。
    """
    spec = importlib.util.spec_from_file_location("skill_garden_patches", RUNNER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _normalize_plan(plan: dict) -> dict:
    """移除临时绝对路径并把 Python 内部 snake_case 字段映射到公开结构。

    Args:
        plan: `prepare_patches()` 返回的计划。

    Returns:
        可与 JS plan 逐字段比较的结构。
    """
    return {
        "bundles": plan["bundles"],
        "patches": plan["patches"],
        "catalogs": plan["catalogs"],
        "selectedBundles": plan["selectedBundles"],
        "selectedPatches": plan["selectedPatches"],
        "operationOrder": plan["operationOrder"],
        "files": [
            {
                "target": item["target"],
                "original": item["original"],
                "originalExists": item["original_exists"],
                "next": item["next"],
                "operations": item["operations"],
                "patches": item["patches"],
                "bundles": item["bundles"],
                "operationEntries": item["operation_entries"],
                "changed": item["changed"],
                "beforeHash": item["before_hash"],
                "afterHash": item["after_hash"],
            }
            for item in plan["files"]
        ],
        "results": plan["results"],
        "catalogHash": plan["catalogHash"],
        "catalogOperations": plan["catalogOperations"],
    }


def main() -> None:
    """在隔离 fixture 中生成 plan/provenance 并输出 JSON。

    Returns:
        无返回值；结果写入标准输出。
    """
    runner = _load_runner()
    with tempfile.TemporaryDirectory(prefix="patch-plan-parity-") as temp:
        root = Path(temp)
        catalog = root / "catalog"
        target = root / "target"
        shutil.copytree(FIXTURE / "catalog", catalog)
        shutil.copytree(FIXTURE / "target", target)
        plan = runner.prepare_patches(catalog, target)
        result = runner.apply_prepared(target, plan)
        print(json.dumps({
            "plan": _normalize_plan(plan),
            "provenance": result["provenance"],
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
