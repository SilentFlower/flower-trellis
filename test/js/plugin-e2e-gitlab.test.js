import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { create } from "tar";
import { GitLabOAuthClient } from "../../src/plugin/auth/gitlab-oauth.js";
import { GitLabRestClient } from "../../src/plugin/gitlab/rest-client.js";
import { hashCanonicalTree } from "../../src/plugin/integrity/canonical-tree.js";
import {
  createPluginTestRoot,
  pluginManifest,
  writePluginPackage,
} from "./plugin-test-helpers.js";
import {
  createFlowerCliCopy,
  createIsolatedFlowerEnv,
  findSensitiveText,
  parseFlowerJson,
  runFlower,
  runFlowerAsync,
  scanSensitiveFiles,
} from "./plugin-e2e-helpers.js";

/**
 * 创建一个可由 GitLab archive 端点返回的固定 Plugin 仓库归档。
 *
 * @param {string} root fixture 根目录
 * @param {string} version Plugin 版本
 * @param {string} content Skill 内容
 * @returns {Promise<{archive:Buffer,integrity:string}>} 归档与 canonical 摘要
 */
async function createRepositoryArchive(root, version, content) {
  const releaseRoot = path.join(root, `release-${version}`);
  const repositoryName = `rd-guide-${version.replaceAll(".", "-")}`;
  const repositoryRoot = path.join(releaseRoot, repositoryName);
  const packageRoot = writePluginPackage(
    repositoryRoot,
    "plugins/demo",
    pluginManifest({ version }),
    { "skills/demo/SKILL.md": content },
  );
  const archiveFile = path.join(root, `rd-guide-${version}.tar.gz`);
  await create({ cwd: releaseRoot, file: archiveFile, gzip: true }, [repositoryName]);
  return {
    archive: fs.readFileSync(archiveFile),
    integrity: hashCanonicalTree(packageRoot),
  };
}

/**
 * 构造指定发布状态的 Marketplace 索引。
 *
 * @param {Array<{version:string,ref:string,commit:string,integrity:string}>} versions 版本记录
 * @returns {object} Marketplace manifest
 */
function marketplaceManifest(versions) {
  return {
    schemaVersion: 1,
    id: "mock-guide",
    name: "Mock Guide",
    plugins: [{
      id: "demo",
      description: "示例 Plugin",
      source: { type: "path", path: "plugins/demo" },
      trust: { maxProfile: "standard" },
      versions,
    }],
  };
}

/**
 * 启动只记录脱敏请求摘要的 GitLab HTTP mock。
 *
 * @param {string} root fixture 根目录
 * @returns {Promise<{baseUrl:string,requests:object[],sensitiveValues:string[],setRelease:(index:number)=>void,close:()=>Promise<void>}>} mock 控制器
 */
async function startGitLabMock(root) {
  const accessValue = ["e2e", "access", "canary", "value", "1234567890"].join("-");
  const refreshValue = ["e2e", "refresh", "canary", "value", "1234567890"].join("-");
  const deviceValue = ["e2e", "device", "canary", "value", "1234567890"].join("-");
  const authorizationCode = ["e2e", "authorization", "canary", "code", "1234567890"].join("-");
  const pluginCommits = ["a".repeat(40), "b".repeat(40)];
  const indexCommits = ["c".repeat(40), "d".repeat(40)];
  const packageV1 = await createRepositoryArchive(root, "1.0.0", "# Demo 1.0.0\n");
  const packageV2 = await createRepositoryArchive(root, "1.1.0", "# Demo 1.1.0\n");
  const releases = [
    marketplaceManifest([{
      version: "1.0.0",
      ref: "v1.0.0",
      commit: pluginCommits[0],
      integrity: packageV1.integrity,
    }]),
    marketplaceManifest([{
      version: "1.0.0",
      ref: "v1.0.0",
      commit: pluginCommits[0],
      integrity: packageV1.integrity,
    }, {
      version: "1.1.0",
      ref: "v1.1.0",
      commit: pluginCommits[1],
      integrity: packageV2.integrity,
    }]),
  ];
  const archives = new Map([
    [pluginCommits[0], packageV1.archive],
    [pluginCommits[1], packageV2.archive],
  ]);
  const requests = [];
  let currentRelease = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const form = new URLSearchParams(body);
    requests.push({
      method: request.method,
      path: url.pathname,
      authorized: request.headers.authorization === `Bearer ${accessValue}`,
      grantType: form.get("grant_type") || null,
    });
    const json = (value, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (url.pathname === "/oauth/authorize_device") {
      json({
        device_code: deviceValue,
        user_code: "ABCD-1234",
        verification_uri: "http://gitlab.example.test/oauth/device",
        expires_in: 60,
        interval: 1,
      });
    } else if (url.pathname === "/oauth/token") {
      const grantType = form.get("grant_type");
      if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
        assert.equal(form.get("device_code"), deviceValue);
      } else if (grantType === "authorization_code") {
        assert.equal(form.get("code"), authorizationCode);
      } else {
        assert.fail(`未预期的 OAuth grant:${grantType}`);
      }
      json({
        access_token: accessValue,
        refresh_token: refreshValue,
        token_type: "Bearer",
        expires_in: 7200,
        scope: ["read_api", "read_repository"],
      });
    } else if (url.pathname.endsWith("/repository/commits/main")) {
      json({ id: indexCommits[currentRelease] });
    } else if (url.pathname.endsWith("/repository/tree")) {
      json([{ id: "1", name: "plugin.json", type: "blob" }]);
    } else if (url.pathname.includes("/repository/files/") && url.pathname.endsWith("/raw")) {
      const releaseIndex = indexCommits.indexOf(url.searchParams.get("ref"));
      if (releaseIndex < 0) {
        json({ error: "unknown ref" }, 404);
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(releases[releaseIndex]));
      }
    } else if (url.pathname.endsWith("/repository/archive.tar.gz")) {
      const archive = archives.get(url.searchParams.get("sha"));
      if (!archive) {
        json({ error: "unknown sha" }, 404);
      } else {
        response.writeHead(200, {
          "content-length": archive.length,
          "content-type": "application/gzip",
        });
        response.end(archive);
      }
    } else {
      json({ error: "unexpected" }, 500);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    sensitiveValues: [
      accessValue,
      refreshValue,
      deviceValue,
      authorizationCode,
      `Bearer ${accessValue}`,
    ],
    setRelease: (index) => { currentRelease = index; },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

/**
 * 创建模拟系统浏览器的 xdg-open，向 loopback callback 回传授权码。
 *
 * @param {string} root 可执行文件目录
 * @param {string} authorizationCode 固定授权码
 * @returns {string} xdg-open 所在目录
 */
function createMockBrowser(root, authorizationCode) {
  fs.mkdirSync(root, { recursive: true });
  const executable = path.join(root, "xdg-open");
  fs.writeFileSync(executable, `#!/usr/bin/env node
const authorizeUrl = new URL(process.argv[2]);
const callbackUrl = new URL(authorizeUrl.searchParams.get("redirect_uri"));
callbackUrl.searchParams.set("code", ${JSON.stringify(authorizationCode)});
callbackUrl.searchParams.set("state", authorizeUrl.searchParams.get("state"));
fetch(callbackUrl).catch(() => { process.exitCode = 1; });
`);
  fs.chmodSync(executable, 0o755);
  return root;
}

test("真实 bin 的 source 管理与未授权 search 保持惰性零网络", async (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-gitlab-cli-");
  const project = path.join(workspace, "project");
  const envRoot = path.join(workspace, "env");
  fs.mkdirSync(project);
  const mock = await startGitLabMock(path.join(workspace, "mock"));
  t.after(() => mock.close());

  const add = runFlower(project, [
    "plugin", "source", "add", "mock-guide",
    "--url", mock.baseUrl,
    "--project", "group/rd-guide",
    "--application-id", "public-client",
    "--json",
  ], { envRoot });
  assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);
  assert.equal(mock.requests.length, 0);

  const list = runFlower(project, ["plugin", "source", "list", "--json"], { envRoot });
  assert.equal(list.status, 0, `${list.stdout}\n${list.stderr}`);
  assert.equal(parseFlowerJson(list).sources.some(({ id }) => id === "mock-guide"), true);
  assert.equal(mock.requests.length, 0);

  const search = await runFlowerAsync(project, [
    "plugin", "search", "example", "--source", "mock-guide", "--json",
  ], { envRoot, timeout: 10_000 });
  assert.equal(search.status, 1, `${search.stdout}\n${search.stderr}`);
  assert.equal(parseFlowerJson(search).diagnostics[0].code, "PLUGIN_AUTH_REQUIRED");
  assert.equal(mock.requests.length, 0);
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
});

test("真实 bin 跨进程覆盖 GitLab OAuth、search、add、update 与禁用零网络", async (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-gitlab-full-");
  const project = path.join(workspace, "project");
  const envRoot = path.join(workspace, "env");
  fs.mkdirSync(project);
  const mock = await startGitLabMock(path.join(workspace, "mock"));
  const { cli, keyringFile } = createFlowerCliCopy(path.join(workspace, "cli-copy"));
  const authorizationCode = mock.sensitiveValues[3];
  const browserBin = createMockBrowser(path.join(workspace, "browser-bin"), authorizationCode);
  const common = {
    cli,
    envRoot,
    env: { FLOWER_E2E_KEYRING_FILE: keyringFile },
    timeout: 20_000,
  };
  t.after(() => mock.close());

  const results = [];
  const sourceAdd = runFlower(project, [
    "plugin", "source", "add", "mock-guide",
    "--url", mock.baseUrl,
    "--project", "group/rd-guide",
    "--application-id", "public-client",
    "--json",
  ], common);
  results.push(sourceAdd);
  assert.equal(sourceAdd.status, 0, `${sourceAdd.stdout}\n${sourceAdd.stderr}`);

  const deviceLogin = await runFlowerAsync(project, [
    "plugin", "auth", "login", "mock-guide", "--device", "--json",
  ], common);
  results.push(deviceLogin);
  assert.equal(deviceLogin.status, 0, `${deviceLogin.stdout}\n${deviceLogin.stderr}`);
  assert.equal(parseFlowerJson(deviceLogin).persistent, true);

  const logout = runFlower(project, [
    "plugin", "auth", "logout", "mock-guide", "--json",
  ], common);
  results.push(logout);
  assert.equal(logout.status, 0, `${logout.stdout}\n${logout.stderr}`);

  const pkceLogin = await runFlowerAsync(project, [
    "plugin", "auth", "login", "mock-guide", "--json",
  ], {
    ...common,
    env: {
      ...common.env,
      PATH: `${browserBin}${path.delimiter}${process.env.PATH}`,
    },
  });
  results.push(pkceLogin);
  assert.equal(pkceLogin.status, 0, `${pkceLogin.stdout}\n${pkceLogin.stderr}`);

  const search = await runFlowerAsync(project, [
    "plugin", "search", "示例", "--source", "mock-guide", "--json",
  ], common);
  results.push(search);
  assert.equal(search.status, 0, `${search.stdout}\n${search.stderr}`);
  assert.equal(parseFlowerJson(search).results[0].id, "mock-guide/demo");

  const add = await runFlowerAsync(project, [
    "plugin", "add", "mock-guide/demo", "--platform", "codex", "--json",
  ], common);
  results.push(add);
  assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);
  assert.equal(parseFlowerJson(add).graph.plugins[0].version, "1.0.0");
  assert.equal(fs.readFileSync(path.join(project, ".agents/skills/demo/SKILL.md"), "utf8"), "# Demo 1.0.0\n");

  mock.setRelease(1);
  const update = await runFlowerAsync(project, [
    "plugin", "update", "mock-guide/demo", "--json",
  ], common);
  results.push(update);
  assert.equal(update.status, 0, `${update.stdout}\n${update.stderr}`);
  assert.equal(parseFlowerJson(update).graph.plugins[0].version, "1.1.0");
  assert.equal(fs.readFileSync(path.join(project, ".agents/skills/demo/SKILL.md"), "utf8"), "# Demo 1.1.0\n");

  const requestsBeforeDisable = mock.requests.length;
  const disable = runFlower(project, [
    "plugin", "source", "disable", "mock-guide", "--json",
  ], common);
  results.push(disable);
  assert.equal(disable.status, 0, `${disable.stdout}\n${disable.stderr}`);
  const disabledSearch = await runFlowerAsync(project, [
    "plugin", "search", "示例", "--source", "mock-guide", "--json",
  ], common);
  results.push(disabledSearch);
  assert.equal(disabledSearch.status, 3, `${disabledSearch.stdout}\n${disabledSearch.stderr}`);
  assert.equal(parseFlowerJson(disabledSearch).diagnostics[0].code, "PLUGIN_SOURCE_NOT_FOUND");
  assert.equal(mock.requests.length, requestsBeforeDisable);

  const lock = JSON.parse(fs.readFileSync(path.join(project, ".flower/plugin-lock.json"), "utf8"));
  const state = JSON.parse(fs.readFileSync(path.join(project, ".flower/state.json"), "utf8"));
  assert.equal(lock.plugins[0].version, "1.1.0");
  assert.equal(state.plugins[0].version, "1.1.0");
  assert.equal(mock.requests.some(({ grantType }) => grantType === "urn:ietf:params:oauth:grant-type:device_code"), true);
  assert.equal(mock.requests.some(({ grantType }) => grantType === "authorization_code"), true);
  assert.equal(mock.requests.some(({ path: requestPath }) => requestPath.endsWith("/repository/archive.tar.gz")), true);
  assert.equal(mock.requests.every(({ authorized, path: requestPath }) => (
    !requestPath.startsWith("/api/v4/") || authorized
  )), true);

  for (const result of results) {
    assert.deepEqual(findSensitiveText(`${result.stdout}\n${result.stderr}`, mock.sensitiveValues), []);
  }
  assert.deepEqual(scanSensitiveFiles(project, mock.sensitiveValues), []);
});

test("本地 HTTP mock 覆盖 repository tree、raw file 与 archive", async (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-gitlab-http-");
  const mock = await startGitLabMock(path.join(workspace, "mock"));
  t.after(() => mock.close());
  const source = {
    id: "mock-guide",
    baseUrl: mock.baseUrl,
    project: "group/rd-guide",
    oauth: { applicationId: "public-client", scopes: ["read_api", "read_repository"] },
  };
  const oauth = new GitLabOAuthClient({ sleep: async () => {} });
  let verification;
  const credential = await oauth.loginWithDevice(source, {
    onVerification: (value) => { verification = value; },
  });
  assert.equal(verification.userCode, "ABCD-1234");
  assert.deepEqual(credential.scope, ["read_api", "read_repository"]);

  const client = new GitLabRestClient({
    source,
    credentialManager: { getAccessToken: async () => credential.accessToken },
  });
  const commit = await client.resolveCommit(source.project, "main");
  assert.equal(commit, "c".repeat(40));
  assert.equal((await client.readTree(source.project, { ref: commit }))[0].name, "plugin.json");
  assert.match(await client.readRawFile(source.project, ".flower-marketplace/marketplace.json", commit), /mock-guide/);
  assert.ok((await client.downloadArchive(source.project, "a".repeat(40))).length > 0);
  assert.equal(mock.requests.filter(({ authorized }) => authorized).length, 4);

  const publicOutput = JSON.stringify({
    sourceId: source.id,
    scopes: credential.scope,
    verificationUri: verification.verificationUri,
  });
  assert.deepEqual(findSensitiveText(publicOutput, mock.sensitiveValues), []);
  assert.equal(createIsolatedFlowerEnv(path.join(workspace, "isolated")).FLOWER_DEBUG, undefined);
});
