import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { writeManifest } from "../../src/lib/manifest.js";
import {
  FLOWER_TELEMETRY_ENDPOINT,
  buildTelemetryPayload,
  readTelemetryState,
  reportTelemetry,
  setTelemetryEnabled,
  telemetryStatePath,
} from "../../src/lib/telemetry.js";
import { flowerVersion, trellisVersion } from "../../src/lib/versions.js";

const FIRST_DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_DEVICE_ID = "22222222-2222-4222-8222-222222222222";

/**
 * 创建隔离的用户配置和 Trellis 项目。
 *
 * @param {import("node:test").TestContext} t 测试上下文
 * @returns {{target:string,env:NodeJS.ProcessEnv}} 测试目录与环境变量
 */
function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-telemetry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "project");
  const config = path.join(root, "config");
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis", ".version"), `${trellisVersion()}\n`);
  fs.writeFileSync(path.join(target, ".trellis", ".developer"), "name=测试开发者\n");
  writeManifest(target, {
    flowerVersion: flowerVersion(),
    variant: "0.6",
    version: trellisVersion(),
    skills: [],
    paths: [],
    updateCheck: { enabled: true, policy: "ask", intervalHours: 8 },
  });
  return {
    target,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: config,
      GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
    },
  };
}

/**
 * 为测试项目配置确定的 Git 开发者名称。
 *
 * @param {string} target 测试项目目录
 * @param {string} name Git 开发者名称
 * @param {NodeJS.ProcessEnv} env 隔离环境变量
 * @returns {void}
 */
function configureGitDeveloper(target, name, env) {
  const init = spawnSync("git", ["init"], { cwd: target, encoding: "utf8", env });
  assert.equal(init.status, 0, init.stderr);
  const configured = spawnSync("git", ["config", "user.name", name], {
    cwd: target,
    encoding: "utf8",
    env,
  });
  assert.equal(configured.status, 0, configured.stderr);
}

test("遥测首次上报默认启用并持久化稳定设备 ID", async (t) => {
  const fixture = createFixture(t);
  const requests = [];
  const now = new Date("2026-07-31T02:00:00.000Z");
  const result = await reportTelemetry(fixture.target, "version_check", {
    env: fixture.env,
    now,
    randomUUID: () => FIRST_DEVICE_ID,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true };
    },
  });

  assert.equal(result.status, "reported");
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://ai-api.hub.flower-cli.com/api/flower-trellis/telemetry",
  );
  assert.equal(requests[0].url, FLOWER_TELEMETRY_ENDPOINT);
  const stateResult = readTelemetryState({ env: fixture.env });
  assert.equal(stateResult.status, "valid");
  assert.deepEqual(stateResult.state, {
    schemaVersion: 1,
    deviceId: FIRST_DEVICE_ID,
    developerName: "测试开发者",
    enabled: true,
    lastAttemptAt: now.toISOString(),
    lastSuccessAt: now.toISOString(),
  });

  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.dirname(stateResult.path)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(stateResult.path).mode & 0o777, 0o600);
  }
});

test("旧遥测状态兼容读取并在真实上报后补齐开发者名称", async (t) => {
  const fixture = createFixture(t);
  const filePath = telemetryStatePath(fixture.env);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 1,
    deviceId: FIRST_DEVICE_ID,
    enabled: true,
    lastAttemptAt: null,
    lastSuccessAt: null,
  }, null, 2)}\n`);

  const legacy = readTelemetryState({ env: fixture.env });
  assert.equal(legacy.status, "valid");
  assert.equal(legacy.state.developerName, null);

  const result = await reportTelemetry(fixture.target, "version_check", {
    env: fixture.env,
    force: true,
    fetch: async () => ({ ok: true }),
  });
  assert.equal(result.status, "reported");
  assert.equal(readTelemetryState({ env: fixture.env }).state.developerName, "测试开发者");

  const cliPath = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
  const status = spawnSync(process.execPath, [cliPath, "telemetry", "status"], {
    encoding: "utf8",
    env: fixture.env,
  });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /开发者名称:测试开发者/);
  assert.match(status.stdout, new RegExp(`设备 ID:${FIRST_DEVICE_ID}`));
});

test("遥测载荷只包含白名单版本、开发者与运行环境字段", (t) => {
  const fixture = createFixture(t);
  configureGitDeveloper(fixture.target, "Git 开发者", fixture.env);
  const payload = buildTelemetryPayload(fixture.target, "init_completed", {
    deviceId: FIRST_DEVICE_ID,
    env: fixture.env,
    now: new Date("2026-07-31T03:00:00.000Z"),
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    "arch",
    "bundled_trellis_version",
    "client_time",
    "developer_name",
    "device_id",
    "event",
    "flower_version",
    "platform",
    "project_flower_version",
    "project_trellis_version",
    "schema_version",
  ]);
  assert.equal(payload.device_id, FIRST_DEVICE_ID);
  assert.equal(payload.developer_name, "测试开发者");
  assert.equal(payload.project_flower_version, flowerVersion());
  assert.equal(payload.project_trellis_version, trellisVersion());
  assert.equal("hostname" in payload, false);
  assert.equal("mac_address" in payload, false);
  assert.equal("project_path" in payload, false);
  assert.equal("repository" in payload, false);
  assert.equal("username" in payload, false);
});

test("项目别名缺失或格式无效时回退 Git，并缓存名称供后续上报", async (t) => {
  for (const [scenario, content] of [
    ["文件缺失", null],
    ["缺少 name=", "测试开发者\n"],
  ]) {
    await t.test(scenario, async (subtest) => {
      const fixture = createFixture(subtest);
      const developerPath = path.join(fixture.target, ".trellis", ".developer");
      if (content === null) {
        fs.unlinkSync(developerPath);
      } else {
        fs.writeFileSync(developerPath, content);
      }
      configureGitDeveloper(fixture.target, "Git 开发者", fixture.env);

      const payload = buildTelemetryPayload(fixture.target, "init_completed", {
        deviceId: FIRST_DEVICE_ID,
        env: fixture.env,
      });
      const requests = [];
      const result = await reportTelemetry(fixture.target, "init_completed", {
        env: fixture.env,
        force: true,
        randomUUID: () => FIRST_DEVICE_ID,
        fetch: async (_url, options) => {
          requests.push(JSON.parse(options.body));
          return { ok: true };
        },
      });

      assert.equal(payload.developer_name, "Git 开发者");
      assert.equal(result.status, "reported");
      assert.equal(requests[0].developer_name, "Git 开发者");
      const cachedState = readTelemetryState({ env: fixture.env }).state;
      assert.equal(cachedState.deviceId, FIRST_DEVICE_ID);
      assert.equal(cachedState.developerName, "Git 开发者");

      fs.rmSync(path.join(fixture.target, ".git"), { recursive: true, force: true });
      const cachedResult = await reportTelemetry(fixture.target, "version_check", {
        env: fixture.env,
        now: new Date("2026-07-31T03:30:00.000Z"),
        force: true,
        fetch: async (_url, options) => {
          requests.push(JSON.parse(options.body));
          return { ok: true };
        },
      });

      assert.equal(cachedResult.status, "reported");
      assert.equal(requests[1].developer_name, "Git 开发者");
      assert.equal(readTelemetryState({ env: fixture.env }).state.developerName, "Git 开发者");
    });
  }
});

test("全部开发者身份来源缺失时才保持零上报", async (t) => {
  const fixture = createFixture(t);
  fs.unlinkSync(path.join(fixture.target, ".trellis", ".developer"));
  let calls = 0;
  const result = await reportTelemetry(fixture.target, "init_completed", {
    env: fixture.env,
    force: true,
    randomUUID: () => FIRST_DEVICE_ID,
    fetch: async () => {
      calls += 1;
      return { ok: true };
    },
  });

  assert.equal(result.status, "missing_developer");
  assert.equal(calls, 0);
  assert.equal(readTelemetryState({ env: fixture.env }).status, "missing");
});

test("遥测按更新检查间隔节流，完成事件可强制上报", async (t) => {
  const fixture = createFixture(t);
  let calls = 0;
  const fetchRequest = async () => {
    calls += 1;
    return { ok: true };
  };
  await reportTelemetry(fixture.target, "version_check", {
    env: fixture.env,
    now: new Date("2026-07-31T00:00:00.000Z"),
    randomUUID: () => FIRST_DEVICE_ID,
    fetch: fetchRequest,
  });
  const throttled = await reportTelemetry(fixture.target, "version_check", {
    env: fixture.env,
    now: new Date("2026-07-31T01:00:00.000Z"),
    fetch: fetchRequest,
  });
  const forced = await reportTelemetry(fixture.target, "update_completed", {
    env: fixture.env,
    now: new Date("2026-07-31T01:01:00.000Z"),
    force: true,
    fetch: fetchRequest,
  });

  assert.equal(throttled.status, "throttled");
  assert.equal(forced.status, "reported");
  assert.equal(calls, 2);
  assert.equal(readTelemetryState({ env: fixture.env }).state.deviceId, FIRST_DEVICE_ID);
});

test("显式开关保留设备 ID，环境变量只临时停用", async (t) => {
  const fixture = createFixture(t);
  const disabled = setTelemetryEnabled(false, {
    env: fixture.env,
    randomUUID: () => FIRST_DEVICE_ID,
  });
  assert.equal(disabled.enabled, false);

  let calls = 0;
  const disabledResult = await reportTelemetry(fixture.target, "init_completed", {
    env: fixture.env,
    force: true,
    fetch: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(disabledResult.status, "disabled");

  const enabled = setTelemetryEnabled(true, {
    env: fixture.env,
    randomUUID: () => SECOND_DEVICE_ID,
  });
  assert.equal(enabled.deviceId, FIRST_DEVICE_ID);

  const envDisabled = {
    ...fixture.env,
    XDG_CONFIG_HOME: path.join(path.dirname(fixture.target), "fresh-config"),
    FLOWER_NO_TELEMETRY: "1",
  };
  const envResult = await reportTelemetry(fixture.target, "init_completed", {
    env: envDisabled,
    force: true,
    fetch: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(envResult.status, "disabled_by_env");
  assert.equal(calls, 0);
  assert.equal(readTelemetryState({ env: envDisabled }).status, "missing");
});

test("损坏状态不会被后台上报覆盖，显式启用可以修复", async (t) => {
  const fixture = createFixture(t);
  const filePath = telemetryStatePath(fixture.env);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{broken\n");

  const result = await reportTelemetry(fixture.target, "version_check", {
    env: fixture.env,
    fetch: async () => assert.fail("损坏状态不应发起网络请求"),
  });
  assert.equal(result.status, "corrupt_state");
  assert.equal(fs.readFileSync(filePath, "utf8"), "{broken\n");

  const repaired = setTelemetryEnabled(true, {
    env: fixture.env,
    randomUUID: () => SECOND_DEVICE_ID,
  });
  assert.equal(repaired.deviceId, SECOND_DEVICE_ID);
  assert.equal(readTelemetryState({ env: fixture.env }).status, "valid");
});

test("软链接遥测状态在后台和显式命令中都保持零覆盖", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows 普通用户默认不能创建文件软链接");
    return;
  }
  const fixture = createFixture(t);
  const filePath = telemetryStatePath(fixture.env);
  const outsidePath = path.join(path.dirname(fixture.target), "outside.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(outsidePath, "outside\n");
  fs.symlinkSync(outsidePath, filePath);

  const result = await reportTelemetry(fixture.target, "version_check", {
    env: fixture.env,
    fetch: async () => assert.fail("软链接状态不应发起网络请求"),
  });
  assert.equal(result.status, "corrupt_state");
  assert.throws(
    () => setTelemetryEnabled(true, {
      env: fixture.env,
      randomUUID: () => SECOND_DEVICE_ID,
    }),
    /必须是普通文件/,
  );
  assert.equal(fs.readFileSync(outsidePath, "utf8"), "outside\n");
  assert.equal(fs.lstatSync(filePath).isSymbolicLink(), true);
});

test("网络失败保持静默并记录尝试时间", async (t) => {
  const fixture = createFixture(t);
  const now = new Date("2026-07-31T04:00:00.000Z");
  const result = await reportTelemetry(fixture.target, "version_check", {
    env: fixture.env,
    now,
    randomUUID: () => FIRST_DEVICE_ID,
    fetch: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(result.status, "failed");
  const state = readTelemetryState({ env: fixture.env }).state;
  assert.equal(state.lastAttemptAt, now.toISOString());
  assert.equal(state.lastSuccessAt, null);
});

test("默认遥测超时允许秒级公网响应", async (t) => {
  const fixture = createFixture(t);
  const result = await reportTelemetry(fixture.target, "version_check", {
    env: fixture.env,
    randomUUID: () => FIRST_DEVICE_ID,
    fetch: async (_url, options) => new Promise((resolve, reject) => {
      // 1 秒可稳定回归原 800ms 默认值，同时显著低于新的 10 秒上限。
      const responseTimer = setTimeout(() => resolve({ ok: true }), 1000);
      options.signal.addEventListener("abort", () => {
        clearTimeout(responseTimer);
        reject(new Error("aborted"));
      }, { once: true });
    }),
  });

  assert.equal(result.status, "reported");
});

test("网络超时静默降级且不阻断调用方", async (t) => {
  const fixture = createFixture(t);
  const result = await reportTelemetry(fixture.target, "version_check", {
    env: fixture.env,
    randomUUID: () => FIRST_DEVICE_ID,
    timeoutMs: 5,
    fetch: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  assert.equal(result.status, "failed");
});

test("self-check 命令标准输出保持为单一 JSON 文档", (t) => {
  const fixture = createFixture(t);
  const cliPath = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [
    cliPath,
    "self-check",
    "--json",
    "--target",
    fixture.target,
  ], {
    encoding: "utf8",
    env: {
      ...fixture.env,
      FLOWER_NO_UPDATE_CHECK: "1",
      FLOWER_NO_TELEMETRY: "1",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "disabled");
});

test("init/update 成功事件位于完成路径且 update dry-run 明确跳过", () => {
  const initSource = fs.readFileSync(
    fileURLToPath(new URL("../../src/commands/init.js", import.meta.url)),
    "utf8",
  );
  const updateSource = fs.readFileSync(
    fileURLToPath(new URL("../../src/commands/update.js", import.meta.url)),
    "utf8",
  );

  assert.ok(initSource.indexOf('reportTelemetry(target, "init_completed"') > initSource.indexOf("await plugin("));
  assert.ok(initSource.indexOf('reportTelemetry(target, "init_completed"') < initSource.indexOf('showCommandCompletion("init"'));
  assert.match(updateSource, /dryRun\s*\?\s*null\s*:\s*reportTelemetry\(target, "update_completed", \{ force: true \}\)/);
  assert.ok(updateSource.indexOf('reportTelemetry(target, "update_completed"') > updateSource.indexOf("const backupResult = pruneUpdateBackups("));
});
