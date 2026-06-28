import { checkbox } from "@inquirer/prompts";

/**
 * 平台多选清单 —— flower 自己的平台选择菜单。
 *
 * 为什么 flower 自己出菜单:Trellis 原生平台菜单的默认勾选写死为 Claude Code + Cursor
 * (types/ai-tools.ts 的 defaultChecked),外部 wrapper 改不了。这里默认勾 Claude Code + Codex,
 * 用户选完后把 value(= trellis init 的平台 flag)透传给 trellis。
 *
 * name 取自 Trellis types/ai-tools.ts;value 为对应 CLI flag。
 */
const PLATFORMS = [
  { name: "Claude Code", value: "--claude", checked: true },
  {
    name: "Codex(同时写 .agents/skills/ — Cursor / Gemini CLI / GitHub Copilot 等可读)",
    value: "--codex",
    checked: true,
  },
  { name: "Cursor", value: "--cursor" },
  { name: "OpenCode", value: "--opencode" },
  { name: "Gemini CLI", value: "--gemini" },
  { name: "Kilo CLI", value: "--kilo" },
  { name: "Kiro Code", value: "--kiro" },
  { name: "Antigravity", value: "--antigravity" },
  { name: "Devin", value: "--devin" },
  { name: "Windsurf(旧别名,等同 Devin)", value: "--windsurf" },
  { name: "Qoder", value: "--qoder" },
  { name: "CodeBuddy", value: "--codebuddy" },
  { name: "GitHub Copilot", value: "--copilot" },
  { name: "Factory Droid", value: "--droid" },
  { name: "Pi", value: "--pi" },
  { name: "Reasonix", value: "--reasonix" },
  { name: "ZCode", value: "--zcode" },
  { name: "Trae", value: "--trae" },
];

/**
 * 弹出平台多选菜单,返回选中的 trellis 平台 flag 数组(如 ["--claude","--codex"])。
 * 非 TTY(无法交互)时回退到默认 codex + claude。
 *
 * @returns {Promise<string[]>}
 */
export async function pickPlatforms() {
  if (!process.stdin.isTTY) return ["--codex", "--claude"];
  // 用 @inquirer/checkbox(现代 @inquirer/core 增量重绘内核)替代经典 inquirer。
  // 为什么换:经典 inquirer 每次重绘都「整块清屏 → 整块重写」,在 WSL2 / ConPTY 终端下
  // 清空与重画之间有一帧空白,上下切换平台时肉眼可见闪屏;新内核按差异增量重绘可消闪。
  // pageSize 取平台总数,一屏展示全部、避免滚动带来的二次重绘;loop:false 保持首尾不循环。
  // 返回值即选中的 value 数组(["--claude","--codex", ...]),对调用方契约不变。
  const tools = await checkbox({
    message:
      "选择要配置的 AI 工具(空格勾选 / 回车确认,默认已勾 Claude Code + Codex):",
    choices: PLATFORMS.map((p) => ({
      name: p.name,
      value: p.value,
      checked: !!p.checked,
    })),
    loop: false,
    pageSize: PLATFORMS.length,
  });
  return tools;
}
