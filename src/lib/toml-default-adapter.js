/** 为平台 TOML 配置补入缺失的布尔默认值，保留用户原文。 */

import { parse as parseToml, TomlError } from "smol-toml";

/**
 * 按顶层分隔符扫描语句，避开字符串、注释和容器中的伪键。
 *
 * @param {string} text 原始 TOML 文本或内联表正文
 * @param {string} [separator] 顶层语句分隔符
 * @returns {Array<object>} 带原始位置、有效正文和赋值位置的语句
 */
export function scanTomlStatements(text, separator = "\n") {
  const statements = [];
  const stack = [];
  let start = 0;
  let code = "";
  let equals = -1;
  let containerEnd = -1;
  let quote = "";
  let triple = false;
  let escaped = false;
  let comment = false;
  const finish = (end) => {
    if (code.trim()) statements.push({ start, end, code, equals, containerEnd });
    start = end + 1;
    code = "";
    equals = -1;
    containerEnd = -1;
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (comment) {
      if (character !== "\n") continue;
      comment = false;
    }
    if (quote) {
      if (escaped) {
        code += character;
        escaped = false;
      } else if (quote === '"' && character === "\\") {
        code += character;
        escaped = true;
      } else if (triple && text.slice(index, index + 3) === quote.repeat(3)) {
        // TOML 允许用四或五个引号结束多行字符串，尾部引号仍属于同一个值。
        let count = 3;
        while (count < 5 && text[index + count] === quote) count += 1;
        code += quote.repeat(count);
        index += count - 1;
        quote = "";
      } else {
        if (!triple && character === "\n") throw new Error("TOML 单行字符串未闭合");
        code += character;
        if (!triple && character === quote) quote = "";
      }
      continue;
    }
    if (character === "#") {
      comment = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      triple = text.slice(index, index + 3) === quote.repeat(3);
      code += triple ? quote.repeat(3) : character;
      if (triple) index += 2;
      continue;
    }
    if (character === "[" || character === "{") stack.push(character);
    if (character === "]" || character === "}") {
      const expected = character === "]" ? "[" : "{";
      if (stack.pop() !== expected) throw new Error("TOML 容器括号不匹配");
      if (stack.length === 0) containerEnd = index;
    }
    if (character === "=" && stack.length === 0 && equals === -1) equals = index - start;
    if (character === separator && stack.length === 0) finish(index);
    else code += character;
  }
  if (quote || stack.length) throw new Error("TOML 字符串或容器未闭合");
  finish(text.length);
  return statements;
}

/**
 * 解析裸键与常见引号键，不把引号中的点当成层级。
 *
 * @param {string} text TOML 键或 section 名
 * @returns {string[]} 语义路径；不能安全识别时抛出错误
 */
function keyPath(text) {
  const statements = scanTomlStatements(text, ".");
  if (!statements.length || statements[0].start !== 0 || statements.at(-1).end !== text.length
    || statements.some((item, index) => index > 0 && item.start !== statements[index - 1].end + 1)) {
    throw new Error("TOML key 包含空路径片段");
  }
  return statements.map(({ code }) => {
    const key = code.trim();
    if (/^[A-Za-z0-9_-]+$/.test(key)) return key;
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      try {
        return Object.keys(parseToml(`${key} = true`))[0];
      } catch {
        // 不猜测无法完整解码的 quoted key，避免写到错误的配置路径。
      }
    }
    throw new Error(`TOML key 无法安全解析:${key}`);
  });
}

/**
 * 在行边界补入文本，保留既有内容和 LF/CRLF 风格。
 *
 * @param {string} text 原始文本
 * @param {number} position 插入位置
 * @param {string} addition 待插入正文
 * @param {string} newline 目标行尾
 * @returns {string} 插入后的文本
 */
function insertLines(text, position, addition, newline) {
  const before = text.slice(0, position);
  return before + (before && !before.endsWith("\n") ? newline : "") + addition + newline + text.slice(position);
}

/**
 * 补入二级 TOML 布尔默认键；已有显式值保留，歧义与损坏结构失败关闭。
 *
 * @param {{value:string,operation:object,parseSectionHeader:Function}} context Patch 上下文
 * @returns {{value?:string,source?:string,error?:string}} 无写盘变换结果
 */
export function applyTomlDefaultBoolean({ value, operation, parseSectionHeader }) {
  try {
    if (operation.operation !== "replace") throw new Error("toml-default-boolean 只支持 replace");
    const parts = keyPath(operation.selector.path || "");
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
      throw new Error("toml-default-boolean path 必须是两级裸键");
    }
    const content = typeof operation.content === "string" ? JSON.parse(operation.content) : operation.content;
    if (!content || typeof content.value !== "boolean") throw new Error("TOML 默认值必须是布尔值");
    // 解析器只验证文档，不序列化用户内容；大整数也必须合法保留。
    const parsed = parseToml(value, { integersAsBigInt: true });
    const table = parsed[parts[0]];
    if (table !== undefined && (!table || typeof table !== "object" || Array.isArray(table))) {
      throw new Error(`TOML ${parts[0]} 必须是配置表`);
    }
    const explicit = table !== undefined && Object.hasOwn(table, parts[1]);
    if (explicit && typeof table[parts[1]] !== "boolean") {
      throw new Error(`TOML ${parts.join(".")} 必须是布尔值`);
    }
    const newline = value.includes("\r\n") ? "\r\n" : "\n";
    let updated = value;
    if (content.commentReplacements !== undefined && !Array.isArray(content.commentReplacements)) {
      throw new Error("TOML 注释替换必须是数组");
    }
    for (const replacement of content.commentReplacements || []) {
      if (typeof replacement.from !== "string" || !replacement.from || typeof replacement.to !== "string") {
        throw new Error("TOML 注释替换必须声明精确原文和目标文本");
      }
      if (![replacement.from, replacement.to].every((text) => text.split("\n").every((line) => line.startsWith("#")))) {
        throw new Error("TOML 注释替换只能修改完整注释行");
      }
      const from = replacement.from.replace(/\n/g, newline);
      const statements = scanTomlStatements(updated);
      const positions = [];
      let offset = 0;
      while (updated.indexOf(from, offset) !== -1) {
        const position = updated.indexOf(from, offset);
        // 同一模板也可能同时出现在多行示例和真实注释中；按语句位置排除字符串。
        const occupied = statements.some((item) => position < item.end && position + from.length > item.start);
        if (!occupied && (position === 0 || updated[position - 1] === "\n")) positions.push(position);
        offset = position + from.length;
      }
      if (positions.length > 1) throw new Error("TOML 待更新注释重复");
      if (positions.length === 1) {
        const position = positions[0];
        updated = updated.slice(0, position) + replacement.to.replace(/\n/g, newline)
          + updated.slice(position + from.length);
      }
    }
    const statements = scanTomlStatements(updated);
    let section = [];
    let featureHeader = null;
    let rootInline = null;
    let hasRootDotted = false;
    let firstHeader = updated.length;
    for (const statement of statements) {
      if (statement.code.trimStart().startsWith("[")) {
        const parsed = parseSectionHeader(statement.code);
        if (parsed.error) throw new Error(parsed.error);
        section = keyPath(parsed.header.name);
        firstHeader = Math.min(firstHeader, statement.start);
        if (section[0] !== parts[0]) continue;
        if (section.length === 1) {
          featureHeader = statement;
        }
        continue;
      }
      if (statement.equals < 0) throw new Error("TOML 语句缺少赋值符");
      const relative = keyPath(updated.slice(statement.start, statement.start + statement.equals));
      const path = [...section, ...relative];
      const raw = statement.code.slice(statement.equals + 1).trim();
      if (path.length === 1 && path[0] === parts[0]) {
        if (rootInline || !raw.startsWith("{") || !raw.endsWith("}")) {
          throw new Error(`TOML ${parts[0]} 必须是唯一配置表`);
        }
        rootInline = statement;
      } else {
        if (section.length === 0 && path[0] === parts[0]) hasRootDotted = true;
      }
    }
    if (!explicit) {
      const assignment = `${parts[1]} = ${content.value}`;
      if (rootInline) {
        const raw = rootInline.code.slice(rootInline.equals + 1).trim();
        const inner = raw.slice(1, -1).trim();
        const addition = `${inner && !inner.endsWith(",") ? ", " : " "}${assignment}`;
        updated = updated.slice(0, rootInline.containerEnd) + addition + updated.slice(rootInline.containerEnd);
      } else if (featureHeader) {
        const end = featureHeader.end + (updated[featureHeader.end] === "\n" ? 1 : 0);
        updated = insertLines(updated, end, assignment, newline);
      } else if (hasRootDotted) {
        updated = insertLines(updated, firstHeader, `${parts[0]}.${assignment}`, newline);
      } else {
        updated = insertLines(updated, updated.length, `[${parts[0]}]${newline}${assignment}`, newline);
      }
    }
    const result = parseToml(updated, { integersAsBigInt: true });
    if (result[parts[0]]?.[parts[1]] !== (explicit ? table[parts[1]] : content.value)) {
      throw new Error("TOML 默认值未落在目标配置路径");
    }
    // provenance 的来源类型必须跨首次写入和重复更新保持稳定。
    return { value: updated, source: "structured" };
  } catch (error) {
    if (error instanceof TomlError) {
      // 解析器默认错误带相邻原文；配置可能含凭证，只交付位置而不回显正文。
      return { error: `TOML 默认配置无法安全更新:语法错误（行 ${error.line}，列 ${error.column}）` };
    }
    return { error: `TOML 默认配置无法安全更新:${error.message}` };
  }
}
