import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Release CI 无依赖且无 submodule 时沿用已提交快照", (t) => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flower-release-sync-"));
  t.after(() => fs.rmSync(packageRoot, { recursive: true, force: true }));

  const files = [
    "scripts/sync-enhancements.mjs",
    "src/lib/fs-utils.js",
    "src/plugin/integrity/volatile-tree-artifact.js",
  ];
  for (const relativePath of files) {
    const target = path.join(packageRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relativePath), target);
  }
  fs.mkdirSync(path.join(packageRoot, "enhancements"));
  fs.writeFileSync(path.join(packageRoot, "enhancements/MANIFEST.json"), "{}\n");
  fs.writeFileSync(path.join(packageRoot, "package.json"), '{"type":"module"}\n');

  const result = spawnSync(process.execPath, [path.join(packageRoot, "scripts/sync-enhancements.mjs")], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      SKILL_GARDEN_DIR: path.join(packageRoot, "missing-skill-garden"),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /跳过 sync:未找到强化包源/);
  assert.equal(fs.existsSync(path.join(packageRoot, "node_modules")), false);
});
