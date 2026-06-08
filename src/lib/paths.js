import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 包内路径定位。
 *
 * ESM 没有 __dirname,统一用 import.meta.url 推导。本文件位于 <pkg>/src/lib/,
 * 故包根是其上两级目录。
 */
const here = path.dirname(fileURLToPath(import.meta.url)); // .../src/lib

/** flower-trellis 包根目录。 */
export const PKG_ROOT = path.resolve(here, "..", "..");

/** 随包发布的强化包快照根目录(由 scripts/sync-enhancements.mjs 生成)。 */
export const ENHANCEMENTS_ROOT = path.join(PKG_ROOT, "enhancements");
