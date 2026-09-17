import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installedGlobalTrellisVersion, syncGlobalTrellis, bundledTrellisVersion } from "../../src/lib/global-trellis-sync.js";
import { isolatedGlobalTrellis, npmNodeShim } from "../helpers/update-performance.js";

/** @param {object} t 测试上下文 @returns {string} 自动清理的目录 */
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-global-perf-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("标准全局布局从实际安装读取版本，同版不探测子进程、不安装", (t) => {
  const prefix = temporary(t);
  const command = isolatedGlobalTrellis(prefix);
  assert.equal(installedGlobalTrellisVersion(prefix, command), bundledTrellisVersion());
  const result = syncGlobalTrellis({ prefix, logger: { log() {} },
    probeVersion() { assert.fail("不应执行版本子进程"); },
    spawn() { assert.fail("同版不应安装"); },
  });
  assert.equal(result.currentVersion, bundledTrellisVersion());
  assert.equal(result.installed, false);
});

test("Windows metadata 快路径要求完整标准启动器，自定义和损坏证据均回退", (t) => {
  const prefix = temporary(t);
  const root = path.join(prefix, "node_modules/@mindfoldhq/trellis");
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, "bin/trellis.js"), "console.log('0.1.0');\n");
  const pkg = { name: "@mindfoldhq/trellis", version: "0.1.0", bin: { trellis: "bin/trellis.js" } };
  const metadata = path.join(root, "package.json");
  const command = path.join(prefix, "trellis.cmd");
  fs.writeFileSync(metadata, JSON.stringify(pkg));
  const shim = npmNodeShim("node_modules\\@mindfoldhq\\trellis\\bin\\trellis.js");
  fs.writeFileSync(command, shim);
  assert.equal(installedGlobalTrellisVersion(prefix, command, "win32"), "0.1.0");
  fs.writeFileSync(command, `@echo custom\r\n${shim}`);
  assert.equal(installedGlobalTrellisVersion(prefix, command, "win32"), null);
  fs.writeFileSync(command, shim);
  for (const broken of ["{", JSON.stringify({ ...pkg, name: "other" }), JSON.stringify({ ...pkg, version: "invalid" }), JSON.stringify({ ...pkg, bin: "../other.js" })]) {
    fs.writeFileSync(metadata, broken);
    assert.equal(installedGlobalTrellisVersion(prefix, command, "win32"), null);
  }
  fs.writeFileSync(metadata, JSON.stringify(pkg));
  const outside = path.join(prefix, "custom");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "trellis.js"), "console.log('another installation');\n");
  fs.rmSync(path.join(root, "bin"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, "bin"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(installedGlobalTrellisVersion(prefix, command, "win32"), null);
});

test("自定义入口继续兼容探测，异版精确安装且失败不被计时吞掉", (t) => {
  const prefix = temporary(t);
  const command = path.join(prefix, ...(process.platform === "win32" ? ["trellis.cmd"] : ["bin", "trellis"]));
  fs.mkdirSync(path.dirname(command), { recursive: true });
  fs.writeFileSync(command, "custom");
  let probes = 0;
  let installs = 0;
  const options = { prefix, logger: { log() {} },
    probeVersion(cwd, executable) { probes++; assert.equal(executable, command); return "0.0.1"; },
    spawn(name, args) {
      installs++;
      assert.equal(name, "npm");
      assert.deepEqual(args, ["install", "-g", `@mindfoldhq/trellis@${bundledTrellisVersion()}`]);
      return { status: 0 };
    },
  };
  assert.equal(syncGlobalTrellis(options).installed, true);
  assert.equal(probes, 1);
  assert.equal(installs, 1);
  assert.throws(() => syncGlobalTrellis({ ...options, spawn: () => ({ status: 2 }) }), /退出码 2/);
});
