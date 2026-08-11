import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectCodexTurnsAndEvents } from "../../node_modules/@mindfoldhq/trellis-core/dist/mem/adapters/codex.js";
import { collectGrokTurnsAndEvents } from "../../node_modules/@mindfoldhq/trellis-core/dist/mem/adapters/grok.js";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TRELLIS_CLI = path.join(
  ROOT,
  "node_modules",
  "@mindfoldhq",
  "trellis",
  "bin",
  "trellis.js",
);
const SESSION_START_TARGETS = [
  ".gemini/hooks/session-start.py",
  ".qoder/hooks/session-start.py",
  ".codebuddy/hooks/session-start.py",
  ".factory/hooks/session-start.py",
  ".trae/hooks/session-start.py",
  ".zcode/hooks/session-start.py",
];
const WORKFLOW_HOOK_TARGETS = SESSION_START_TARGETS.map((relative) => (
  relative.replace("session-start.py", "inject-workflow-state.py")
));

/**
 * 创建会被测试结束回收的临时目录。
 *
 * @param {import("node:test").TestContext} t 测试上下文
 * @param {string} prefix 临时目录前缀
 * @returns {string} 临时目录
 */
function makeTempDir(t, prefix) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  return target;
}

/**
 * 执行 Flower 强化并隐藏正常安装日志。
 *
 * @param {string} target Trellis 项目根目录
 * @returns {ReturnType<typeof applyEnhancements>} 强化结果
 */
function quietApply(target) {
  const original = console.log;
  console.log = () => {};
  try {
    return applyEnhancements(target, { variant: "0.6" });
  } finally {
    console.log = original;
  }
}

/**
 * 返回不携带宿主 AI 会话身份的子进程环境。
 *
 * @returns {NodeJS.ProcessEnv} 隔离后的环境
 */
function sessionlessEnv() {
  const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
  for (const key of Object.keys(env)) {
    if (
      key === "TRELLIS_CONTEXT_ID"
      || /(?:SESSION|CONVERSATION|TRANSCRIPT|THREAD)_?ID$/.test(key)
    ) {
      delete env[key];
    }
  }
  return env;
}

/**
 * 把对象序列化为 JSONL 测试文件。
 *
 * @param {string} file 目标文件
 * @param {object[]} rows JSONL 行
 * @returns {void}
 */
function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

test("Trellis 0.6.14 全平台初始化保留上游修复并收敛 Flower 更新入口", (t) => {
  const target = makeTempDir(t, "flower-trellis-0614-init-");
  const initialized = spawnSync(
    process.execPath,
    [
      TRELLIS_CLI,
      "init",
      "--gemini",
      "--qoder",
      "--codebuddy",
      "--droid",
      "--trae",
      "--zcode",
      "--grok",
      "--yes",
      "--no-monorepo",
      "--user",
      "trellis-0614-test",
    ],
    { cwd: target, encoding: "utf8", env: sessionlessEnv(), timeout: 60_000 },
  );
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(fs.readFileSync(path.join(target, ".trellis/.version"), "utf8").trim(), "0.6.14");

  const applied = quietApply(target);
  assert.equal(applied.patchReport.summary.errors, 0);

  const codebuddy = JSON.parse(fs.readFileSync(path.join(target, ".codebuddy/settings.json")));
  const qoder = JSON.parse(fs.readFileSync(path.join(target, ".qoder/settings.json")));
  const trae = JSON.parse(fs.readFileSync(path.join(target, ".trae/hooks.json")));
  assert.deepEqual(
    codebuddy.hooks.PreToolUse.map(({ matcher }) => matcher),
    ["task|Task", "execute_command|Bash|PowerShell"],
  );
  assert.deepEqual(qoder.hooks.PreToolUse.map(({ matcher }) => matcher), ["Bash|run_in_terminal"]);
  assert.deepEqual(trae.hooks.PreToolUse.map(({ matcher }) => matcher), ["RunCommand|Bash"]);

  const sessionContext = fs.readFileSync(
    path.join(target, ".trellis/scripts/common/session_context.py"),
    "utf8",
  );
  assert.doesNotMatch(sessionContext, /get_update_hint|trellis --version/);

  for (const relative of SESSION_START_TARGETS) {
    const value = fs.readFileSync(path.join(target, relative), "utf8");
    assert.match(value, /<first-reply-notice>/, relative);
    assert.match(value, /session-start-update-notice-builder/, relative);
    assert.match(value, /session-start-update-notice-output/, relative);
    assert.doesNotMatch(value, /_resolve_update_hint|get_update_hint/, relative);
    assert.doesNotMatch(value, /Also relay this Trellis maintenance notice/, relative);
  }

  for (const relative of [...SESSION_START_TARGETS, ...WORKFLOW_HOOK_TARGETS]) {
    const value = fs.readFileSync(path.join(target, relative), "utf8");
    const claudeIndex = value.indexOf('"CLAUDE_PROJECT_DIR": "claude"');
    assert.ok(claudeIndex > 0, relative);
    for (const vendorEntry of [
      '"ZCODE_PROJECT_DIR": "zcode"',
      '"CODEBUDDY_PROJECT_DIR": "codebuddy"',
      '"TRAE_PROJECT_DIR": "trae"',
    ]) {
      assert.ok(value.indexOf(vendorEntry) < claudeIndex, `${relative}:${vendorEntry}`);
    }
  }

  const hookPayload = {
    cwd: "/",
    session_id: "codebuddy-session-14",
    tool_name: "execute_command",
    tool_input: { command: "python3 ./.trellis/scripts/task.py current" },
  };
  const hookResult = spawnSync(
    "python3",
    [path.join(target, ".codebuddy/hooks/inject-shell-session-context.py")],
    {
      cwd: target,
      encoding: "utf8",
      env: sessionlessEnv(),
      input: JSON.stringify(hookPayload),
    },
  );
  assert.equal(hookResult.status, 0, hookResult.stderr);
  const ticketDir = path.join(target, ".trellis/.runtime/shell-tickets");
  const tickets = fs.readdirSync(ticketDir);
  assert.equal(tickets.length, 1);
  const ticket = JSON.parse(fs.readFileSync(path.join(ticketDir, tickets[0]), "utf8"));
  assert.equal(ticket.cwd, target);
  assert.equal(ticket.host_cwd, "/");
  assert.equal(ticket.platform, "codebuddy");
  assert.deepEqual(ticket.subcommands, [{ name: "current" }]);

  const scriptsDir = path.join(target, ".trellis/scripts");
  const consumer = spawnSync(
    "python3",
    [
      "-c",
      `import sys; sys.path.insert(0, ${JSON.stringify(scriptsDir)}); sys.argv = ["task.py", "current"]; from common.active_task import resolve_context_key; print(resolve_context_key() or "")`,
    ],
    { cwd: target, encoding: "utf8", env: sessionlessEnv() },
  );
  assert.equal(consumer.status, 0, consumer.stderr);
  assert.equal(consumer.stdout.trim(), ticket.context_key);

  const memHelp = spawnSync(process.execPath, [TRELLIS_CLI, "mem", "help"], {
    cwd: target,
    encoding: "utf8",
    env: sessionlessEnv(),
  });
  assert.equal(memHelp.status, 0, memHelp.stderr);
  assert.match(memHelp.stdout, /Claude\/Codex\/Grok\/OpenCode\/Pi\/ZCode sessions/);
  assert.match(memHelp.stdout, /--platform claude\|codex\|grok\|opencode\|pi\|zcode\|all/);
  assert.match(memHelp.stdout, /Claude\/Codex\/Grok\/Pi\/ZCode supported; OpenCode warns/);
});

test("Trellis Core 0.6.14 恢复 Codex 压缩历史并标记 Grok 不可恢复边界", (t) => {
  const target = makeTempDir(t, "flower-trellis-0614-mem-");
  const codexFile = path.join(target, "codex.jsonl");
  writeJsonl(codexFile, [
    {
      type: "compacted",
      payload: {
        replacement_history: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "压缩前仍需恢复的问题" }],
          },
        ],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "压缩后的回答" }],
      },
    },
  ]);
  const codexWarnings = [];
  const codex = collectCodexTurnsAndEvents(
    { platform: "codex", id: "codex-0614", cwd: target, filePath: codexFile },
    codexWarnings,
  );
  assert.equal(codex.turns[0].text, "压缩前仍需恢复的问题");
  assert.ok(codex.turns.some(({ kind }) => kind === "marker"));
  assert.ok(codex.turns.some(({ text }) => text === "压缩后的回答"));
  assert.ok(codexWarnings.some(({ code }) => code === "codex-compaction-assistant-dropped"));

  const grokFile = path.join(target, "grok.jsonl");
  writeJsonl(grokFile, [
    { type: "user", synthetic_reason: "compaction_meta", content: "压缩摘要" },
    { type: "user", content: "压缩后的问题" },
    { type: "assistant", content: "压缩后的答复" },
  ]);
  const grokWarnings = [];
  const grok = collectGrokTurnsAndEvents(
    { platform: "grok", id: "grok-0614", cwd: target, filePath: grokFile },
    grokWarnings,
  );
  assert.ok(grok.turns.some(({ kind }) => kind === "marker"));
  assert.ok(grok.turns.some(({ text }) => text === "压缩后的问题"));
  assert.ok(grok.turns.some(({ text }) => text === "压缩后的答复"));
  assert.ok(grokWarnings.some(({ code }) => code === "grok-compaction-unrecoverable"));
});
