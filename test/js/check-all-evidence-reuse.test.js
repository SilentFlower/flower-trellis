import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "vendor/skill-garden/.trellis/0.6");
const skillPath = ".agents/skills/trellis-check-all";

/**
 * 读取 Check-All 的实际提示词契约。
 * @param {string} relativePath 相对技能目录的路径。
 * @returns {string} UTF-8 文本。
 */
function read(relativePath) {
  return fs.readFileSync(path.join(sourceRoot, skillPath, relativePath), "utf8");
}

test("验收与追踪合并证据，但保留全部来源和独立约束", () => {
  for (const profile of ["full", "light"]) {
    const content = read(`references/${profile}-profile.md`);
    assert.match(content, /合并验收.*保留全部来源位置/);
    assert.match(content, /不同约束、边界场景.*不得合并丢失/);
    assert.match(content, /同一条调用链只追踪一次/);
    assert.match(content, /独立的验收判断/);
    assert.match(content, /review gate.*rollback point/);
    assert.match(content, /references\/verification\.md/);
    assert.doesNotMatch(content, /trellis-check\/SKILL\.md|Dimension E|Verification Tests/);
    assert.match(content, /API Contract/);
    assert.match(content, /Component Context/);
    assert.match(content, /Data History/);
    assert.match(content, /Data Flow Trace/);
    assert.match(content, /无 `CHK-\*`、无 `FBK-\*`、无阻塞、无部分验证/);
  }
});

test("共享验证只复用条件匹配的真实证据，失败与遗漏仍须处理", () => {
  const content = read("references/verification.md");
  assert.match(content, /命令、工作目录、覆盖范围、退出状态明确/);
  assert.match(content, /源码、测试、配置和工具链未变化才可复用/);
  assert.match(content, /无法确认适用范围均不足以复用/);
  assert.match(content, /相同工作目录、命令参数、环境与被测内容的验证只执行一次/);
  assert.match(content, /不同条件不得去重/);
  assert.match(content, /测试过滤范围、跳过项和未执行项不能算作已覆盖/);
  assert.match(content, /缺失、失败或失效的证据.*补跑必要命令/);
  assert.match(content, /按实际独立验证统计，不按引用次数累加/);
  assert.match(content, /DOC 修复后重新判断受影响证据/);
  assert.match(content, /不得用证据复用跳过必需回归或伪报已运行/);
});

test("质量依据来自实际风险与项目约定，不以函数或常量数量要求改造", () => {
  const content = read("references/verification.md");
  assert.match(content, /不因新增函数就要求一份对应单测/);
  assert.match(content, /不因两处值相同就要求抽公共常量/);
  assert.match(content, /项目 spec、风险等级或回归概率明确要求自动化覆盖时，缺失测试仍记录问题/);
  assert.match(content, /漏改的调用方、批量修改遗漏、生成或分发产物/);
  assert.match(content, /debug logging、warning suppression、类型安全绕过/);
  assert.match(content, /不直接修复代码、配置或测试/);
  assert.match(content, /不得调用 `plan` \/ `run` 或任何 Maven goal/);
});

test("两个 profile 的实际必读清单小于原 profile 加通用检查入口", () => {
  const previousBytes = { full: 7773 + 2814, light: 5192 + 2814 };
  const verificationBytes = Buffer.byteLength(read("references/verification.md"));
  for (const [profile, baseline] of Object.entries(previousBytes)) {
    const total = Buffer.byteLength(read(`references/${profile}-profile.md`)) + verificationBytes;
    assert.ok(total < baseline, `${profile}: ${total} >= ${baseline}`);
  }
});

test("检查及重检报告先解释实际改动，且不隐藏未验证内容或问题", () => {
  const content = read("references/reporting-and-disposition.md");
  assert.match(content, /staged、unstaged、未跟踪文件及必要的子仓/);
  assert.match(content, /不额外启动 Diff Brief 流程或重复扫描/);
  assert.match(content, /只有证据支持时才描述旧行为/);
  assert.match(content, /计划中的功能不得写成已经交付/);
  assert.match(content, /未归属本次范围的 dirty 不得混入/);
  assert.match(content, /阻塞或重大问题在开头说明/);
  assert.match(content, /重检只解释本轮修复及其影响/);
  assert.match(content, /## Trellis Check-All 结果\n\n<用自然语言说明实际改动[^\n]+\n\n\[</);
  assert.match(content, /## Trellis Check-All 修复结果\n\n<用自然语言说明本轮实际修复[^\n]+\n\n\[</);
  assert.match(content, /独立 `CHK-\*` 或 `FBK-\*` 不得因数量多而静默省略/);
  assert.match(content, /interactive 标准报告必须以“下一步”段结束/);
});

test("去重清单与自然改动说明同步到双平台、快照和当前项目", () => {
  for (const relativePath of [
    "SKILL.md",
    "references/full-profile.md",
    "references/light-profile.md",
    "references/verification.md",
    "references/maven-evidence.md",
    "references/reporting-and-disposition.md",
  ]) {
    const expected = read(relativePath);
    for (const root of [sourceRoot, path.join(projectRoot, "enhancements/0.6"), projectRoot]) {
      for (const platform of [".agents", ".claude"]) {
        const file = path.join(root, platform, "skills/trellis-check-all", relativePath);
        assert.equal(fs.readFileSync(file, "utf8"), expected, file);
      }
    }
  }
});
