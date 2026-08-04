import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  installCommonSkills,
  listSkillCatalog,
  removeCommonSkills,
  syncInstalledCommonSkills,
} from "../../src/lib/skill-catalog.js";
import { ENHANCEMENTS_ROOT } from "../../src/lib/paths.js";

const SKILL_NAME = "aliyun-sls-query";
const ROOT = path.resolve(ENHANCEMENTS_ROOT, "..");
const SNAPSHOT_ROOT = path.join(ENHANCEMENTS_ROOT, "common", ".common");
const CODEX_SKILL = path.join(SNAPSHOT_ROOT, ".codex", "skills", SKILL_NAME);
const CLAUDE_SKILL = path.join(SNAPSHOT_ROOT, ".claude", "skills", SKILL_NAME);
const SOURCE_ROOT = path.join(ROOT, "vendor", "skill-garden", ".common");
const SOURCE_CODEX_SKILL = path.join(SOURCE_ROOT, ".codex", "skills", SKILL_NAME);
const SOURCE_CLAUDE_SKILL = path.join(SOURCE_ROOT, ".claude", "skills", SKILL_NAME);

/**
 * 创建带指定平台目录的临时 Trellis 项目。
 *
 * @param {import("node:test").TestContext} t 测试上下文
 * @param {string[]} platforms 平台名称
 * @returns {string} 临时项目根目录
 */
function createTarget(t, platforms) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-common-skill-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis", ".version"), "0.6.5\n");
  for (const platform of platforms) {
    fs.mkdirSync(path.join(target, `.${platform}`), { recursive: true });
  }
  return target;
}

/**
 * 递归列出目录内的普通文件。
 *
 * @param {string} root 目录根路径
 * @returns {string[]} POSIX 相对文件路径
 */
function listRelativeFiles(root) {
  const files = [];

  /**
   * 遍历当前目录。
   *
   * @param {string} current 当前绝对目录
   * @param {string} prefix 当前相对目录
   * @returns {void}
   */
  function visit(current, prefix = "") {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) files.push(relative);
    }
  }

  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

/**
 * 断言两个平台的 Skill 资产完全一致。
 *
 * @returns {void}
 */
function assertPlatformTreesEqual() {
  const expected = ["SKILL.md", "assets/env.example", "scripts/sls_get_logs.py"]
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(listRelativeFiles(CODEX_SKILL), expected);
  assert.deepEqual(listRelativeFiles(CLAUDE_SKILL), expected);
  for (const relative of expected) {
    assert.deepEqual(
      fs.readFileSync(path.join(CODEX_SKILL, ...relative.split("/"))),
      fs.readFileSync(path.join(CLAUDE_SKILL, ...relative.split("/"))),
      relative,
    );
  }
}

test("SLS common skill 快照在 Codex 与 Claude 中一致且不含凭证", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ENHANCEMENTS_ROOT, "MANIFEST.json"), "utf8"),
  );
  assert.ok(manifest.common.codexSkills.includes(SKILL_NAME));
  assert.ok(manifest.common.claudeSkills.includes(SKILL_NAME));
  assertPlatformTreesEqual();

  assert.equal(fs.statSync(path.join(CODEX_SKILL, "SKILL.md")).mode & 0o777, 0o644);
  assert.equal(
    fs.statSync(path.join(CODEX_SKILL, "assets", "env.example")).mode & 0o777,
    0o644,
  );
  assert.equal(
    fs.statSync(path.join(CODEX_SKILL, "scripts", "sls_get_logs.py")).mode & 0o777,
    0o755,
  );

  const envExample = fs.readFileSync(
    path.join(CODEX_SKILL, "assets", "env.example"),
    "utf8",
  );
  assert.match(envExample, /^ALIYUN_ACCESS_KEY_ID=$/m);
  assert.match(envExample, /^ALIYUN_ACCESS_KEY_SECRET=$/m);
  assert.doesNotMatch(envExample, /LTAI[0-9A-Za-z]+/);
  assert.equal(
    listRelativeFiles(CODEX_SKILL).some((file) => (
      file.includes("__pycache__") || file.endsWith(".pyc")
    )),
    false,
  );

  for (const file of [
    path.join(SOURCE_CODEX_SKILL, "SKILL.md"),
    path.join(SOURCE_CLAUDE_SKILL, "SKILL.md"),
    path.join(CODEX_SKILL, "SKILL.md"),
    path.join(CLAUDE_SKILL, "SKILL.md"),
  ]) {
    const skill = fs.readFileSync(file, "utf8");
    assert.match(skill, /Java Forest\/HTTP trace 配对纪律/);
    assert.match(skill, /Response: Status = \.\.\./);
    assert.match(skill, /调用接口异常/);
    assert.match(skill, /project\/logstore 选择纪律/);
    assert.match(skill, /xhgj-zysys/);
    assert.match(skill, /xhxhgjmall/);
  }
});

test("Trellis workflow skill 菜单显示中文短说明", (t) => {
  const target = createTarget(t, ["codex"]);
  const catalog = listSkillCatalog(target, "0.6");
  const descriptions = Object.fromEntries(
    catalog.enhancementSkills.map((item) => [item.name, item.description]),
  );

  assert.equal(descriptions["trellis-worktree"], "准备 linked worktree 的 Trellis 入口");
  assert.equal(descriptions["trellis-flower-update"], "手动追平已安装 Flower 强化包");
  assert.notEqual(descriptions["trellis-worktree"], "查看技能说明");
  assert.notEqual(descriptions["trellis-flower-update"], "查看技能说明");
});

for (const platforms of [["codex"], ["claude"], ["codex", "claude"]]) {
  test(`SLS common skill 按目标平台安装:${platforms.join("+")}`, (t) => {
    const target = createTarget(t, platforms);
    const catalog = listSkillCatalog(target, "0.6");
    const item = catalog.commonSkills.find(({ name }) => name === SKILL_NAME);
    assert.ok(item);
    assert.match(item.description, /阿里云 SLS/);
    assert.equal(item.installed, false);

    const result = installCommonSkills(target, [SKILL_NAME]);
    assert.deepEqual(result.installed, [SKILL_NAME]);
    assert.deepEqual(result.skipped, []);
    for (const platform of ["codex", "claude"]) {
      const installed = fs.existsSync(
        path.join(target, `.${platform}`, "skills", SKILL_NAME, "SKILL.md"),
      );
      assert.equal(installed, platforms.includes(platform), platform);
    }
  });
}

test("停用 SLS common skill 只删除精确受管目录", (t) => {
  const target = createTarget(t, ["codex"]);
  installCommonSkills(target, [SKILL_NAME]);
  const userSkill = path.join(target, ".codex", "skills", "user-skill", "SKILL.md");
  fs.mkdirSync(path.dirname(userSkill), { recursive: true });
  fs.writeFileSync(userSkill, "用户自有 Skill\n");

  const result = removeCommonSkills(target, "0.6", [SKILL_NAME]);
  assert.ok(result.removed.includes(`.codex/skills/${SKILL_NAME}`));
  assert.equal(fs.existsSync(path.join(target, ".codex", "skills", SKILL_NAME)), false);
  assert.equal(fs.readFileSync(userSkill, "utf8"), "用户自有 Skill\n");
});

test("更新只刷新已安装的 SLS common skill", (t) => {
  const installedTarget = createTarget(t, ["claude"]);
  installCommonSkills(installedTarget, [SKILL_NAME]);
  const installedSkill = path.join(
    installedTarget,
    ".claude",
    "skills",
    SKILL_NAME,
    "SKILL.md",
  );
  fs.writeFileSync(installedSkill, "旧版本\n");

  const refreshed = syncInstalledCommonSkills(installedTarget);
  assert.ok(refreshed.refreshed.includes(SKILL_NAME));
  assert.deepEqual(fs.readFileSync(installedSkill), fs.readFileSync(path.join(CLAUDE_SKILL, "SKILL.md")));

  const untouchedTarget = createTarget(t, ["claude"]);
  const untouched = syncInstalledCommonSkills(untouchedTarget);
  assert.deepEqual(untouched.refreshed, []);
  assert.equal(
    fs.existsSync(path.join(untouchedTarget, ".claude", "skills", SKILL_NAME)),
    false,
  );
});
