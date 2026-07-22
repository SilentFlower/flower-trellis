import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Flower 更新完成后必须加载 trellis-push", () => {
  const command = read("src/commands/self-update.js");
  const sourceWorkflow = read(
    "vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/hub/content.md",
  );
  const snapshotWorkflow = read(
    "enhancements/0.6/overrides/patches/workflow/hub/content.md",
  );

  assert.match(command, /必须先加载并遵循 `trellis-push`/);
  assert.match(command, /不得用自行 Git 检查或手写计划替代/);
  assert.match(sourceWorkflow, /load and follow\s+`trellis-push` before any Git inspection/);
  assert.match(sourceWorkflow, /never replace it with a hand-written\s+Git summary/);
  assert.equal(snapshotWorkflow, sourceWorkflow);
});
