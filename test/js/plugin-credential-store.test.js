import assert from "node:assert/strict";
import test from "node:test";
import {
  isGitLabCredentialScopeSufficient,
  redactSensitive,
  validateCredential,
} from "../../src/plugin/auth/credential-store.js";
import { createCredentialStore } from "../../src/plugin/auth/keyring-credential-store.js";
import { MemoryCredentialStore } from "../../src/plugin/auth/memory-credential-store.js";

const source = { id: "rd-guide", baseUrl: "http://gitlab.example.test" };
const credential = {
  schemaVersion: 1,
  sourceId: "rd-guide",
  baseUrl: "http://gitlab.example.test",
  tokenType: "Bearer",
  scope: ["read_api", "read_repository"],
  accessToken: "access-value",
  refreshToken: "refresh-value",
  expiresAt: 123456,
};

test("Memory CredentialStore 版本化读写且返回副本", async () => {
  const store = new MemoryCredentialStore();
  await store.set(source, credential);
  const first = await store.get(source);
  first.scope.push("mutated");
  assert.deepEqual((await store.get(source)).scope, ["read_api", "read_repository"]);
  await store.delete(source);
  assert.equal(await store.get(source), null);
});

test("GitLab 凭据校验同时接受旧读取 scope 与新 api scope", () => {
  assert.equal(isGitLabCredentialScopeSufficient(["read_api", "read_repository"]), true);
  assert.equal(isGitLabCredentialScopeSufficient(["api"]), true);
  assert.equal(isGitLabCredentialScopeSufficient(["read_api"]), false);
  assert.deepEqual(validateCredential({
    ...credential,
    scope: ["api", "openid", "profile"],
    accessToken: "api-token",
  }, source).scope, ["api", "openid", "profile"]);
  assert.throws(
    () => validateCredential({ ...credential, scope: ["read_api"] }, source),
    (error) => error.code === "PLUGIN_AUTH_SCOPE_INVALID",
  );
});

test("Keyring 后端运行时不可用时只退回内存", async () => {
  class BrokenEntry {
    getPassword() { throw new Error("Secret Service unavailable"); }
    setPassword() { throw new Error("Secret Service unavailable"); }
    deletePassword() { throw new Error("Secret Service unavailable"); }
  }
  const bundle = await createCredentialStore({ loadKeyring: async () => ({ Entry: BrokenEntry }) });
  assert.equal(bundle.persistent, true);
  assert.equal(await bundle.store.get(source), null);
  assert.equal(bundle.persistent, false);
  await bundle.store.set(source, credential);
  assert.equal((await bundle.store.get(source)).accessToken, "access-value");
});

test("Keyring 凭据损坏时返回结构化错误且不静默降级", async () => {
  class CorruptEntry {
    getPassword() { return "{broken"; }
    setPassword() {}
    deletePassword() {}
  }
  const bundle = await createCredentialStore({ loadKeyring: async () => ({ Entry: CorruptEntry }) });
  await assert.rejects(
    () => bundle.store.get(source),
    (error) => error.code === "PLUGIN_AUTH_SCOPE_INVALID",
  );
  assert.equal(bundle.persistent, true);
});

test("敏感字段清理覆盖 token、Authorization、code 与嵌套值", () => {
  assert.deepEqual(redactSensitive({
    access_token: "a",
    headers: { Authorization: "Bearer a" },
    nested: [{ code: "oauth-code", message: "ok" }],
  }), {
    access_token: "[REDACTED]",
    headers: { Authorization: "[REDACTED]" },
    nested: [{ code: "[REDACTED]", message: "ok" }],
  });
});
