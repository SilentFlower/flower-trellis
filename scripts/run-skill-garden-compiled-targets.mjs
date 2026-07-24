import path from "node:path";
import { spawnSync } from "node:child_process";
import { PKG_ROOT } from "../src/lib/paths.js";
import { resolveTrellisBin } from "../src/lib/trellis-runner.js";

const generator = path.join(
  PKG_ROOT,
  "vendor",
  "skill-garden",
  "scripts",
  "generate-compiled-targets.py",
);
const result = spawnSync(
  process.env.PYTHON || "python3",
  [
    generator,
    "--trellis-bin",
    resolveTrellisBin(),
    "--node-bin",
    process.execPath,
    ...process.argv.slice(2),
  ],
  {
    cwd: PKG_ROOT,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`❌ Skill-Garden compiled targets 启动失败:${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
