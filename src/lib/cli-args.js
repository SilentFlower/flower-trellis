import path from "node:path";
import { DEFAULT_UPDATE_BACKUP_RETENTION } from "../constants.js";

/**
 * 解析 flower-trellis argv，分离自有参数与 Trellis 透传参数。
 *
 * @param {string[]} argv 不含 node 与入口脚本的参数列表
 * @param {string} cwd 解析相对目标路径时使用的当前目录
 * @returns {{command:string|null,ctx:object}} 子命令与执行上下文
 */
export function parseCliArgs(argv, cwd = process.cwd()) {
  let command = null;
  let enhance = true;
  let enhanceOnly = false;
  let variant = null;
  let target = cwd;
  let updateCheck = true;
  let backupRetention = DEFAULT_UPDATE_BACKUP_RETENTION;
  const skills = [];
  const passthrough = [];
  const forwarded = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      forwarded.push(...argv.slice(i + 1));
      if (command !== "self-update") {
        passthrough.push(...argv.slice(i + 1));
      }
      break;
    }
    // 第一个非 flag token 视为子命令。
    if (command === null && !a.startsWith("-")) {
      command = a;
      continue;
    }
    switch (a) {
      case "--no-enhance":
        enhance = false;
        break;
      case "--enhance-only":
        enhanceOnly = true;
        break;
      case "--skills": {
        const value = argv[++i] || "";
        skills.push(...value.split(/[,\s]+/).filter(Boolean));
        break;
      }
      case "--variant":
        variant = argv[++i] || null;
        break;
      case "--target":
        target = path.resolve(cwd, argv[++i] || ".");
        break;
      case "--no-update-check":
        updateCheck = false;
        break;
      case "--backup-retention": {
        const value = argv[i + 1];
        // 不吞掉后续普通 flag；负数仍作为本参数值交给 update 入口输出准确错误。
        if (value === undefined || value === "--" || (value.startsWith("-") && !/^-\d/.test(value))) {
          backupRetention = null;
        } else {
          backupRetention = value;
          i += 1;
        }
        break;
      }
      default:
        passthrough.push(a);
    }
  }

  return {
    command,
    ctx: {
      target: path.resolve(target),
      passthrough,
      enhance,
      enhanceOnly,
      skills,
      variant,
      updateCheck,
      backupRetention,
      forwarded,
    },
  };
}
