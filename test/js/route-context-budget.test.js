import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "vendor/skill-garden/.trellis/0.6");
const snapshotRoot = path.join(projectRoot, "enhancements/0.6");
const routePath = ".agents/skills/trellis-route";
const entryMaxBytes = 8192;
const projectedBaselineBytes = 39950;

/**
 * 列出路由会交给模型读取的说明和分发材料，排除可直接执行的 helper。
 *
 * @param {string} directory 路由目录。
 * @returns {string[]} Markdown 与 JSON 文件的绝对路径。
 */
function explanationFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return explanationFiles(file);
    return /\.(md|json)$/.test(entry.name) ? [file] : [];
  });
}

test("路由默认入口缩短且全部材料不通过拆分增加体量", () => {
  for (const root of [sourceRoot, snapshotRoot]) {
    const agentsRoot = path.join(root, routePath);
    const agents = fs.readFileSync(path.join(agentsRoot, "SKILL.md"));
    const claude = fs.readFileSync(path.join(root, ".claude/skills/trellis-route/SKILL.md"));
    assert.deepEqual(agents, claude);
    assert.ok(agents.length <= entryMaxBytes, `${root}: ${agents.length} B`);
    const totalBytes = explanationFiles(agentsRoot).reduce(
      (total, file) => total + fs.statSync(file).size,
      0,
    );
    assert.ok(totalBytes <= projectedBaselineBytes, `${root}: ${totalBytes} B`);
  }
});

test("路由低频规则可由入口发现但默认 inline 不加载", () => {
  const root = path.join(sourceRoot, routePath);
  const entry = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
  const references = [...entry.matchAll(/\]\((references\/[^)]+)\)/g)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(references)].sort(), [
    "references/interaction.md",
    "references/recovery-and-errors.md",
    "references/subagent-dispatch.md",
  ]);
  for (const relativePath of new Set(references)) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const snapshot = fs.readFileSync(path.join(snapshotRoot, routePath, relativePath), "utf8");
    assert.equal(source, snapshot, relativePath);
    assert.match(source, /仅在/);
  }
  assert.match(entry, /默认 inline 命中不读取上述 reference/);
  assert.match(entry, /inline 路径不读取 catalog/);
  assert.doesNotMatch(entry, /## 核心原则|## 反模式|### 输出模板|```yaml/);
});

test("路由明确选择先于恢复，展示后同轮执行并保留待决选择", () => {
  const entry = fs.readFileSync(path.join(sourceRoot, routePath, "SKILL.md"), "utf8");
  assert.ok(entry.indexOf("**明确指令先应用**") < entry.indexOf("**已有选择直接恢复**"));
  assert.match(entry, /只有明确“保存\/更新默认、以后默认”才持久化个人偏好，否则临时应用/);
  assert.match(entry, /假设、问题、引用或历史叙述不算执行指令/);
  assert.match(entry, /禁止自动代选或把 implement 选择套到 check/);
  assert.match(entry, /helper 的 hit\/written 输出就是本轮结构化执行证据/);
  assert.match(entry, /随后主 agent 在同一回合实际调用/);
  assert.match(entry, /不等用户回复“继续”/);
  assert.doesNotMatch(entry, /下一轮执行|下一轮由主 agent/);
});
