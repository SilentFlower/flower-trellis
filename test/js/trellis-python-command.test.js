import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  materializeTrellisPythonText,
  resolveTrellisPythonCommand,
} from "../../src/lib/trellis-python-command.js";

function createTarget(t) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-python-command-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  return target;
}

function write(target, relative, value) {
  const file = path.join(target, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

test("目标 Hook 与 workflow 证据优先于环境变量", (t) => {
  const target = createTarget(t);
  write(target, ".codex/hooks.json", JSON.stringify({
    hooks: {
      SessionStart: [{
        hooks: [{ type: "command", command: "py -3 -X utf8 .codex/hooks/session-start.py" }],
      }],
    },
  }));
  write(target, ".trellis/workflow.md", "python ./.trellis/scripts/task.py current\n");

  assert.deepEqual(resolveTrellisPythonCommand(target, {
    env: { TRELLIS_PYTHON_CMD: "custom-python" },
    platform: "linux",
  }), {
    command: "py -3",
    source: ".codex/hooks.json",
  });
});

test("workflow、环境变量和平台回退按优先级解析", (t) => {
  const target = createTarget(t);
  write(target, ".trellis/workflow.md", "Run `python ./.trellis/scripts/task.py current`.\n");
  assert.equal(resolveTrellisPythonCommand(target).command, "python");

  fs.rmSync(path.join(target, ".trellis"), { recursive: true, force: true });
  assert.deepEqual(resolveTrellisPythonCommand(target, {
    env: { TRELLIS_PYTHON_CMD: " py-custom " },
    platform: "linux",
  }), {
    command: "py-custom",
    source: "env:TRELLIS_PYTHON_CMD",
  });
  assert.equal(resolveTrellisPythonCommand(target, { env: {}, platform: "win32" }).command, "python");
  assert.equal(resolveTrellisPythonCommand(target, { env: {}, platform: "darwin" }).command, "python3");
});

test("文本物化保留 shebang，支持 python 与 py -3，python3 为 no-op", () => {
  const value = [
    "#!/usr/bin/env python3",
    "Run python3 ./.trellis/scripts/task.py current",
    "python3 -X utf8 .codex/hooks/session-start.py",
    "",
  ].join("\n");

  assert.equal(materializeTrellisPythonText(value, "python3"), value);
  assert.equal(materializeTrellisPythonText(value, "python"), [
    "#!/usr/bin/env python3",
    "Run python ./.trellis/scripts/task.py current",
    "python -X utf8 .codex/hooks/session-start.py",
    "",
  ].join("\n"));
  assert.equal(materializeTrellisPythonText(value, "py -3"), [
    "#!/usr/bin/env python3",
    "Run py -3 ./.trellis/scripts/task.py current",
    "py -3 -X utf8 .codex/hooks/session-start.py",
    "",
  ].join("\n"));
});

test("环境命令拒绝换行与 NUL", (t) => {
  const target = createTarget(t);
  assert.throws(
    () => resolveTrellisPythonCommand(target, {
      env: { TRELLIS_PYTHON_CMD: "python\nmalicious" },
      platform: "linux",
    }),
    /不能包含换行或 NUL/,
  );
});
