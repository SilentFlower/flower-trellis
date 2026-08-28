import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 创建测试临时目录并注册清理。
 *
 * @param {import("node:test").TestContext} t 测试上下文
 * @param {string} prefix 目录前缀
 * @returns {string} 临时目录
 */
export function createPluginTestRoot(t, prefix = "flower-plugin-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/**
 * 创建合法 Plugin manifest。
 *
 * @param {{id?:string,version?:string,dependencies?:Record<string,string>,content?:Record<string,unknown[]>}} [overrides] 覆盖字段
 * @returns {object} manifest
 */
export function pluginManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    id: overrides.id || "demo",
    name: `Plugin ${overrides.id || "demo"}`,
    version: overrides.version || "1.0.0",
    compatibility: { flower: ">=0.5.0 <1.0.0" },
    dependencies: overrides.dependencies || {},
    capabilities: { profile: "standard", required: ["content.skills"] },
    content: overrides.content || {
      skills: [{
        name: "demo",
        path: "skills/demo",
        version: overrides.version || "1.0.0",
        description: "Demo Skill",
      }],
    },
  };
}

/**
 * 写入一个测试 Plugin 包。
 *
 * @param {string} root 容器根目录
 * @param {string} relative 包相对路径
 * @param {object} manifest manifest
 * @param {Record<string,string|Buffer>} [files] 额外文件
 * @returns {string} 包根
 */
export function writePluginPackage(root, relative, manifest, files = {}) {
  const packageRoot = path.join(root, ...relative.split("/"));
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const defaults = Object.keys(files).length === 0 ? { "skills/demo/SKILL.md": "# Demo\n" } : files;
  for (const [file, content] of Object.entries(defaults)) {
    const target = path.join(packageRoot, ...file.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return packageRoot;
}

/**
 * 创建无需文件系统的候选 DTO。
 *
 * @param {string} id canonical Plugin ID
 * @param {string} version 版本
 * @param {Record<string,string>} [dependencies] 依赖
 * @returns {import("../../src/plugin/contracts.js").PluginCandidate} 候选
 */
export function candidate(id, version, dependencies = {}) {
  const [sourceId, pluginId] = id.split("/");
  return {
    id,
    version,
    source: { id: sourceId, type: "builtin", reference: `package:${pluginId}/${version}` },
    commit: null,
    integrity: `sha256:${Buffer.from(`${id}@${version}`).toString("hex").padEnd(64, "0").slice(0, 64)}`,
    manifest: pluginManifest({ id: pluginId, version, dependencies }),
  };
}

/**
 * 创建最小合法 lock。
 *
 * @param {import("../../src/plugin/contracts.js").ResolvedPlugin[]} plugins 已解析 Plugin
 * @param {string[]} [roots] roots
 * @returns {import("../../src/plugin/contracts.js").PluginLock} lock
 */
export function pluginLock(plugins, roots = plugins.map(({ id }) => id)) {
  return { schemaVersion: 1, roots, plugins };
}
