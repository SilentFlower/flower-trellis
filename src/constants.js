/**
 * 全局常量集中地。
 *
 * 这里的名单从 skill-garden 的 install.sh 与 Trellis cli/index.ts 对齐而来,
 * 改动时需与上游保持一致。
 */

/** 强化包支持的三个版本变体目录名。 */
export const VARIANTS = ["old", "0.5", "0.6"];

/** `flower-trellis update` 默认保留的 Trellis 时间戳备份数量。 */
export const DEFAULT_UPDATE_BACKUP_RETENTION = 3;

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
  "--devin",
  "--windsurf",
  "--qoder",
  "--codebuddy",
  "--copilot",
  "--droid",
  "--pi",
  "--reasonix",
  "--zcode",
  "--omp",
  "--trae",
  "--grok",
  "--kimi",
  "--snow",
];

/**
 * Flower 工作流强化 Skill 的平台原生目标。
 *
 * `source` 指向强化快照中的 canonical Skill 源；Codex、Gemini、Pi 与 Kimi
 * 共用 `.agents/skills`，因此这里只保留一个目标。Kimi 的
 * `.kimi-code/skills` 只承载命令与 agent prompts，不是工作流 Skill 根。
 * Windsurf 没有 Skill root，其 workflow 入口继续由 Patch Engine 单独维护。
 */
export const ENHANCEMENT_SKILL_TARGETS = [
  { platform: "claude", platforms: ["claude"], root: ".claude/skills", source: "claude" },
  {
    platform: "codex-gemini-pi-kimi",
    platforms: ["codex", "gemini", "pi", "kimi"],
    root: ".agents/skills",
    source: "agents",
    // 共享 Skill root 只证明物理目标存在，不能证明四个逻辑平台都已启用。
    detectPaths: {
      codex: ".codex/agents/trellis-implement.toml",
      gemini: ".gemini/agents/trellis-implement.md",
      pi: ".pi/agents/trellis-implement.md",
      kimi: ".kimi-code/skills/trellis-implement/SKILL.md",
    },
  },
  { platform: "cursor", platforms: ["cursor"], root: ".cursor/skills", source: "agents" },
  { platform: "opencode", platforms: ["opencode"], root: ".opencode/skills", source: "agents" },
  { platform: "kilo", platforms: ["kilo"], root: ".kilocode/skills", source: "agents" },
  { platform: "kiro", platforms: ["kiro"], root: ".kiro/skills", source: "agents" },
  { platform: "antigravity", platforms: ["antigravity"], root: ".agent/skills", source: "agents" },
  { platform: "devin", platforms: ["devin", "windsurf"], root: ".devin/skills", source: "agents" },
  { platform: "qoder", platforms: ["qoder"], root: ".qoder/skills", source: "agents" },
  { platform: "codebuddy", platforms: ["codebuddy"], root: ".codebuddy/skills", source: "agents" },
  { platform: "copilot", platforms: ["copilot"], root: ".github/skills", source: "agents" },
  { platform: "droid", platforms: ["droid"], root: ".factory/skills", source: "agents" },
  { platform: "grok", platforms: ["grok"], root: ".grok/skills", source: "agents" },
  { platform: "omp", platforms: ["omp"], root: ".omp/skills", source: "agents" },
  { platform: "snow", platforms: ["snow"], root: ".snow/skills", source: "agents" },
  { platform: "trae", platforms: ["trae"], root: ".trae/skills", source: "agents" },
  { platform: "reasonix", platforms: ["reasonix"], root: ".reasonix/skills", source: "agents" },
  { platform: "zcode", platforms: ["zcode"], root: ".zcode/skills", source: "agents" },
];

/**
 * 强化 Skill 的选择性安装别名。
 *
 * Bundle 别名只控制 Patch 选择；Skill 目录投影必须复用本表，才能让 legacy 与
 * Plugin 两条安装路径对同一用户输入保持一致。
 */
export const ENHANCEMENT_SKILL_ALIASES = Object.freeze({
  "trellis-maven-verify": Object.freeze(["java-maven"]),
});

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
  "--no-update-check": false,
  "--backup-retention": true,
};
