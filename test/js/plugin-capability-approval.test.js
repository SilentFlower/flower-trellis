import assert from "node:assert/strict";
import test from "node:test";
import { createCapabilityApprovalDigest } from "../../src/plugin/capabilities/approval-digest.js";

function approvalInput() {
  return {
    pluginId: "rd-guide/code-review",
    version: "1.2.3",
    integrity: `sha256:${"1".repeat(64)}`,
    source: {
      id: "rd-guide",
      type: "gitlab",
      reference: "digital-rd-governance/rd-guide",
      indexCommit: "a".repeat(40),
    },
    request: {
      profile: "integration",
      required: ["patch.insert", "content.skills"],
      optional: ["content.assets"],
    },
    marketplaceMaxProfile: "integration",
    runtimeProfile: "integration",
    operations: [{
      catalog: "plugin-rd-guide-code-review-123456789abc",
      patch: "workflow-note",
      id: "insert-note",
      operation: "insert",
      required: true,
      selector: { type: "workflow-hub", heading: "## Request Triage", expectedMatches: 1 },
      targets: [{ kind: "workflow", path: ".trellis/workflow.md", missing: "error" }],
    }],
  };
}

test("批准摘要对稳定集合排序不敏感", () => {
  const input = approvalInput();
  const first = createCapabilityApprovalDigest(input);
  const second = createCapabilityApprovalDigest({
    ...input,
    request: {
      ...input.request,
      required: [...input.request.required].reverse(),
    },
    source: {
      indexCommit: input.source.indexCommit,
      reference: input.source.reference,
      type: input.source.type,
      id: input.source.id,
    },
  });
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.equal(second, first);
});

test("批准摘要绑定版本、内容、来源上限和规范化 Patch 计划", () => {
  const input = approvalInput();
  const baseline = createCapabilityApprovalDigest(input);
  const changes = [
    { version: "1.2.4" },
    { integrity: `sha256:${"2".repeat(64)}` },
    { marketplaceMaxProfile: "standard" },
    { source: { ...input.source, indexCommit: "b".repeat(40) } },
    {
      operations: [{
        ...input.operations[0],
        selector: { ...input.operations[0].selector, heading: "## Phase 2" },
      }],
    },
    {
      operations: [{
        ...input.operations[0],
        targets: [{ kind: "markdown", path: ".trellis/spec/team.md", missing: "error" }],
      }],
    },
  ];
  for (const change of changes) {
    assert.notEqual(createCapabilityApprovalDigest({ ...input, ...change }), baseline);
  }
});
