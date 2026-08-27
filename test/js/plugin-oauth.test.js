import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCredentialStore } from "../../src/plugin/auth/memory-credential-store.js";
import {
  GitLabCredentialManager,
  GitLabOAuthClient,
  authorizationOpenCommand,
  credentialFromToken,
  createPkceParameters,
} from "../../src/plugin/auth/gitlab-oauth.js";
import {
  parseGlabAuthStatusToken,
  resolveGitLabEnvironmentCredential,
} from "../../src/plugin/auth/gitlab-credential-resolver.js";

const source = {
  id: "rd-guide",
  baseUrl: "http://gitlab.example.test",
  oauth: { applicationId: "public-client", scopes: ["read_api", "read_repository"] },
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("PKCE 参数满足 verifier、challenge 与 state 要求", () => {
  const first = createPkceParameters();
  const second = createPkceParameters();
  assert.match(first.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(first.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.state, second.state);
  assert.deepEqual(
    authorizationOpenCommand("http://example.test/oauth?a=1&b=2", "win32"),
    ["explorer.exe", ["http://example.test/oauth?a=1&b=2"]],
  );
});

test("PKCE loopback 校验 state、只接受一次回调并交换公共客户端 token", async () => {
  const callbacks = [];
  const oauthCalls = [];
  const client = new GitLabOAuthClient({
    openUrl: async (authorizationUrl) => {
      const authorization = new URL(authorizationUrl);
      const redirectUri = authorization.searchParams.get("redirect_uri");
      const state = authorization.searchParams.get("state");
      assert.equal(authorization.searchParams.get("scope"), "openid profile read_user write_repository api");
      callbacks.push(await fetch(`${redirectUri}?code=code-value&state=${state}`));
      callbacks.push(await fetch(`${redirectUri}?code=second-code&state=${state}`));
    },
    fetch: async (url, options) => {
      oauthCalls.push({ url: String(url), body: String(options?.body || "") });
      if (String(url).endsWith("/oauth/token/info")) {
        return jsonResponse({ scope: ["read_api", "read_repository"] });
      }
      return jsonResponse({
        access_token: "access",
        refresh_token: "refresh",
        token_type: "Bearer",
        expires_in: 7200,
      });
    },
  });
  const credential = await client.loginWithPkce(source);
  assert.deepEqual(callbacks.map(({ status }) => status), [200, 404]);
  assert.equal(credential.accessToken, "access");
  assert.match(oauthCalls[0].body, /code_verifier=/);
  assert.match(oauthCalls[0].body, /client_id=public-client/);
  assert.equal(oauthCalls.every(({ body }) => !body.includes("client_secret")), true);
});

test("PKCE 浏览器启动失败时关闭 callback 并返回认证错误", async () => {
  const client = new GitLabOAuthClient({
    openUrl: async () => { throw new Error("browser unavailable"); },
    callbackTimeoutMs: 50,
  });
  await assert.rejects(
    () => client.loginWithPkce(source),
    (error) => error.code === "PLUGIN_AUTH_FAILED" && error.message.includes("授权页面"),
  );
});

test("PKCE loopback 拒绝不匹配 state", async () => {
  const client = new GitLabOAuthClient({
    openUrl: async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri");
      const response = await fetch(`${redirectUri}?code=code-value&state=wrong-state`);
      assert.equal(response.status, 400);
    },
    callbackTimeoutMs: 100,
  });
  await assert.rejects(
    () => client.loginWithPkce(source),
    (error) => error.code === "PLUGIN_AUTH_FAILED" && error.message.includes("state"),
  );
});

test("Device Flow 处理 pending 与 slow_down 后保存固定 scopes", async () => {
  let currentTime = 0;
  const calls = [];
  const responses = [
    jsonResponse({
      device_code: "device-code",
      user_code: "ABCD-1234",
      verification_uri: "http://gitlab.example.test/oauth/device",
      expires_in: 60,
      interval: 1,
    }),
    jsonResponse({ error: "authorization_pending" }, 400),
    jsonResponse({ error: "slow_down" }, 400),
    jsonResponse({
      access_token: "access",
      refresh_token: "refresh",
      token_type: "Bearer",
      expires_in: 7200,
    }),
    jsonResponse({ scope: ["read_api", "read_repository"] }),
  ];
  const client = new GitLabOAuthClient({
    fetch: async (url, options) => {
      calls.push({ url: String(url), body: String(options.body) });
      return responses.shift();
    },
    sleep: async (milliseconds) => { currentTime += milliseconds; },
    now: () => currentTime,
  });
  let verification;
  const credential = await client.loginWithDevice(source, {
    onVerification: (value) => { verification = value; },
  });
  assert.equal(verification.userCode, "ABCD-1234");
  assert.deepEqual(credential.scope, ["read_api", "read_repository"]);
  assert.equal(calls[0].url, "http://gitlab.example.test/oauth/authorize_device");
  assert.match(calls[0].body, /scope=openid\+profile\+read_user\+write_repository\+api/);
  assert.match(calls[1].body, /device_code=device-code/);
  assert.equal(currentTime, 8000);
});

test("OAuth 凭据转换接受新 api scope 并保留实际授权结果", () => {
  const credential = credentialFromToken({
    access_token: "access",
    refresh_token: "refresh",
    token_type: "Bearer",
    scope: "api profile",
    expires_in: 3600,
  }, source, 1000);
  assert.deepEqual(credential.scope, ["api", "profile"]);
});

for (const [name, oauthError] of [
  ["拒绝", "access_denied"],
  ["过期", "expired_token"],
]) {
  test(`Device Flow 在授权${name}后停止轮询`, async () => {
    const responses = [
      jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-1234",
        verification_uri: "http://gitlab.example.test/oauth/device",
        expires_in: 60,
        interval: 1,
      }),
      jsonResponse({ error: oauthError }, 400),
    ];
    const client = new GitLabOAuthClient({
      fetch: async () => responses.shift(),
      sleep: async () => {},
    });
    await assert.rejects(() => client.loginWithDevice(source), (error) => (
      error.code === "PLUGIN_AUTH_FAILED" && error.message.includes(oauthError)
    ));
  });
}

test("Device Flow 支持 AbortSignal 取消", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new GitLabOAuthClient({
    fetch: async () => jsonResponse({
      device_code: "device-code",
      user_code: "ABCD-1234",
      verification_uri: "http://gitlab.example.test/oauth/device",
      expires_in: 60,
      interval: 1,
    }),
    sleep: async () => {},
  });
  await assert.rejects(
    () => client.loginWithDevice(source, { signal: controller.signal }),
    (error) => error.code === "PLUGIN_AUTH_FAILED" && error.message.includes("取消"),
  );
});

test("Device Flow 等待期间取消时不再发送 token 轮询", async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = new GitLabOAuthClient({
    fetch: async () => {
      calls += 1;
      return jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-1234",
        verification_uri: "http://gitlab.example.test/oauth/device",
        expires_in: 60,
        interval: 1,
      });
    },
    sleep: async () => { controller.abort(); },
  });
  await assert.rejects(
    () => client.loginWithDevice(source, { signal: controller.signal }),
    (error) => error.code === "PLUGIN_AUTH_FAILED" && error.message.includes("取消"),
  );
  assert.equal(calls, 1);
});

test("OAuth 请求超时后返回稳定认证错误", async () => {
  const client = new GitLabOAuthClient({
    requestTimeoutMs: 5,
    fetch: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(
    () => client.loginWithDevice(source),
    (error) => error.code === "PLUGIN_AUTH_FAILED" && error.message.includes("请求失败"),
  );
});

test("CredentialManager 对并发过期凭据只刷新一次", async () => {
  const store = new MemoryCredentialStore();
  await store.set(source, {
    schemaVersion: 1,
    sourceId: source.id,
    baseUrl: source.baseUrl,
    tokenType: "Bearer",
    scope: ["read_api", "read_repository"],
    accessToken: "expired",
    refreshToken: "refresh",
    expiresAt: 100,
  });
  let refreshes = 0;
  const manager = new GitLabCredentialManager({
    store,
    now: () => 1000,
    oauth: {
      refresh: async () => {
        refreshes += 1;
        await Promise.resolve();
        return {
          schemaVersion: 1,
          sourceId: source.id,
          baseUrl: source.baseUrl,
          tokenType: "Bearer",
          scope: ["read_api", "read_repository"],
          accessToken: "fresh",
          refreshToken: "next",
          expiresAt: 100000,
        };
      },
    },
  });
  assert.deepEqual(await Promise.all([
    manager.getAccessToken(source),
    manager.getAccessToken(source),
    manager.getAccessToken(source),
  ]), ["fresh", "fresh", "fresh"]);
  assert.equal(refreshes, 1);
});

test("CredentialManager 在无 Flower 凭据时复用同 host glab token", async () => {
  const store = new MemoryCredentialStore();
  const calls = [];
  const manager = new GitLabCredentialManager({
    store,
    oauth: {},
    runGlab: async (args) => {
      calls.push(args);
      return {
        stdout: "gitlab.example.test\n  ✓ Logged in to gitlab.example.test\n  ✓ Token: glab-token\n",
        stderr: "",
      };
    },
  });
  assert.equal(await manager.getAccessToken(source), "glab-token");
  assert.deepEqual(calls[0], ["auth", "status", "--hostname", "gitlab.example.test", "--show-token"]);
  assert.equal(await store.get(source), null);
});

test("CredentialManager 只接受同 host 绑定的环境 token fallback", async () => {
  const store = new MemoryCredentialStore();
  const manager = new GitLabCredentialManager({
    store,
    oauth: {},
    env: { GITLAB_TOKEN: "env-token", GITLAB_HOST: "https://gitlab.example.test/group/project" },
    runGlab: async () => { throw new Error("glab unavailable"); },
  });
  assert.equal(await manager.getAccessToken(source), "env-token");
  assert.equal(resolveGitLabEnvironmentCredential(source, {
    GITLAB_TOKEN: "wrong-token",
    GITLAB_HOST: "gitlab.other.test",
  }), null);
  assert.equal(parseGlabAuthStatusToken("gitlab.other.test\n  ✓ Token: leaked\n", source), null);
});

test("PKCE refresh 复用首次授权 redirect_uri", async () => {
  let body;
  let calls = 0;
  const client = new GitLabOAuthClient({
    now: () => 1000,
    fetch: async (_url, options) => {
      calls += 1;
      if (calls === 2) return jsonResponse({ scope: ["read_api", "read_repository"] });
      body = String(options.body);
      return jsonResponse({
        access_token: "fresh",
        refresh_token: "next",
        token_type: "Bearer",
        expires_in: 7200,
      });
    },
  });
  const credential = await client.refresh(source, {
    refreshToken: "refresh",
    redirectUri: "http://127.0.0.1:43123/oauth/callback",
  });
  assert.match(body, /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A43123%2Foauth%2Fcallback/);
  assert.equal(credential.redirectUri, "http://127.0.0.1:43123/oauth/callback");
});

test("scope 不完整时拒绝凭据，refresh 失败后清除旧凭据", async () => {
  const client = new GitLabOAuthClient({
    fetch: async (url) => String(url).endsWith("/oauth/token/info")
      ? jsonResponse({ scope: ["read_api"] })
      : jsonResponse({ access_token: "limited", refresh_token: "next", expires_in: 7200 }),
  });
  await assert.rejects(
    () => client.refresh(source, { refreshToken: "refresh", redirectUri: null }),
    (error) => error.code === "PLUGIN_AUTH_SCOPE_INVALID",
  );

  const store = new MemoryCredentialStore();
  await store.set(source, {
    schemaVersion: 1,
    sourceId: source.id,
    baseUrl: source.baseUrl,
    tokenType: "Bearer",
    scope: ["read_api", "read_repository"],
    accessToken: "expired",
    refreshToken: "refresh",
    expiresAt: 0,
  });
  const manager = new GitLabCredentialManager({
    store,
    now: () => 1000,
    oauth: { refresh: async () => { throw new Error("invalid refresh"); } },
  });
  await assert.rejects(
    () => manager.getAccessToken(source),
    (error) => error.code === "PLUGIN_AUTH_REQUIRED",
  );
  assert.equal(await store.get(source), null);
});
