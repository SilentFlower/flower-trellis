import { checkbox } from "@inquirer/prompts";
import chalk from "chalk";
import readline from "node:readline";
import {
  installCommonSkills,
  listSkillCatalog,
  removeCommonSkills,
  summarizeSkillDescription,
} from "../lib/skill-catalog.js";

const TITLE_COLOR = "#ff6fb5";

/**
 * 计算纯文本宽度,用于对齐不带 ANSI 控制码的 skill 名称。
 *
 * @param {string[]} values 待测字符串
 * @returns {number} 最大宽度
 */
function maxTextWidth(values) {
  return Math.max(0, ...values.map((value) => value.length));
}

/**
 * 打印 skill 管理帮助。
 */
function printSkillHelp() {
  console.log(`flower-trellis skill — 交互管理通用技能

用法:
  flower-trellis skill [flower flags]  打开交互菜单，启用或停用通用技能

可用 flower 参数:
  --variant <old|0.5|0.6>  强制强化包变体（默认按 .trellis/.version 自动选）
  --target <dir>           目标目录（默认当前目录）`);
}

/**
 * 打印 skill 管理页头。
 *
 * @param {{variant: string, version: string}} catalog skill 清单
 */
function printHeader(catalog) {
  const meta = [`强化包 ${catalog.variant}`];
  if (catalog.version) meta.push(`项目 Trellis ${catalog.version}`);

  console.log("");
  console.log(chalk.hex(TITLE_COLOR).bold("Flower Trellis 技能管理"));
  console.log(chalk.gray(`  ${meta.join(" · ")}`));
}

/**
 * 打印只读工作流强化项。
 *
 * @param {{enhancementSkills: object[]}} catalog skill 清单
 */
function printReadonlyEnhancements(catalog) {
  if (catalog.enhancementSkills.length === 0) return;

  const width = maxTextWidth(catalog.enhancementSkills.map((item) => item.name));

  console.log("");
  console.log(chalk.bold("Trellis 工作流强化包"));
  console.log(chalk.gray("  随初始化、更新自动维护，仅展示用途。"));
  for (const item of catalog.enhancementSkills) {
    const description = summarizeSkillDescription(item.description, 36);
    console.log(`  ${chalk.gray("·")} ${item.name.padEnd(width)}  ${chalk.gray(description)}`);
  }
}

/**
 * 打印通用技能分组说明。
 *
 * @param {{commonSkills: object[]}} catalog skill 清单
 */
function printCommonIntro(catalog) {
  if (catalog.commonSkills.length === 0) return;

  console.log("");
  console.log(chalk.bold("可选通用技能"));
  console.log(chalk.gray("  勾选表示启用，取消勾选表示停用；未安装项排在前面。"));
}

/**
 * 构造通用技能管理菜单选项。
 *
 * @param {{commonSkills: object[]}} catalog skill 清单
 * @returns {Array<object>} checkbox choices
 */
function buildChoices(catalog) {
  const width = maxTextWidth(catalog.commonSkills.map((item) => item.name));
  return catalog.commonSkills.map((item) => {
    const description = summarizeSkillDescription(item.description, 34);
    const label = `${item.name.padEnd(width)}  ${chalk.gray(description)}`;
    return {
      name: label,
      short: item.name,
      checkedName: label,
      value: item.name,
      checked: item.installed,
    };
  });
}

/**
 * 创建 Esc 取消控制器。
 *
 * @returns {{signal: AbortSignal, dispose: Function}} prompt signal 与清理函数
 */
function createEscAbortController() {
  const controller = new AbortController();
  let abortedByEsc = false;
  readline.emitKeypressEvents(process.stdin);

  const onKeypress = (_value, key) => {
    if (key && key.name === "escape") {
      abortedByEsc = true;
      controller.abort();
    }
  };
  process.stdin.on("keypress", onKeypress);

  return {
    signal: controller.signal,
    dispose: () => process.stdin.off("keypress", onKeypress),
    isEscAbort: () => abortedByEsc,
  };
}

/**
 * 执行通用技能最终状态同步。
 *
 * @param {object} ctx cli.js 的解析上下文
 * @param {{commonSkills: object[]}} catalog skill 清单
 * @param {string[]} selected 用户最终勾选的通用技能名称
 */
function applySkillSelection(ctx, catalog, selected) {
  const selectedSet = new Set(selected);
  const toDisable = catalog.commonSkills
    .filter((item) => item.installed && !selectedSet.has(item.name))
    .map((item) => item.name);
  const toEnable = catalog.commonSkills
    .filter((item) => !item.installed && selectedSet.has(item.name))
    .map((item) => item.name);

  if (toDisable.length > 0) {
    const r = removeCommonSkills(ctx.target, ctx.variant, toDisable);
    if (r.removed.length > 0) {
      console.log(`  ✓ 停用 ${toDisable.length} 个通用技能 → ${r.removed.join(", ")}`);
    } else {
      console.log(`  · 未发现可停用的通用技能:${toDisable.join(", ")}`);
    }
  }

  if (toEnable.length > 0) {
    const r = installCommonSkills(ctx.target, toEnable);
    if (r.paths.length > 0) {
      console.log(`  ✓ 启用 ${r.installed.length} 个通用技能 → ${r.paths.join(", ")}`);
    }
    if (r.skipped.length > 0) {
      console.log(`  · 跳过未找到的通用技能:${r.skipped.join(", ")}`);
    }
  }
}

/**
 * flower-trellis skill:交互启用或停用通用技能。
 *
 * @param {object} ctx cli.js 的解析上下文
 */
export async function skill(ctx) {
  if (ctx.passthrough.some((arg) => arg === "-h" || arg === "--help" || arg === "help")) {
    printSkillHelp();
    return;
  }

  if (ctx.passthrough.length > 0) {
    throw new Error("skill 子命令已移除,请直接运行 flower-trellis skill 打开交互菜单");
  }

  if (!process.stdin.isTTY) {
    throw new Error("flower-trellis skill 需要交互终端,非 TTY 环境不会等待输入");
  }

  const catalog = listSkillCatalog(ctx.target, ctx.variant);
  printHeader(catalog);

  if (catalog.commonSkills.length === 0 && catalog.enhancementSkills.length === 0) {
    console.log("  · 当前没有可展示的 skill");
    return;
  }

  printReadonlyEnhancements(catalog);

  if (catalog.commonSkills.length === 0) {
    console.log("");
    console.log("  · 当前没有可管理的通用技能");
    return;
  }

  printCommonIntro(catalog);

  let selected;
  const escAbort = createEscAbortController();
  try {
    selected = await checkbox({
      message: "选择要启用的通用技能",
      choices: buildChoices(catalog),
      loop: false,
      pageSize: Math.min(catalog.commonSkills.length, 12),
      required: false,
      shortcuts: { all: null, invert: null },
      theme: {
        style: {
          description: (text) => chalk.gray(text),
          keysHelpTip: (keys) =>
            keys
              .map(([key, action]) => {
                const keyLabels = {
                  escape: "Esc",
                  space: "空格",
                  "⏎": "回车",
                };
                const labels = {
                  navigate: "移动",
                  select: "选择",
                  submit: "确认",
                };
                return `${chalk.bold(keyLabels[key] || key)} ${chalk.gray(labels[action] || action)}`;
              })
              .concat(`${chalk.bold("ESC")} ${chalk.gray("退出")}`)
              .join(chalk.gray(" · ")),
          renderSelectedChoices: (selectedChoices) =>
            selectedChoices.map((choice) => choice.short).join(", "),
        },
      },
    }, { signal: escAbort.signal });
  } catch (err) {
    if (err && err.name === "AbortPromptError" && escAbort.isEscAbort()) {
      console.log("  · 已取消");
      return;
    }
    if (err && err.name === "ExitPromptError") {
      throw new Error("已取消 skill 管理");
    }
    throw err;
  } finally {
    escAbort.dispose();
  }

  const selectedSet = new Set(selected);
  const changed = catalog.commonSkills.some(
    (item) => item.installed !== selectedSet.has(item.name),
  );
  if (!changed) {
    console.log("  · 没有修改");
    return;
  }

  applySkillSelection(ctx, catalog, selected);
  console.log(`\n🌸 flower-trellis skill 完成 → ${ctx.target}`);
}
