import { applyEnhancements } from "../lib/apply-enhancements.js";
import { listEnhancementSkills } from "../lib/enhancement-catalog.js";
import { shouldInstallName } from "../lib/skill-filter.js";

/**
 * 打印 skill 子命令帮助。
 */
function printSkillHelp() {
  console.log(`flower-trellis skill — 查看和安装 skill-garden 增强技能

用法:
  flower-trellis skill list [flower flags]              列出当前变体可安装的增强技能
  flower-trellis skill install <name...> [flower flags] 安装指定增强技能

示例:
  ft skill list
  ft skill install humanize-writing
  ft skill install humanize-writing trellis-visualize

可用 flower flag:
  --variant <old|0.5|0.6>  强制强化包变体(默认按 .trellis/.version 自动选)
  --target <dir>           目标目录(默认当前目录)`);
}

/**
 * 从透传参数里提取 skill install 的位置参数。
 *
 * @param {string[]} passthrough 未被 flower 自有解析消耗的参数
 * @returns {string[]} skill 名称列表
 */
function parseInstallNames(passthrough) {
  return passthrough.filter((value) => value && !value.startsWith("-"));
}

/**
 * 列出目标项目当前变体下可安装的增强 skill。
 *
 * @param {object} ctx cli.js 的解析上下文
 */
function listSkills(ctx) {
  const result = listEnhancementSkills(ctx.target, ctx.variant);
  console.log(
    `\n强化技能:${result.variant}${result.version ? `(项目 Trellis ${result.version})` : ""}`,
  );

  if (result.skills.length === 0) {
    console.log("  · 当前变体没有可安装的增强技能");
    return;
  }

  for (const item of result.skills) {
    const state = item.installed ? "已安装" : "可安装";
    console.log(`  ${item.installed ? "✓" : "·"} ${item.name}  ${state}`);
  }
}

/**
 * 安装指定增强 skill,不运行 trellis update。
 *
 * @param {object} ctx cli.js 的解析上下文
 */
function installSkills(ctx) {
  const names = parseInstallNames(ctx.passthrough);
  if (names.length === 0) {
    throw new Error("请指定要安装的增强技能,例如: ft skill install humanize-writing");
  }

  const available = listEnhancementSkills(ctx.target, ctx.variant);
  const missing = names.filter(
    (name) => !available.skills.some((item) => shouldInstallName(item.name, [name])),
  );
  if (missing.length > 0) {
    throw new Error(
      `未知增强技能:${missing.join(", ")}。可用技能: ${available.skills.map((item) => item.name).join(", ")}`,
    );
  }

  console.log(`· skill install:仅安装指定增强技能(${names.join(", ")})`);
  applyEnhancements(ctx.target, { variant: ctx.variant, skills: names });
  console.log(`\n🌸 flower-trellis skill install 完成 → ${ctx.target}`);
}

/**
 * flower-trellis skill:查看或安装 skill-garden 增强 skill。
 *
 * @param {object} ctx cli.js 的解析上下文
 */
export async function skill(ctx) {
  const subcommand = ctx.passthrough.shift();

  if (!subcommand || subcommand === "-h" || subcommand === "--help" || subcommand === "help") {
    printSkillHelp();
    return;
  }

  if (subcommand === "list") {
    listSkills(ctx);
    return;
  }

  if (subcommand === "install") {
    installSkills(ctx);
    return;
  }

  throw new Error(`未知 skill 子命令:${subcommand}(可选 list / install)`);
}
