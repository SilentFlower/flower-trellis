import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { flowerVersion } from "../../src/lib/versions.js";
import {
  SKILL_GARDEN_PLUGIN_ID,
  SkillGardenBuiltinProvider,
} from "../../src/builtin-plugins/skill-garden/provider.js";
import {
  applySkillGardenUninstall,
  planSkillGardenUninstall,
} from "../../src/builtin-plugins/skill-garden/uninstall.js";
import { isBuiltinProviderTrusted } from "../../src/plugin/capabilities/builtin-trust.js";
import { PluginApplicationService } from "../../src/plugin/application-service.js";
import { ProjectStore } from "../../src/plugin/state/project-store.js";
import { SourceRegistry } from "../../src/plugin/sources/source-registry.js";

function createTarget(t, version = "0.5.9") {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-skill-garden-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis/.version"), `${version}\n`);
  fs.mkdirSync(path.join(target, ".claude/skills"), { recursive: true });
  return target;
}

function quietApply(target, options) {
  const original = console.log;
  console.log = () => {};
  try {
    return applyEnhancements(target, options);
  } finally {
    console.log = original;
  }
}

test("builtin provider 使用进程内信任且 digest 稳定绑定 variant", (t) => {
  const target = createTarget(t, "0.6.5");
  fs.writeFileSync(
    path.join(target, ".trellis/workflow.md"),
    "Run `py -3 ./.trellis/scripts/task.py current`.\n",
  );
  const first = new SkillGardenBuiltinProvider({ projectRoot: target });
  const second = new SkillGardenBuiltinProvider({ projectRoot: target });
  assert.equal(isBuiltinProviderTrusted(first), true);
  assert.equal(first.integrity, second.integrity);
  assert.match(first.integrity, /^sha256:/);
  assert.equal(first.listCandidates(SKILL_GARDEN_PLUGIN_ID)[0].source.reference, "package:skill-garden:0.6");
  assert.equal(first.manifest.version, flowerVersion());
  const pluginPackage = first.readPackage(first.listCandidates(SKILL_GARDEN_PLUGIN_ID)[0]);
  assert.equal(pluginPackage.skillGarden.pythonCommand, "py -3");
  assert.ok(pluginPackage.catalogs.every((catalog) => (
    catalog.textMaterialization.trellisPythonCommand === "py -3"
  )));
});

test("builtin update 可刷新旧精确声明到当前 Flower 版本", (t) => {
  const target = createTarget(t);
  quietApply(target, { variant: "0.5", skills: ["trellis-route"] });
  const store = new ProjectStore(target);
  const plugins = store.readPlugins();
  plugins.plugins[0].version = "0.0.1";
  store.writePlugins(plugins);
  const provider = new SkillGardenBuiltinProvider({
    projectRoot: target,
    previousState: store.readState(),
  });
  const service = new PluginApplicationService(target, {
    store,
    registry: new SourceRegistry([provider]),
  });

  service.update({
    id: SKILL_GARDEN_PLUGIN_ID,
    version: provider.manifest.version,
  });
  assert.equal(store.readPlugins().plugins[0].version, flowerVersion());
});

test("legacy manifest 只读迁移到 Plugin state 且重复运行不改旧证据", (t) => {
  const target = createTarget(t);
  quietApply(target, { variant: "0.5", skills: ["trellis-route"] });
  fs.rmSync(path.join(target, ".flower"), { recursive: true, force: true });
  const legacy = {
    flowerVersion: flowerVersion(),
    variant: "0.5",
    version: "0.5.9",
    skills: ["trellis-route"],
    paths: [".claude/skills/trellis-route"],
  };
  const legacyPath = path.join(target, ".trellis/.flower-manifest.json");
  const legacyText = `${JSON.stringify(legacy, null, 2)}\n`;
  fs.writeFileSync(legacyPath, legacyText);

  const first = quietApply(target, { variant: "0.5", skills: ["trellis-route"] });
  const statePath = path.join(target, ".flower/state.json");
  const firstState = fs.readFileSync(statePath, "utf8");
  const state = JSON.parse(firstState);
  assert.deepEqual(state.migration, {
    source: "legacy-flower-manifest",
    schemaVersion: 1,
  });
  assert.ok(state.plugins.some(({ id }) => id === SKILL_GARDEN_PLUGIN_ID));
  assert.equal(fs.readFileSync(legacyPath, "utf8"), legacyText);

  const second = quietApply(target, { variant: "0.5", skills: ["trellis-route"] });
  assert.equal(first.runtime.transaction.status, "applied");
  assert.equal(second.runtime.transaction.status, "unchanged");
  assert.equal(fs.readFileSync(statePath, "utf8"), firstState);
  assert.equal(fs.readFileSync(legacyPath, "utf8"), legacyText);

  fs.unlinkSync(legacyPath);
  quietApply(target, { variant: "0.5", skills: ["trellis-route"] });
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")).migration, {
    source: "legacy-flower-manifest",
    schemaVersion: 1,
  });
});

test("损坏或目标缺失的 legacy manifest 在事务前失败", (t) => {
  const corrupt = createTarget(t);
  fs.writeFileSync(path.join(corrupt, ".trellis/.flower-manifest.json"), "{broken\n");
  assert.throws(
    () => quietApply(corrupt, { variant: "0.5", skills: ["trellis-route"] }),
    /旧 flower manifest 损坏/,
  );
  assert.equal(fs.existsSync(path.join(corrupt, ".flower")), false);

  const drift = createTarget(t);
  fs.writeFileSync(path.join(drift, ".trellis/.flower-manifest.json"), `${JSON.stringify({
    flowerVersion: flowerVersion(),
    variant: "0.5",
    paths: [".claude/skills/missing"],
  })}\n`);
  assert.throws(
    () => quietApply(drift, { variant: "0.5", skills: ["trellis-route"] }),
    /目标缺失/,
  );
  assert.equal(fs.existsSync(path.join(drift, ".flower")), false);
});

test("uninstall 只删除 state hash 匹配的独占文件，漂移时保留证据", (t) => {
  const clean = createTarget(t);
  quietApply(clean, { variant: "0.5", skills: ["trellis-route"] });
  const cleanSkill = path.join(clean, ".claude/skills/trellis-route/SKILL.md");
  const cleanPlan = planSkillGardenUninstall(clean);
  fs.rmSync(path.join(clean, ".trellis"), { recursive: true, force: true });
  const cleanResult = applySkillGardenUninstall(clean, cleanPlan);
  assert.equal(cleanResult.conflicts.length, 0);
  assert.equal(fs.existsSync(cleanSkill), false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(clean, ".flower/state.json"), "utf8")).plugins,
    [],
  );

  const drift = createTarget(t);
  quietApply(drift, { variant: "0.5", skills: ["trellis-route", "trellis-push"] });
  const driftSkill = path.join(drift, ".claude/skills/trellis-route/SKILL.md");
  const cleanDriftSkill = path.join(drift, ".claude/skills/trellis-push/SKILL.md");
  fs.appendFileSync(driftSkill, "\n用户修改\n");
  const driftPlan = planSkillGardenUninstall(drift);
  fs.rmSync(path.join(drift, ".trellis"), { recursive: true, force: true });
  const driftResult = applySkillGardenUninstall(drift, driftPlan);
  assert.equal(driftResult.status, "conflict");
  assert.ok(driftResult.removed > 0);
  assert.equal(fs.existsSync(driftSkill), true);
  assert.equal(fs.existsSync(cleanDriftSkill), false);
  assert.ok(
    JSON.parse(fs.readFileSync(path.join(drift, ".flower/state.json"), "utf8"))
      .plugins.some(({ id }) => id === SKILL_GARDEN_PLUGIN_ID),
  );
});

test("uninstall 计划在 Trellis 删除前报告仍依赖 skill-garden 的 Plugin", (t) => {
  const target = createTarget(t);
  quietApply(target, { variant: "0.5", skills: ["trellis-route"] });
  const store = new ProjectStore(target);
  const plugins = store.readPlugins();
  plugins.plugins.push({
    id: "local/dependent",
    source: "local",
    version: "1.0.0",
  });
  store.writePlugins(plugins);
  const lock = store.readLock();
  const skillGarden = lock.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
  lock.roots.push("local/dependent");
  lock.plugins.push({
    id: "local/dependent",
    version: "1.0.0",
    source: { id: "local", type: "local", reference: "plugins/dependent" },
    commit: null,
    integrity: `sha256:${"a".repeat(64)}`,
    dependencies: { [SKILL_GARDEN_PLUGIN_ID]: skillGarden.version },
    compatibility: { flower: "*" },
    capabilities: {
      profile: "standard",
      granted: [],
      denied: [],
      approvalDigest: null,
    },
  });
  store.writeLock(lock);

  assert.deepEqual(planSkillGardenUninstall(target).dependents, ["local/dependent"]);
});

test("replay 冻结 skill-garden 时保留原 lock/state 且不重算 variant", (t) => {
  const target = createTarget(t);
  quietApply(target, { variant: "0.5", skills: ["trellis-route"] });
  const store = new ProjectStore(target);
  const beforeLock = fs.readFileSync(path.join(target, ".flower/plugin-lock.json"), "utf8");
  const beforeState = fs.readFileSync(path.join(target, ".flower/state.json"), "utf8");
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.5\n");
  const lockedPlugin = store.readLock().plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
  const provider = new SkillGardenBuiltinProvider({
    projectRoot: target,
    previousState: store.readState(),
    preserve: true,
    lockedPlugin,
  });
  provider.manifest.dependencies = { "local/unexpected": "1.0.0" };
  assert.deepEqual(
    provider.listCandidates(SKILL_GARDEN_PLUGIN_ID)[0].manifest.dependencies,
    lockedPlugin.dependencies,
  );
  const service = new PluginApplicationService(target, {
    store,
    registry: new SourceRegistry([provider]),
  });

  const result = service.replay({ preserveIds: [SKILL_GARDEN_PLUGIN_ID] });
  assert.equal(result.transaction.status, "unchanged");
  assert.equal(fs.readFileSync(path.join(target, ".flower/plugin-lock.json"), "utf8"), beforeLock);
  assert.equal(fs.readFileSync(path.join(target, ".flower/state.json"), "utf8"), beforeState);
});

test("已启用 common skill 以 shared ownership 刷新且卸载保留", (t) => {
  const target = createTarget(t);
  const commonSkill = path.join(target, ".claude/skills/open-idea/SKILL.md");
  const removedCommonSkill = path.join(
    target,
    ".claude/skills/sub2api-account-json-fix/SKILL.md",
  );
  fs.mkdirSync(path.dirname(commonSkill), { recursive: true });
  fs.mkdirSync(path.dirname(removedCommonSkill), { recursive: true });
  fs.writeFileSync(commonSkill, "stale\n");
  fs.writeFileSync(removedCommonSkill, "removed\n");
  quietApply(target, { variant: "0.5" });
  const state = JSON.parse(fs.readFileSync(path.join(target, ".flower/state.json"), "utf8"));
  const commonState = state.plugins
    .find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID)
    .paths.find(({ path: value }) => value === ".claude/skills/open-idea/SKILL.md");
  assert.equal(commonState.ownership, "shared");
  assert.notEqual(fs.readFileSync(commonSkill, "utf8"), "stale\n");
  assert.equal(fs.existsSync(path.dirname(removedCommonSkill)), false);

  const cleanupPlan = planSkillGardenUninstall(target);
  assert.ok(cleanupPlan.shared.includes(".claude/skills/open-idea/SKILL.md"));
  fs.rmSync(path.join(target, ".trellis"), { recursive: true, force: true });
  applySkillGardenUninstall(target, cleanupPlan);
  assert.equal(fs.existsSync(commonSkill), true);
});

test("common craft-rpa 旧运行时软链与依赖缓存不阻断 Plugin 重放", (t) => {
  const target = createTarget(t);
  const skillRoot = path.join(target, ".claude/skills/craft-rpa");
  const recorderRoot = path.join(skillRoot, "recorder");
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, "SKILL.md"), "stale\n");
  quietApply(target, { variant: "0.5" });

  const profileTarget = path.join(target, ".craft-rpa/profile");
  const sessionTarget = path.join(target, ".craft-rpa/sessions/legacy/session.jsonl");
  fs.mkdirSync(profileTarget, { recursive: true });
  fs.mkdirSync(path.dirname(sessionTarget), { recursive: true });
  fs.writeFileSync(path.join(profileTarget, "preserved.txt"), "profile\n");
  fs.writeFileSync(sessionTarget, "{\"kind\":\"legacy\"}\n");
  fs.symlinkSync(profileTarget, path.join(recorderRoot, "profile"), "dir");
  fs.symlinkSync(sessionTarget, path.join(recorderRoot, "session.jsonl"));
  fs.mkdirSync(path.join(recorderRoot, "node_modules/playwright"), { recursive: true });
  fs.writeFileSync(path.join(recorderRoot, "node_modules/playwright/package.json"), "{}\n");

  assert.doesNotThrow(() => quietApply(target, { variant: "0.5" }));
  assert.equal(fs.lstatSync(path.join(recorderRoot, "profile")).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(recorderRoot, "session.jsonl")).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(recorderRoot, "node_modules/playwright/package.json")), true);
  assert.equal(fs.readFileSync(path.join(profileTarget, "preserved.txt"), "utf8"), "profile\n");
  assert.equal(fs.readFileSync(sessionTarget, "utf8"), "{\"kind\":\"legacy\"}\n");

  fs.symlinkSync(profileTarget, path.join(recorderRoot, "unexpected-link"), "dir");
  assert.throws(
    () => quietApply(target, { variant: "0.5" }),
    /Plugin tree 不允许软链:recorder\/unexpected-link/,
  );
});
