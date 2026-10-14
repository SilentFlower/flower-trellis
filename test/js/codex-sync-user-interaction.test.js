import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { applyPatchPlan, preparePatchPlan } from "../../src/lib/patch-engine.js";
import { flowerPatchAdapters } from "../../src/lib/platform-patch-adapters.js";
import { runFlower, snapshotProjectFiles } from "./plugin-e2e-helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CATALOG = {
  id: "flower",
  patchesDir: path.join(ROOT, "src/patches/platforms"),
  bundlesDir: path.join(ROOT, "src/patches/bundles"),
};

/**
 * 创建可清理的 Codex 配置目标。
 *
 * @param {object} t 当前测试上下文
 * @param {string|undefined} config 既有配置；undefined 表示文件缺失
 * @returns {string} 临时项目根目录
 */
function fixture(t, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-codex-input-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".trellis"));
  fs.mkdirSync(path.join(root, ".codex"));
  if (config !== undefined) fs.writeFileSync(path.join(root, ".codex/config.toml"), config);
  return root;
}

/**
 * 执行完整 Flower 平台 Patch，包含旧配置清理与新的默认值。
 *
 * @param {string} root 临时项目根目录
 * @param {object} [options] 精细安装选项
 * @returns {object} 真实 Patch 执行结果
 */
function apply(root, options = {}) {
  return applyPatchPlan(root, preparePatchPlan(root, [CATALOG], { adapters: flowerPatchAdapters(), ...options }));
}

test("Codex 默认值兼容表、点号键、内联表和 CRLF，保留用户原文且幂等", (t) => {
  const cases = [
    undefined,
    'model = "custom"\n[agents]\nmax_depth = 2\n',
    '[features] # 用户特性\nhooks = true\n[agents]\nmax_depth = 2\n',
    'features.hooks = true\n[agents]\nmax_depth = 2\n',
    'features = { hooks = true, label = "a,b#c}" } # 保留 } 注释\n[agents]\nmax_depth = 2\n',
    'features = {}\n',
    'features = { hooks = true, }\n',
    'large = 9223372036854775807\n',
    '["features"]\nhooks = true\n',
    '[features.other]\nkeep = true\n',
    '[features]\r\nhooks = true\r\n[agents]\r\nmax_depth = 2\r\n',
  ];
  for (const input of cases) {
    const root = fixture(t, input);
    apply(root);
    const file = path.join(root, ".codex/config.toml");
    const output = fs.readFileSync(file, "utf8");
    assert.match(output, /default_mode_request_user_input = true/);
    assert.equal(parseToml(output, { integersAsBigInt: true }).features.default_mode_request_user_input, true);
    if (input?.includes("hooks = true")) assert.ok(output.includes("hooks = true"));
    if (input?.includes("max_depth = 2")) assert.ok(output.includes("max_depth = 2"));
    if (input?.includes("label =")) assert.ok(output.includes('label = "a,b#c}"') && output.includes("# 保留 } 注释"));
    if (input?.includes("\r\n")) {
      // 核心 Patch Engine 统一末尾为一个 LF；adapter 保留文件内部的 CRLF。
      assert.equal(output.slice(0, -1).replaceAll("\r\n", "").includes("\n"), false);
    }
    const before = snapshotProjectFiles(root);
    assert.equal(apply(root).changed, 0);
    assert.deepEqual(snapshotProjectFiles(root), before);
  }
});

test("已有同步询问 true/false 在三种配置写法中保持原值", (t) => {
  for (const value of ["true", "false"]) {
    for (const input of [
      `[features]\ndefault_mode_request_user_input = ${value} # 用户决定\n`,
      `features.default_mode_request_user_input = ${value}\n`,
      `features = { default_mode_request_user_input = ${value}, hooks = true }\n`,
    ]) {
      const root = fixture(t, input);
      apply(root);
      assert.equal(fs.readFileSync(path.join(root, ".codex/config.toml"), "utf8"), input);
    }
  }
});

test("字符串、数组和多行文本中的配置示例不能被当成真实 section 或默认值", (t) => {
  const input = 'note = """\n[features.multi_agent_v2]\nenabled = true\n[features]\ndefault_mode_request_user_input = false\n"""\n'
    + "literal = '''\n[features]\ndefault_mode_request_user_input = false\n'''\n"
    + 'examples = [\n  "[features]",\n  "features.default_mode_request_user_input = false",\n]\n';
  const root = fixture(t, input);
  apply(root);
  const output = fs.readFileSync(path.join(root, ".codex/config.toml"), "utf8");
  assert.ok(output.startsWith(input));
  assert.ok(output.endsWith('[features]\ndefault_mode_request_user_input = true\n'));
  assert.equal(apply(root).changed, 0);
});

test("只修正已知模板注释，不修改字符串中的同一段模板文字", (t) => {
  const payload = JSON.parse(fs.readFileSync(path.join(ROOT,
    "src/patches/platforms/codex/sync-user-interaction/config-content.json.txt"), "utf8"));
  const { from, to } = payload.commentReplacements[0];
  const plain = fixture(t, `${from}\n[agents]\nmax_depth=1\n`);
  apply(plain);
  assert.ok(fs.readFileSync(path.join(plain, ".codex/config.toml"), "utf8").startsWith(to + "\n"));
  const quotedInput = `note = '''\n${from}\n'''\n`;
  const quoted = fixture(t, quotedInput);
  apply(quoted);
  assert.ok(fs.readFileSync(path.join(quoted, ".codex/config.toml"), "utf8").startsWith(quotedInput));
  const combined = fixture(t, `${quotedInput}${from}\n[agents]\nmax_depth=1\n`);
  apply(combined);
  const output = fs.readFileSync(path.join(combined, ".codex/config.toml"), "utf8");
  assert.ok(output.startsWith(quotedInput));
  assert.ok(output.slice(quotedInput.length).startsWith(to + "\n"));
});

test("重复或损坏的目标配置阻断全部平台写入", (t) => {
  for (const input of [
    '[features]\ndefault_mode_request_user_input = "true"\n',
    '[features]\nhooks=true\n[features]\nhooks=false\n',
    '[features]\ndefault_mode_request_user_input=true\ndefault_mode_request_user_input=false\n',
    'features = { default_mode_request_user_input = 1 }\n',
    'features = false\n',
    'features = { hooks = true }\n[features.other]\nkeep=true\n',
    'features.hooks = true\n[features]\nother=true\n',
    '[features.default_mode_request_user_input]\nvalue=true\n',
    '[features\nhooks=true\n',
    'note = """unterminated\n',
    'features..default_mode_request_user_input = true\n',
    'model = this is broken\n',
    '[agents]\nmax_depth = invalid\n',
    'model="one"\nmodel="two"\n',
  ]) {
    const root = fixture(t, input);
    const before = snapshotProjectFiles(root);
    assert.throws(() => apply(root), /TOML/);
    assert.deepEqual(snapshotProjectFiles(root), before);
  }
});

test("损坏配置的错误只显示位置，不回显相邻配置值", (t) => {
  const input = 'private = "sensitive-fixture-value"\nmodel = invalid value\n';
  const root = fixture(t, input);
  const before = snapshotProjectFiles(root);
  assert.throws(() => apply(root), (error) => {
    assert.match(error.message, /语法错误（行 2，列 /);
    assert.equal(error.message.includes("sensitive-fixture-value"), false);
    return true;
  });
  assert.deepEqual(snapshotProjectFiles(root), before);
});

test("skill-only 安装和未启用 Codex 的项目不生成默认配置", (t) => {
  const root = fixture(t, '[agents]\nmax_depth = 1\n');
  const before = snapshotProjectFiles(root);
  assert.equal(apply(root, { skills: ["trellis-route"] }).changed, 0);
  assert.deepEqual(snapshotProjectFiles(root), before);
  fs.rmSync(path.join(root, ".codex"), { recursive: true });
  assert.equal(apply(root).changed, 0);
  assert.equal(fs.existsSync(path.join(root, ".codex")), false);
});

test("真实 init/update 通过 Plugin 生命周期分发同步默认值与交互规则", (t) => {
  const root = fixture(t);
  fs.rmSync(path.join(root, ".trellis"), { recursive: true });
  fs.rmSync(path.join(root, ".codex"), { recursive: true });
  const init = runFlower(root, ["init", "--codex", "--no-update-check", "-y"], { timeout: 60000 });
  assert.equal(init.status, 0, init.stderr + init.stdout);
  const file = path.join(root, ".codex/config.toml");
  assert.match(fs.readFileSync(file, "utf8"), /default_mode_request_user_input = true/);
  const wrapper = fs.readFileSync(path.join(root, ".trellis/scripts/flower_session_start.py"), "utf8");
  assert.ok(wrapper.includes("<trellis-codex-user-interaction>"));
  assert.ok(wrapper.includes("Do not call request_user_input_async, send_user_message_async"));
  const update = runFlower(root, ["update", "--enhance-only", "--no-update-check", "-y"], { timeout: 60000 });
  assert.equal(update.status, 0, update.stderr + update.stdout);
  assert.match(fs.readFileSync(file, "utf8"), /default_mode_request_user_input = true/);
  const before = snapshotProjectFiles(root);
  const dry = runFlower(root, ["update", "--enhance-only", "--dry-run", "--no-update-check", "-y"], { timeout: 60000 });
  assert.equal(dry.status, 0, dry.stderr + dry.stdout);
  assert.deepEqual(snapshotProjectFiles(root), before);
  const uninstall = runFlower(root, ["uninstall", "--dry-run"], { timeout: 60000 });
  assert.equal(uninstall.status, 0, uninstall.stderr + uninstall.stdout);
  assert.deepEqual(snapshotProjectFiles(root), before);
});
