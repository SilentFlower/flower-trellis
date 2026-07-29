/** Runtime capability policy 版本，批准摘要必须绑定此值。 */
export const RUNTIME_CAPABILITY_POLICY_VERSION = 1;

/** Flower Plugin capability 名称。 */
export const PLUGIN_CAPABILITIES = Object.freeze({
  CONTENT_SKILLS: "content.skills",
  CONTENT_SPECS: "content.specs",
  CONTENT_ASSETS: "content.assets",
  CONTENT_SCRIPTS: "content.scripts",
  CONTENT_TESTS: "content.tests",
  PATCH_INSERT: "patch.insert",
  PATCH_REPLACE: "patch.replace",
  PATCH_REMOVE: "patch.remove",
  PATCH_HOOK: "patch.hook",
  PATCH_MIGRATION: "patch.migration",
  PATCH_ADAPTER: "patch.adapter",
});

/** Flower Plugin capability 档位。 */
export const CAPABILITY_PROFILES = Object.freeze({
  STANDARD: "standard",
  INTEGRATION: "integration",
  SYSTEM: "system",
});

const PROFILE_ORDER = Object.freeze([
  CAPABILITY_PROFILES.STANDARD,
  CAPABILITY_PROFILES.INTEGRATION,
  CAPABILITY_PROFILES.SYSTEM,
]);

const STANDARD_CAPABILITIES = Object.freeze([
  PLUGIN_CAPABILITIES.CONTENT_SKILLS,
  PLUGIN_CAPABILITIES.CONTENT_SPECS,
  PLUGIN_CAPABILITIES.CONTENT_ASSETS,
  PLUGIN_CAPABILITIES.CONTENT_SCRIPTS,
  PLUGIN_CAPABILITIES.CONTENT_TESTS,
]);

const PROFILE_CAPABILITIES = Object.freeze({
  [CAPABILITY_PROFILES.STANDARD]: STANDARD_CAPABILITIES,
  [CAPABILITY_PROFILES.INTEGRATION]: Object.freeze([
    ...STANDARD_CAPABILITIES,
    PLUGIN_CAPABILITIES.PATCH_INSERT,
  ]),
  [CAPABILITY_PROFILES.SYSTEM]: Object.freeze([
    ...STANDARD_CAPABILITIES,
    PLUGIN_CAPABILITIES.PATCH_INSERT,
    PLUGIN_CAPABILITIES.PATCH_REPLACE,
    PLUGIN_CAPABILITIES.PATCH_REMOVE,
    PLUGIN_CAPABILITIES.PATCH_HOOK,
    PLUGIN_CAPABILITIES.PATCH_MIGRATION,
    PLUGIN_CAPABILITIES.PATCH_ADAPTER,
  ]),
});

/** 所有 Runtime 已知 capability。 */
export const KNOWN_PLUGIN_CAPABILITIES = Object.freeze([
  ...PROFILE_CAPABILITIES[CAPABILITY_PROFILES.SYSTEM],
]);

/**
 * 判断 capability 档位是否合法。
 *
 * @param {unknown} profile 待检查档位
 * @returns {boolean} 是否为已知档位
 */
export function isCapabilityProfile(profile) {
  return typeof profile === "string" && PROFILE_ORDER.includes(profile);
}

/**
 * 返回档位允许的 capability。
 *
 * @param {"standard"|"integration"|"system"} profile capability 档位
 * @returns {string[]} 稳定 capability 列表
 */
export function capabilitiesForProfile(profile) {
  return [...(PROFILE_CAPABILITIES[profile] || [])];
}

/**
 * 返回多个档位中的最低权限档位。
 *
 * @param {Array<"standard"|"integration"|"system">} profiles capability 档位
 * @returns {"standard"|"integration"|"system"} 最低权限档位
 */
export function minimumCapabilityProfile(profiles) {
  return profiles.reduce((minimum, profile) => (
    PROFILE_ORDER.indexOf(profile) < PROFILE_ORDER.indexOf(minimum) ? profile : minimum
  ), CAPABILITY_PROFILES.SYSTEM);
}
