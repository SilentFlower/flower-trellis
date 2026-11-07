/** 真实PTY和进程树夹具；不连接模型服务、不执行项目Git动作。 */
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { runConfirmationSession } from "../../../src/lib/confirmation-session.js";
import { CONFIRMATION_SESSION_ENV } from "../../../src/constants.js";
import { startConfirmationServer } from "../../../src/lib/confirmation-server.js";
import { createConfirmationSnapshot } from "../../../src/lib/confirmation-snapshot.js";

const self = fileURLToPath(import.meta.url);
const root = process.env.CONFIRMATION_FIXTURE_ROOT;
const helper = process.env.CONFIRMATION_FIXTURE_HELPER;
const python = process.env.FLOWER_TEST_PYTHON;
const role = process.argv[2];

if (role === "runner") {
  const code = await runConfirmationSession({ root, resolved: { platform: "codex" } }, {
    python, helper,
    launchFactory: ({ descriptor, env }) => ({ executable: process.execPath, args: [self, "harness"],
      env: { ...env, [CONFIRMATION_SESSION_ENV]: JSON.stringify(descriptor), CODEX_THREAD_ID: "lifecycle" } }),
  });
  process.exitCode = code;
} else if (role === "descendant") {
  setInterval(() => {}, 1000);
} else if (role === "inspector-runner") {
  const exits = [];
  const runtime = await startConfirmationServer({ root, platform: "codex",
    snapshot: createConfirmationSnapshot(root, { python, helper }), display: async () => {}, onExitCode: code => exits.push(code) });
  runtime.state.bind("codex_inspector");
  if (process.env.CONFIRMATION_INSPECT_CLOSE === "1") {
    const timer = setInterval(() => {
      if (!fs.existsSync(path.join(root, "processes.json"))) return;
      clearInterval(timer);
      void runtime.close();
    }, 10);
  }
  try {
    const result = await runtime.state.prepare({}, "codex_inspector");
    fs.writeFileSync(path.join(root, "inspect-result.json"), JSON.stringify({ ok: true, result, exits }));
  } catch {
    fs.writeFileSync(path.join(root, "inspect-result.json"), JSON.stringify({ ok: false, exits }));
  } finally { await runtime.close(); }
} else if (role === "harness") {
  process.stdout.write("\x1b[?1049h");
  const descendant = spawn(process.execPath, [self, "descendant"], { stdio: "ignore" });
  const inputRead = new Promise(resolve => process.stdin.once("data", chunk => resolve(chunk.toString())));
  const mcpFile = fileURLToPath(new URL("../../../src/lib/confirmation-mcp.js", import.meta.url));
  const mcp = spawn(process.execPath, [mcpFile], { stdio: ["pipe", "pipe", "inherit"] });
  fs.writeFileSync(path.join(root, "processes.json"), JSON.stringify([process.ppid, process.pid, descendant.pid, mcp.pid]));
  let id = 0;
  const pending = new Map();
  createInterface({ input: mcp.stdout }).on("line", line => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const request = (method, params) => {
    const next = ++id;
    const response = new Promise(resolve => pending.set(next, resolve));
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: next, method, params })}\n`);
    return response;
  };
  const client = (args, input = "") => JSON.parse(execFileSync(python, ["-X", "utf8", helper, ...args, "--root", root],
    { encoding: "utf8", input, env: process.env }));
  client(["bind"], JSON.stringify({ session_id: "lifecycle" }));
  await request("initialize", { protocolVersion: "2025-11-25" });
  await request("tools/list");
  const prepared = client(["prepare", "--kind", "check", "--file", "报告.md", "--problem-id", "CHK-1"]);
  const waited = await request("tools/call", { name: "wait", arguments: { request_id: prepared.request_id } });
  const result = JSON.parse(waited.result.content[0].text);
  let claim = null;
  if (result.source === "policy_timeout") claim = client(["claim", "--request-id", prepared.request_id]);
  const input = result.source === "cancelled" ? await inputRead : null;
  fs.writeFileSync(path.join(root, "outcome.json"), JSON.stringify({ result, claim, input }));
  // 故意留下CLI的后代和MCP，让生产守护器承担正常退出时的整树清理。
  process.exit(7);
}
