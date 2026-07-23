import fs from "node:fs";
import path from "node:path";
import { ENHANCEMENT_SKILL_TARGETS } from "../constants.js";
import { runTrellis } from "../lib/trellis-runner.js";
import { selectVariant } from "../lib/variant.js";
import { ENHANCEMENTS_ROOT } from "../lib/paths.js";
import { listDirs, listFiles, rmrf } from "../lib/fs-utils.js";

/**
 * flower-trellis uninstall:卸载 Trellis 并清理强化包残留。
 *
 * 背景(实读 Trellis uninstall.ts):trellis uninstall 只删它 manifest
 * (.trellis/.template-hashes.json)记录的文件 + 整个 .trellis/。强化包铺的
 * 各平台原生 skill root 下的 trellis-*、old 的 Claude commands 不在
 * manifest 里,会残留 —— 故卸载后由本命令补删(workflow.md/.backup-* 随 .trellis/ 已删)。
 *
 * 流程:① 卸载前(.version 还在)读变体并列出强化清单 → ② 透传 trellis uninstall
 * → ③ 退出码 0 且非 dry-run 时,删除目标里名字精确匹配清单的强化条目。
 *
 * @param {object} ctx 见 cli-args.js 的 parseCliArgs()
 * @returns {Promise<void>} 卸载与强化残留清理完成后返回
 */
export async function uninstall(ctx) {
  const { target } = ctx;
  const dryRun = ctx.passthrough.includes("--dry-run");

  // 1. 卸载前确定要清理的强化条目(此时 .trellis/.version 仍存在)
  const { variant } = selectVariant(target);
  const variantDir = path.join(ENHANCEMENTS_ROOT, variant);
  const skillNames = new Set([
    ...listDirs(path.join(variantDir, ".agents", "skills")),
    ...listDirs(path.join(variantDir, ".claude", "skills")),
  ]);
  const cmdFiles = listFiles(
    path.join(variantDir, ".claude", "commands", "trellis"),
    ".md",
  );

  // 2. 透传 trellis uninstall
  const code = await runTrellis(["uninstall", ...ctx.passthrough], target);
  if (code !== 0) {
    throw new Error(`trellis uninstall 失败(退出码 ${code}),未清理强化残留`);
  }
  if (dryRun) {
    console.log("· --dry-run:trellis 仅预览,强化残留清理一并跳过");
    return;
  }

  // 3. 补删强化残留(只删名字精确匹配强化清单的,避免误删用户文件)
  let removed = 0;
  for (const name of skillNames) {
    for (const { root } of ENHANCEMENT_SKILL_TARGETS) {
      const p = path.join(target, ...root.split("/"), name);
      if (fs.existsSync(p)) {
        rmrf(p);
        removed++;
      }
    }
  }
  for (const file of cmdFiles) {
    const p = path.join(target, ".claude", "commands", "trellis", file);
    if (fs.existsSync(p)) {
      rmrf(p);
      removed++;
    }
  }

  // 清理可能因此变空的目录(深到浅)
  const candidates = [...new Set([
    ...ENHANCEMENT_SKILL_TARGETS.map(({ root }) => root),
    ".claude/commands/trellis",
    ".claude/commands",
    ...ENHANCEMENT_SKILL_TARGETS.map(({ root }) => path.posix.dirname(root)),
  ])].sort((left, right) => right.split("/").length - left.split("/").length);
  for (const d of candidates) {
    const abs = path.join(target, ...d.split("/"));
    try {
      if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
    } catch {
      // 不存在或非空,忽略
    }
  }

  console.log(
    `\n🌸 flower-trellis uninstall 完成:补清理 ${removed} 个强化残留 → ${target}`,
  );
}
