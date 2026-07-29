import assert from "node:assert/strict";
import test from "node:test";
import { GitLabRestClient } from "../../src/plugin/gitlab/rest-client.js";

const source = {
  id: "rd-guide",
  baseUrl: "http://gitlab.example.test",
};

test("GitLab REST client 使用 Bearer header、编码 project 并覆盖 tree/files/archive", async () => {
  const requests = [];
  const commit = "a".repeat(40);
  const client = new GitLabRestClient({
    source,
    credentialManager: { getAccessToken: async () => "sensitive-token" },
    fetch: async (url, options) => {
      requests.push({ url: String(url), authorization: options.headers.authorization });
      if (String(url).includes("/commits/")) return Response.json({ id: commit });
      if (String(url).includes("/repository/tree")) return Response.json([{ id: "1", name: "plugins" }]);
      if (String(url).includes("/repository/files/")) return new Response("index-content");
      return new Response(Buffer.from("archive"), { headers: { "content-length": "7" } });
    },
  });
  assert.equal(await client.resolveCommit("group/rd guide", "main"), commit);
  assert.deepEqual(await client.readTree("group/rd guide", { path: "plugins", ref: commit }), [{ id: "1", name: "plugins" }]);
  assert.equal(await client.readRawFile("group/rd guide", "dir/file.json", commit), "index-content");
  assert.equal((await client.downloadArchive("group/rd guide", commit)).toString(), "archive");
  assert.equal(requests.every(({ authorization }) => authorization === "Bearer sensitive-token"), true);
  assert.equal(requests.every(({ url }) => !url.includes("sensitive-token")), true);
  assert.match(requests[0].url, /projects\/group%2Frd%20guide\/repository\/commits\/main/);
  assert.match(requests[1].url, /repository\/tree\?ref=.*&path=plugins/);
  assert.match(requests[2].url, /repository\/files\/dir%2Ffile.json\/raw\?ref=/);
});

test("GitLab REST client 对 GET 5xx 只重试一次", async () => {
  let calls = 0;
  const client = new GitLabRestClient({
    source,
    credentialManager: { getAccessToken: async () => "token" },
    fetch: async () => {
      calls += 1;
      return calls === 1 ? new Response("failed", { status: 503 }) : Response.json({ id: "b".repeat(40) });
    },
  });
  assert.equal(await client.resolveCommit("group/project", "main"), "b".repeat(40));
  assert.equal(calls, 2);
});

test("GitLab REST client 对 4xx 不重试，超时网络错误只重试一次", async () => {
  let clientErrors = 0;
  const clientError = new GitLabRestClient({
    source,
    credentialManager: { getAccessToken: async () => "token" },
    fetch: async () => {
      clientErrors += 1;
      return new Response("forbidden", { status: 403 });
    },
  });
  await assert.rejects(
    () => clientError.resolveCommit("group/project", "main"),
    (error) => error.code === "PLUGIN_REMOTE_REQUEST_FAILED",
  );
  assert.equal(clientErrors, 1);

  let timeouts = 0;
  const timeout = new GitLabRestClient({
    source,
    timeoutMs: 5,
    credentialManager: { getAccessToken: async () => "token" },
    fetch: async (_url, options) => new Promise((resolve, reject) => {
      timeouts += 1;
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(
    () => timeout.resolveCommit("group/project", "main"),
    (error) => error.code === "PLUGIN_REMOTE_REQUEST_FAILED",
  );
  assert.equal(timeouts, 2);
});

test("GitLab REST client 同时限制 archive 响应头和实际字节", async () => {
  const oversizedHeader = new GitLabRestClient({
    source,
    maxArchiveBytes: 4,
    credentialManager: { getAccessToken: async () => "token" },
    fetch: async () => new Response("x", { headers: { "content-length": "5" } }),
  });
  await assert.rejects(
    () => oversizedHeader.downloadArchive("group/project", "a".repeat(40)),
    (error) => error.code === "PLUGIN_REMOTE_REQUEST_FAILED" && error.message.includes("大小限制"),
  );

  const oversizedBody = new GitLabRestClient({
    source,
    maxArchiveBytes: 4,
    credentialManager: { getAccessToken: async () => "token" },
    fetch: async () => new Response("12345"),
  });
  await assert.rejects(
    () => oversizedBody.downloadArchive("group/project", "a".repeat(40)),
    (error) => error.code === "PLUGIN_REMOTE_REQUEST_FAILED" && error.message.includes("大小限制"),
  );
});
