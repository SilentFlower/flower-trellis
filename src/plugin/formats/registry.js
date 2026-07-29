import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { assertSourceRoot } from "../sources/package-reader.js";
import { compareUtf8 } from "../stable-order.js";
import { DEFAULT_FORMAT_ADAPTERS } from "./adapters.js";
import { SOURCE_FORMATS } from "./constants.js";

/**
 * 外部 Plugin 格式 Adapter 注册表。
 */
export class PluginFormatRegistry {
  /**
   * 创建格式注册表。
   *
   * @param {object[]} [adapters] 格式 Adapter
   */
  constructor(adapters = DEFAULT_FORMAT_ADAPTERS) {
    this.adapters = new Map();
    for (const adapter of adapters) {
      if (!adapter?.format || typeof adapter.detect !== "function") {
        throw new TypeError("Plugin 格式 Adapter 必须声明 format 和 detect()");
      }
      if (this.adapters.has(adapter.format)) throw new TypeError(`Plugin 格式 Adapter 重复:${adapter.format}`);
      this.adapters.set(adapter.format, adapter);
    }
  }

  /**
   * 检测目录中的全部格式入口。
   *
   * @param {string} root 仓库快照根
   * @param {{format?:string}} [options] 格式过滤
   * @returns {object[]} 稳定检测结果
   */
  detect(root, options = {}) {
    const format = options.format || "auto";
    if (!SOURCE_FORMATS.includes(format)) throw new TypeError(`未知 Plugin 格式:${format}`);
    const sourceRoot = assertSourceRoot(root, "外部 Plugin 快照");
    const adapters = format === "auto"
      ? [...this.adapters.values()]
      : [this.adapters.get(format)].filter(Boolean);
    return adapters.flatMap((adapter) => adapter.detect(sourceRoot))
      .sort((left, right) => compareUtf8(
        `${left.format}\0${left.kind}\0${left.entryPath}`,
        `${right.format}\0${right.kind}\0${right.entryPath}`,
      ));
  }

  /**
   * 断言检测结果唯一。
   *
   * @param {object[]} detections 检测结果
   * @returns {object} 唯一结果
   */
  selectSingle(detections) {
    if (detections.length === 0) {
      throw new PluginRuntimeError("仓库中未识别到受支持的 Plugin 或 Skill", {
        code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNRECOGNIZED,
      });
    }
    if (detections.length > 1) {
      throw new PluginRuntimeError("仓库中存在多个 Plugin 格式入口，需要显式选择", {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_AMBIGUOUS,
        details: {
          detections: detections.map(({ format, kind, entryPath, displayName }) => ({
            format,
            kind,
            entryPath,
            displayName,
          })),
        },
      });
    }
    return detections[0];
  }

  /**
   * 把检测结果规范化为标准 Flower package。
   *
   * @param {object} selected 检测结果
   * @param {object} context 规范化上下文
   * @returns {object} 标准包
   */
  normalize(selected, context) {
    if (selected.kind !== "plugin") {
      throw new PluginRuntimeError(`Marketplace 入口不能直接规范化为单 Plugin:${selected.entryPath}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
        path: selected.entryPath,
      });
    }
    const adapter = this.adapters.get(selected.format);
    if (!adapter || typeof adapter.normalize !== "function") {
      throw new PluginRuntimeError(`格式暂不需要或不支持规范化:${selected.format}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
        path: selected.entryPath,
      });
    }
    return adapter.normalize(selected, context);
  }
}
