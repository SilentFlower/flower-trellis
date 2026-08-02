import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ENHANCEMENT_SKILL_TARGETS } from "../../src/constants.js";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { isEnhancementSkillInstalled } from "../../src/lib/enhancement-catalog.js";

function makeTarget(prefix) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.5\n");
  return target;
}

function quietApply(target) {
  const original = console.log;
  console.log = () => {};
  try {
    return applyEnhancements(target, { variant: "0.6", skills: ["trellis-route"] });
  } finally {
    console.log = original;
  }
}

test("Kiro-only 项目只向原生 skill root 分发，不错误创建 Claude", () => {
  const target = makeTarget("flower-kiro-only-");
  fs.mkdirSync(path.join(target, ".kiro/skills"), { recursive: true });

  const result = quietApply(target);

  assert.ok(result.installed.includes("trellis-route"));
  assert.equal(
    fs.existsSync(path.join(target, ".kiro/skills/trellis-route/SKILL.md")),
    true,
  );
  assert.equal(fs.existsSync(path.join(target, ".claude")), false);
  assert.equal(isEnhancementSkillInstalled(target, "trellis-route"), true);
});

test("全部平台原生 skill root 获得同一 Flower Gate Skill", () => {
  const target = makeTarget("flower-platform-skill-matrix-");
  for (const { root } of ENHANCEMENT_SKILL_TARGETS) {
    fs.mkdirSync(path.join(target, ...root.split("/")), { recursive: true });
  }

  quietApply(target);

  assert.equal(ENHANCEMENT_SKILL_TARGETS.length, 18);
  for (const { platform, root } of ENHANCEMENT_SKILL_TARGETS) {
    const file = path.join(target, ...root.split("/"), "trellis-route", "SKILL.md");
    assert.equal(fs.existsSync(file), true, `${platform}:${root}`);
    assert.match(fs.readFileSync(file, "utf8"), /Phase 2\.1 completion contract/, platform);
  }
});

test("没有平台 root 时仅使用 Claude fallback", () => {
  const target = makeTarget("flower-platform-fallback-");

  quietApply(target);

  assert.equal(
    fs.existsSync(path.join(target, ".claude/skills/trellis-route/SKILL.md")),
    true,
  );
  assert.equal(fs.existsSync(path.join(target, ".agents")), false);
});

test("应用投影复用集中平台映射，卸载只读取 Plugin state", () => {
  const applySource = fs.readFileSync(new URL("../../src/builtin-plugins/skill-garden/content-adapter.js", import.meta.url), "utf8");
  const uninstallSource = fs.readFileSync(new URL("../../src/commands/uninstall.js", import.meta.url), "utf8");
  const catalogSource = fs.readFileSync(new URL("../../src/lib/enhancement-catalog.js", import.meta.url), "utf8");

  for (const source of [applySource, catalogSource]) {
    assert.match(source, /ENHANCEMENT_SKILL_TARGETS/);
  }
  assert.match(uninstallSource, /planSkillGardenUninstall/);
  assert.doesNotMatch(uninstallSource, /ENHANCEMENT_SKILL_TARGETS/);
});
