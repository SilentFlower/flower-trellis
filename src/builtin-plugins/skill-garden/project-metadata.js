import fs from "node:fs";
import path from "node:path";
import { planLegacyManifestMigration } from "../../lib/manifest.js";
import { contentMutationKey } from "../../plugin/install/content-projector.js";
import { hashContent, hashFileIfExists } from "../../plugin/install/content-hash.js";
import { mergeFlowerIgnoreRules } from "../../plugin/state/ignore-rules.js";

/**
 * 规划 Flower 共享记录与旧配置迁移，不声明用户配置的独占 ownership。
 *
 * @param {string} projectRoot 目标项目根
 * @param {string} owner 内置 Plugin ID
 * @returns {{mutations:object[],payloads:Map<string,Buffer>}} 事务目标及写入内容
 */
export function projectFlowerMetadata(projectRoot, owner) {
  const writes = planLegacyManifestMigration(projectRoot);
  const localIgnore = path.join(projectRoot, ".flower/.gitignore");
  const localText = hashFileIfExists(localIgnore) === null ? "" : fs.readFileSync(localIgnore, "utf8");
  writes.push({ path: ".flower/.gitignore", content: Buffer.from(mergeFlowerIgnoreRules(localText)) });
  const rootIgnore = path.join(projectRoot, ".gitignore");
  if (hashFileIfExists(rootIgnore) !== null) {
    writes.push({ path: ".gitignore", content: Buffer.from(mergeFlowerIgnoreRules(fs.readFileSync(rootIgnore, "utf8"), { root: true })) });
  }
  const mutations = [];
  const payloads = new Map();
  for (const entry of writes) {
    const mutation = {
      owner,
      target: entry.path,
      operation: entry.content === null ? "remove" : "write",
      beforeHash: hashFileIfExists(path.join(projectRoot, ...entry.path.split("/"))),
      afterHash: entry.content === null ? null : hashContent(entry.content),
      source: "flower:project-metadata",
      allowUnownedWrite: true,
      allowUnownedRemove: true,
    };
    mutations.push(mutation);
    if (entry.content !== null) payloads.set(contentMutationKey(mutation), entry.content);
  }
  return { mutations, payloads };
}
