import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PATCH = "overrides/patches/skills/trellis-finish-work/exact-bookkeeping/content.md";
const source = fs.readFileSync(path.join(ROOT, "vendor/skill-garden/.trellis/0.6", PATCH), "utf8");

/**
 * 在隔离仓库执行 Git，避免个人配置、签名与 hooks 影响回归结果。
 * @param {string} root 临时仓库根目录
 * @param {...string} args Git 参数
 * @returns {string} 命令标准输出
 */
function git(root, ...args) {
  return execFileSync("git", ["-c", "core.hooksPath=.git/no-hooks", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(root, ".git/fixture-global-config"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * 写入测试文件并创建所需目录。
 * @param {string} root 临时仓库根目录
 * @param {string} relative 相对路径
 * @param {string} content 文件内容
 * @returns {void}
 */
function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

for (const withJournal of [true, false]) {
  test(`收尾模板仅提交一次且隔离无关变更：${withJournal ? "包含日志与子任务" : "日志与子任务无变化"}`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-finish-bookkeeping-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    git(root, "init", "-q");
    git(root, "config", "user.name", "Bookkeeping fixture");
    git(root, "config", "user.email", "bookkeeping@example.invalid");

    const task = ".trellis/tasks/current task";
    const archive = ".trellis/tasks/archive/2026-09/current task";
    const child = ".trellis/tasks/child/task.json";
    const journal = ".trellis/workspace/test/journal-1.md";
    const index = ".trellis/workspace/test/index.md";
    const unrelated = [
      "staged.txt",
      "unstaged.txt",
      ".trellis/tasks/other/prd.md",
      ".trellis/tasks/archive/2000-01/old/prd.md",
    ];
    for (const relative of [`${task}/task.json`, `${task}/prd.md`, child, journal, index, ...unrelated.slice(0, 2)]) {
      write(root, relative, "baseline\n");
    }
    git(root, "add", ".");
    git(root, "commit", "-qm", "fixture baseline");
    const baseline = git(root, "rev-parse", "HEAD").trim();

    write(root, "staged.txt", "staged content\n");
    git(root, "add", "--", "staged.txt");
    write(root, "staged.txt", "later unstaged content\n");
    for (const relative of unrelated.slice(1)) write(root, relative, "unrelated content\n");
    const statusBefore = git(root, "status", "--porcelain=v1", "-z", "--", ...unrelated);
    const stagedBefore = git(root, "ls-files", "--stage", "--", "staged.txt");
    const contentsBefore = unrelated.map((relative) => fs.readFileSync(path.join(root, relative), "utf8"));

    fs.mkdirSync(path.dirname(path.join(root, archive)), { recursive: true });
    fs.renameSync(path.join(root, task), path.join(root, archive));
    if (withJournal) {
      for (const relative of [child, journal, index]) write(root, relative, "finish bookkeeping\n");
    }

    const replacements = {
      "<original task source>": [task],
      "<actual archive destination>": [archive],
      "<changed child task.json files>": withJournal ? [child] : [],
      "<exact journal/index paths>": withJournal ? [journal, index] : [],
      '"<configured session commit message>"': ["chore: finish session"],
    };
    const block = source.match(/### 6\.[\s\S]*?```bash\n([\s\S]*?)\n```/);
    assert.ok(block, "收尾提交阶段必须有可执行命令模板");
    // 直接执行模板中的 Git 参数；占位路径保持独立参数，避免另写一份提交流程或依赖 shell。
    for (const line of block[1].replace(/\\\r?\n\s*/g, " ").trim().split("\n")) {
      const args = line.match(/"?<[^>]+>"?|\S+/g).flatMap((token) => replacements[token] ?? [token]);
      assert.equal(args.shift(), "git");
      assert.ok(args.every((arg) => !arg.includes("<")), "所有模板占位符必须显式替换");
      git(root, ...args);
    }

    assert.equal(git(root, "rev-list", "--count", `${baseline}..HEAD`).trim(), "1");
    assert.equal(git(root, "log", "-1", "--format=%s").trim(), "chore: finish session");
    assert.deepEqual(
      git(root, "diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "HEAD").trim().split("\n").sort(),
      [`${task}/task.json`, `${task}/prd.md`, `${archive}/task.json`, `${archive}/prd.md`, ...(withJournal ? [child, journal, index] : [])].sort(),
    );
    assert.equal(git(root, "status", "--porcelain=v1", "-z", "--", ...unrelated), statusBefore);
    assert.equal(git(root, "ls-files", "--stage", "--", "staged.txt"), stagedBefore);
    assert.deepEqual(unrelated.map((relative) => fs.readFileSync(path.join(root, relative), "utf8")), contentsBefore);
    assert.equal(git(root, "status", "--porcelain=v1", "--", task, archive, child, journal, index), "");
  });
}

test("收尾合并提交同步快照并保留提交开关和推送边界", () => {
  assert.equal(fs.readFileSync(path.join(ROOT, "enhancements/0.6", PATCH), "utf8"), source);
  assert.match(source, /When `session_auto_commit: false`, keep the archive and journal changes on disk without committing or pushing/);
  assert.match(source, /the only newly ahead commit is this run's bookkeeping commit/);
  assert.match(source, /branch was already ahead, behind, diverged, or lacked upstream at the start/);
  assert.match(source, /concurrent commit, branch\/upstream change, or push rejection/);
  assert.doesNotMatch(source, /separate scoped commits|second commit|archive commit when present|journal commit when present/);
});
