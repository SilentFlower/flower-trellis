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

test("auto-loop 启动前选模先返回 runner，普通执行门槛与同轮实施继续保留", () => {
  for (const root of [sourceRoot, snapshotRoot]) {
    const routeRoot = path.join(root, routePath);
    const entry = fs.readFileSync(path.join(routeRoot, "SKILL.md"), "utf8");
    const recovery = fs.readFileSync(path.join(routeRoot, "references/recovery-and-errors.md"), "utf8");
    const interaction = fs.readFileSync(path.join(routeRoot, "references/interaction.md"), "utf8");
    const startup = recovery.split("## auto-loop 启动前选模\n")[1]?.split("## auto-loop prepare 预检")[0];
    assert.ok(startup, "启动准备必须有独立的条件分支");
    assert.ok(entry.indexOf("**auto-loop 启动前选模例外**") < entry.indexOf("## 进入条件与证据"));
    assert.match(entry, /不套用下方执行门槛或同轮实施规则/);
    assert.match(entry, /task implement 需要任务已获首次 Brief 批准且处于 `in_progress`/);
    assert.match(entry, /随后主 agent 在同一回合实际调用/);
    assert.match(startup, /用户明确要求启动自动循环/);
    assert.match(startup, /普通规划、恢复 running action 或历史启动表述不进入此例外/);
    assert.match(startup, /对显式队列任务的 implement\/check 使用下方只读预检/);
    assert.match(startup, /不得把某一任务的 session 决定复制成整队列模式/);
    assert.match(startup, /不得调用 task 的 `write`、手写 runtime 或绑定\/切换任务/);
    assert.match(startup, /明确要求保存个人默认时调用 `write-pref/);
    assert.match(startup, /不得直接 `task.py start`、实施、运行 Check-All 或分发 subagent/);
    assert.match(startup, /选择确定后同轮返回 `trellis-auto-loop` 启动 runner/);
    assert.match(interaction, /不执行下方 task `write` 或末尾同轮实施/);
    for (const platform of [".agents", ".claude"]) {
      const autoLoop = fs.readFileSync(path.join(root, platform, "skills/trellis-auto-loop/SKILL.md"), "utf8");
      assert.match(autoLoop, /启动前进入 `trellis-route` 的“auto-loop 启动前选模例外”/);
      assert.match(autoLoop, /只有 runner 返回 `run_implement` \/ `run_check_all` 等运行 action 后/);
      assert.match(autoLoop, /每个 action 完成后，必须用同名 `record --action/);
      assert.match(autoLoop, /不得 push、merge、release 或 deploy/);
    }
  }
});

test("Check-All 和 Push 条件引用完整投影，全部说明不因拆分增长", () => {
  for (const [name, baseline] of [["trellis-check-all", 57123], ["trellis-push", 35656]]) {
    const directory = path.join(sourceRoot, ".agents/skills", name);
    const files = explanationFiles(directory);
    const bytes = files.reduce((total, file) => total + fs.statSync(file).size, 0);
    assert.ok(bytes <= baseline, `${name}: ${bytes} > ${baseline}`);
    for (const file of files) {
      const relative = path.relative(directory, file);
      const expected = fs.readFileSync(file, "utf8");
      for (const root of [sourceRoot, snapshotRoot, projectRoot]) {
        for (const platform of [".agents", ".claude"]) {
          const target = path.join(root, platform, "skills", name, relative);
          assert.equal(fs.readFileSync(target, "utf8"), expected, target);
        }
      }
      for (const match of expected.matchAll(/\]\((references\/[^)#]+\.md)(?:#[^)]*)?\)/g)) {
        assert.ok(fs.existsSync(path.join(directory, match[1])), `${file}: ${match[1]}`);
      }
    }
  }
});

test("路由缺省只读且不冒充用户选择，特殊提交仍先载入适用细则", () => {
  const route = fs.readFileSync(path.join(sourceRoot, routePath, "SKILL.md"), "utf8");
  assert.match(route, /没有选择时使用内置 inline，不询问模式/);
  assert.match(route, /`builtin-default`.*不写 session 或个人偏好/);
  const interaction = fs.readFileSync(path.join(sourceRoot, routePath, "references/interaction.md"), "utf8");
  assert.match(interaction, /清除指定默认.*内置 inline 继续，不再弹菜单/);
  const push = fs.readFileSync(path.join(sourceRoot, ".agents/skills/trellis-push/SKILL.md"), "utf8");
  assert.match(push, /未命中场景不加载其 reference；命中却缺失细则时阻塞/);
  assert.match(push, /多仓\/生成依赖、已有 merge 或历史 GC ahead/);
  assert.match(push, /git-special-cases\.md.*相关规划或副作用前读取/);
  assert.match(push, /`MERGE_HEAD` 存在时仅普通模式可继续/);
  assert.match(push, /确认前禁止 `git add`、`git commit` 或 `git push`/);
});
