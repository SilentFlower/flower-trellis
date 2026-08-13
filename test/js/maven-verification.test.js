import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ENHANCEMENT_SKILL_TARGETS } from "../../src/constants.js";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { copyScriptAssets } from "../../src/lib/copy-scripts.js";


const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "vendor/skill-garden/.trellis/0.6");
const snapshotRoot = path.join(projectRoot, "enhancements/0.6");
const upstreamWorkflow = path.join(
  projectRoot,
  "node_modules/@mindfoldhq/trellis/dist/templates/trellis/workflow.md",
);


function read(root, relativePath) {
  return fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8");
}


function makeTarget(prefix) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.14\n");
  fs.copyFileSync(upstreamWorkflow, path.join(target, ".trellis/workflow.md"));
  return target;
}


function quietApply(target, skills) {
  const original = console.log;
  console.log = () => {};
  try {
    return applyEnhancements(target, { variant: "0.6", skills });
  } finally {
    console.log = original;
  }
}


test("Maven Skill 双 canonical 副本与发布快照保持一致", () => {
  const paths = [
    "SKILL.md",
    "agents/openai.yaml",
    "references/lifecycle-policy.md",
    "references/evidence-contract.md",
  ];
  for (const relativePath of paths) {
    const agents = read(
      sourceRoot,
      `.agents/skills/trellis-maven-verify/${relativePath}`,
    );
    const claude = read(
      sourceRoot,
      `.claude/skills/trellis-maven-verify/${relativePath}`,
    );
    assert.equal(agents, claude, relativePath);
    assert.equal(
      agents,
      read(snapshotRoot, `.agents/skills/trellis-maven-verify/${relativePath}`),
      `snapshot agents:${relativePath}`,
    );
    assert.equal(
      claude,
      read(snapshotRoot, `.claude/skills/trellis-maven-verify/${relativePath}`),
      `snapshot claude:${relativePath}`,
    );
  }
  assert.equal(
    read(sourceRoot, "scripts/maven_verify.py"),
    read(snapshotRoot, "scripts/maven_verify.py"),
  );
});


test("Maven owner 契约区分 implement 产证与 Check-All 只读复用", () => {
  const implement = read(
    sourceRoot,
    "overrides/patches/workflow/phase-ownership/phase-2-implement-content.md",
  );
  const lightAgents = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/light-profile.md",
  );
  const lightClaude = read(
    sourceRoot,
    ".claude/skills/trellis-check-all/references/light-profile.md",
  );
  const fullAgents = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/full-profile.md",
  );
  const fullClaude = read(
    sourceRoot,
    ".claude/skills/trellis-check-all/references/full-profile.md",
  );
  const agentBody = read(
    sourceRoot,
    ".agents/skills/trellis-route/references/check-all-agent-body.md",
  );

  assert.match(implement, /load `trellis-maven-verify`/);
  assert.match(implement, /successful `final` plan\/evidence/);
  assert.match(implement, /Final defaults to conservative compilation/);
  assert.match(implement, /Decide whether to pass `--threads`/);
  assert.match(implement, /do not run extra Maven builds merely to compare thread counts/);
  assert.match(implement, /Do not broaden to `clean`, `package`, `install`, `deploy`/);
  for (const profile of [lightAgents, lightClaude, fullAgents, fullClaude]) {
    assert.match(profile, /maven_verify\.py check --latest --require-plan/);
    assert.match(profile, /不得调用 `plan` \/ `run`|不得调用 `maven_verify\.py plan\/run`/);
    assert.match(profile, /不得.*Maven goal/);
  }
  assert.match(agentBody, /may only run `python3 \.\/\.trellis\/scripts\/maven_verify\.py check/);
  assert.match(agentBody, /Do not run `plan`, `run`, `mvn`, `mvnw`/);
});


test("legacy 选择性安装为 Maven 与 Check-All 入口携带 helper", () => {
  for (const skill of [
    "maven-verify",
    "java-maven",
    "trellis-maven-verify",
    "trellis-check-all",
    "check-all",
  ]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-maven-script-"));
    const variant = path.join(target, "variant");
    fs.mkdirSync(path.join(variant, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(variant, "scripts/maven_verify.py"), "# helper\n");

    const result = copyScriptAssets(target, variant, [skill]);

    assert.deepEqual(result.installed, ["script:maven_verify.py"], skill);
    assert.equal(
      fs.existsSync(path.join(target, ".trellis/scripts/maven_verify.py")),
      true,
      skill,
    );
    fs.rmSync(target, { recursive: true, force: true });
  }
});


test("Plugin 选择性安装投影 Maven Skill、helper 与 owner Patch", () => {
  for (const alias of ["trellis-maven-verify", "maven-verify", "java-maven"]) {
    const target = makeTarget(`flower-maven-plugin-${alias}-`);
    fs.mkdirSync(path.join(target, ".agents/skills"), { recursive: true });

    const result = quietApply(target, [alias]);

    assert.ok(result.installed.includes("trellis-maven-verify"), alias);
    assert.ok(result.installed.includes("script:maven_verify.py"), alias);
    assert.equal(
      fs.existsSync(path.join(target, ".agents/skills/trellis-maven-verify/SKILL.md")),
      true,
      alias,
    );
    assert.equal(
      fs.existsSync(path.join(target, ".trellis/scripts/maven_verify.py")),
      true,
      alias,
    );
    const workflow = fs.readFileSync(path.join(target, ".trellis/workflow.md"), "utf8");
    assert.match(workflow, /load `trellis-maven-verify`/, alias);
  }
});


test("Plugin 只选择 Check-All 时仍携带 Maven evidence helper", () => {
  const target = makeTarget("flower-check-all-maven-helper-");
  fs.mkdirSync(path.join(target, ".agents/skills"), { recursive: true });

  const result = quietApply(target, ["trellis-check-all"]);

  assert.ok(result.installed.includes("trellis-check-all"));
  assert.ok(result.installed.includes("script:maven_verify.py"));
  assert.equal(
    fs.existsSync(path.join(target, ".trellis/scripts/maven_verify.py")),
    true,
  );
  const light = fs.readFileSync(
    path.join(target, ".agents/skills/trellis-check-all/references/light-profile.md"),
    "utf8",
  );
  assert.match(light, /maven_verify\.py check --latest --require-plan/);
  assert.doesNotMatch(light, /读取 `trellis-maven-verify`/);
});


test("全平台 Skill root 获得 Maven 分层验证 Skill", () => {
  const target = makeTarget("flower-maven-platform-matrix-");
  for (const { root } of ENHANCEMENT_SKILL_TARGETS) {
    fs.mkdirSync(path.join(target, ...root.split("/")), { recursive: true });
  }

  quietApply(target, ["trellis-maven-verify"]);

  for (const { platform, root } of ENHANCEMENT_SKILL_TARGETS) {
    assert.equal(
      fs.existsSync(path.join(target, ...root.split("/"), "trellis-maven-verify/SKILL.md")),
      true,
      `${platform}:${root}`,
    );
  }
});


test("Maven Bundle 提供稳定别名并复用 workflow owner", () => {
  const bundle = JSON.parse(read(sourceRoot, "overrides/bundles/maven-verification.json"));

  assert.equal(bundle.id, "maven-verification");
  for (const alias of [
    "maven-verify",
    "java-maven",
    "trellis-maven-verify",
  ]) {
    assert.ok(bundle.aliases.includes(alias), alias);
  }
  assert.equal(bundle.aliases.includes("trellis-check-all"), false);
  assert.equal(bundle.aliases.includes("check-all"), false);
  assert.deepEqual(bundle.patches, ["workflow/phase-ownership"]);
});
