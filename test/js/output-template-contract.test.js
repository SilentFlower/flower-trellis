import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectOutputTemplateFindings,
  scanDocument,
} from "../../scripts/check-output-templates.mjs";

/**
 * 把一段文档内容写进临时文件并扫描,返回缺陷列表。
 *
 * 守卫按「文件路径」报告缺陷,因此测试需要真实落盘而非直接传字符串。
 *
 * @param {string} content 待扫描的 Markdown 文档内容
 * @returns {Array<{kind: string, line: number}>} 缺陷列表
 */
function scanContent(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "output-template-"));
  const file = path.join(dir, "SKILL.md");
  try {
    fs.writeFileSync(file, content, "utf8");
    return scanDocument(file, "fixture/SKILL.md");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("列表项承载的编号条目被判定为渲染折叠缺陷", () => {
  // 这是 0.6 之前 check-all 报告的写法:语法完全合法,前三类检测全部放行,
  // 但终端渲染器会把松散列表压平,CHK-001 与 CHK-002 糊成一整段。
  const findings = scanContent(
    [
      "```markdown",
      "### 主路径问题",
      "",
      "- [ ] `CHK-001` `[P1]` `[spec]` <标题>",
      "  - 证据：<file:line>",
      "  - 影响：<影响>",
      "",
      "- [ ] `CHK-002` `[P2]` `[design]` <标题>",
      "  - 证据：<file:line>",
      "  - 影响：<影响>",
      "```",
    ].join("\n"),
  );

  assert.deepEqual(
    findings.map((item) => item.kind),
    ["list-borne-finding", "list-borne-finding"],
  );
  assert.deepEqual(findings.map((item) => item.line), [4, 8]);
});


test("标题承载的编号条目不触发缺陷", () => {
  const findings = scanContent(
    [
      "```markdown",
      "### 主路径问题",
      "",
      "#### `CHK-001` `P1` `spec` <标题>",
      "",
      "- **证据**",
      "  - `<file:line>` — <命令结果>",
      "- **影响**：<影响>",
      "",
      "#### `CHK-002` `P2` `design` <标题> `[已接受风险]`",
      "",
      "- **证据**",
      "  - `<file:line>` — <命令结果>",
      "- **影响**：<影响>",
      "```",
    ].join("\n"),
  );

  assert.deepEqual(findings, []);
});


test("无嵌套字段的编号列表项不误判", () => {
  // 「修复结果」这类单行编号条目不下挂字段子项,压平也不影响辨识,不应拦截。
  const findings = scanContent(
    [
      "```markdown",
      "- `CHK-001` 已修复",
      "- `FBK-001` 未修复",
      "```",
    ].join("\n"),
  );

  assert.deepEqual(findings, []);
});


test("编号条目的等价写法同样被拦截", () => {
  // 守卫若只认「短横 + 反引号 ID」这一种历史写法,换个等价写法就能绕过,
  // 契约实际没有锁住。逐一覆盖加粗包裹、有序列表和无反引号三条绕过路径。
  const variants = {
    "加粗包裹": "- **`CHK-001`** `P1` <标题>\n  - **证据**\n  - **影响**：y",
    "有序列表": "1. `CHK-001` `P1` <标题>\n   - **证据**\n   - **影响**：y",
    "无反引号": "- CHK-001 `P1` <标题>\n  - **证据**\n  - **影响**：y",
    "星号列表": "* `FBK-001` `P1` <标题>\n  - **证据**\n  - **影响**：y",
  };

  for (const [name, body] of Object.entries(variants)) {
    const findings = scanContent(["```markdown", body, "```"].join("\n"));
    assert.deepEqual(
      findings.map((item) => item.kind),
      ["list-borne-finding"],
      `${name} 写法应被判定为渲染折叠缺陷`,
    );
  }
});


test("非编号条目的加粗字段行不误判", () => {
  // `- **Check-All**：<...>` 这类加粗字段行与编号条目形状相近,不得误伤。
  const findings = scanContent(
    [
      "```markdown",
      "### 完成链证据",
      "- **Check-All**：<通过 / 未运行>",
      "  - 子项",
      "- **批次 1**：<CHK/FBK 问题 ID> · <修复目标>",
      "  - 子项",
      "- [untracked] <path>",
      "  - 子项",
      "```",
    ].join("\n"),
  );

  assert.deepEqual(findings, []);
});


test("0.6 强化包全部 skill 输出模板满足渲染契约", () => {
  const { root, findings, scanned } = collectOutputTemplateFindings();
  const pushTemplates = path.join(
    root,
    ".claude/skills/trellis-push/references/output-templates.md",
  );

  assert.ok(scanned > 0, "应至少扫描到一个 skill 文档");
  assert.ok(fs.existsSync(pushTemplates), "trellis-push 输出 reference 应进入递归扫描目录");
  assert.deepEqual(
    findings.map((item) => `${item.file}:${item.line} ${item.kind}`),
    [],
  );
});
