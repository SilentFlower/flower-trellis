import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { planVersionUpdate, runPluginInteractive } from "../../src/commands/plugin-interactive.js";
import { MemoryCredentialStore } from "../../src/plugin/auth/memory-credential-store.js";
import { UserSourceStore } from "../../src/plugin/sources/user-source-store.js";
import { ProjectStore } from "../../src/plugin/state/project-store.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";

const descriptor = {
  schemaVersion: 1,
  id: "rd-guide",
  type: "gitlab",
  name: "研发指南",
  enabled: true,
  baseUrl: "http://gitlab.example.test",
  project: "group/rd-guide",
  ref: "main",
  marketplacePath: ".flower-plugin/marketplace.json",
  oauth: { applicationId: "public-client", scopes: ["read_api", "read_repository"] },
};

/**
 * 构造管理器返回值。
 *
 * @param {string} tab 当前页签
 * @param {string} action 动作
 * @returns {object} 管理器结果
 */
function managerResult(tab, action) {
  return {
    tab,
    action,
    queries: { discover: "", installed: "", sources: "", issues: "" },
    selectedByTab: { discover: null, installed: null, sources: null, issues: null },
  };
}

/**
 * 创建按顺序返回结果的 prompt adapter。
 *
 * @param {Array<{type:string,value:unknown,check?:(question:object)=>void}>} steps prompt 脚本
 * @returns {{prompts:object,assertDone:()=>void}} adapter 与完成断言
 */
function scriptedPrompts(steps) {
  const pending = [...steps];
  const prompt = (type) => async (question) => {
    const step = pending.shift();
    assert.ok(step, `缺少 ${type} prompt 脚本`);
    assert.equal(step.type, type);
    step.check?.(question);
    return step.value;
  };
  return {
    prompts: {
      manager: prompt("manager"),
      action: prompt("action"),
      select: prompt("select"),
      input: prompt("input"),
      checkbox: prompt("checkbox"),
      confirm: prompt("confirm"),
    },
    assertDone: () => assert.deepEqual(pending, []),
  };
}

/**
 * 创建不接触真实用户配置或 Keyring 的交互测试依赖。
 *
 * @param {import("node:test").TestContext} t 测试上下文
 * @returns {object} 测试依赖
 */
function interactiveFixture(t) {
  const project = createPluginTestRoot(t, "flower-plugin-interactive-");
  const output = [];
  return {
    project,
    output,
    store: new ProjectStore(project),
    sourceStore: new UserSourceStore({
      configFile: path.join(project, "source-config.json"),
      builtinDescriptors: [descriptor],
    }),
    credentialBundle: { store: new MemoryCredentialStore(), persistent: false },
    outputAdapter: {
      log: (message) => output.push(message),
      error: (message) => output.push(message),
    },
  };
}

/**
 * 断言 rd-guide 普通 Plugin 的 Skill 选择题。
 *
 * @param {object} question checkbox prompt 入参
 */
function assertRdGuideSkillQuestion(question) {
  assert.equal(question.message, "选择要启用的 RD Guide 技能");
  assert.equal(question.required, false);
  assert.deepEqual(
    question.choices.map(({ value }) => value),
    ["xhgj-gitlab-collaboration"],
  );
  assert.equal(question.choices[0].checked, false);
  assert.match(question.choices[0].name, /v0\.1\.0/);
  assert.equal(question.shortcuts.all, null);
  assert.equal(question.shortcuts.invert, null);
}

/**
 * 构造只暴露 GitLab 协作 Skill 的 rd-guide 清单读取器。
 *
 * @param {{version?:string,locked?:boolean}} [expect] 期望参数
 * @returns {Function} 清单读取器
 */
function rdGuideSkillInspector(expect = {}) {
  return async (request) => {
    assert.equal(request.pluginId, "rd-guide/review");
    if (expect.version) assert.equal(request.version, expect.version);
    if (expect.locked) assert.ok(request.lockedPlugin);
    return {
      ok: true,
      pluginId: request.pluginId,
      version: request.version || request.lockedPlugin?.version || "1.0.0",
      name: "研发指南",
      skills: [{
        name: "xhgj-gitlab-collaboration",
        path: "skills/xhgj-gitlab-collaboration",
        description: "GitLab 协作执行。",
        version: "0.1.0",
      }],
    };
  };
}

test("四页签管理器可显式退出且不初始化项目状态", async (t) => {
  const fixture = interactiveFixture(t);
  const script = scriptedPrompts([{
    type: "manager",
    value: managerResult("discover", "exit"),
    check: (view) => assert.deepEqual(view.tabs.map(({ label }) => label), ["发现", "已安装", "来源", "问题"]),
  }]);
  const code = await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: () => { throw new Error("退出不应执行命令"); },
  });
  assert.equal(code, 0);
  assert.match(fixture.output.join("\n"), /已退出 Plugin 管理/);
  assert.equal(fixture.store.readLock(), null);
  script.assertDone();
});

test("发现页的内置 Skill Garden 入口复用 skill 管理器", async (t) => {
  const fixture = interactiveFixture(t);
  fs.mkdirSync(path.join(fixture.project, ".trellis"), { recursive: true });
  const script = scriptedPrompts([
    {
      type: "manager",
      value: managerResult("discover", "builtin:flower/skill-garden"),
      check: (view) => {
        const builtin = view.itemsByTab.discover.find(({ value }) => value === "builtin:flower/skill-garden");
        assert.equal(builtin.title, "flower/skill-garden");
        assert.match(builtin.meta, /Flower 内置/);
        assert.equal(view.tabs.find(({ id }) => id === "discover").count, 1);
      },
    },
    { type: "manager", value: managerResult("discover", "exit") },
  ]);
  let opened = 0;
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    skillGardenProvider: {
      listCandidates: () => [{
        id: "flower/skill-garden",
        version: "0.5.1-beta.1",
        manifest: { name: "Flower Skill Garden" },
      }],
    },
    openSkillManager: async () => { opened += 1; },
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: () => { throw new Error("内置 Skill Garden 入口不应执行 Plugin 生命周期命令"); },
  });
  assert.equal(opened, 1);
  script.assertDone();
});

test("无 Trellis 项目发现页仍可打开内置 Skill 管理且不读取 Provider 候选", async (t) => {
  const fixture = interactiveFixture(t);
  fs.mkdirSync(path.join(fixture.project, ".codex"), { recursive: true });
  const script = scriptedPrompts([
    {
      type: "manager",
      value: managerResult("discover", "builtin:flower/skill-garden"),
      check: (view) => {
        const builtin = view.itemsByTab.discover.find(({ value }) => value === "builtin:flower/skill-garden");
        assert.equal(builtin.title, "flower/skill-garden");
        assert.match(builtin.meta, /Flower 内置 · .+/);
        assert.equal(view.tabs.find(({ id }) => id === "discover").count, 1);
        assert.equal(view.tabs.find(({ id }) => id === "issues").count, 0);
      },
    },
    { type: "manager", value: managerResult("discover", "exit") },
  ]);
  let opened = 0;
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    skillGardenProvider: {
      listCandidates: () => {
        throw new Error("无 Trellis common-only 不应读取 Provider 候选");
      },
    },
    openSkillManager: async () => { opened += 1; },
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: () => { throw new Error("内置 Skill 管理入口不应执行 Plugin 生命周期命令"); },
  });
  assert.equal(opened, 1);
  assert.equal(fs.existsSync(path.join(fixture.project, ".flower")), false);
  assert.equal(fs.existsSync(path.join(fixture.project, ".trellis")), false);
  assert.doesNotMatch(fixture.output.join("\n"), /目标不是 Trellis/);
  script.assertDone();
});

test("旧版 Skill Garden 计入已安装并保持只读", async (t) => {
  const fixture = interactiveFixture(t);
  const trellisDir = path.join(fixture.project, ".trellis");
  fs.mkdirSync(trellisDir, { recursive: true });
  const legacyPath = path.join(trellisDir, ".flower-manifest.json");
  const legacyText = `${JSON.stringify({
    flowerVersion: "0.5.1-beta.1",
    variant: "0.6",
    version: "0.6.5",
    skills: ["trellis-check-all"],
    paths: [".agents/skills/trellis-check-all"],
  }, null, 2)}\n`;
  fs.writeFileSync(legacyPath, legacyText);
  const script = scriptedPrompts([
    {
      type: "manager",
      value: managerResult("installed", "legacy:flower/skill-garden"),
      check: (view) => {
        const installed = view.itemsByTab.installed.find(({ value }) => value === "legacy:flower/skill-garden");
        assert.equal(view.tabs.find(({ id }) => id === "installed").count, 1);
        assert.equal(installed.title, "flower/skill-garden");
        assert.equal(installed.badge, "旧版安装");
        assert.match(installed.meta, /0\.5\.1-beta\.1.*0\.6/);
      },
    },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  let opened = 0;
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    skillGardenProvider: {
      listCandidates: () => [{ id: "flower/skill-garden", version: "0.5.1-beta.1" }],
    },
    openSkillManager: async () => { opened += 1; },
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: () => { throw new Error("旧版 Skill Garden 管理不应执行 Plugin 生命周期命令"); },
  });
  assert.equal(opened, 1);
  assert.equal(fs.readFileSync(legacyPath, "utf8"), legacyText);
  assert.equal(fs.existsSync(path.join(fixture.project, ".flower")), false);
  script.assertDone();
});

test("rd-guide 发现页直接进入技能管理并直接应用选择", async (t) => {
  const fixture = interactiveFixture(t);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("discover", "plugin:rd-guide:rd-guide/review") },
    { type: "checkbox", value: ["xhgj-gitlab-collaboration"], check: assertRdGuideSkillQuestion },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  const code = await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    searchPlugins: async () => [{
      id: "rd-guide/review",
      description: "代码评审规范",
      versions: ["1.0.0", "1.2.0"],
      source: "rd-guide",
    }],
    authStatus: async () => ({ authorized: true, persistent: false }),
    inspectPluginContentSkills: rdGuideSkillInspector({ version: "1.2.0" }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.equal(code, 0);
  assert.deepEqual(commands, [
    [
      "add",
      "rd-guide/review",
      "--version",
      "^1.2.0",
      "--content-skill",
      "xhgj-gitlab-collaboration",
      "--platform",
      "codex",
      "--platform",
      "claude",
    ],
  ]);
  assert.match(fixture.output.join("\n"), /RD Guide 技能管理/);
  assert.doesNotMatch(fixture.output.join("\n"), /Plugin 详情/);
  assert.doesNotMatch(fixture.output.join("\n"), /安装预览/);
  assert.doesNotMatch(fixture.output.join("\n"), /当前项目还没有可识别的平台/);
  script.assertDone();
});

test("rd-guide Skill 空选择使用中文提示且不执行安装", async (t) => {
  const fixture = interactiveFixture(t);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("discover", "plugin:rd-guide:rd-guide/review") },
    { type: "checkbox", value: [], check: assertRdGuideSkillQuestion },
    { type: "manager", value: managerResult("discover", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    searchPlugins: async () => [{
      id: "rd-guide/review",
      description: "代码评审规范",
      versions: ["1.0.0"],
      source: "rd-guide",
    }],
    authStatus: async () => ({ authorized: true, persistent: false }),
    inspectPluginContentSkills: rdGuideSkillInspector({ version: "1.0.0" }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, []);
  assert.match(fixture.output.join("\n"), /未选择 RD Guide 技能，已取消安装/);
  script.assertDone();
});

test("未登录来源按 Enter 直接设备码授权并返回原发现页", async (t) => {
  const fixture = interactiveFixture(t);
  const script = scriptedPrompts([
    {
      type: "manager",
      value: managerResult("discover", "auth:rd-guide"),
      check: (view) => {
        const auth = view.itemsByTab.discover.find(({ value }) => value === "auth:rd-guide");
        assert.match(auth.description, /获取 GitLab 授权码/);
      },
    },
    { type: "manager", value: managerResult("discover", "plugin:rd-guide:rd-guide/review") },
    { type: "checkbox", value: ["xhgj-gitlab-collaboration"], check: assertRdGuideSkillQuestion },
    { type: "manager", value: managerResult("discover", "exit") },
  ]);
  let authorized = false;
  let searches = 0;
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    searchPlugins: async () => {
      searches += 1;
      return [{
        id: "rd-guide/review",
        description: "代码评审规范",
        versions: ["1.0.0"],
        source: "rd-guide",
      }];
    },
    authStatus: async () => ({ authorized, persistent: false }),
    inspectPluginContentSkills: rdGuideSkillInspector({ version: "1.0.0" }),
    runCommand: async (args) => {
      commands.push(args);
      if (args[0] === "auth") authorized = true;
      return 0;
    },
  });
  assert.equal(searches, 1);
  assert.deepEqual(commands, [
    ["auth", "login", "rd-guide", "--device"],
    [
      "add",
      "rd-guide/review",
      "--version",
      "^1.0.0",
      "--content-skill",
      "xhgj-gitlab-collaboration",
      "--platform",
      "codex",
      "--platform",
      "claude",
    ],
  ]);
  assert.match(fixture.output.join("\n"), /RD Guide 技能已应用/);
  script.assertDone();
});

test("已安装页先预览再确认卸载", async (t) => {
  const fixture = interactiveFixture(t);
  const store = {
    readPlugins: () => ({
      schemaVersion: 1,
      plugins: [{ id: "rd-guide/review", source: "rd-guide", version: "^1.0.0" }],
    }),
    readLock: () => ({
      schemaVersion: 1,
      roots: ["rd-guide/review"],
      plugins: [{ id: "rd-guide/review", version: "1.2.0", source: { type: "gitlab" } }],
    }),
    readState: () => ({
      schemaVersion: 1,
      plugins: [{ id: "rd-guide/review", platforms: ["codex"] }],
    }),
  };
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "installed:rd-guide/review") },
    { type: "select", value: "remove" },
    { type: "confirm", value: true },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, [
    ["remove", "rd-guide/review", "--dry-run"],
    ["remove", "rd-guide/review"],
  ]);
  script.assertDone();
});

test("已安装页复用全项目 update dry-run 和真实事务", async (t) => {
  const fixture = interactiveFixture(t);
  const store = {
    readPlugins: () => ({
      schemaVersion: 1,
      plugins: [{ id: "rd-guide/review", source: "rd-guide", version: "^1.0.0" }],
    }),
    readLock: () => null,
    readState: () => null,
  };
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "update:all") },
    { type: "confirm", value: true },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, [["update", "--dry-run"], ["update"]]);
  script.assertDone();
});

test("planVersionUpdate 区分范围内更新与跨兼容边界放宽", () => {
  assert.deepEqual(
    planVersionUpdate({ declared: "^0.4.0", available: ["0.4.0", "0.4.3"] }),
    { action: "in-range", latest: "0.4.3" },
  );
  // Marketplace 只保留最新版时，旧的精确锁筛不到任何候选，必须放宽。
  assert.deepEqual(
    planVersionUpdate({ declared: "0.3.0", available: ["0.4.0"] }),
    { action: "widen", latest: "0.4.0", nextRange: "^0.4.0" },
  );
  assert.deepEqual(
    planVersionUpdate({ declared: "^0.4.0", available: ["0.5.0"] }),
    { action: "widen", latest: "0.5.0", nextRange: "^0.5.0" },
  );
  assert.deepEqual(planVersionUpdate({ declared: "^0.4.0", available: [] }), { action: "unknown" });
  assert.deepEqual(planVersionUpdate(), { action: "unknown" });
});

/**
 * 构造带 Marketplace 与已安装声明的交互依赖。
 *
 * @param {object} fixture 交互测试依赖
 * @param {string} declaredVersion plugins.json 中的版本约束
 * @param {string[]} marketplaceVersions Marketplace 可用版本
 * @returns {object} 注入依赖
 */
function installedDeps(fixture, declaredVersion, marketplaceVersions) {
  return {
    store: {
      readPlugins: () => ({
        schemaVersion: 1,
        plugins: [{ id: "rd-guide/review", source: "rd-guide", version: declaredVersion }],
      }),
      readLock: () => ({
        schemaVersion: 1,
        roots: ["rd-guide/review"],
        plugins: [{ id: "rd-guide/review", version: "0.3.0", source: { type: "gitlab" } }],
      }),
      readState: () => ({
        schemaVersion: 1,
        plugins: [{ id: "rd-guide/review", platforms: ["claude"] }],
      }),
    },
    searchPlugins: async () => [{
      id: "rd-guide/review",
      description: "代码评审规范",
      versions: marketplaceVersions,
      source: "rd-guide",
    }],
    authStatus: async () => ({ authorized: true, persistent: false }),
  };
}

test("发现页 rd-guide 聚合入口隐藏包版本并直接进入管理动作", async (t) => {
  const fixture = interactiveFixture(t);
  const deps = installedDeps(fixture, "0.3.0", ["0.4.0"]);
  const script = scriptedPrompts([
    {
      type: "manager",
      value: managerResult("discover", "exit"),
      check: (view) => {
        const entry = view.itemsByTab.discover.find(({ title }) => title === "RD Guide 技能");
        assert.equal(entry.badge, "已安装");
        assert.equal(entry.meta, "研发指南");
        assert.match(entry.description, /已安装/);
      },
    },
  ]);
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    runCommand: async () => 0,
    ...deps,
  });
  script.assertDone();
});

test("发现页把已是最新的已安装 Plugin 标成已安装", async (t) => {
  const fixture = interactiveFixture(t);
  const deps = installedDeps(fixture, "^0.3.0", ["0.3.0"]);
  const script = scriptedPrompts([
    {
      type: "manager",
      value: managerResult("discover", "exit"),
      check: (view) => {
        const entry = view.itemsByTab.discover.find(({ title }) => title === "RD Guide 技能");
        assert.equal(entry.badge, "已安装");
        assert.equal(entry.meta, "研发指南");
      },
    },
  ]);
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    runCommand: async () => 0,
    ...deps,
  });
  script.assertDone();
});

test("跨兼容边界更新一次放宽全部被阻塞声明", async (t) => {
  const fixture = interactiveFixture(t);
  const deps = installedDeps(fixture, "0.3.0", ["0.4.0"]);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "installed:rd-guide/review") },
    { type: "select", value: "update" },
    {
      type: "confirm",
      value: true,
      check: (question) => assert.match(question.message, /放宽 1 个声明并更新项目 Plugin/),
    },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    runCommand: async (args) => { commands.push(args); return 0; },
    ...deps,
  });
  assert.deepEqual(commands, [
    ["update", "--widen", "rd-guide/review=^0.4.0", "--dry-run"],
    ["update", "--widen", "rd-guide/review=^0.4.0"],
  ]);
  assert.match(fixture.output.join("\n"), /rd-guide\/review\s+0\.3\.0 → \^0\.4\.0/);
  script.assertDone();
});

test("多个声明同时越界时批量放宽，避免解析器互锁", async (t) => {
  const fixture = interactiveFixture(t);
  // alpha 与 beta 都是精确锁且都落后；只放宽其一会在另一个上撞「已锁定 Plugin 包不可重放」。
  const store = {
    readPlugins: () => ({
      schemaVersion: 1,
      plugins: [
        { id: "rd-guide/alpha", source: "rd-guide", version: "0.3.0" },
        { id: "rd-guide/beta", source: "rd-guide", version: "0.2.1" },
        { id: "rd-guide/gamma", source: "rd-guide", version: "^0.4.0" },
      ],
    }),
    readLock: () => ({
      schemaVersion: 1,
      roots: ["rd-guide/alpha", "rd-guide/beta", "rd-guide/gamma"],
      plugins: [
        { id: "rd-guide/alpha", version: "0.3.0", source: { type: "gitlab" } },
        { id: "rd-guide/beta", version: "0.2.1", source: { type: "gitlab" } },
        { id: "rd-guide/gamma", version: "0.4.0", source: { type: "gitlab" } },
      ],
    }),
    readState: () => ({
      schemaVersion: 1,
      plugins: [{ id: "rd-guide/alpha", platforms: ["claude"] }],
    }),
  };
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "installed:rd-guide/alpha") },
    { type: "select", value: "update" },
    {
      type: "confirm",
      value: true,
      check: (question) => assert.match(question.message, /放宽 2 个声明/),
    },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    searchPlugins: async () => [
      { id: "rd-guide/alpha", description: "a", versions: ["0.4.0"], source: "rd-guide" },
      { id: "rd-guide/beta", description: "b", versions: ["0.2.2"], source: "rd-guide" },
      { id: "rd-guide/gamma", description: "g", versions: ["0.4.0"], source: "rd-guide" },
    ],
    authStatus: async () => ({ authorized: true, persistent: false }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  // 已在范围内的 gamma 不进放宽集合。
  assert.deepEqual(commands, [
    ["update", "--widen", "rd-guide/alpha=^0.4.0", "--widen", "rd-guide/beta=^0.2.2", "--dry-run"],
    ["update", "--widen", "rd-guide/alpha=^0.4.0", "--widen", "rd-guide/beta=^0.2.2"],
  ]);
  script.assertDone();
});

test("检查全部更新在需要放宽时也能走到确认", async (t) => {
  const fixture = interactiveFixture(t);
  const deps = installedDeps(fixture, "0.3.0", ["0.4.0"]);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "update:all") },
    { type: "confirm", value: true },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    runCommand: async (args) => { commands.push(args); return 0; },
    ...deps,
  });
  // 旧实现会先跑未放宽的 ["update","--dry-run"]，在确认前就以退出码 3 提前返回。
  assert.deepEqual(commands, [
    ["update", "--widen", "rd-guide/review=^0.4.0", "--dry-run"],
    ["update", "--widen", "rd-guide/review=^0.4.0"],
  ]);
  script.assertDone();
});

test("拒绝跨边界更新时只跑 dry-run，不执行任何写入", async (t) => {
  const fixture = interactiveFixture(t);
  const deps = installedDeps(fixture, "0.3.0", ["0.4.0"]);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "installed:rd-guide/review") },
    { type: "select", value: "update" },
    { type: "confirm", value: false },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    runCommand: async (args) => { commands.push(args); return 0; },
    ...deps,
  });
  assert.deepEqual(commands, [["update", "--widen", "rd-guide/review=^0.4.0", "--dry-run"]]);
  assert.match(fixture.output.join("\n"), /已取消更新/);
  script.assertDone();
});

test("范围内更新不附加 --version，也不提示放宽", async (t) => {
  const fixture = interactiveFixture(t);
  const deps = installedDeps(fixture, "^0.3.0", ["0.3.5"]);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "installed:rd-guide/review") },
    { type: "select", value: "update" },
    {
      type: "confirm",
      value: true,
      check: (question) => assert.equal(question.message, "确认更新 rd-guide/review?"),
    },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    runCommand: async (args) => { commands.push(args); return 0; },
    ...deps,
  });
  assert.deepEqual(commands, [
    ["update", "rd-guide/review", "--dry-run"],
    ["update", "rd-guide/review"],
  ]);
  assert.doesNotMatch(fixture.output.join("\n"), /放宽/);
  script.assertDone();
});

test("项目已有平台证据时安装不再询问平台", async (t) => {
  const fixture = interactiveFixture(t);
  // 已有 state 平台即视为平台证据，服务层会据此投影。
  const store = {
    readPlugins: () => ({ schemaVersion: 1, plugins: [] }),
    readLock: () => null,
    readState: () => ({
      schemaVersion: 1,
      plugins: [{ id: "rd-guide/other", platforms: ["claude", "codex"] }],
    }),
  };
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("discover", "plugin:rd-guide:rd-guide/review") },
    { type: "checkbox", value: ["xhgj-gitlab-collaboration"], check: assertRdGuideSkillQuestion },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    searchPlugins: async () => [{
      id: "rd-guide/review",
      description: "代码评审规范",
      versions: ["1.0.0"],
      source: "rd-guide",
    }],
    authStatus: async () => ({ authorized: true, persistent: false }),
    inspectPluginContentSkills: rdGuideSkillInspector({ version: "1.0.0" }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, [
    [
      "add",
      "rd-guide/review",
      "--version",
      "^1.0.0",
      "--content-skill",
      "xhgj-gitlab-collaboration",
    ],
  ]);
  script.assertDone();
});

test("已安装页可按 manifest 管理 Marketplace Skill 选择", async (t) => {
  const fixture = interactiveFixture(t);
  const store = {
    readPlugins: () => ({
      schemaVersion: 1,
      plugins: [{
        id: "rd-guide/review",
        source: "rd-guide",
        version: "^1.0.0",
        contentSelection: { skills: ["xhgj-gitlab-collaboration"] },
      }],
    }),
    readLock: () => ({
      schemaVersion: 1,
      roots: ["rd-guide/review"],
      plugins: [{
        id: "rd-guide/review",
        version: "1.0.0",
        source: { id: "rd-guide", type: "gitlab", reference: "group/rd-guide" },
      }],
    }),
    readState: () => ({
      schemaVersion: 1,
      plugins: [{
        id: "rd-guide/review",
        version: "1.0.0",
        platforms: ["codex"],
        contentSelection: { skills: ["xhgj-gitlab-collaboration"] },
      }],
    }),
  };
  const script = scriptedPrompts([
    {
      type: "manager",
      value: managerResult("installed", "installed:rd-guide/review"),
      check: (view) => {
        const entry = view.itemsByTab.installed.find(({ value }) => value === "installed:rd-guide/review");
        assert.equal(entry.title, "RD Guide 技能");
        assert.equal(entry.meta, "研发指南 · 已启用 1 个技能");
      },
    },
    {
      type: "checkbox",
      value: ["xhgj-humanize-writing"],
      check: (question) => {
        assert.equal(question.message, "选择要启用的 RD Guide 技能");
        assert.deepEqual(
          question.choices.map(({ value }) => value),
          ["xhgj-gitlab-collaboration", "xhgj-humanize-writing"],
        );
        assert.equal(question.choices[0].checked, true);
      },
    },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: true, persistent: false }),
    inspectPluginContentSkills: async (request) => {
      assert.equal(request.pluginId, "rd-guide/review");
      assert.ok(request.lockedPlugin);
      return {
        ok: true,
        pluginId: request.pluginId,
        version: "1.0.0",
        name: "研发指南",
        skills: [
          { name: "xhgj-gitlab-collaboration", path: "skills/xhgj-gitlab-collaboration" },
          { name: "xhgj-humanize-writing", path: "skills/xhgj-humanize-writing" },
        ],
      };
    },
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, [
    ["update", "rd-guide/review", "--content-skill", "xhgj-humanize-writing"],
  ]);
  script.assertDone();
});

test("rd-guide 取消部分 Skill 会直接更新启用列表并保留可选清单", async (t) => {
  const fixture = interactiveFixture(t);
  const skillNames = [
    "xhgj-dws-message-governance",
    "xhgj-gitlab-collaboration",
    "xhgj-humanize-writing",
    "xhgj-rd-guide",
  ];
  const store = {
    readPlugins: () => ({
      schemaVersion: 1,
      plugins: [{
        id: "rd-guide/review",
        source: "rd-guide",
        version: "^1.0.0",
        contentSelection: { skills: skillNames },
      }],
    }),
    readLock: () => ({
      schemaVersion: 1,
      roots: ["rd-guide/review"],
      plugins: [{
        id: "rd-guide/review",
        version: "1.0.0",
        source: { id: "rd-guide", type: "gitlab", reference: "group/rd-guide" },
      }],
    }),
    readState: () => ({
      schemaVersion: 1,
      plugins: [{
        id: "rd-guide/review",
        version: "1.0.0",
        platforms: ["codex"],
        contentSelection: { skills: skillNames },
      }],
    }),
  };
  const enabledAfter = [
    "xhgj-dws-message-governance",
    "xhgj-gitlab-collaboration",
    "xhgj-rd-guide",
  ];
  const script = scriptedPrompts([
    {
      type: "manager",
      value: managerResult("installed", "installed:rd-guide/review"),
      check: (view) => {
        const entry = view.itemsByTab.installed.find(({ value }) => value === "installed:rd-guide/review");
        assert.equal(entry.title, "RD Guide 技能");
        assert.equal(entry.meta, "研发指南 · 已启用 4 个技能");
      },
    },
    {
      type: "checkbox",
      value: enabledAfter,
      check: (question) => {
        assert.equal(question.message, "选择要启用的 RD Guide 技能");
        assert.deepEqual(question.choices.map(({ value }) => value), skillNames);
        assert.deepEqual(question.choices.map(({ checked }) => checked), [true, true, true, true]);
      },
    },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: true, persistent: false }),
    inspectPluginContentSkills: async (request) => {
      assert.equal(request.pluginId, "rd-guide/review");
      assert.ok(request.lockedPlugin);
      return {
        ok: true,
        pluginId: request.pluginId,
        version: "1.0.0",
        name: "研发指南",
        skills: skillNames.map((name) => ({ name, path: `skills/${name}` })),
      };
    },
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, [
    [
      "update",
      "rd-guide/review",
      "--content-skill",
      "xhgj-dws-message-governance",
      "--content-skill",
      "xhgj-gitlab-collaboration",
      "--content-skill",
      "xhgj-rd-guide",
    ],
  ]);
  assert.match(fixture.output.join("\n"), /RD Guide 技能选择已应用/);
  script.assertDone();
});

test("rd-guide 已安装后全部取消勾选会停用整个 RD Guide 插件", async (t) => {
  const fixture = interactiveFixture(t);
  const skillNames = [
    "xhgj-gitlab-collaboration",
    "xhgj-humanize-writing",
  ];
  const store = {
    readPlugins: () => ({
      schemaVersion: 1,
      plugins: [{
        id: "rd-guide/review",
        source: "rd-guide",
        version: "^1.0.0",
        contentSelection: { skills: skillNames },
      }],
    }),
    readLock: () => ({
      schemaVersion: 1,
      roots: ["rd-guide/review"],
      plugins: [{
        id: "rd-guide/review",
        version: "1.0.0",
        source: { id: "rd-guide", type: "gitlab", reference: "group/rd-guide" },
      }],
    }),
    readState: () => ({
      schemaVersion: 1,
      plugins: [{
        id: "rd-guide/review",
        version: "1.0.0",
        platforms: ["codex"],
        contentSelection: { skills: skillNames },
      }],
    }),
  };
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "installed:rd-guide/review") },
    {
      type: "checkbox",
      value: [],
      check: (question) => {
        assert.equal(question.message, "选择要启用的 RD Guide 技能");
        assert.deepEqual(question.choices.map(({ value }) => value), skillNames);
        assert.deepEqual(question.choices.map(({ checked }) => checked), [true, true]);
      },
    },
    { type: "manager", value: managerResult("discover", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: true, persistent: false }),
    inspectPluginContentSkills: async (request) => ({
      ok: true,
      pluginId: request.pluginId,
      version: "1.0.0",
      name: "研发指南",
      skills: skillNames.map((name) => ({ name, path: `skills/${name}` })),
    }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, [["remove", "rd-guide/review"]]);
  assert.match(fixture.output.join("\n"), /RD Guide 技能已全部停用/);
  assert.doesNotMatch(fixture.output.join("\n"), /未选择 RD Guide 技能，已取消安装/);
  script.assertDone();
});

test("rd-guide 同一版本 Skill 清单在同一轮 TUI 中复用缓存", async (t) => {
  const fixture = interactiveFixture(t);
  const store = {
    readPlugins: () => ({
      schemaVersion: 1,
      plugins: [{
        id: "rd-guide/review",
        source: "rd-guide",
        version: "^1.0.0",
        contentSelection: { skills: ["xhgj-gitlab-collaboration"] },
      }],
    }),
    readLock: () => ({
      schemaVersion: 1,
      roots: ["rd-guide/review"],
      plugins: [{
        id: "rd-guide/review",
        version: "1.0.0",
        integrity: "sha256:" + "a".repeat(64),
        source: { id: "rd-guide", type: "gitlab", reference: "group/rd-guide" },
      }],
    }),
    readState: () => ({
      schemaVersion: 1,
      plugins: [{
        id: "rd-guide/review",
        version: "1.0.0",
        platforms: ["codex"],
        contentSelection: { skills: ["xhgj-gitlab-collaboration"] },
      }],
    }),
  };
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "installed:rd-guide/review") },
    {
      type: "checkbox",
      value: ["xhgj-gitlab-collaboration"],
      check: (question) => assert.equal(question.choices[0].checked, true),
    },
    { type: "manager", value: managerResult("installed", "installed:rd-guide/review") },
    {
      type: "checkbox",
      value: ["xhgj-gitlab-collaboration"],
      check: (question) => assert.equal(question.choices[0].checked, true),
    },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  let inspections = 0;
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: true, persistent: false }),
    inspectPluginContentSkills: async (request) => {
      inspections += 1;
      return {
        ok: true,
        pluginId: request.pluginId,
        version: request.version,
        name: "研发指南",
        skills: [{
          name: "xhgj-gitlab-collaboration",
          path: "skills/xhgj-gitlab-collaboration",
        }],
      };
    },
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.equal(inspections, 1);
  assert.deepEqual(commands, []);
  assert.equal(
    fixture.output.filter((line) => /正在读取 RD Guide 技能清单/.test(line)).length,
    1,
  );
  script.assertDone();
});

test("命令失败后先停下来让用户读完再回管理器", async (t) => {
  const fixture = interactiveFixture(t);
  const deps = installedDeps(fixture, "^0.3.0", ["0.3.0"]);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "installed:rd-guide/review") },
    { type: "select", value: "verify" },
    {
      type: "select",
      value: "back",
      check: (question) => assert.match(question.message, /校验失败，返回管理器/),
    },
    { type: "manager", value: managerResult("installed", "exit") },
  ]);
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    runCommand: async () => 3,
    ...deps,
  });
  script.assertDone();
});

test("登录态在同一轮管理器生命周期内只查询一次", async (t) => {
  const fixture = interactiveFixture(t);
  let authCalls = 0;
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("installed", "update:all") },
    { type: "confirm", value: true },
    { type: "manager", value: managerResult("sources", "exit") },
  ]);
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: {
      readPlugins: () => ({
        schemaVersion: 1,
        plugins: [{ id: "rd-guide/review", source: "rd-guide", version: "^1.0.0" }],
      }),
      readLock: () => null,
      readState: () => null,
    },
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => {
      authCalls += 1;
      return { authorized: false, persistent: false };
    },
    runCommand: async () => 0,
  });
  // 两轮管理器视图共用一次登录态查询；旧实现每轮都会重查。
  assert.equal(authCalls, 1);
  script.assertDone();
});

test("来源页可新增 GitLab Marketplace", async (t) => {
  const fixture = interactiveFixture(t);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("sources", "source:add") },
    {
      type: "action",
      value: "gitlab",
      check: (question) => {
        assert.equal(question.title, "新增来源");
        assert.ok(question.choices.some(({ value }) => value === "back"));
        assert.ok(question.choices.some(({ value }) => value === "exit"));
      },
    },
    { type: "input", value: "http://gitlab.example.test/team/guide" },
    { type: "manager", value: managerResult("sources", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, [[
    "source", "add", "guide",
    "--type", "gitlab",
    "--name", "Guide",
    "--url", "http://gitlab.example.test",
    "--project", "team/guide",
    "--ref", "main",
    "--marketplace-path", ".flower-plugin/marketplace.json",
    "--application-id", "public-client",
  ]]);
  assert.match(fixture.output.join("\n"), /正在保存 GitLab 来源:guide/);
  script.assertDone();
});

test("新增来源类型页可直接返回或退出", async (t) => {
  const backFixture = interactiveFixture(t);
  const backScript = scriptedPrompts([
    { type: "manager", value: managerResult("sources", "source:add") },
    { type: "action", value: "back" },
    { type: "manager", value: managerResult("sources", "exit") },
  ]);
  const backCommands = [];
  await runPluginInteractive({ target: backFixture.project }, {
    prompts: backScript.prompts,
    output: backFixture.outputAdapter,
    store: backFixture.store,
    sourceStore: backFixture.sourceStore,
    credentialBundle: backFixture.credentialBundle,
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: async (args) => { backCommands.push(args); return 0; },
  });
  assert.deepEqual(backCommands, []);
  backScript.assertDone();

  const exitFixture = interactiveFixture(t);
  const exitScript = scriptedPrompts([
    { type: "manager", value: managerResult("sources", "source:add") },
    { type: "action", value: "exit" },
  ]);
  const exitCommands = [];
  await runPluginInteractive({ target: exitFixture.project }, {
    prompts: exitScript.prompts,
    output: exitFixture.outputAdapter,
    store: exitFixture.store,
    sourceStore: exitFixture.sourceStore,
    credentialBundle: exitFixture.credentialBundle,
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: async (args) => { exitCommands.push(args); return 0; },
  });
  assert.deepEqual(exitCommands, []);
  assert.match(exitFixture.output.join("\n"), /已退出 Plugin 管理/);
  exitScript.assertDone();
});

test("来源页新增 GitHub 公共仓库时先预览兼容性再确认保存", async (t) => {
  const fixture = interactiveFixture(t);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("sources", "source:add") },
    { type: "action", value: "github" },
    { type: "input", value: "example/public-guides" },
    { type: "confirm", value: true },
    { type: "manager", value: managerResult("sources", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async (sourceId) => ({ authorized: sourceId !== "rd-guide", persistent: false }),
    inspectGitHubSource: async (source) => ({
      source: { ...source, format: "claude-code", entryPath: ".claude-plugin/plugin.json" },
      resolvedCommit: "d".repeat(40),
      detection: { format: "claude-code", kind: "plugin", entryPath: ".claude-plugin/plugin.json" },
      candidate: {
        id: "public-guides/release-helper",
        version: "1.0.0",
        compatibilityReport: {
          status: "partial",
          imported: [{ kind: "skills", path: "skills/release" }],
          omitted: [{ kind: "hooks", path: "hooks", reason: "首版只分发被动 Skill 内容" }],
          diagnostics: [],
        },
      },
    }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, [[
    "source", "add", "public-guides",
    "--type", "github",
    "--name", "Public Guides",
    "--repo", "example/public-guides",
    "--format", "claude-code",
    "--entry-path", ".claude-plugin/plugin.json",
  ]]);
  assert.match(fixture.output.join("\n"), /可导入 1 项 · 忽略 1 项/);
  assert.match(fixture.output.join("\n"), /不会安装 hooks/);
  assert.match(fixture.output.join("\n"), /正在检测 GitHub 来源:example\/public-guides/);
  assert.match(fixture.output.join("\n"), /正在保存 GitHub 来源:public-guides/);
  script.assertDone();
});

test("来源页新增 GitHub 探测失败时留在管理器问题页", async (t) => {
  const fixture = interactiveFixture(t);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("sources", "source:add") },
    { type: "action", value: "github" },
    { type: "input", value: "example/broken" },
    {
      type: "manager",
      value: managerResult("issues", "exit"),
      check: (view) => {
        assert.equal(view.activeTab, "issues");
        assert.equal(view.tabs.find(({ id }) => id === "issues").count, 1);
        assert.match(view.itemsByTab.issues[0].title, /GitHub 来源检测失败/);
      },
    },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: false, persistent: false }),
    inspectGitHubSource: async () => {
      throw Object.assign(new Error("GitHub Plugin archive 包含不安全条目:repo/AGENTS.md"), {
        code: "PLUGIN_REMOTE_ARCHIVE_INVALID",
      });
    },
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, []);
  assert.match(fixture.output.join("\n"), /正在检测 GitHub 来源:example\/broken/);
  assert.match(fixture.output.join("\n"), /已记录到问题页/);
  script.assertDone();
});

test("来源页遇到多个 GitHub 格式入口时展示候选并按选择继续", async (t) => {
  const fixture = interactiveFixture(t);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("sources", "source:add") },
    { type: "action", value: "github" },
    { type: "input", value: "example/public-guides" },
    {
      type: "select",
      value: 1,
      check: (question) => {
        assert.match(question.message, /多个 Plugin 入口/);
        assert.equal(question.choices.length, 2);
      },
    },
    { type: "confirm", value: true },
    { type: "manager", value: managerResult("sources", "exit") },
  ]);
  const commands = [];
  let inspections = 0;
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: false, persistent: false }),
    inspectGitHubSource: async (source) => {
      inspections += 1;
      if (source.format === "auto") {
        throw Object.assign(new Error("ambiguous"), {
          code: "PLUGIN_SOURCE_AMBIGUOUS",
          details: {
            detections: [
              { format: "codex", kind: "plugin", entryPath: ".codex-plugin/plugin.json", displayName: "Codex" },
              { format: "claude-code", kind: "plugin", entryPath: ".claude-plugin/plugin.json", displayName: "Claude" },
            ],
          },
        });
      }
      return {
        source,
        resolvedCommit: "d".repeat(40),
        detection: { format: source.format, kind: "plugin", entryPath: source.entryPath },
        candidate: {
          id: "public-guides/review",
          version: "1.0.0",
          compatibilityReport: { status: "compatible", imported: [], omitted: [], diagnostics: [] },
        },
      };
    },
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.equal(inspections, 2);
  assert.deepEqual(commands, [[
    "source", "add", "public-guides",
    "--type", "github",
    "--name", "Public Guides",
    "--repo", "example/public-guides",
    "--format", "claude-code",
    "--entry-path", ".claude-plugin/plugin.json",
  ]]);
  assert.match(fixture.output.join("\n"), /正在按已选择入口继续检测:Claude/);
  assert.match(fixture.output.join("\n"), /正在保存 GitHub 来源:public-guides/);
  script.assertDone();
});

test("来源详情默认设备码登录，并可恢复内置覆盖", async (t) => {
  const fixture = interactiveFixture(t);
  fixture.sourceStore.setEnabled("rd-guide", false);
  const script = scriptedPrompts([
    { type: "manager", value: managerResult("sources", "source:rd-guide") },
    {
      type: "action",
      value: "restore",
      check: (question) => {
        assert.equal(question.title, "研发指南");
        assert.match(question.subtitle, /rd-guide/);
        assert.ok(question.facts.some(({ value }) => value === "已停用"));
        assert.ok(question.choices.some(({ value }) => value === "restore"));
      },
    },
    { type: "confirm", value: true },
    { type: "manager", value: managerResult("sources", "exit") },
  ]);
  const commands = [];
  await runPluginInteractive({ target: fixture.project }, {
    prompts: script.prompts,
    output: fixture.outputAdapter,
    store: fixture.store,
    sourceStore: fixture.sourceStore,
    credentialBundle: fixture.credentialBundle,
    authStatus: async () => ({ authorized: false, persistent: false }),
    runCommand: async (args) => { commands.push(args); return 0; },
  });
  assert.deepEqual(commands, [["source", "remove", "rd-guide"]]);
  script.assertDone();
});
