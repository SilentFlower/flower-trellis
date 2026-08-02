import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { projectPluginContent } from "../../src/plugin/install/content-projector.js";
import {
  detectPluginPlatforms,
  listPluginPlatforms,
} from "../../src/plugin/install/platform-detector.js";
import { resolvePluginGraph } from "../../src/plugin/resolver/dependency-resolver.js";
import { PLUGIN_RUNTIME_ERROR_CODES } from "../../src/plugin/runtime-errors.js";
import { LocalSourceProvider } from "../../src/plugin/sources/local-provider.js";
import { SourceRegistry } from "../../src/plugin/sources/source-registry.js";
import {
  createPluginTestRoot,
  pluginManifest,
  writePluginPackage,
} from "./plugin-test-helpers.js";

test("平台检测支持显式选择并按共享物理 root 去重", (t) => {
  const project = createPluginTestRoot(t);
  const selection = detectPluginPlatforms(project, ["zcode", "codex", "gemini"]);
  assert.deepEqual(selection.platforms, ["codex", "gemini", "zcode"]);
  assert.deepEqual(selection.targets, [
    {
      root: ".agents/skills",
      source: "agents",
      platforms: ["codex", "gemini"],
    },
    {
      root: ".zcode/skills",
      source: "agents",
      platforms: ["zcode"],
    },
  ]);
  assert.ok(listPluginPlatforms().includes("claude"));
  assert.throws(
    () => detectPluginPlatforms(project),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.PLATFORM_SELECTION_REQUIRED,
  );
  assert.equal(fs.existsSync(path.join(project, ".claude")), false);
});

test("平台检测从已有原生 root 推断逻辑平台", (t) => {
  const project = createPluginTestRoot(t);
  fs.mkdirSync(path.join(project, ".claude/skills"), { recursive: true });
  fs.mkdirSync(path.join(project, ".agents/skills"), { recursive: true });
  fs.mkdirSync(path.join(project, ".codex/agents"), { recursive: true });
  fs.writeFileSync(path.join(project, ".codex/agents/trellis-implement.toml"), "name = \"trellis-implement\"\n");
  const selection = detectPluginPlatforms(project);
  assert.deepEqual(selection.platforms, ["claude", "codex"]);
  assert.equal(selection.targets.length, 2);
});

test("共享 Skill root 不会把未启用消费者误判为逻辑平台", (t) => {
  const project = createPluginTestRoot(t);
  fs.mkdirSync(path.join(project, ".agents/skills"), { recursive: true });
  for (const [platform, detectPath] of Object.entries({
    codex: ".codex/agents/trellis-implement.toml",
    gemini: ".gemini/agents/trellis-implement.md",
    pi: ".pi/agents/trellis-implement.md",
    kimi: ".kimi-code/skills/trellis-implement/SKILL.md",
  })) {
    const target = path.join(project, ...detectPath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${platform}\n`);
  }

  const selection = detectPluginPlatforms(project);

  assert.deepEqual(selection.platforms, ["codex", "gemini", "kimi", "pi"]);
  assert.deepEqual(selection.targets, [{
    root: ".agents/skills",
    source: "agents",
    platforms: ["codex", "gemini", "kimi", "pi"],
  }]);
});

test("内容投影把 canonical Skill 一次写入共享物理 root", (t) => {
  const project = createPluginTestRoot(t);
  writePluginPackage(project, "plugins/demo", pluginManifest(), {
    "skills/demo/SKILL.md": "# Demo\n",
    "skills/demo/reference.md": "reference\n",
    "skills/demo/references/nested.md": "nested\n",
  });
  const registry = new SourceRegistry([
    new LocalSourceProvider({ id: "local", projectRoot: project, references: ["plugins"] }),
  ]);
  const resolution = resolvePluginGraph(
    [{ id: "local/demo", source: "local", version: "*" }],
    registry,
  );
  const projection = projectPluginContent({
    projectRoot: project,
    graph: resolution.graph,
    selected: resolution.selected,
    registry,
    platformSelection: detectPluginPlatforms(project, ["codex", "gemini"]),
  });
  assert.deepEqual(
    projection.mutations.map(({ target }) => target),
    [
      ".agents/skills/demo/SKILL.md",
      ".agents/skills/demo/reference.md",
      ".agents/skills/demo/references/nested.md",
    ],
  );
  assert.deepEqual(
    projection.directoryClaims.map(({ path: target }) => target),
    [".agents/skills/demo", ".agents/skills/demo/references"],
  );
  assert.deepEqual(projection.state.plugins[0].platforms, ["codex", "gemini"]);
  assert.equal(projection.payloads.size, 3);
});

test("内容投影应用 platform override，并拒绝共享 root 的差异覆盖", (t) => {
  const project = createPluginTestRoot(t);
  const packageRoot = writePluginPackage(project, "plugins/demo", pluginManifest());
  fs.mkdirSync(path.join(packageRoot, "platforms/codex/skills/demo"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "platforms/codex/skills/demo/SKILL.md"), "# Codex\n");
  const projectContent = (platforms) => {
    const registry = new SourceRegistry([
      new LocalSourceProvider({ id: "local", projectRoot: project, references: ["plugins"] }),
    ]);
    const resolution = resolvePluginGraph(
      [{ id: "local/demo", source: "local", version: "*" }],
      registry,
    );
    return projectPluginContent({
      projectRoot: project,
      graph: resolution.graph,
      selected: resolution.selected,
      registry,
      platformSelection: detectPluginPlatforms(project, platforms),
    });
  };

  const codex = projectContent(["codex"]);
  assert.equal([...codex.payloads.values()][0].toString(), "# Codex\n");
  assert.match(codex.mutations[0].source, /platforms\/codex/);
  assert.throws(
    () => projectContent(["codex", "gemini"]),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
  );

  fs.mkdirSync(path.join(packageRoot, "platforms/gemini/skills/demo"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "platforms/gemini/skills/demo/SKILL.md"), "# Codex\n");
  assert.equal(projectContent(["codex", "gemini"]).mutations.length, 1);
});
