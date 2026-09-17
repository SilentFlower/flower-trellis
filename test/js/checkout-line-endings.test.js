import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SELECTOR = "overrides/patches/workflow/state-untracked/selector.md";
const BASELINE = "overrides/patches/skills/trellis-break-loop/spec-evaluation/baseline.md";

for (const [name, source, samples] of [
  ["Flower", ROOT, [`enhancements/0.6/${SELECTOR}`, `enhancements/0.6/${BASELINE}`, "src/patches/platforms/codex/dispatch-mode/hook-selector.py"]],
  ["Skill-Garden", path.join(ROOT, "vendor/skill-garden"), [`.trellis/0.6/${SELECTOR}`, `.trellis/0.6/${BASELINE}`, "compiled-targets/0.6.14/full/targets/.cursor/hooks/session-start.py.diff"]],
]) {
  test(`${name} 在 autocrlf=true 检出时保持 Patch 原文与二进制字节`, (t) => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-checkout-eol-"));
    t.after(() => fs.rmSync(target, { recursive: true, force: true }));
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(target, "no-global-config") };
    const git = (...args) => execFileSync("git", ["-c", "core.autocrlf=true", "-c", "core.safecrlf=false", ...args], {
      cwd: target, env, stdio: "pipe",
    });
    git("init");
    fs.copyFileSync(path.join(source, ".gitattributes"), path.join(target, ".gitattributes"));
    const expected = new Map(samples.map((relative) => [relative, fs.readFileSync(path.join(source, relative))]));
    expected.set("binary.dat", Buffer.from([0, 13, 10, 255, 10]));
    for (const [relative, bytes] of expected) {
      const file = path.join(target, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    }
    git("add", "--", ".gitattributes", ...expected.keys());
    // 用真实 Git 检出触发行尾转换，不能只断言 attributes 文件包含某一行。
    git("checkout-index", "--all", "--prefix=checkout/");
    for (const [relative, bytes] of expected) {
      const actual = fs.readFileSync(path.join(target, "checkout", relative));
      assert.deepEqual(actual, bytes, relative);
      if (relative !== "binary.dat") assert.equal(actual.includes(Buffer.from("\r\n")), false, relative);
    }
  });
}
