/** 可识别的外部 Plugin 格式。 */
export const PLUGIN_FORMATS = Object.freeze([
  "flower",
  "codex",
  "claude-code",
  "skill-only",
]);

/** 用户来源允许的格式选择。 */
export const SOURCE_FORMATS = Object.freeze(["auto", ...PLUGIN_FORMATS]);
