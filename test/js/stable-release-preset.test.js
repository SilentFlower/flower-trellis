import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const stablePreset = require("../../scripts/lib/stable-release-preset.cjs");

test("稳定版发布起点忽略预发布标签并选择最高稳定版本", () => {
  assert.equal(
    stablePreset.selectLatestStableTag([
      "v0.6.0-beta.9",
      "v0.5.5",
      "v0.5.6-beta.1",
      "v0.5.4",
    ]),
    "v0.5.5",
  );
});

test("稳定版提交格式不携带中间标签，避免 beta 版本被拆成多个段落", () => {
  assert.doesNotMatch(stablePreset.COMMIT_FORMAT_WITHOUT_TAGS, /gitTags|%d/);
});
