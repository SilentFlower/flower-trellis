import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyScriptAssets } from "../../src/lib/copy-scripts.js";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { uninstall } from "../../src/commands/uninstall.js";
import { runTrellis } from "../../src/lib/trellis-runner.js";
import { captureConfigPreserveSnapshot, restoreConfigPreserveSnapshot } from "../../src/lib/config-preserver.js";
import { ENHANCEMENTS_ROOT } from "../../src/lib/paths.js";
import { materializeTrellisPythonText } from "../../src/lib/trellis-python-command.js";

for (const command of ["python", "py -3"]) {
  test(`确认协议两条投影均使用目标${command}，选择安装和重复更新保持命令及脚本原字节`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirmation-python-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const variant = path.join(ENHANCEMENTS_ROOT, "0.6");
    const canonical = fs.readFileSync(path.join(variant, "scripts/confirmation.md"), "utf8");
    const script = fs.readFileSync(path.join(variant, "scripts/confirmation.py"));
    for (const projection of ["plugin", "legacy"]) {
      const target = path.join(root, projection);
      fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
      fs.mkdirSync(path.join(target, ".agents/skills"), { recursive: true });
      fs.mkdirSync(path.join(target, ".codex"), { recursive: true });
      fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.14\n");
      fs.writeFileSync(path.join(target, ".codex/hooks.json"), JSON.stringify({ command: `${command} ./.codex/hooks/session-start.py` }));
      for (let attempt = 0; attempt < 2; attempt++) {
        if (projection === "plugin") applyEnhancements(target, { variant: "0.6", skills: ["trellis-task-brief"] });
        else copyScriptAssets(target, variant, ["trellis-task-brief"]);
        const deployed = path.join(target, ".trellis/scripts");
        assert.equal(fs.readFileSync(path.join(deployed, "confirmation.md"), "utf8"), materializeTrellisPythonText(canonical, command));
        assert.deepEqual(fs.readFileSync(path.join(deployed, "confirmation.py")), script);
      }
    }
  });
}

test("更新整文件覆盖后逐字恢复用户超时配置，保留新版其它块", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirmation-config-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".trellis"));
  const file = path.join(root, ".trellis/config.yaml");
  const block = "# 用户确认策略\nconfirmation_timeout:\n  enabled: false\n  brief:\n    base_seconds: 123\n  check:\n    increment_seconds: 45\n  push:\n    seconds: 222";
  fs.writeFileSync(file, `default_package: app\n\n${block}\n\nold_template: true\n`);
  const snapshot = captureConfigPreserveSnapshot(root);
  fs.writeFileSync(file, "new_template: true\nconfirmation_timeout:\n  enabled: true\n");
  const result = restoreConfigPreserveSnapshot(root, snapshot);
  assert.ok(result.keys.includes("confirmation_timeout"));
  const restored = fs.readFileSync(file, "utf8");
  assert.ok(restored.includes(block));
  assert.match(restored, /new_template: true/);
  assert.doesNotMatch(restored, /old_template/);
  assert.equal(restoreConfigPreserveSnapshot(root, snapshot).restored, false);
});

for (const owner of ["trellis-task-brief", "trellis-check-all", "trellis-push"]) {
  test(`${owner}选择安装在两条分发路径均携带完整协议，重复更新幂等且卸载精确`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirmation-install-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.equal(await runTrellis(["init", "-y", "--codex", "--claude", "-u", "tester"], root), 0);
    const old = path.join(root, "legacy");
    copyScriptAssets(old, path.join(ENHANCEMENTS_ROOT, "0.6"), [owner]);
    for (const file of ["confirmation.py", "confirmation.md"]) assert.ok(fs.existsSync(path.join(old, ".trellis/scripts", file)));
    const logs = console.log;
    console.log = () => {};
    try {
      applyEnhancements(root, { variant: "0.6", skills: [owner] });
      const first = fs.readFileSync(path.join(root, ".trellis/scripts/confirmation.py"), "utf8");
      applyEnhancements(root, { variant: "0.6", skills: [owner] });
      assert.equal(fs.readFileSync(path.join(root, ".trellis/scripts/confirmation.py"), "utf8"), first);
      assert.match(fs.readFileSync(path.join(root, ".trellis/scripts/confirmation.md"), "utf8"), /policy_timeout/);
      fs.writeFileSync(path.join(root, "user.txt"), "用户文件\n");
      await uninstall({ target: root, passthrough: ["-y"] });
      assert.equal(fs.existsSync(path.join(root, ".trellis/scripts/confirmation.py")), false);
      assert.equal(fs.existsSync(path.join(root, ".trellis/scripts/confirmation.md")), false);
      assert.ok(fs.existsSync(path.join(root, "user.txt")));
    } finally { console.log = logs; }
  });
}
