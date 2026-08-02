import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyPatchPlan, preparePatchPlan } from "../../src/lib/patch-engine.js";
import { flowerPatchAdapters } from "../../src/lib/platform-patch-adapters.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FLOWER_PATCHES = path.join(ROOT, "src", "patches");
const CATALOG = {
  id: "flower",
  patchesDir: path.join(FLOWER_PATCHES, "platforms"),
  bundlesDir: path.join(FLOWER_PATCHES, "bundles"),
};

function write(root, relative, value) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function fixture() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-platform-patch-"));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  return target;
}

function prepare(target) {
  return preparePatchPlan(target, [CATALOG], { adapters: flowerPatchAdapters() });
}

test("Flower 平台 Patch 归位 Hook、保留用户配置并重复执行幂等", () => {
  const target = fixture();
  fs.mkdirSync(path.join(target, ".codex"));
  fs.mkdirSync(path.join(target, ".claude"));
  write(target, ".codex/hooks.json", JSON.stringify({
    custom: true,
    hooks: {
      UserPromptSubmit: [{ hooks: [{
        type: "command",
        command: "python3 -X utf8 .codex/hooks/inject-workflow-state.py",
        timeout: 20,
      }] }],
      SessionStart: [
        { hooks: [{ type: "command", command: "python3 .codex/hooks/session-start.py", timeout: 8 }] },
        { matcher: "clear", hooks: [{ type: "command", command: "python3 .trellis/scripts/flower_update_hook.py", timeout: 8 }] },
        { matcher: "custom", hooks: [{ type: "command", command: "echo keep", timeout: 5 }] },
      ],
    },
  }, null, 2) + "\n");
  write(target, ".claude/settings.json", JSON.stringify({
    permissions: { allow: ["Read"] },
    hooks: {
      UserPromptSubmit: [{ hooks: [{
        type: "command",
        command: "python3 .claude/hooks/inject-workflow-state.py",
      }] }],
      SessionStart: [
        { matcher: "compact", hooks: [{ type: "command", command: "python3 .trellis/scripts/flower_update_hook.py", timeout: 8 }] },
      ],
    },
  }, null, 2) + "\n");
  write(target, ".codex/config.toml", [
    "model = \"gpt\"",
    "",
    "[features.multi_agent_v2] # remove legacy feature",
    "enabled = true",
    "",
    "[other] # keep user section",
    "keep = true",
    "",
  ].join("\n"));
  const upstreamConfig = fs.readFileSync(
    path.join(ROOT, "node_modules/@mindfoldhq/trellis/dist/templates/trellis/config.yaml"),
    "utf8",
  );
  const configuredCodex = `${upstreamConfig}\ncodex: { dispatch_mode: inline, other: true }\n`;
  write(target, ".trellis/config.yaml", configuredCodex);
  write(
    target,
    ".codex/hooks/inject-workflow-state.py",
    fs.readFileSync(
      path.join(ROOT, "node_modules/@mindfoldhq/trellis/dist/templates/shared-hooks/inject-workflow-state.py"),
      "utf8",
    ),
  );

  const first = applyPatchPlan(target, prepare(target));
  assert.equal(first.changed, 5);
  const codex = JSON.parse(fs.readFileSync(path.join(target, ".codex/hooks.json"), "utf8"));
  assert.equal(codex.custom, true);
  const codexSession = codex.hooks.SessionStart;
  assert.equal(codexSession.filter((group) => group.matcher === "startup|resume|clear|compact").length, 1);
  assert.equal(codexSession.filter((group) => group.matcher === "startup").length, 1);
  assert.equal(codexSession.find((group) => group.matcher === "custom").hooks[0].command, "echo keep");
  assert.equal(codexSession.flatMap((group) => group.hooks).filter((hook) =>
    hook.command.includes("flower_update_hook.py")
  ).length, 1);
  const claude = JSON.parse(fs.readFileSync(path.join(target, ".claude/settings.json"), "utf8"));
  assert.deepEqual(claude.permissions, { allow: ["Read"] });
  assert.equal(claude.hooks.SessionStart[0].matcher, "startup");
  assert.equal(claude.hooks.SessionStart[0].hooks[0].timeout, 30);
  const toml = fs.readFileSync(path.join(target, ".codex/config.toml"), "utf8");
  assert.doesNotMatch(toml, /multi_agent_v2/);
  assert.match(toml, /\[other\] # keep user section/);
  const yaml = fs.readFileSync(path.join(target, ".trellis/config.yaml"), "utf8");
  assert.match(yaml, /codex:\n  dispatch_mode: auto\n  other: true/);
  assert.doesNotMatch(yaml, /dispatch_mode: (?:inline|sub-agent)/);
  assert.match(yaml, /It does not choose inline or subagent execution for a task: trellis-route owns/);
  const workflowHook = fs.readFileSync(
    path.join(target, ".codex/hooks/inject-workflow-state.py"),
    "utf8",
  );
  assert.match(workflowHook, /this banner is not/);
  assert.match(workflowHook, /a route decision/);
  assert.match(
    workflowHook,
    /Normalize `codex\.dispatch_mode` from \.trellis\/config\.yaml to "auto" or "inline"\./,
  );
  assert.doesNotMatch(workflowHook, /defaults to Trellis sub-agents/);
  assert.doesNotMatch(workflowHook, /do not dispatch implement\/check sub-agents/);

  const second = applyPatchPlan(target, prepare(target));
  assert.equal(second.changed, 0);
});

test("Codex dispatch 配置缺少上游注释时仍只规范化能力值", () => {
  const target = fixture();
  fs.mkdirSync(path.join(target, ".codex"));
  write(target, ".trellis/config.yaml", "project: demo\ncodex: { dispatch_mode: inline, other: true }\n");
  write(
    target,
    ".codex/hooks/inject-workflow-state.py",
    fs.readFileSync(
      path.join(ROOT, "node_modules/@mindfoldhq/trellis/dist/templates/shared-hooks/inject-workflow-state.py"),
      "utf8",
    ),
  );

  applyPatchPlan(target, prepare(target));
  const yaml = fs.readFileSync(path.join(target, ".trellis/config.yaml"), "utf8");
  assert.match(yaml, /codex:\n  dispatch_mode: auto\n  other: true/);
  assert.doesNotMatch(yaml, /Codex \(dispatch behavior\)/);
});

test("缺失平台目录安全跳过，损坏 JSON/YAML/TOML 失败且不覆盖", () => {
  const noPlatform = fixture();
  const empty = prepare(noPlatform);
  assert.equal(empty.files.length, 0);
  assert.ok(empty.results.every((item) => item.status === "missing-target"));

  const invalid = fixture();
  fs.mkdirSync(path.join(invalid, ".codex"));
  write(invalid, ".codex/hooks.json", "{broken\n");
  const before = fs.readFileSync(path.join(invalid, ".codex/hooks.json"), "utf8");
  assert.throws(() => prepare(invalid), /JSON Hook 配置无法解析/);
  assert.equal(fs.readFileSync(path.join(invalid, ".codex/hooks.json"), "utf8"), before);

  const invalidYaml = fixture();
  fs.mkdirSync(path.join(invalidYaml, ".codex"));
  write(invalidYaml, ".trellis/config.yaml", "codex: [broken\n");
  const yamlBefore = fs.readFileSync(path.join(invalidYaml, ".trellis/config.yaml"), "utf8");
  assert.throws(() => prepare(invalidYaml), /YAML 无法安全解析 codex/);
  assert.equal(
    fs.readFileSync(path.join(invalidYaml, ".trellis/config.yaml"), "utf8"),
    yamlBefore,
  );

  const invalidToml = fixture();
  fs.mkdirSync(path.join(invalidToml, ".codex"));
  write(invalidToml, ".codex/config.toml", "[features.multi_agent_v2\nenabled = true\n");
  const tomlBefore = fs.readFileSync(path.join(invalidToml, ".codex/config.toml"), "utf8");
  assert.throws(() => prepare(invalidToml), /TOML section header 无法解析/);
  assert.equal(
    fs.readFileSync(path.join(invalidToml, ".codex/config.toml"), "utf8"),
    tomlBefore,
  );
});
