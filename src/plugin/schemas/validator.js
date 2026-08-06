import Ajv from "ajv";
import { PluginSchemaError } from "../errors.js";
import {
  isCanonicalPluginId,
  isGitCommit,
  isGitHubRepository,
  isGitLabProjectPath,
  isPluginId,
  isSafePosixRelativePath,
  isSemVerRange,
  isSha256Digest,
  isStrictSemVer,
} from "./shared.js";

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat("plugin-id", { type: "string", validate: isPluginId });
ajv.addFormat("canonical-plugin-id", { type: "string", validate: isCanonicalPluginId });
ajv.addFormat("semver", { type: "string", validate: isStrictSemVer });
ajv.addFormat("semver-range", { type: "string", validate: isSemVerRange });
ajv.addFormat("posix-relative-path", { type: "string", validate: isSafePosixRelativePath });
ajv.addFormat("sha256", { type: "string", validate: isSha256Digest });
ajv.addFormat("git-commit", { type: "string", validate: isGitCommit });
ajv.addFormat("gitlab-project", { type: "string", validate: isGitLabProjectPath });
ajv.addFormat("github-repository", { type: "string", validate: isGitHubRepository });

/**
 * 把 Ajv instancePath 转为稳定 JSON Pointer。
 *
 * @param {object} error Ajv 错误
 * @returns {string} issue JSON Pointer
 */
function issuePath(error) {
  let result = error.instancePath || "";
  if (error.keyword === "required" && error.params?.missingProperty) {
    result += `/${String(error.params.missingProperty).replaceAll("~", "~0").replaceAll("/", "~1")}`;
  } else if (error.keyword === "additionalProperties" && error.params?.additionalProperty) {
    result += `/${String(error.params.additionalProperty).replaceAll("~", "~0").replaceAll("/", "~1")}`;
  }
  return result || "/";
}

/**
 * 创建附带稳定错误结构的 schema validator。
 *
 * Ajv 编译一份 schema 需要数十毫秒，而单条命令通常只用到其中一两份。
 * 这里把 `ajv.compile` 推迟到首次校验，让只读命令不必为用不到的 schema 付启动开销。
 *
 * @param {object} schema JSON Schema
 * @param {string} label schema 展示名称
 * @param {(value:unknown)=>Array<{code:string,path:string,message:string}>} [semanticValidator] 结构校验后的语义校验
 * @returns {(value:unknown)=>unknown} validator
 */
export function createSchemaValidator(schema, label, semanticValidator) {
  let validate = null;
  return (value) => {
    if (!validate) validate = ajv.compile(schema);
    const valid = validate(value);
    const issues = valid
      ? []
      : (validate.errors || []).map((error) => ({
          code: `schema.${error.keyword}`,
          path: issuePath(error),
          message: error.message || "schema 校验失败",
        }));
    if (valid && semanticValidator) issues.push(...semanticValidator(value));
    if (issues.length > 0) {
      throw new PluginSchemaError(`${label} 校验失败`, { issues });
    }
    return value;
  };
}

/**
 * 创建语义校验 issue。
 *
 * @param {string} code 稳定 issue code
 * @param {string} path JSON Pointer
 * @param {string} message 错误说明
 * @returns {{code:string,path:string,message:string}} issue
 */
export function schemaIssue(code, path, message) {
  return { code, path, message };
}
