import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PluginPathError, PluginSchemaError } from "../../src/plugin/errors.js";
import { stringifyCanonicalJson } from "../../src/plugin/integrity/canonical-json.js";
import {
  hashCanonicalTree,
  listCanonicalTreeFiles,
  listVolatileTreeEntries,
} from "../../src/plugin/integrity/canonical-tree.js";
import { hashDirectoryIfExists } from "../../src/plugin/install/content-hash.js";

function createTree(t, entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-plugin-tree-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of entries) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

test("Canonical JSON 递归排序对象键但保留数组顺序", () => {
  const first = stringifyCanonicalJson({ z: 1, nested: { b: true, a: null }, values: [2, 1] });
  const second = stringifyCanonicalJson({ values: [2, 1], nested: { a: null, b: true }, z: 1 });
  assert.equal(first, second);
  assert.notEqual(first, stringifyCanonicalJson({ z: 1, nested: { b: true, a: null }, values: [1, 2] }));
  assert.equal(first.endsWith("\n"), true);
});

test("Canonical JSON 拒绝 undefined、非有限数字和循环引用", () => {
  assert.throws(() => stringifyCanonicalJson({ value: undefined }), PluginSchemaError);
  assert.throws(() => stringifyCanonicalJson({ value: Number.NaN }), PluginSchemaError);
  const circular = {};
  circular.self = circular;
  assert.throws(() => stringifyCanonicalJson(circular), /循环引用/);
});

test("Canonical tree hash 不依赖根目录和创建顺序", (t) => {
  const first = createTree(t, [
    ["skills/review/SKILL.md", "review\n"],
    [".flower-plugin/plugin.json", "{}\n"],
  ]);
  const second = createTree(t, [
    [".flower-plugin/plugin.json", "{}\n"],
    ["skills/review/SKILL.md", "review\n"],
  ]);
  assert.equal(hashCanonicalTree(first), hashCanonicalTree(second));
  assert.deepEqual(
    listCanonicalTreeFiles(first).map((entry) => entry.path),
    [".flower-plugin/plugin.json", "skills/review/SKILL.md"],
  );

  fs.writeFileSync(path.join(second, "skills/review/SKILL.md"), "changed\n");
  assert.notEqual(hashCanonicalTree(first), hashCanonicalTree(second));
});

test("Canonical tree 拒绝根目录和内部软链", (t) => {
  const outside = createTree(t, [["outside.txt", "outside\n"]]);
  const root = createTree(t, [["inside.txt", "inside\n"]]);
  fs.symlinkSync(path.join(outside, "outside.txt"), path.join(root, "link.txt"));
  assert.throws(() => hashCanonicalTree(root), PluginPathError);

  const linkedRoot = path.join(os.tmpdir(), `flower-plugin-root-link-${process.pid}-${Date.now()}`);
  fs.symlinkSync(root, linkedRoot, "dir");
  t.after(() => fs.rmSync(linkedRoot, { force: true }));
  assert.throws(() => hashCanonicalTree(linkedRoot), /根目录不能是软链/);
});

test("Canonical tree 拒绝特殊文件", { skip: process.platform === "win32" }, async (t) => {
  const root = createTree(t, [["inside.txt", "inside\n"]]);
  const socketPath = path.join(root, "runtime.sock");
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  try {
    assert.throws(() => hashCanonicalTree(root), /不允许特殊文件/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("包完整性严格计入字节码缓存，安装态目录摘要忽略它", (t) => {
  const clean = createTree(t, [["scripts/self_check.py", "print(1)\n"]]);
  const cached = createTree(t, [["scripts/self_check.py", "print(1)\n"]]);
  const cleanIntegrity = hashCanonicalTree(clean);
  assert.equal(hashDirectoryIfExists(cached), cleanIntegrity);

  fs.mkdirSync(path.join(cached, "scripts", "__pycache__"));
  fs.writeFileSync(path.join(cached, "scripts/__pycache__/self_check.cpython-312.pyc"), "cache");
  fs.writeFileSync(path.join(cached, "scripts/stray.pyc"), "cache");

  // 供应链完整性必须保持严格：多出的文件仍然改变包摘要。
  assert.notEqual(hashCanonicalTree(cached), cleanIntegrity);
  // 安装态漂移判定忽略运行时产物，未被用户修改的目录不得被判成漂移。
  assert.equal(hashDirectoryIfExists(cached), cleanIntegrity);
  assert.deepEqual(
    listCanonicalTreeFiles(cached, { ignoreVolatile: true }).map((entry) => entry.path),
    ["scripts/self_check.py"],
  );
  assert.deepEqual(
    listVolatileTreeEntries(cached),
    [
      path.join(cached, "scripts", "__pycache__"),
      path.join(cached, "scripts", "stray.pyc"),
    ].sort(),
  );

  // 真实内容变化仍然必须被安装态摘要捕获。
  fs.writeFileSync(path.join(cached, "scripts/self_check.py"), "print(2)\n");
  assert.notEqual(hashDirectoryIfExists(cached), cleanIntegrity);
});
