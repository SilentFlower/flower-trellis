import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { copyFlowerAssets, FLOWER_UPDATE_HOOK_REL } from "../../src/lib/flower-assets.js";

test("Windows 更新 hook 执行 CMD 时保留入口和项目路径中的特殊字符", { skip: process.platform !== "win32" }, async (t) => {
  // 与 hook 的 Path.resolve 保持一致，先展开 Windows 的 8.3 短目录名。
  // 根目录不主动加入空格，避免所有参数自动被引号包围而掩盖 CMD 解释缺口。
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-windows-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cases = [
    ["bin with spaces", "项目 with spaces"],
    ["bin", "项目&ver"],
    ["bin", "项目 with spaces &ver"],
    ["bin", "项目%FLOWER_TEST_LITERAL%"],
    ["bin", "项目 with spaces %FLOWER_TEST_LITERAL%"],
    ["bin", "项目!FLOWER_TEST_LITERAL!"],
    ["bin", "项目^(test)"],
    ["bin&ver", "项目"],
    ["bin%FLOWER_TEST_LITERAL%", "项目"],
    ["bin!FLOWER_TEST_LITERAL!", "项目"],
  ];
  for (const [index, [binName, targetName]] of cases.entries()) {
    await t.test(`${binName} / ${targetName}`, () => {
      const caseRoot = path.join(root, String(index));
      const bin = path.join(caseRoot, binName);
      const target = path.join(caseRoot, targetName);
      fs.mkdirSync(bin, { recursive: true });
      fs.mkdirSync(target);
      copyFlowerAssets(target);
      const capture = path.join(caseRoot, "captured.json");
      fs.writeFileSync(path.join(bin, "capture.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({status: "up_to_date"}));`);
      fs.writeFileSync(path.join(bin, "flower-trellis.cmd"), `@"${process.execPath}" "%~dp0capture.mjs" %*\r\n`);
      const python = process.env.FLOWER_TEST_PYTHON || "python";
      const result = spawnSync(python, [path.join(target, FLOWER_UPDATE_HOOK_REL)], {
        cwd: target,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${bin};${process.env.PATH}`,
          CLAUDE_PROJECT_DIR: target,
          CODEX_PROJECT_DIR: target,
          TRELLIS_HOOKS: "1",
          TRELLIS_DISABLE_HOOKS: "0",
          CODEX_NON_INTERACTIVE: "0",
          FLOWER_NO_TELEMETRY: "1",
          FLOWER_TEST_LITERAL: "expanded",
          FLOWER_UPDATE_HOOK_CLI: "invalid inherited CLI",
          FLOWER_UPDATE_HOOK_TARGET: "invalid inherited target",
        },
        input: JSON.stringify({ cwd: target }),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "");
      assert.deepEqual(JSON.parse(fs.readFileSync(capture, "utf8")), ["self-check", "--json", "--target", target]);
    });
  }
});
