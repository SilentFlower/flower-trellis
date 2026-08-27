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
      requests.push({ url: String(url), authorization: options.headers.authorization, redirect: options.redirect });
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
  assert.equal(requests.every(({ redirect }) => redirect === "manual"), true);
  assert.equal(requests.every(({ url }) => !url.includes("sensitive-token")), true);
  assert.match(requests[0].url, /projects\/group%2Frd%20guide\/repository\/commits\/main/);
  assert.match(requests[1].url, /repository\/tree\?ref=.*&path=plugins/);
  assert.match(requests[2].url, /repository\/files\/dir%2Ffile.json\/raw\?ref=/);
});

test("GitLab REST client 拒绝携带凭据自动跟随重定向并保留脱敏诊断", async () => {
  let calls = 0;
  const client = new GitLabRestClient({
    source,
    credentialManager: { getAccessToken: async () => "sensitive-token" },
    fetch: async () => {
      calls += 1;
      return new Response(null, {
        status: 307,
        headers: { location: "https://gitlab.example.test/api/v4/projects/group%2Fproject" },
      });
    },
  });
  await assert.rejects(
    () => client.resolveCommit("group/project", "main"),
    (error) => (
      error.code === "PLUGIN_REMOTE_REQUEST_FAILED" &&
      error.details.status === 307 &&
      error.details.locationOrigin === "https://gitlab.example.test" &&
      error.message.includes("HTTPS") &&
      !JSON.stringify(error.details).includes("sensitive-token")
    ),
  );
  assert.equal(calls, 1);
});

test("GitLab REST client 递归读取 repository tree 分页并保留原始文件字节", async () => {
  const requests = [];
  const client = new GitLabRestClient({
    source,
    credentialManager: { getAccessToken: async () => "token" },
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).includes("/repository/files/")) return new Response(Buffer.from([0, 255, 1]));
      const page = new URL(url).searchParams.get("page");
      return Response.json(
        [{ path: page === "1" ? "skills/a" : "skills/b", type: "blob", mode: "100644" }],
        { headers: page === "1" ? { "x-next-page": "2" } : {} },
      );
    },
  });
  assert.deepEqual(
    (await client.readRepositoryTree("group/project", { path: "skills", ref: "a".repeat(40) }))
      .map(({ path }) => path),
    ["skills/a", "skills/b"],
  );
  assert.deepEqual(
    await client.readRawBuffer("group/project", "skills/a", "a".repeat(40)),
    Buffer.from([0, 255, 1]),
  );
  assert.equal(requests[0].includes("recursive=true"), true);
  assert.equal(requests[0].includes("per_page=100"), true);
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
      return new Response("not found", { status: 404 });
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

test("GitLab REST client 将 401/403 映射为认证类稳定错误", async () => {
  const unauthorized = new GitLabRestClient({
    source,
    credentialManager: { getAccessToken: async () => "token" },
    fetch: async () => new Response("unauthorized", { status: 401 }),
  });
  await assert.rejects(
    () => unauthorized.resolveCommit("group/project", "main"),
    (error) => error.code === "PLUGIN_AUTH_REQUIRED" &&
      error.details.status === 401 &&
      !JSON.stringify(error.details).includes("token"),
  );

  const forbidden = new GitLabRestClient({
    source,
    credentialManager: { getAccessToken: async () => "token" },
    fetch: async () => new Response("forbidden", { status: 403 }),
  });
  await assert.rejects(
    () => forbidden.resolveCommit("group/project", "main"),
    (error) => error.code === "PLUGIN_AUTH_SCOPE_INVALID" &&
      error.details.status === 403 &&
      !JSON.stringify(error.details).includes("token"),
  );
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
