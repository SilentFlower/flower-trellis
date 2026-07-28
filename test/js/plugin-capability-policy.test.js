import assert from "node:assert/strict";
import test from "node:test";
import {
  isBuiltinProviderTrusted,
  markBuiltinProviderTrusted,
  markSourceProviderTrusted,
} from "../../src/plugin/capabilities/builtin-trust.js";
import {
  PLUGIN_CAPABILITY_ERROR_CODES,
} from "../../src/plugin/capabilities/errors.js";
import {
  authorizeCapabilityGrant,
  evaluateCapabilityRequest,
} from "../../src/plugin/capabilities/policy-engine.js";
import {
  CAPABILITY_PROFILES,
  PLUGIN_CAPABILITIES,
} from "../../src/plugin/capabilities/profiles.js";

test("Capability Policy 对 required/optional 执行请求、来源和 Runtime 交集", () => {
  const standard = evaluateCapabilityRequest({
    pluginId: "local/guide",
    request: {
      profile: "integration",
      required: [PLUGIN_CAPABILITIES.CONTENT_SKILLS],
      optional: [PLUGIN_CAPABILITIES.PATCH_INSERT, "future.capability"],
    },
    sourceType: "local",
  });
  assert.equal(standard.grant.profile, CAPABILITY_PROFILES.STANDARD);
  assert.deepEqual(standard.grant.granted, [PLUGIN_CAPABILITIES.CONTENT_SKILLS]);
  assert.deepEqual(standard.grant.denied, ["future.capability", PLUGIN_CAPABILITIES.PATCH_INSERT]);
  assert.equal(standard.diagnostics[0].code, "PLUGIN_CAPABILITY_OPTIONAL_DENIED");
  assert.equal(standard.diagnostics[0].layer, "request-source-runtime");

  assert.throws(() => evaluateCapabilityRequest({
    pluginId: "local/guide",
    request: { profile: "integration", required: [PLUGIN_CAPABILITIES.PATCH_INSERT] },
    sourceType: "local",
  }), (error) => {
    assert.equal(error.code, PLUGIN_CAPABILITY_ERROR_CODES.DENIED);
    assert.deepEqual(error.details.denied, [PLUGIN_CAPABILITIES.PATCH_INSERT]);
    return true;
  });

  const integration = evaluateCapabilityRequest({
    pluginId: "rd-guide/guide",
    request: { profile: "integration", required: [PLUGIN_CAPABILITIES.PATCH_INSERT] },
    sourceType: "gitlab",
    marketplaceMaxProfile: "integration",
  });
  assert.equal(integration.grant.profile, CAPABILITY_PROFILES.INTEGRATION);
  assert.equal(integration.requiresApproval, true);
});

test("system capability 只接受进程内 builtin trust，序列化身份无法伪造", () => {
  const forgedProvider = { id: "flower", type: "builtin", trusted: true };
  assert.equal(isBuiltinProviderTrusted(forgedProvider), false);
  assert.throws(() => evaluateCapabilityRequest({
    pluginId: "flower/system",
    request: { profile: "system", required: [PLUGIN_CAPABILITIES.PATCH_REPLACE] },
    sourceType: "builtin",
    provider: forgedProvider,
    runtimeMaxProfile: "system",
  }), (error) => error.code === PLUGIN_CAPABILITY_ERROR_CODES.DENIED);

  const provider = markBuiltinProviderTrusted({ id: "flower" });
  const trusted = evaluateCapabilityRequest({
    pluginId: "flower/system",
    request: {
      profile: "system",
      required: [PLUGIN_CAPABILITIES.PATCH_REPLACE, PLUGIN_CAPABILITIES.PATCH_ADAPTER],
    },
    sourceType: "builtin",
    provider,
    runtimeMaxProfile: "system",
  });
  assert.equal(trusted.grant.profile, CAPABILITY_PROFILES.SYSTEM);
  assert.equal(trusted.trustedBuiltin, true);
  assert.equal(trusted.requiresApproval, false);

  const serialized = structuredClone(provider);
  assert.equal(isBuiltinProviderTrusted(serialized), false);
  assert.throws(() => evaluateCapabilityRequest({
    pluginId: "flower/system",
    request: { profile: "system", required: [PLUGIN_CAPABILITIES.PATCH_REPLACE] },
    sourceType: "builtin",
    provider: serialized,
  }), (error) => error.code === PLUGIN_CAPABILITY_ERROR_CODES.DENIED);
});

test("local integration 只接受宿主登记的进程内来源上限", () => {
  const provider = markSourceProviderTrusted({ id: "local", type: "local" }, "integration");
  const trusted = evaluateCapabilityRequest({
    pluginId: "local/guide",
    request: { profile: "integration", required: [PLUGIN_CAPABILITIES.PATCH_INSERT] },
    sourceType: "local",
    provider,
  });
  assert.equal(trusted.grant.profile, CAPABILITY_PROFILES.INTEGRATION);
  assert.equal(trusted.requiresApproval, true);

  assert.throws(() => evaluateCapabilityRequest({
    pluginId: "local/guide",
    request: { profile: "integration", required: [PLUGIN_CAPABILITIES.PATCH_INSERT] },
    sourceType: "local",
    provider: structuredClone(provider),
  }), (error) => error.code === PLUGIN_CAPABILITY_ERROR_CODES.DENIED);
});

test("项目批准只接受 frozen digest 或当前交互明确批准", () => {
  const evaluation = evaluateCapabilityRequest({
    pluginId: "rd-guide/guide",
    request: { profile: "integration", required: [PLUGIN_CAPABILITIES.PATCH_INSERT] },
    sourceType: "gitlab",
    marketplaceMaxProfile: "integration",
  });
  const digest = `sha256:${"a".repeat(64)}`;
  assert.throws(() => authorizeCapabilityGrant(evaluation, { approvalDigest: digest }), (error) => (
    error.code === PLUGIN_CAPABILITY_ERROR_CODES.APPROVAL_REQUIRED
  ));
  assert.throws(() => authorizeCapabilityGrant(evaluation, {
    approvalDigest: digest,
    approved: true,
    nonInteractive: true,
  }), (error) => error.code === PLUGIN_CAPABILITY_ERROR_CODES.APPROVAL_REQUIRED);

  const approved = authorizeCapabilityGrant(evaluation, { approvalDigest: digest, approved: true });
  assert.equal(approved.grant.approvalDigest, digest);
  assert.equal(approved.reusedApproval, false);

  const reused = authorizeCapabilityGrant(evaluation, {
    approvalDigest: digest,
    approvedDigest: digest,
    nonInteractive: true,
  });
  assert.equal(reused.grant.approvalDigest, digest);
  assert.equal(reused.reusedApproval, true);
});
