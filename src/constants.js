/**
 * 全局常量集中地。
 *
 * 这里的名单从 skill-garden 的 install.sh 与 Trellis cli/index.ts 对齐而来,
 * 改动时需与上游保持一致。
 */

/** 强化包支持的三个版本变体目录名。 */
export const VARIANTS = ["old", "0.5", "0.6"];

/**
 * Trellis init 支持的全部平台 flag。
 *
 * 用途:当用户未显式指定任何平台时,flower-trellis 默认补 `--claude`
 * (对应「默认 Claude + agents」决策)。来源为 Trellis cli/index.ts 的 init 注册。
 * 上游新增平台时此名单可滞后 —— 最坏后果仅是误补 `--claude`(与用户新平台共存),
 * 不会致命。
 */
export const PLATFORM_FLAGS = [
  "--cursor",
  "--claude",
  "--opencode",
  "--codex",
  "--kilo",
  "--kiro",
  "--gemini",
  "--antigravity",
  "--windsurf",
  "--qoder",
  "--codebuddy",
  "--copilot",
  "--droid",
  "--pi",
  "--reasonix",
];

/**
 * flower-trellis 自有 flag —— 这些不能透传给 trellis,需在解析时剔除。
 *
 * 值含义:
 *   false → 布尔 flag(出现即生效,不带取值)
 *   true  → 带取值 flag(其后紧跟一个取值 token,剔除时要连带跳过)
 */
export const OWN_FLAGS = {
  "--no-enhance": false,
  "--enhance-only": false,
  "--skills": true,
  "--variant": true,
  "--target": true,
};
