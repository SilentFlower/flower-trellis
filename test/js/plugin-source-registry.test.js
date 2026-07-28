import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PLUGIN_RUNTIME_ERROR_CODES } from "../../src/plugin/runtime-errors.js";
import { BuiltinSourceProvider } from "../../src/plugin/sources/builtin-provider.js";
import { LocalSourceProvider } from "../../src/plugin/sources/local-provider.js";
import { SourceRegistry } from "../../src/plugin/sources/source-registry.js";
import {
  createPluginTestRoot,
  pluginManifest,
  writePluginPackage,
} from "./plugin-test-helpers.js";

test("builtin 与 local provider 返回同一标准候选模型", (t) => {
  const project = createPluginTestRoot(t, "flower-provider-project-");
  const builtin = createPluginTestRoot(t, "flower-provider-builtin-");
  const manifest = pluginManifest();
  writePluginPackage(project, "plugins/demo", manifest);
  writePluginPackage(builtin, "demo/1.0.0", manifest);

  const localProvider = new LocalSourceProvider({
    id: "local",
    projectRoot: project,
    references: ["plugins"],
  });
  const builtinProvider = new BuiltinSourceProvider({ id: "flower", root: builtin });
  const localCandidate = localProvider.listCandidates("local/demo")[0];
  const builtinCandidate = builtinProvider.listCandidates("flower/demo")[0];

  assert.equal(localCandidate.manifest.id, builtinCandidate.manifest.id);
  assert.equal(localCandidate.integrity, builtinCandidate.integrity);
  assert.equal(localProvider.readPackage(localCandidate).manifest.version, "1.0.0");
  assert.equal(builtinProvider.readPackage(builtinCandidate).manifest.version, "1.0.0");
});

test("Source Registry 拒绝重复 source ID", (t) => {
  const root = createPluginTestRoot(t);
  writePluginPackage(root, "plugins/demo", pluginManifest());
  const provider = new LocalSourceProvider({ id: "local", projectRoot: root, references: ["plugins"] });
  const registry = new SourceRegistry([provider]);
  assert.throws(
    () => registry.register(provider),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.SOURCE_DUPLICATE,
  );
});

test("Provider 固定候选在内容变化后读取失败", (t) => {
  const root = createPluginTestRoot(t);
  const packageRoot = writePluginPackage(root, "plugins/demo", pluginManifest());
  const provider = new LocalSourceProvider({ id: "local", projectRoot: root, references: ["plugins"] });
  const candidate = provider.listCandidates("local/demo")[0];
  fs.appendFileSync(path.join(packageRoot, "skills/demo/SKILL.md"), "changed\n");
  assert.throws(
    () => provider.readPackage(candidate),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
  );
});

test("Local Provider 对集合根和具体包根的重叠引用按真实路径去重", (t) => {
  const root = createPluginTestRoot(t);
  writePluginPackage(root, "plugins/demo", pluginManifest());
  const provider = new LocalSourceProvider({
    id: "local",
    projectRoot: root,
    references: ["plugins", "plugins/demo"],
  });
  assert.equal(provider.listCandidates("local/demo").length, 1);
});

test("Provider 对重复版本和缺失固定包返回稳定来源错误码", (t) => {
  const root = createPluginTestRoot(t);
  const builtin = createPluginTestRoot(t, "flower-provider-missing-");
  writePluginPackage(root, "plugins/first", pluginManifest());
  writePluginPackage(root, "plugins/second", pluginManifest());
  const localProvider = new LocalSourceProvider({
    id: "local",
    projectRoot: root,
    references: ["plugins"],
  });
  assert.throws(
    () => localProvider.listCandidates("local/demo"),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.SOURCE_AMBIGUOUS,
  );

  const missing = {
    id: "local/missing",
    version: "1.0.0",
    integrity: `sha256:${"0".repeat(64)}`,
  };
  assert.throws(
    () => localProvider.readPackage(missing),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
  );
  const builtinProvider = new BuiltinSourceProvider({ id: "flower", root: builtin });
  assert.throws(
    () => builtinProvider.readPackage({ ...missing, id: "flower/missing" }),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
  );
});
