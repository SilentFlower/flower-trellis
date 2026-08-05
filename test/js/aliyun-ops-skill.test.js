import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  describeInstalledCommonSkillSync,
  installCommonSkills,
  listSkillCatalog,
  removeCommonSkills,
  syncInstalledCommonSkills,
} from "../../src/lib/skill-catalog.js";
import { ENHANCEMENTS_ROOT } from "../../src/lib/paths.js";

const SKILL_NAME = "aliyun-ops";
const OLD_SKILL_NAMES = ["aliyun-dms-query", "aliyun-sls-query"];
const EXPECTED_FILES = [
  "SKILL.md",
  "agents/openai.yaml",
  "assets/env.example",
  "references/dms.md",
  "references/mse.md",
  "references/sls.md",
  "scripts/aliyun_common.py",
  "scripts/aliyun_rpc_v1.py",
  "scripts/dms.py",
  "scripts/mse.py",
  "scripts/sls_get_logs.py",
].sort((left, right) => left.localeCompare(right));
const ROOT = path.resolve(ENHANCEMENTS_ROOT, "..");
const GARDEN_ROOT = path.join(ROOT, "vendor", "skill-garden");
const SOURCE_ROOT = path.join(GARDEN_ROOT, ".common");
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
 * 返回指定 common 根和平台的统一 Skill 目录。
 *
 * @param {string} root common 根目录
 * @param {string} platform 平台名称
 * @returns {string} Skill 绝对路径
 */
function skillPath(root, platform) {
  return path.join(root, `.${platform}`, "skills", SKILL_NAME);
}

/**
 * 递归列出目录内普通文件。
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
 * 断言两个 Skill 树逐文件一致。
 *
 * @param {string} left 左侧 Skill 目录
 * @param {string} right 右侧 Skill 目录
 * @returns {void}
 */
function assertSkillTreesEqual(left, right) {
  assert.deepEqual(listRelativeFiles(left), EXPECTED_FILES);
  assert.deepEqual(listRelativeFiles(right), EXPECTED_FILES);
  for (const relative of EXPECTED_FILES) {
    assert.deepEqual(
      fs.readFileSync(path.join(left, ...relative.split("/"))),
      fs.readFileSync(path.join(right, ...relative.split("/"))),
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
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-aliyun-ops-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis", ".version"), "0.6.5\n");
  for (const platform of platforms) {
    fs.mkdirSync(path.join(target, `.${platform}`), { recursive: true });
  }
  return target;
}

/**
 * 在目标 common 根写入一个旧版 Skill 占位文件。
 *
 * @param {string} target 项目根目录
 * @param {string} base common Skill 相对根
 * @param {string} name Skill 名称
 * @returns {string} 已写入的 SKILL.md 路径
 */
function seedSkill(target, base, name) {
  const file = path.join(target, ...base.split("/"), name, "SKILL.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `stale:${name}\n`);
  return file;
}

/**
 * 使用假凭证执行 DMS CLI 的本地安全分支。
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
      HOME: path.join(os.tmpdir(), "flower-aliyun-empty-home"),
      PYTHONDONTWRITEBYTECODE: "1",
      ALIYUN_ACCESS_KEY_ID: "test-access-key",
      ALIYUN_ACCESS_KEY_SECRET: "test-access-secret",
      ALIYUN_DMS_ENV_FILE: "",
      ALIYUN_OPS_ENV_FILE: "",
    },
  });
}

/**
 * 创建可被独立安装器 clone 的最小 skill-garden 仓库。
 *
 * @param {import("node:test").TestContext} t 测试上下文
 * @returns {string} 临时 Git 仓库路径
 */
function createInstallerRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "flower-aliyun-garden-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repo, "README.md"), "test garden\n");
  fs.mkdirSync(path.join(repo, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".trellis", ".keep"), "\n");
  fs.cpSync(path.join(GARDEN_ROOT, ".common"), path.join(repo, ".common"), {
    recursive: true,
  });
  for (const args of [
    ["init"],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "Test User"],
    ["add", "."],
    ["commit", "-m", "test garden"],
  ]) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  return repo;
}

/**
 * 执行 skill-garden 独立安装器。
 *
 * @param {string} repo 安装源 Git 仓库
 * @param {string} target 目标项目
 * @param {string[]} names 显式 Skill 名称
 * @param {NodeJS.ProcessEnv} envOverrides 额外环境变量
 * @returns {import("node:child_process").SpawnSyncReturns<string>} 执行结果
 */
function runInstaller(repo, target, names, envOverrides = {}) {
  return spawnSync(
    "bash",
    [
      path.join(GARDEN_ROOT, "scripts", "install.sh"),
      "--scope",
      "common",
      "--repo",
      repo,
      target,
      ...names,
    ],
    {
      encoding: "utf8",
      timeout: 20000,
      env: {
        ...process.env,
        SKILL_GARDEN_BOOTSTRAPPED: "1",
        ...envOverrides,
      },
    },
  );
}

/**
 * 在隔离 HOME 中创建新旧三份阿里云私有 ENV 文件。
 *
 * @param {string} home 隔离 HOME 路径
 * @returns {string[]} ENV 文件路径
 */
function createCredentialEnvFiles(home) {
  const files = [
    ["aliyun-ops", "ALIYUN_ACCESS_KEY_ID=test-unified-ak\n"],
    ["aliyun-dms-query", "ALIYUN_ACCESS_KEY_SECRET=test-dms-sk\n"],
    ["aliyun-sls-query", "ALIYUN_SLS_PROJECT=test-project\n"],
  ].map(([name, content]) => {
    const file = path.join(home, ".config", name, "env");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    fs.chmodSync(file, 0o600);
    return file;
  });
  return files;
}

/**
 * 记录 ENV 文件内容、权限与修改时间。
 *
 * @param {string[]} files ENV 文件路径
 * @returns {Array<{file:string,content:Buffer,mode:number,mtimeNs:bigint}>} 文件快照
 */
function snapshotCredentialEnvFiles(files) {
  return files.map((file) => {
    const status = fs.statSync(file, { bigint: true });
    return {
      file,
      content: fs.readFileSync(file),
      mode: Number(status.mode & 0o777n),
      mtimeNs: status.mtimeNs,
    };
  });
}

/**
 * 断言安装或升级后 ENV 文件完全不变。
 *
 * @param {Array<{file:string,content:Buffer,mode:number,mtimeNs:bigint}>} expected 文件快照
 * @returns {void}
 */
function assertCredentialEnvFilesUnchanged(expected) {
  for (const item of expected) {
    assert.equal(fs.existsSync(item.file), true, item.file);
    const status = fs.statSync(item.file, { bigint: true });
    assert.deepEqual(fs.readFileSync(item.file), item.content, item.file);
    assert.equal(Number(status.mode & 0o777n), item.mode, item.file);
    assert.equal(status.mtimeNs, item.mtimeNs, item.file);
  }
}

/**
 * 临时覆盖随包 manifest 读取结果，用于验证运行时失效保护。
 *
 * @param {object} manifest 待注入的 manifest
 * @param {() => unknown} callback 在覆盖期间执行的同步回调
 * @returns {unknown} 回调返回值
 */
function withManifestOverride(manifest, callback) {
  const manifestFile = path.join(ENHANCEMENTS_ROOT, "MANIFEST.json");
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function readFileSyncWithManifestOverride(file, ...args) {
    if (path.resolve(String(file)) === manifestFile) {
      const content = `${JSON.stringify(manifest)}\n`;
      return args[0] ? content : Buffer.from(content);
    }
    return originalReadFileSync.call(this, file, ...args);
  };
  try {
    return callback();
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
}

test("统一阿里云 Skill 源、快照与双平台保持一致", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ENHANCEMENTS_ROOT, "MANIFEST.json"), "utf8"),
  );
  assert.ok(manifest.common.codexSkills.includes(SKILL_NAME));
  assert.ok(manifest.common.claudeSkills.includes(SKILL_NAME));
  for (const oldName of OLD_SKILL_NAMES) {
    assert.equal(manifest.common.codexSkills.includes(oldName), false);
    assert.equal(manifest.common.claudeSkills.includes(oldName), false);
    assert.ok(manifest.common.removedSkills.includes(oldName));
  }
  assert.deepEqual(manifest.common.skillMigrations, [
    { from: "aliyun-dms-query", to: SKILL_NAME },
    { from: "aliyun-sls-query", to: SKILL_NAME },
  ]);

  const sourceCodex = skillPath(SOURCE_ROOT, "codex");
  const sourceClaude = skillPath(SOURCE_ROOT, "claude");
  const snapshotCodex = skillPath(SNAPSHOT_ROOT, "codex");
  const snapshotClaude = skillPath(SNAPSHOT_ROOT, "claude");
  assertSkillTreesEqual(sourceCodex, sourceClaude);
  assertSkillTreesEqual(snapshotCodex, snapshotClaude);
  assertSkillTreesEqual(sourceCodex, snapshotCodex);

  for (const root of [sourceCodex, sourceClaude, snapshotCodex, snapshotClaude]) {
    for (const relative of EXPECTED_FILES) {
      const mode = fs.statSync(path.join(root, ...relative.split("/"))).mode & 0o777;
      assert.equal(mode, relative.startsWith("scripts/") ? 0o755 : 0o644, relative);
    }
    assert.equal(
      listRelativeFiles(root).some((file) => (
        file.includes("__pycache__") || file.endsWith(".pyc")
      )),
      false,
    );
  }

  const skill = fs.readFileSync(path.join(sourceCodex, "SKILL.md"), "utf8");
  assert.match(skill, /^name: aliyun-ops$/m);
  assert.match(skill, /DMS、SLS 和 MSE/);
  assert.match(skill, /不自动创建、复制、合并、改写、改权限或删除/);
  assert.match(skill, /MSE 当前配置与历史配置无 `--grep` 时只输出摘要/);

  const dmsReference = fs.readFileSync(path.join(sourceCodex, "references/dms.md"), "utf8");
  assert.match(dmsReference, /CreateDataCorrectOrder/);
  assert.match(dmsReference, /python3 scripts\/dms\.py --format csv query/);
  assert.doesNotMatch(dmsReference, /python3 scripts\/dms\.py query[^\n]*--format/);

  const slsReference = fs.readFileSync(path.join(sourceCodex, "references/sls.md"), "utf8");
  assert.match(slsReference, /Java Forest\/HTTP trace 配对纪律/);
  assert.match(slsReference, /project\/logstore 选择纪律/);
  assert.match(slsReference, /xhgj-zysys/);
  assert.match(slsReference, /xhxhgjmall/);

  const envExample = fs.readFileSync(path.join(sourceCodex, "assets/env.example"), "utf8");
  assert.match(envExample, /^ALIYUN_ACCESS_KEY_ID=$/m);
  assert.match(envExample, /^ALIYUN_ACCESS_KEY_SECRET=$/m);
  assert.match(envExample, /^ALIYUN_MSE_REGION=cn-hangzhou$/m);
  assert.doesNotMatch(envExample, /LTAI[0-9A-Za-z]+/);
});

test("DMS CLI 保持 DML 拦截与工单默认预览", () => {
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
  assert.equal(preview.status, 0);
  assert.match(preview.stdout, /待提交的数据变更工单/);
  assert.match(preview.stderr, /未提交/);
  assert.doesNotMatch(`${preview.stdout}\n${preview.stderr}`, /工单已创建/);
});

test("Trellis workflow skill 菜单显示中文短说明", (t) => {
  const target = createTarget(t, ["codex"]);
  const catalog = listSkillCatalog(target, "0.6");
  const descriptions = Object.fromEntries(
    catalog.enhancementSkills.map((item) => [item.name, item.description]),
  );
  assert.equal(descriptions["trellis-worktree"], "管理分支本地化 Trellis worktree");
  assert.equal(descriptions["trellis-flower-update"], "手动追平已安装 Flower 强化包");
});

for (const platforms of [["codex"], ["claude"], ["codex", "claude"]]) {
  test(`统一 common Skill 按目标平台安装:${platforms.join("+")}`, (t) => {
    const target = createTarget(t, platforms);
    const catalog = listSkillCatalog(target, "0.6");
    const item = catalog.commonSkills.find(({ name }) => name === SKILL_NAME);
    assert.ok(item);
    assert.equal(item.description, "统一查询阿里云 DMS、SLS 与 MSE 运维数据");
    assert.equal(item.installed, false);
    assert.equal(catalog.commonSkills.some(({ name }) => OLD_SKILL_NAMES.includes(name)), false);

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

test("多个旧名称作为安装别名时去重且最终只保留统一 Skill", (t) => {
  const target = createTarget(t, ["codex"]);
  for (const oldName of OLD_SKILL_NAMES) seedSkill(target, ".codex/skills", oldName);

  const result = installCommonSkills(target, OLD_SKILL_NAMES);

  assert.deepEqual(result.installed, [SKILL_NAME]);
  assert.deepEqual(result.paths, [`.codex/skills/${SKILL_NAME}`]);
  assert.deepEqual(result.skipped, []);
  assert.equal(fs.existsSync(path.join(target, ".codex/skills", SKILL_NAME, "SKILL.md")), true);
  for (const oldName of OLD_SKILL_NAMES) {
    assert.equal(fs.existsSync(path.join(target, ".codex/skills", oldName)), false);
  }
});

test("停用统一 common Skill 只删除精确受管目录", (t) => {
  const target = createTarget(t, ["codex"]);
  installCommonSkills(target, [SKILL_NAME]);
  const userSkill = seedSkill(target, ".codex/skills", "user-skill");

  const result = removeCommonSkills(target, "0.6", [SKILL_NAME]);

  assert.ok(result.removed.includes(`.codex/skills/${SKILL_NAME}`));
  assert.equal(fs.existsSync(path.dirname(userSkill)), true);
  assert.equal(fs.readFileSync(userSkill, "utf8"), "stale:user-skill\n");
});

test("普通同步覆盖当前、双旧、legacy 与无旧 Skill 场景", (t) => {
  const currentTarget = createTarget(t, ["claude"]);
  const current = seedSkill(currentTarget, ".claude/skills", SKILL_NAME);
  const currentResult = syncInstalledCommonSkills(currentTarget);
  assert.ok(currentResult.refreshed.includes(SKILL_NAME));
  assert.notEqual(fs.readFileSync(current, "utf8"), `stale:${SKILL_NAME}\n`);

  const oldTarget = createTarget(t, ["codex", "claude"]);
  for (const oldName of OLD_SKILL_NAMES) {
    seedSkill(oldTarget, ".codex/skills", oldName);
    seedSkill(oldTarget, ".claude/skills", oldName);
  }
  seedSkill(oldTarget, ".agents/skills", "aliyun-sls-query");
  const userSkill = seedSkill(oldTarget, ".codex/skills", "user-skill");
  const migrated = syncInstalledCommonSkills(oldTarget);
  assert.ok(migrated.refreshed.includes(SKILL_NAME));
  assert.ok(migrated.removed.includes("aliyun-dms-query"));
  assert.ok(migrated.removed.includes("aliyun-sls-query"));
  for (const base of [".codex/skills", ".claude/skills", ".agents/skills"]) {
    assert.equal(fs.existsSync(path.join(oldTarget, ...base.split("/"), SKILL_NAME, "SKILL.md")), true);
    for (const oldName of OLD_SKILL_NAMES) {
      assert.equal(fs.existsSync(path.join(oldTarget, ...base.split("/"), oldName)), false);
    }
  }
  assert.equal(fs.readFileSync(userSkill, "utf8"), "stale:user-skill\n");

  const untouchedTarget = createTarget(t, ["claude"]);
  const untouched = syncInstalledCommonSkills(untouchedTarget);
  assert.deepEqual(untouched.refreshed, []);
  assert.equal(fs.existsSync(path.join(untouchedTarget, ".claude/skills", SKILL_NAME)), false);
});

test("无效迁移声明 fail closed，未声明迁移的旧 manifest 仍执行 tombstone", (t) => {
  const originalManifest = JSON.parse(
    fs.readFileSync(path.join(ENHANCEMENTS_ROOT, "MANIFEST.json"), "utf8"),
  );
  const invalidTarget = createTarget(t, ["codex"]);
  seedSkill(invalidTarget, ".codex/skills", "aliyun-dms-query");

  for (const skillMigrations of [
    [{ from: "aliyun-dms-query", to: "missing-target" }],
    [{ from: "aliyun-dms-query", to: "aliyun-dms-query" }],
  ]) {
    const manifest = structuredClone(originalManifest);
    manifest.common.skillMigrations = skillMigrations;
    manifest.common.removedSkills = ["aliyun-dms-query"];

    const description = withManifestOverride(
      manifest,
      () => describeInstalledCommonSkillSync(invalidTarget),
    );

    assert.deepEqual(description.refreshes, []);
    assert.deepEqual(description.removedTargets, []);
  }

  const legacyTarget = createTarget(t, ["codex"]);
  seedSkill(legacyTarget, ".codex/skills", "legacy-obsolete-skill");
  const legacyManifest = structuredClone(originalManifest);
  delete legacyManifest.common.skillMigrations;
  legacyManifest.common.removedSkills = ["legacy-obsolete-skill"];

  const legacyDescription = withManifestOverride(
    legacyManifest,
    () => describeInstalledCommonSkillSync(legacyTarget),
  );

  assert.deepEqual(legacyDescription.removedTargets, [
    ".codex/skills/legacy-obsolete-skill",
  ]);
});

test("独立安装器接受旧名称并且无关安装不触发迁移", (t) => {
  const repo = createInstallerRepo(t);
  const aliasTarget = createTarget(t, ["codex"]);
  for (const oldName of OLD_SKILL_NAMES) seedSkill(aliasTarget, ".codex/skills", oldName);
  const aliasResult = runInstaller(repo, aliasTarget, ["aliyun-dms-query"]);
  assert.equal(aliasResult.status, 0, `${aliasResult.stdout}\n${aliasResult.stderr}`);
  assert.equal(fs.existsSync(path.join(aliasTarget, ".codex/skills", SKILL_NAME, "SKILL.md")), true);
  for (const oldName of OLD_SKILL_NAMES) {
    assert.equal(fs.existsSync(path.join(aliasTarget, ".codex/skills", oldName)), false);
  }

  const unrelatedTarget = createTarget(t, ["codex"]);
  const oldSkill = seedSkill(unrelatedTarget, ".codex/skills", "aliyun-dms-query");
  const unrelatedResult = runInstaller(repo, unrelatedTarget, ["open-idea"]);
  assert.equal(unrelatedResult.status, 0, `${unrelatedResult.stdout}\n${unrelatedResult.stderr}`);
  assert.equal(fs.existsSync(oldSkill), true);
  assert.equal(fs.existsSync(path.join(unrelatedTarget, ".codex/skills", SKILL_NAME)), false);
});

test("独立安装器全量迁移旧 Skill 且不修改 ENV 文件", (t) => {
  const repo = createInstallerRepo(t);
  const target = createTarget(t, ["codex"]);
  for (const oldName of OLD_SKILL_NAMES) seedSkill(target, ".codex/skills", oldName);
  const envFiles = createCredentialEnvFiles(target);
  const before = snapshotCredentialEnvFiles(envFiles);

  const result = runInstaller(repo, target, [], { HOME: target });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(path.join(target, ".codex/skills", SKILL_NAME, "SKILL.md")), true);
  for (const oldName of OLD_SKILL_NAMES) {
    assert.equal(fs.existsSync(path.join(target, ".codex/skills", oldName)), false);
  }
  assertCredentialEnvFilesUnchanged(before);
});

test("Flower 普通升级迁移旧 Skill 且不修改 ENV 文件", (t) => {
  const target = createTarget(t, ["codex"]);
  for (const oldName of OLD_SKILL_NAMES) seedSkill(target, ".codex/skills", oldName);
  const envFiles = createCredentialEnvFiles(target);
  const before = snapshotCredentialEnvFiles(envFiles);

  const result = syncInstalledCommonSkills(target);

  assert.ok(result.refreshed.includes(SKILL_NAME));
  assert.equal(fs.existsSync(path.join(target, ".codex/skills", SKILL_NAME, "SKILL.md")), true);
  for (const oldName of OLD_SKILL_NAMES) {
    assert.equal(fs.existsSync(path.join(target, ".codex/skills", oldName)), false);
  }
  assertCredentialEnvFilesUnchanged(before);
});
