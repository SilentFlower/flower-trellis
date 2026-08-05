import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  installCommonSkills,
  listSkillCatalog,
} from "../../src/lib/skill-catalog.js";
import { ENHANCEMENTS_ROOT } from "../../src/lib/paths.js";

const SKILL_NAME = "aliyun-dms-query";
const EXPECTED_FILES = ["SKILL.md", "assets/env.example", "scripts/dms.py"];
const ROOT = path.resolve(ENHANCEMENTS_ROOT, "..");
const SOURCE_ROOT = path.join(ROOT, "vendor", "skill-garden", ".common");
const SNAPSHOT_ROOT = path.join(ENHANCEMENTS_ROOT, "common", ".common");
const DMS_SCRIPT = path.join(
  SNAPSHOT_ROOT,
  ".codex",
  "skills",
  SKILL_NAME,
  "scripts",
  "dms.py",
);

/**
 * 返回指定平台的 DMS Skill 目录。
 *
 * @param {string} root common Skill 根目录
 * @param {string} platform 平台名称
 * @returns {string} DMS Skill 绝对路径
 */
function skillPath(root, platform) {
  return path.join(root, `.${platform}`, "skills", SKILL_NAME);
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
 * 断言两个 DMS Skill 目录的核心资产完全一致。
 *
 * @param {string} left 左侧 Skill 目录
 * @param {string} right 右侧 Skill 目录
 * @returns {void}
 */
function assertSkillTreesEqual(left, right) {
  const expected = [...EXPECTED_FILES].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(listRelativeFiles(left), expected);
  assert.deepEqual(listRelativeFiles(right), expected);
  for (const relative of expected) {
    const parts = relative.split("/");
    assert.deepEqual(
      fs.readFileSync(path.join(left, ...parts)),
      fs.readFileSync(path.join(right, ...parts)),
      relative,
    );
  }
}

/**
 * 创建带指定平台目录的临时 Trellis 项目。
 *
 * @param {import("node:test").TestContext} t 测试上下文
 * @param {string[]} platforms 平台名称
 * @returns {string} 临时项目根目录
 */
function createTarget(t, platforms) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-dms-skill-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis", ".version"), "0.6.5\n");
  for (const platform of platforms) {
    fs.mkdirSync(path.join(target, `.${platform}`), { recursive: true });
  }
  return target;
}

/**
 * 使用假凭证执行 DMS CLI 的本地分支。
 *
 * 显式传入 Tid 后，DML 拦截与工单预览都不会触发 RPC 请求。
 *
 * @param {string[]} args CLI 参数
 * @returns {import("node:child_process").SpawnSyncReturns<string>} 执行结果
 */
function runDms(args) {
  return spawnSync("python3", [DMS_SCRIPT, "--tid", "1", ...args], {
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      ALIYUN_ACCESS_KEY_ID: "test-access-key",
      ALIYUN_ACCESS_KEY_SECRET: "test-access-secret",
      ALIYUN_DMS_ENV_FILE: "",
    },
  });
}

test("DMS common Skill 源与快照保持双平台一致且不含凭证", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ENHANCEMENTS_ROOT, "MANIFEST.json"), "utf8"),
  );
  assert.ok(manifest.common.codexSkills.includes(SKILL_NAME));
  assert.ok(manifest.common.claudeSkills.includes(SKILL_NAME));

  const sourceCodex = skillPath(SOURCE_ROOT, "codex");
  const sourceClaude = skillPath(SOURCE_ROOT, "claude");
  const snapshotCodex = skillPath(SNAPSHOT_ROOT, "codex");
  const snapshotClaude = skillPath(SNAPSHOT_ROOT, "claude");
  assertSkillTreesEqual(sourceCodex, sourceClaude);
  assertSkillTreesEqual(snapshotCodex, snapshotClaude);
  assertSkillTreesEqual(sourceCodex, snapshotCodex);

  for (const root of [sourceCodex, sourceClaude, snapshotCodex, snapshotClaude]) {
    assert.equal(fs.statSync(path.join(root, "SKILL.md")).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(root, "assets", "env.example")).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(root, "scripts", "dms.py")).mode & 0o777, 0o755);
    assert.equal(
      listRelativeFiles(root).some((file) => (
        file.includes("__pycache__") || file.endsWith(".pyc")
      )),
      false,
    );
  }

  const skill = fs.readFileSync(path.join(sourceCodex, "SKILL.md"), "utf8");
  assert.match(skill, /^name: aliyun-dms-query$/m);
  assert.match(skill, /CreateDataCorrectOrder/);
  assert.match(skill, /python3 scripts\/dms\.py instances/);
  assert.match(skill, /python3 scripts\/dms\.py --format csv query/);
  assert.doesNotMatch(skill, /python3 scripts\/dms\.py query[^\n]*--format/);
  assert.doesNotMatch(skill, /~\/\.claude/);

  const envExample = fs.readFileSync(
    path.join(sourceCodex, "assets", "env.example"),
    "utf8",
  );
  assert.match(envExample, /^ALIYUN_ACCESS_KEY_ID=$/m);
  assert.match(envExample, /^ALIYUN_ACCESS_KEY_SECRET=$/m);
  assert.doesNotMatch(envExample, /LTAI[0-9A-Za-z]+/);
});

test("DMS CLI 在无网络分支拦截 DML 且工单默认只预览", () => {
  const help = runDms(["--help"]);
  assert.equal(help.error, undefined);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /只读直连，DML 走工单/);

  const rejected = runDms([
    "query",
    "--db",
    "1",
    "--sql",
    "UPDATE t_xxx SET c_a='1' WHERE 1=0",
  ]);
  assert.equal(rejected.error, undefined);
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /拒绝执行/);
  assert.match(rejected.stderr, /请改用: dms\.py order/);

  const preview = runDms([
    "--format",
    "csv",
    "order",
    "--db",
    "1",
    "--sql",
    "UPDATE t_xxx SET c_a='1' WHERE 1=0",
    "--rows",
    "0",
    "--comment",
    "【生产库】零影响预览\n【原因】验证默认不提交",
  ]);
  assert.equal(preview.error, undefined);
  assert.equal(preview.status, 0);
  assert.match(preview.stdout, /待提交的数据变更工单/);
  assert.match(preview.stderr, /未提交/);
  assert.doesNotMatch(`${preview.stdout}\n${preview.stderr}`, /工单已创建/);
});

for (const platforms of [["codex"], ["claude"], ["codex", "claude"]]) {
  test(`DMS common Skill 按目标平台安装:${platforms.join("+")}`, (t) => {
    const target = createTarget(t, platforms);
    const catalog = listSkillCatalog(target, "0.6");
    const item = catalog.commonSkills.find(({ name }) => name === SKILL_NAME);
    assert.ok(item);
    assert.match(item.description, /阿里云 DMS/);
    assert.equal(item.installed, false);

    const result = installCommonSkills(target, [SKILL_NAME]);
    assert.deepEqual(result.installed, [SKILL_NAME]);
    assert.deepEqual(result.skipped, []);
    for (const platform of ["codex", "claude"]) {
      const installed = fs.existsSync(
        path.join(target, `.${platform}`, "skills", SKILL_NAME, "scripts", "dms.py"),
      );
      assert.equal(installed, platforms.includes(platform), platform);
    }
  });
}
