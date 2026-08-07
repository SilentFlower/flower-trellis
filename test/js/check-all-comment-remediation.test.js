import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "vendor/skill-garden/.trellis/0.6");
const snapshotRoot = path.join(projectRoot, "enhancements/0.6");
const mainEntryMaxBytes = 7916;
const defaultRequiredMaxBytes = 39696;
const defaultRequiredPaths = [
  ".agents/skills/trellis-check-all/SKILL.md",
  ".agents/skills/trellis-check-all/references/depth-routing.md",
  ".agents/skills/trellis-check-all/references/fallback-findings.md",
  ".agents/skills/trellis-check-all/references/document-drift-auto-remediation.md",
  ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
];

/**
 * 读取指定根目录中的 UTF-8 文本文件。
 *
 * @param {string} root 文件根目录。
 * @param {string} relativePath 相对文件路径。
 * @returns {string} 文件文本。
 */
function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Check-All 默认必读上下文不超过任务基线", () => {
  const mainEntry = read(sourceRoot, defaultRequiredPaths[0]);
  const totalBytes = defaultRequiredPaths.reduce(
    (total, relativePath) => total + Buffer.byteLength(read(sourceRoot, relativePath)),
    0,
  );

  assert.ok(Buffer.byteLength(mainEntry) <= mainEntryMaxBytes);
  assert.ok(totalBytes <= defaultRequiredMaxBytes);

  for (const relativePath of defaultRequiredPaths) {
    const claudePath = relativePath.replace(".agents/", ".claude/");
    assert.equal(read(sourceRoot, relativePath), read(sourceRoot, claudePath), relativePath);
  }
});

test("源码注释事实修复使用条件加载且保持事实片段边界", () => {
  const entry = read(sourceRoot, ".agents/skills/trellis-check-all/SKILL.md");
  const docRemediation = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/document-drift-auto-remediation.md",
  );
  const commentRemediation = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/code-comment-auto-remediation.md",
  );

  assert.match(entry, /低风险事实漂移进入 `DOC-\*` 通道/);
  assert.doesNotMatch(entry, /公共 API 的 Javadoc|重试次数|超时时间/);
  assert.match(docRemediation, /发现源码注释事实候选时才读取 `references\/code-comment-auto-remediation\.md`/);
  assert.match(docRemediation, /`code-comment-fact`/);

  assert.match(commentRemediation, /机械引用/);
  assert.match(commentRemediation, /局部实现事实/);
  assert.match(commentRemediation, /本轮 diff.*任务规划、测试结果或其它已读取权威证据/s);
  assert.match(commentRemediation, /只替换目标事实片段/);
  assert.match(commentRemediation, /不整句润色、不删除注释/);
  assert.match(commentRemediation, /公共 API 的 Javadoc\/docstring/);
  assert.match(commentRemediation, /lint\/type-ignore、pragma、构建标签、shebang/);
  assert.match(commentRemediation, /TODO、FIXME、HACK/);
  assert.match(commentRemediation, /doctest、可执行示例/);
  assert.match(commentRemediation, /subagent 只返回候选/);
  assert.match(commentRemediation, /interactive 与 validated auto-loop 的主会话都可以落地/);
  assert.match(commentRemediation, /不得传给 `--doc-remediation-file`/);
  assert.match(commentRemediation, /重新计算实际 diff 和检查范围/);
  assert.match(commentRemediation, /复核 `check_profile`/);
  assert.match(commentRemediation, /重跑受影响的无副作用定向验证/);
});

test("注释事实 reference 在 canonical、snapshot 与 dogfood 中一致", () => {
  const paths = [
    ".agents/skills/trellis-check-all/references/code-comment-auto-remediation.md",
    ".claude/skills/trellis-check-all/references/code-comment-auto-remediation.md",
  ];

  for (const relativePath of paths) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
    assert.equal(read(projectRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});
