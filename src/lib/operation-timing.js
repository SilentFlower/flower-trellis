import { performance } from "node:perf_hooks";

/**
 * 开始一个本地诊断阶段；父阶段包含子阶段，不能相加作为总耗时。
 * @param {string} scope 固定操作名，不得传入用户路径或参数
 * @param {string} stage 固定阶段名
 * @param {{env?:object,output?:{write:Function},now?:Function}} [options] 运行环境与测试替身
 * @returns {(success?:boolean)=>void} 幂等结束函数
 */
export function beginOperationTiming(scope, stage, options = {}) {
  if ((options.env || process.env).FLOWER_TIMING !== "1") return () => {};
  const output = options.output || process.stderr;
  const now = options.now || (() => performance.now());
  const started = now();
  let finished = false;
  const write = (message) => {
    try { output.write(message); } catch { /* 诊断流失效不能影响升级结果。 */ }
  };
  write(`  · [耗时 ${scope}/${stage}] 开始\n`);
  return (success = true) => {
    if (finished) return;
    finished = true;
    write(`  · [耗时 ${scope}/${stage}] ${success ? "完成" : "失败"} ${Math.max(0, Math.round(now() - started))} ms\n`);
  };
}

/**
 * 计时同步或异步操作，保留返回值、退出码和原始异常。
 * @template T
 * @param {string} scope 固定操作名
 * @param {string} stage 固定阶段名
 * @param {()=>T} operation 原操作
 * @param {object} [options] 计时依赖
 * @returns {T} 原操作的返回值
 */
export function timeOperation(scope, stage, operation, options = {}) {
  const finish = beginOperationTiming(scope, stage, options);
  const complete = (value) => {
    const code = typeof value === "number" ? value : value?.status;
    finish(value !== null && value?.ok !== false && !value?.error && !value?.signal && (typeof code !== "number" || code === 0));
    return value;
  };
  const fail = (error) => { finish(false); throw error; };
  try {
    const result = operation();
    return result && typeof result.then === "function" ? result.then(complete, fail) : complete(result);
  } catch (error) {
    return fail(error);
  }
}
