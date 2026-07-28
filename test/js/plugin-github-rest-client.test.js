import assert from "node:assert/strict";
import test from "node:test";
import { GitHubRestClient } from "../../src/plugin/github/rest-client.js";

function response(body, options = {}) {
  return new Response(body, {
    status: options.status || 200,
    headers: options.headers,
  });
}

test("GitHub client 匿名解析默认分支、commit 和 archive", async () => {
  const calls = [];
  const client = new GitHubRestClient({
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/repos/example/guides")) {
        return response(JSON.stringify({ default_branch: "trunk" }), { headers: { "content-type": "application/json" } });
      }
      if (String(url).includes("/commits/trunk")) {
        return response(JSON.stringify({
          sha: "a".repeat(40),
          commit: { committer: { date: "2026-07-28T10:00:00Z" } },
        }), { headers: { "content-type": "application/json" } });
      }
      return response(Buffer.from("archive"), { headers: { "content-length": "7" } });
    },
  });
  assert.deepEqual(await client.resolveRepository("https://github.com/example/guides.git"), {
    repository: "example/guides",
    defaultBranch: "trunk",
  });
  assert.deepEqual(await client.resolveCommit("example/guides", "trunk"), {
    sha: "a".repeat(40),
    committedAt: "2026-07-28T10:00:00Z",
  });
  assert.equal((await client.downloadArchive("example/guides", "a".repeat(40))).toString(), "archive");
  assert.equal(calls.every(({ options }) => options.headers.authorization === undefined), true);
  assert.equal(calls.every(({ options }) => options.headers["user-agent"] === "flower-trellis"), true);
});

test("GitHub client 区分匿名限流与普通远程错误", async () => {
  const limited = new GitHubRestClient({
    fetch: async () => response("{}", {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-limit": "60",
        "x-ratelimit-reset": "123",
      },
    }),
  });
  await assert.rejects(
    () => limited.resolveRepository("example/guides"),
    (error) => error.code === "PLUGIN_REMOTE_RATE_LIMITED" && error.details.limit === "60",
  );

  const missing = new GitHubRestClient({ fetch: async () => response("{}", { status: 404 }) });
  await assert.rejects(
    () => missing.resolveRepository("example/guides"),
    (error) => error.code === "PLUGIN_REMOTE_REQUEST_FAILED",
  );
});

test("GitHub client 拒绝超限 archive", async () => {
  const client = new GitHubRestClient({
    maxArchiveBytes: 4,
    fetch: async () => response(Buffer.from("12345"), { headers: { "content-length": "5" } }),
  });
  await assert.rejects(
    () => client.downloadArchive("example/guides", "a".repeat(40)),
    (error) => error.code === "PLUGIN_REMOTE_REQUEST_FAILED",
  );
});
