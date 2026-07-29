import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createPluginTestRoot } from "./plugin-test-helpers.js";
import {
  parseFlowerJson,
  runFlower,
  snapshotProjectFiles,
} from "./plugin-e2e-helpers.js";

test("真实 bin 拒绝本地来源把 integration 自行提升到可批准范围", (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-capability-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  const scaffold = runFlower(project, [
    "plugin", "init",
    "--id", "local/integration",
    "--name", "集成规范",
    "--profile", "integration",
    "--patches",
    "--non-interactive",
    "--json",
  ]);
  assert.equal(scaffold.status, 0, `${scaffold.stdout}\n${scaffold.stderr}`);
  const before = snapshotProjectFiles(project);

  const denied = runFlower(project, [
    "plugin", "add", "local/integration",
    "--source", ".flower-plugin",
    "--platform", "codex",
    "--dry-run",
    "--json",
  ]);
  assert.equal(denied.status, 1, `${denied.stdout}\n${denied.stderr}`);
  assert.equal(parseFlowerJson(denied).diagnostics[0].code, "PLUGIN_CAPABILITY_DENIED");
  assert.deepEqual(snapshotProjectFiles(project), before);
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
});
