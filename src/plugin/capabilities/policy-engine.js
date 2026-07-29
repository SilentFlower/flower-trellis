import {
  isBuiltinProviderTrusted,
  trustedSourceProviderProfile,
} from "./builtin-trust.js";
import {
  CAPABILITY_PROFILES,
  KNOWN_PLUGIN_CAPABILITIES,
  PLUGIN_CAPABILITIES,
  capabilitiesForProfile,
  isCapabilityProfile,
  minimumCapabilityProfile,
} from "./profiles.js";
import {
  PLUGIN_CAPABILITY_ERROR_CODES,
  PluginCapabilityError,
} from "./errors.js";

function compareStable(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeCapabilities(values) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new TypeError("Plugin capability required/optional 必须是字符串数组");
  }
  return [...new Set(values)].sort(compareStable);
}

function sourceProfile(options, trustedBuiltin) {
  if (trustedBuiltin) return CAPABILITY_PROFILES.SYSTEM;
  if (options.sourceType === "gitlab") {
    return options.marketplaceMaxProfile || CAPABILITY_PROFILES.STANDARD;
  }
  if (options.sourceType === "local") {
    return trustedSourceProviderProfile(options.provider) || CAPABILITY_PROFILES.STANDARD;
  }
  return CAPABILITY_PROFILES.STANDARD;
}

function diagnostic(pluginId, code, message, details) {
  return {
    code,
    path: pluginId,
    message,
    severity: "warning",
    pluginId,
    ...details,
  };
}

/**
 * 计算 Plugin 请求、来源上限和 Runtime 硬限制的 capability 交集。
 *
 * 项目批准在规范化 Patch 计划生成后由 `authorizeCapabilityGrant()` 完成，避免批准摘要
 * 只绑定未经验证的 manifest 声明。
 *
 * @param {{pluginId:string,request:import("../contracts.js").CapabilityRequest,sourceType:string,marketplaceMaxProfile?:"standard"|"integration",provider?:object,runtimeMaxProfile?:"standard"|"integration"|"system"}} options 协商输入
 * @returns {{pluginId:string,request:{profile:string,required:string[],optional:string[]},limits:{sourceProfile:string,runtimeProfile:string},grant:import("../contracts.js").CapabilityGrant,diagnostics:object[],requiresApproval:boolean,trustedBuiltin:boolean}} 待项目批准的授权结果
 */
export function evaluateCapabilityRequest(options) {
  const request = options.request || {};
  if (!isCapabilityProfile(request.profile)) {
    throw new PluginCapabilityError(`Plugin capability profile 无效:${options.pluginId}`, {
      code: PLUGIN_CAPABILITY_ERROR_CODES.DENIED,
      path: options.pluginId,
    });
  }
  const trustedBuiltin = isBuiltinProviderTrusted(options.provider);
  if (request.profile === CAPABILITY_PROFILES.SYSTEM && !trustedBuiltin) {
    throw new PluginCapabilityError(`外部 Plugin 不得请求 system capability:${options.pluginId}`, {
      code: PLUGIN_CAPABILITY_ERROR_CODES.DENIED,
      path: options.pluginId,
      details: { layer: "builtin-trust", requestedProfile: request.profile },
    });
  }

  const sourceMax = sourceProfile(options, trustedBuiltin);
  const requestedRuntimeMax = options.runtimeMaxProfile || (
    trustedBuiltin ? CAPABILITY_PROFILES.SYSTEM : CAPABILITY_PROFILES.INTEGRATION
  );
  const runtimeMax = trustedBuiltin
    ? requestedRuntimeMax
    : minimumCapabilityProfile([requestedRuntimeMax, CAPABILITY_PROFILES.INTEGRATION]);
  if (!isCapabilityProfile(sourceMax) || !isCapabilityProfile(runtimeMax)) {
    throw new PluginCapabilityError(`Plugin capability 来源或 Runtime 上限无效:${options.pluginId}`, {
      code: PLUGIN_CAPABILITY_ERROR_CODES.DENIED,
      path: options.pluginId,
    });
  }

  let required;
  let optional;
  try {
    required = normalizeCapabilities(request.required);
    optional = normalizeCapabilities(request.optional);
  } catch (error) {
    throw new PluginCapabilityError(`Plugin capability 请求列表无效:${options.pluginId}`, {
      code: PLUGIN_CAPABILITY_ERROR_CODES.DENIED,
      path: options.pluginId,
      cause: error,
    });
  }
  const requested = normalizeCapabilities([...required, ...optional]);
  const known = new Set(KNOWN_PLUGIN_CAPABILITIES);
  const effectiveProfile = minimumCapabilityProfile([request.profile, sourceMax, runtimeMax]);
  const allowed = new Set(capabilitiesForProfile(effectiveProfile));
  const granted = requested.filter((capability) => known.has(capability) && allowed.has(capability));
  const denied = requested.filter((capability) => !granted.includes(capability));
  const requiredDenied = required.filter((capability) => denied.includes(capability));
  if (requiredDenied.length > 0) {
    throw new PluginCapabilityError(
      `Plugin required capability 被拒绝:${options.pluginId}:${requiredDenied.join(",")}`,
      {
        code: PLUGIN_CAPABILITY_ERROR_CODES.DENIED,
        path: options.pluginId,
        details: {
          layer: "request-source-runtime",
          requested,
          granted,
          denied,
          sourceProfile: sourceMax,
          runtimeProfile: runtimeMax,
        },
      },
    );
  }

  const optionalDenied = optional.filter((capability) => denied.includes(capability));
  const diagnostics = optionalDenied.length === 0 ? [] : [diagnostic(
    options.pluginId,
    "PLUGIN_CAPABILITY_OPTIONAL_DENIED",
    `Plugin optional capability 已跳过:${optionalDenied.join(",")}`,
    {
      layer: "request-source-runtime",
      requested,
      granted,
      denied,
      sourceProfile: sourceMax,
      runtimeProfile: runtimeMax,
    },
  )];
  return {
    pluginId: options.pluginId,
    request: { profile: request.profile, required, optional },
    limits: { sourceProfile: sourceMax, runtimeProfile: runtimeMax },
    grant: {
      profile: effectiveProfile,
      granted,
      denied,
      approvalDigest: null,
    },
    diagnostics,
    requiresApproval: (
      effectiveProfile === CAPABILITY_PROFILES.INTEGRATION &&
      granted.includes(PLUGIN_CAPABILITIES.PATCH_INSERT)
    ),
    trustedBuiltin,
  };
}

/**
 * 应用项目批准层并生成可写入 lock 的最终 CapabilityGrant。
 *
 * @param {ReturnType<typeof evaluateCapabilityRequest>} evaluation capability 交集结果
 * @param {{approvalDigest?:string,approvedDigest?:string|null,approved?:boolean,nonInteractive?:boolean}} [options] 项目批准状态
 * @returns {{grant:import("../contracts.js").CapabilityGrant,reusedApproval:boolean}} 最终授权
 */
export function authorizeCapabilityGrant(evaluation, options = {}) {
  if (!evaluation.requiresApproval || evaluation.trustedBuiltin) {
    return { grant: { ...evaluation.grant }, reusedApproval: false };
  }
  const approvalDigest = options.approvalDigest;
  if (typeof approvalDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(approvalDigest)) {
    throw new PluginCapabilityError(`Plugin capability 批准摘要无效:${evaluation.pluginId}`, {
      code: PLUGIN_CAPABILITY_ERROR_CODES.PATCH_POLICY_INVALID,
      path: evaluation.pluginId,
    });
  }
  if (options.approvedDigest === approvalDigest) {
    return {
      grant: { ...evaluation.grant, approvalDigest },
      reusedApproval: true,
    };
  }
  if (options.approved === true && options.nonInteractive !== true) {
    return {
      grant: { ...evaluation.grant, approvalDigest },
      reusedApproval: false,
    };
  }
  throw new PluginCapabilityError(`Plugin integration capability 需要项目批准:${evaluation.pluginId}`, {
    code: PLUGIN_CAPABILITY_ERROR_CODES.APPROVAL_REQUIRED,
    path: evaluation.pluginId,
    details: {
      layer: "project-approval",
      requested: [...evaluation.request.required, ...evaluation.request.optional],
      granted: evaluation.grant.granted,
      denied: evaluation.grant.denied,
      approvalDigest,
    },
  });
}
