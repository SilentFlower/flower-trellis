/** 按已知改动范围选择 CI；未识别范围保留完整回归。 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GARDEN = "vendor/skill-garden";
const FULL = { full: true, contracts: true, python: true, update: true };
const RULE_JS_TESTS = [
  "apply-enhancements", "brief-preauthorization", "check-all-comment-remediation",
  "check-all-evidence-reuse", "check-all-fallback-findings", "check-all-smart-depth",
  "ci-impact", "codex-sync-user-interaction", "output-template-contract",
  "platform-skill-distribution", "pre-check-feedback-gate", "route-context-budget",
  "trellis-meta-overlay", "untracked-flow-gate", "update-spec-auto-decision",
  "workflow-gate-ownership",
].map(name => `test/js/${name}.test.js`);
const RULE_PYTHON_TESTS = [
  "test_skill_garden_patches", "test_flower_session_start", "test_flower_update_hook",
].map(name => `test/python/${name}.py`);

/**
 * 选择原生兼容矩阵；提示词仍须经过规则、真实 Patch 与产物检查。
 * @param {string[]} files 包含展开后子模块路径的 Git 相对路径
 * @param {{root?:string}} options 仓库根目录，供 Patch 目标核对使用
 * @returns {{full:boolean,contracts:boolean,python:boolean,update:boolean}} 需要运行的验证范围
 */
export function classifyCiChanges(files, { root = ROOT } = {}) {
  if (!files.length) return { ...FULL };
  let contracts = false;
  let python = false;
  let update = false;
  for (const original of files) {
    const file = original.replace(/^vendor\/skill-garden\/\.trellis\//, "enhancements/");
    if (/^(?:README|CHANGELOG|AGENTS)\.md$|^LICENSE$|^docs\/.*\.md$/.test(file)) continue;
    if (/^\.trellis\/(?:spec|workspace|tasks)\/.*\.(?:md|json|jsonl)$/.test(file)) continue;
    contracts = true;
    if (file === "test/js/ci-impact.test.js") return { ...FULL };
    if (RULE_JS_TESTS.includes(file) || file === "test/python/test_skill_garden_patches.py") continue;
    if ([".flower/plugin-lock.json", "enhancements/MANIFEST.json", "enhancements/0.6/overrides/conflicts.json", ".trellis/workflow.md"].includes(file)) continue;
    if (/^(?:enhancements\/0\.6\/)?\.(?:agents|claude)\/(?:skills|commands|agents)\/.*\.md$/.test(file)) continue;
    if (/^enhancements\/0\.6\/overrides\/patches\/(?:workflow|skills|agents)\/.*\.md$/.test(file)) {
      // workflow 目录也含 Python Patch，不能只凭目录名或 Markdown 后缀缩小验证。
      try {
        const patch = JSON.parse(fs.readFileSync(path.join(root, path.dirname(original), "patch.json"), "utf8"));
        if (patch.operations?.length && patch.operations.every(operation =>
          operation.targets?.length && operation.targets.every(target =>
            ["workflow", "skill", "command", "agent"].includes(target.kind) && target.path?.endsWith(".md"),
          ),
        )) continue;
      } catch {
        // 删除、损坏或未知的 Patch 定义交由完整回归判定。
      }
      return { ...FULL };
    }
    if (/^vendor\/skill-garden\/compiled-targets\/[^/]+\/full\/(?:plan\.json|targets\/.*\.md(?:\.diff)?)$/.test(file)) continue;
    if (/^(?:src\/assets\/|test\/python\/|\.trellis\/scripts\/|\.(?:agents|claude|codex)\/(?:hooks|skills)\/|enhancements\/0\.6\/(?:scripts\/|overrides\/patches\/|\.(?:agents|claude)\/skills\/)).*\.py$/.test(file)) {
      python = true;
      continue;
    }
    if (/^src\/lib\/(?:update-check(?:-cache)?|update-backups|update-all-projects|global-trellis-sync|operation-timing|terminal-state)\.js$/.test(file)) {
      update = true;
      continue;
    }
    return { ...FULL };
  }
  return { full: false, contracts, python, update };
}

/**
 * 读取完整 Git 差异并展开子模块，避免仅因 pin 变化误判或漏判运行时代码。
 * @param {string} base 比较起点的完整 commit SHA
 * @param {string} head 比较终点的完整 commit SHA
 * @param {{root?:string,mergeBase?:boolean}} options 仓库根目录及 PR 合并基点开关
 * @returns {string[]} 未按行拆分、同时保留重命名前后路径的变化列表
 */
export function collectCiChanges(base, head, { root = ROOT, mergeBase = false } = {}) {
  if (![base, head].every(value => /^[a-f0-9]{40,64}$/.test(value ?? "") && !/^0+$/.test(value))) {
    throw new Error("缺少有效的 Git 比较起点或终点");
  }
  const git = (cwd, args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
  });
  if (mergeBase) base = git(root, ["merge-base", base, head]).trim();
  const changed = (cwd, from, to) => {
    // 可执行位及软链类型变化不是提示词修改，必须重新验证运行环境。
    const summary = git(cwd, ["diff", "--summary", from, to, "--"]);
    if (/mode change|(?:create|delete) mode (?:120000|100755)/.test(summary)) {
      throw new Error("Git 文件模式变化需要完整回归");
    }
    return git(cwd, ["diff", "--name-only", "--no-renames", "-z", from, to, "--"]).split("\0").filter(Boolean);
  };
  const files = changed(root, base, head);
  if (!files.includes(GARDEN)) return files;
  const pins = [base, head].map(commit => {
    const entry = git(root, ["ls-tree", commit, "--", GARDEN]);
    const pin = /^160000 commit ([a-f0-9]{40,64})\t/.exec(entry)?.[1];
    if (!pin) throw new Error("子模块新增、移除或类型变化需要完整回归");
    return pin;
  });
  const gardenFiles = changed(path.join(root, GARDEN), ...pins);
  return files.filter(file => file !== GARDEN).concat(gardenFiles.map(file => `${GARDEN}/${file}`));
}

/** 运行固定的规则专项，共用同一清单进行影响判断和实际执行。 */
function runRuleTests() {
  const env = { ...process.env, FLOWER_NO_TELEMETRY: "1" };
  for (const args of [["--test", ...RULE_JS_TESTS], ["scripts/run-python-tests.mjs", ...RULE_PYTHON_TESTS]]) {
    const result = spawnSync(process.execPath, args, { cwd: ROOT, env, stdio: "inherit" });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--rules") {
    runRuleTests();
  } else {
    let plan;
    try {
      if (process.env.CI_FULL === "true") {
        console.warn("手动运行或发布前执行完整回归");
        plan = { ...FULL };
      } else {
        const files = collectCiChanges(process.env.CI_BASE, process.env.CI_HEAD, {
          mergeBase: process.env.GITHUB_EVENT_NAME === "pull_request",
        });
        plan = classifyCiChanges(files);
        const scope = plan.full ? "含未知或共享运行时范围，执行完整回归"
          : plan.contracts ? "执行规则专项及受影响矩阵" : "仅普通文档或任务记录，无需运行测试";
        console.warn(`比较 ${files.length} 项实际变化：${scope}`);
      }
    } catch (error) {
      console.warn(`采用完整回归：${error.message}`);
      plan = { ...FULL };
    }
    console.log(JSON.stringify(plan));
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(""));
    }
  }
}
