import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyCiChanges, collectCiChanges } from "../../scripts/ci-impact.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FULL = { full: true, contracts: true, python: true, update: true };
const RULES = { full: false, contracts: true, python: false, update: false };

function repository(root) {
  fs.mkdirSync(root, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-q");
  git("config", "user.name", "CI 测试");
  git("config", "user.email", "ci-test@example.invalid");
  const write = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const commit = () => {
    git("-c", "core.hooksPath=", "commit", "-qm", "测试快照");
    return git("rev-parse", "HEAD");
  };
  return { git, write, commit };
}

function temporaryRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-ci-中文 空格-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, ...repository(root) };
}

test("规则修复的源、快照、编译产物和 dogfood 一起走专项", () => {
  assert.deepEqual(classifyCiChanges([
    "vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/states-in-progress/common-content.md",
    "vendor/skill-garden/.trellis/0.6/overrides/conflicts.json",
    "vendor/skill-garden/compiled-targets/0.6.14/full/plan.json",
    "vendor/skill-garden/compiled-targets/0.6.14/full/targets/.agents/skills/trellis-start/SKILL.md.diff",
    "enhancements/0.6/overrides/patches/skills/trellis-start/no-task-routing/content.md",
    "enhancements/MANIFEST.json", ".flower/plugin-lock.json", ".trellis/workflow.md",
    ".agents/skills/trellis-start/SKILL.md", "test/js/workflow-gate-ownership.test.js",
    "test/python/test_skill_garden_patches.py", ".trellis/spec/flower-trellis/cli/quality-guidelines.md",
  ]), RULES);
});

test("Markdown 后缀和 workflow 目录不代表提示词 Patch", () => {
  for (const file of [
    "src/assets/runtime.md",
    "enhancements/0.6/overrides/patches/workflow/state-missing-task/content.md",
    "enhancements/0.6/overrides/patches/workflow/unknown/content.md",
    "vendor/skill-garden/compiled-targets/0.6.14/full/targets/.trellis/config.yaml.diff",
  ]) assert.deepEqual(classifyCiChanges([file]), FULL, file);
});

test("普通文档和任务记录不跑测试，混合代码仍按实际影响验证", () => {
  assert.deepEqual(classifyCiChanges([
    "README.md", ".trellis/tasks/current/task.json", ".trellis/workspace/silentflower/journal-2.md",
    ".trellis/spec/flower-trellis/cli/quality-guidelines.md",
  ]), { full: false, contracts: false, python: false, update: false });
  assert.deepEqual(classifyCiChanges(["README.md", ".trellis/workflow.md"]), RULES);
  assert.deepEqual(classifyCiChanges(["README.md", "src/cli.js"]), FULL);
});

test("Python 运行脚本只启动 Python 矩阵，已知更新模块只启动更新矩阵", () => {
  assert.deepEqual(classifyCiChanges([
    "src/assets/flower_session_start.py",
    "vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py",
    "test/python/test_untracked_flow.py",
    "test/python/test_flower_session_start.py",
  ]), { full: false, contracts: true, python: true, update: false });
  assert.deepEqual(classifyCiChanges(["src/lib/update-check.js", "src/lib/update-check-cache.js"]), {
    full: false, contracts: true, python: false, update: true,
  });
  assert.deepEqual(classifyCiChanges(["src/lib/update-backups.js", ".trellis/scripts/task.py"]), {
    full: false, contracts: true, python: true, update: true,
  });
});

test("Patch 配置、依赖、共享运行时、未知测试与空范围保留完整回归", () => {
  for (const files of [
    [], ["package-lock.json"], [".github/workflows/ci.yml"], ["scripts/ci-impact.mjs"],
    ["test/js/ci-impact.test.js"], ["test/js/new-runtime.test.js"], [".gitattributes"],
    ["src/commands/update.js"], ["src/plugin/application-service.js"],
    ["enhancements/0.6/overrides/patches/workflow/state-no-task/patch.json"],
    ["vendor/skill-garden/scripts/generate-compiled-targets.py"], ["unknown.py"],
  ]) assert.deepEqual(classifyCiChanges(files), FULL, JSON.stringify(files));
});

test("真实 Git 差异保留中文、空格、换行及重命名前后的路径", (t) => {
  const repo = temporaryRepository(t);
  const oldFile = "docs/中文 空格\n说明.md";
  repo.write(oldFile, "原文\n");
  repo.git("add", "--", oldFile);
  const base = repo.commit();
  const newFile = "src/assets/runtime.py";
  repo.write(newFile, "原文\n");
  fs.rmSync(path.join(repo.root, oldFile));
  repo.git("add", "-A");
  const head = repo.commit();
  assert.deepEqual(collectCiChanges(base, head, { root: repo.root }).sort(), [oldFile, newFile].sort());
});

test("PR 从合并基点比较，不把另一分支的文件混入当前改动", (t) => {
  const repo = temporaryRepository(t);
  repo.write("README.md", "基线\n");
  repo.git("add", "README.md");
  const base = repo.commit();
  repo.git("checkout", "-qb", "feature");
  repo.write(".trellis/workflow.md", "本分支文案\n");
  repo.git("add", ".trellis");
  const feature = repo.commit();
  repo.git("checkout", "--detach", base);
  repo.write("package-lock.json", "{}\n");
  repo.git("add", "package-lock.json");
  const otherBranch = repo.commit();
  assert.deepEqual(collectCiChanges(otherBranch, feature, { root: repo.root, mergeBase: true }), [".trellis/workflow.md"]);
});

test("展开真实子模块 pin，区分提示词修改与脚本修改", (t) => {
  const repo = temporaryRepository(t);
  repo.write("README.md", "父仓\n");
  repo.git("add", "README.md");
  const garden = repository(path.join(repo.root, "vendor/skill-garden"));
  garden.write("README.md", "子仓\n");
  garden.git("add", "README.md");
  const pin = (commit) => {
    repo.git("update-index", "--add", "--cacheinfo", `160000,${commit},vendor/skill-garden`);
    return repo.commit();
  };
  const base = pin(garden.commit());
  garden.write(".trellis/0.6/.agents/skills/demo/SKILL.md", "提示词\n");
  garden.git("add", ".trellis");
  const textHead = pin(garden.commit());
  const textFiles = collectCiChanges(base, textHead, { root: repo.root });
  assert.deepEqual(textFiles, ["vendor/skill-garden/.trellis/0.6/.agents/skills/demo/SKILL.md"]);
  assert.deepEqual(classifyCiChanges(textFiles, { root: repo.root }), RULES);
  garden.write(".trellis/0.6/scripts/demo.py", "print('脚本')\n");
  garden.git("add", ".trellis");
  const scriptHead = pin(garden.commit());
  assert.deepEqual(classifyCiChanges(collectCiChanges(textHead, scriptHead, { root: repo.root })), {
    full: false, contracts: true, python: true, update: false,
  });
  assert.throws(() => collectCiChanges("0".repeat(40), scriptHead, { root: repo.root }), /缺少有效/);
  assert.throws(() => collectCiChanges("f".repeat(40), scriptHead, { root: repo.root }));
});

test("文件模式变化和无法读取的子模块历史不能按文本跳过", (t) => {
  const repo = temporaryRepository(t);
  repo.write("README.md", "原文\n");
  repo.git("add", "README.md");
  const base = repo.commit();
  repo.git("update-index", "--chmod=+x", "--", "README.md");
  const modeHead = repo.commit();
  assert.throws(() => collectCiChanges(base, modeHead, { root: repo.root }), /文件模式变化/);
  repo.git("update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},vendor/skill-garden`);
  const pinHead = repo.commit();
  assert.throws(() => collectCiChanges(modeHead, pinHead, { root: repo.root }), /子模块新增/);
});

test("手动完整运行及 Git 比较失败都输出完整矩阵，保持 Actions 输出协议", (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-ci-output-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  for (const full of ["true", "false"]) {
    const output = path.join(target, `${full}.txt`);
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/ci-impact.mjs")], {
      encoding: "utf8", env: {
        ...process.env, CI_FULL: full, CI_BASE: "", CI_HEAD: "", GITHUB_OUTPUT: output,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), FULL);
    assert.equal(fs.readFileSync(output, "utf8"), "full=true\ncontracts=true\npython=true\nupdate=true\n");
    if (full === "false") assert.match(result.stderr, /采用完整回归/);
  }
});
