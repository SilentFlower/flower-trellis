import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { normalizeGitHubRepository } from "../sources/user-source-store.js";
import { assertSafePosixRelativePath } from "../schemas/shared.js";

/**
 * 解析 Claude/Codex Marketplace 中的同仓相对路径条目。
 *
 * @param {object} selected Marketplace 检测结果
 * @param {string} repository 当前 GitHub 仓库
 * @returns {{entries:Array<{name:string,description:string,repository:string,path:string|null,ref:string|null}>,diagnostics:object[]}} 支持条目与诊断
 */
export function readExternalMarketplaceEntries(selected, repository) {
  if (!new Set(["codex", "claude-code"]).has(selected.format) || selected.kind !== "marketplace") {
    throw new PluginRuntimeError(`格式不是可适配的外部 Marketplace:${selected.format}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
      path: selected.entryPath,
    });
  }
  const plugins = Array.isArray(selected.manifest?.plugins) ? selected.manifest.plugins : [];
  const entries = [];
  const diagnostics = [];
  for (const [index, plugin] of plugins.entries()) {
    const name = String(plugin?.name || plugin?.id || `plugin-${index + 1}`);
    const source = plugin?.source;
    let relative = null;
    let targetRepository = repository;
    let ref = null;
    if (typeof source === "string" && !source.startsWith("git@")) {
      if (source.startsWith("./")) relative = source;
      else {
        try {
          targetRepository = normalizeGitHubRepository(source);
        } catch {
          if (!/^[a-z]+:/i.test(source)) relative = source;
        }
      }
    } else if (source && typeof source === "object") {
      const kind = source.source || source.type;
      if (["local", "path"].includes(kind)) relative = source.path;
      else if (["github", "git-subdir"].includes(kind)) {
        try {
          targetRepository = normalizeGitHubRepository(source.repo || source.repository || source.url);
        } catch {
          diagnostics.push({
            code: "external.marketplace-source-unsupported",
            path: `plugins/${index}`,
            message: `Marketplace 条目来源暂不支持:${name}`,
            severity: "warning",
          });
          continue;
        }
        relative = source.path || source.subdir || null;
        ref = source.ref || source.rev || source.commit || null;
      }
    }
    if (targetRepository === repository && (typeof relative !== "string" || !relative.trim())) {
      diagnostics.push({
        code: "external.marketplace-source-unsupported",
        path: `plugins/${index}`,
        message: `Marketplace 条目来源暂不支持:${name}`,
        severity: "warning",
      });
      continue;
    }
    try {
      entries.push({
        name,
        description: String(plugin?.description || `${name} 外部工作流`),
        repository: targetRepository,
        path: relative
          ? assertSafePosixRelativePath(relative.replace(/^\.\//, "").replace(/\/+$/, ""), `Marketplace Plugin 路径:${name}`)
          : null,
        ref: ref ? String(ref) : null,
      });
    } catch (error) {
      diagnostics.push({
        code: error?.code || "external.marketplace-path-invalid",
        path: `plugins/${index}`,
        message: `Marketplace 条目路径无效:${name}`,
        severity: "warning",
      });
    }
  }
  if (entries.length === 0) {
    throw new PluginRuntimeError("Marketplace 中没有可安装的公开 GitHub 或相对路径 Plugin", {
      code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
      path: selected.entryPath,
      details: { diagnostics },
    });
  }
  return { entries, diagnostics };
}
