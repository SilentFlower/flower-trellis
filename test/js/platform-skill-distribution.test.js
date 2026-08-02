import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ENHANCEMENT_SKILL_TARGETS } from "../../src/constants.js";
import { validateDispatchCatalog } from "../../src/builtin-plugins/skill-garden/content-adapter.js";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { isEnhancementSkillInstalled } from "../../src/lib/enhancement-catalog.js";

function makeTarget(prefix) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.5\n");
  return target;
}

function quietApply(target, skills = ["trellis-route"]) {
  const original = console.log;
  console.log = () => {};
  try {
    return applyEnhancements(target, { variant: "0.6", skills });
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

  const catalog = JSON.parse(fs.readFileSync(
    path.join(
      "enhancements/0.6/.agents/skills/trellis-route/references/platform-dispatch.json",
    ),
    "utf8",
  ));
  const skillPlatforms = new Set(ENHANCEMENT_SKILL_TARGETS
    .flatMap(({ platforms }) => platforms)
    .filter((platform) => platform !== "windsurf")
    .map((platform) => platform === "claude" ? "claude-code" : platform));
  assert.deepEqual(
    [...skillPlatforms].sort(),
    catalog.platforms.map(({ id }) => id).sort(),
  );
  for (const { platform, root } of ENHANCEMENT_SKILL_TARGETS) {
    const file = path.join(target, ...root.split("/"), "trellis-route", "SKILL.md");
    assert.equal(fs.existsSync(file), true, `${platform}:${root}`);
    assert.match(fs.readFileSync(file, "utf8"), /Phase 2\.1 completion contract/, platform);
  }
});

test("dispatch catalog 拒绝重复 target、缺失 inline reason 和未知格式", () => {
  const catalogPath = path.join(
    "enhancements/0.6/.agents/skills/trellis-route/references/platform-dispatch.json",
  );
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.equal(validateDispatchCatalog(catalog, catalogPath), catalog);

  const duplicateTarget = structuredClone(catalog);
  duplicateTarget.platforms[1].checkAll.target = duplicateTarget.platforms[0].checkAll.target;
  assert.throws(
    () => validateDispatchCatalog(duplicateTarget, catalogPath),
    /checkAll\.target 重复/,
  );

  const missingReason = structuredClone(catalog);
  missingReason.platforms.find(({ id }) => id === "kilo").inlineOnlyReason = null;
  assert.throws(
    () => validateDispatchCatalog(missingReason, catalogPath),
    /inline-only checkAll 必须声明 reason/,
  );

  const unknownFormat = structuredClone(catalog);
  unknownFormat.platforms.find(({ id }) => id === "codex").checkAll.format = "unknown";
  assert.throws(
    () => validateDispatchCatalog(unknownFormat, catalogPath),
    /eligible checkAll 字段不合法/,
  );
});

test("dispatch catalog 为已启用平台投影专用 audit-only Check-All agent", () => {
  const target = makeTarget("flower-check-all-agent-matrix-");
  const catalog = JSON.parse(fs.readFileSync(
    path.join(
      "enhancements/0.6/.agents/skills/trellis-route/references/platform-dispatch.json",
    ),
    "utf8",
  ));
  const compiledRoot = path.resolve("vendor/skill-garden/compiled-targets/0.6.12/full/targets");
  const runtimePlatforms = catalog.platforms.flatMap((entry) => entry.runtimePlatforms || [entry.id]);
  const checkAllTargets = catalog.platforms
    .filter(({ checkAll }) => checkAll.eligible)
    .map(({ checkAll }) => checkAll.target);
  assert.equal(new Set(runtimePlatforms).size, runtimePlatforms.length);
  assert.equal(new Set(checkAllTargets).size, checkAllTargets.length);
  assert.ok(catalog.platforms.find(({ id }) => id === "devin").runtimePlatforms.includes("windsurf"));
  for (const entry of catalog.platforms) {
    assert.equal(
      fs.existsSync(path.join(compiledRoot, ...entry.detectPath.split("/"))),
      true,
      `${entry.id}:${entry.detectPath}`,
    );
    if (entry.implement.target) {
      assert.equal(
        fs.existsSync(path.join(compiledRoot, ...entry.implement.target.split("/"))),
        true,
        `${entry.id}:${entry.implement.target}`,
      );
    }
  }
  for (const { root } of ENHANCEMENT_SKILL_TARGETS) {
    fs.mkdirSync(path.join(target, ...root.split("/")), { recursive: true });
  }
  for (const entry of catalog.platforms) {
    fs.mkdirSync(path.join(target, ...entry.detectPath.split("/")), { recursive: true });
    if (entry.implement.target) {
      const source = path.join(compiledRoot, ...entry.implement.target.split("/"));
      const destination = path.join(target, ...entry.implement.target.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
    if (entry.checkAll.target) {
      fs.mkdirSync(
        path.dirname(path.join(target, ...entry.checkAll.target.split("/"))),
        { recursive: true },
      );
    }
  }

  quietApply(target, ["trellis-route", "trellis-check-all"]);

  for (const entry of catalog.platforms) {
    if (!entry.checkAll.eligible) {
      assert.equal(entry.checkAll.target, null, entry.id);
      assert.ok(entry.inlineOnlyReason, entry.id);
      continue;
    }
    const agentPath = path.join(target, ...entry.checkAll.target.split("/"));
    assert.equal(fs.existsSync(agentPath), true, `${entry.id}:${entry.checkAll.target}`);
    const content = fs.readFileSync(agentPath, "utf8");
    assert.match(content, /audit-only|只读|audit only/i, entry.id);
    assert.doesNotMatch(content, /workspace-write Trellis reviewer/, entry.id);
    if (entry.checkAll.format === "codex-toml") assert.match(content, /sandbox_mode = "read-only"/);
    if (entry.checkAll.format === "kiro-json") {
      const parsed = JSON.parse(content);
      assert.deepEqual(parsed.tools, ["read", "shell", "glob", "grep"]);
    }
    if (entry.checkAll.format === "markdown-reasonix") assert.match(content, /runAs: subagent/);
    if (entry.checkAll.format === "markdown-kimi") assert.match(content, /agent: explore/);
  }
  assert.match(
    fs.readFileSync(path.join(target, ".trellis/agents/check-all.md"), "utf8"),
    /audit-only/,
  );
});

test("共享 agents Skill root 不会创建未启用平台的 Check-All 目录", () => {
  const target = makeTarget("flower-check-all-enabled-platforms-");
  fs.mkdirSync(path.join(target, ".claude/skills"), { recursive: true });
  fs.mkdirSync(path.join(target, ".agents/skills"), { recursive: true });
  fs.mkdirSync(path.join(target, ".codex/agents"), { recursive: true });
  fs.copyFileSync(
    path.resolve(
      "vendor/skill-garden/compiled-targets/0.6.12/full/targets/.codex/agents/trellis-implement.toml",
    ),
    path.join(target, ".codex/agents/trellis-implement.toml"),
  );

  quietApply(target, ["trellis-route", "trellis-check-all"]);

  assert.equal(fs.existsSync(path.join(target, ".claude/agents/trellis-check-all.md")), true);
  assert.equal(fs.existsSync(path.join(target, ".codex/agents/trellis-check-all.toml")), true);
  assert.equal(fs.existsSync(path.join(target, ".gemini")), false);
  assert.equal(fs.existsSync(path.join(target, ".kimi-code")), false);
  assert.equal(fs.existsSync(path.join(target, ".pi")), false);
  const state = JSON.parse(fs.readFileSync(path.join(target, ".flower/state.json"), "utf8"));
  assert.deepEqual(state.plugins[0].platforms, ["claude", "codex"]);
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
