// scripts/check-output-templates.mjs
//
// 守卫 skill 对话内输出模板的 Markdown 渲染契约。
//
// 背景:skill 的 ```markdown 代码块定义的是"要展示给用户看"的输出形态。若模板里写成
// 连续裸段落行,GFM 会把段落内的软换行折叠成空格,渲染后多个字段糊成一整段;Claude Code
// 的终端渲染器同样如此。此类缺陷在源码中完全看不出来,只有渲染后才暴露,因此需要静态守卫。
//
// 检测四类缺陷:
//   1. bare-paragraph —— markdown 块内连续 >= 2 行裸段落,渲染后折叠成一段
//   2. bullet-char    —— 用 `•` 冒充列表项,Markdown 不识别该字符,整块折叠
//   3. yaml-block     —— bare-paragraph 的特化:内容是 YAML 结构却未包进代码块,缩进塌陷
//   4. list-borne-finding —— 语义级:重复编号条目用列表项承载,渲染器压平后相邻条目糊成一段
//
// 用法:
//   node scripts/check-output-templates.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PKG_ROOT } from "../src/lib/paths.js";

// 只守当前维护版本 0.6。0.5 与 old 是冻结的历史强化包,不再接受排版改动;
// 纳入检测只会让 npm test 因历史包袱长期变红,失去守卫意义。
const GUARDED_VARIANT = "0.6";

// 真源优先。CI 未拉 submodule 时回退到已提交的 enhancements 快照,与 sync-enhancements.mjs 的
// 幂等策略保持一致。
const SOURCE_ROOTS = [
  path.join(PKG_ROOT, "vendor", "skill-garden", ".trellis", GUARDED_VARIANT),
  path.join(PKG_ROOT, "enhancements", GUARDED_VARIANT),
];

// 豁免项:模板描述的是写入产物文件的内容结构,不会展示到对话里,不受渲染契约约束。
// 用「文件后缀 + 首行前缀」定位而非行号,避免文件增删行后豁免失效。
const ALLOWLIST = [
  {
    file: "trellis-extract-prd/SKILL.md",
    startsWith: "<按原始文档的子结构组织",
    reason: "prd.md 产物文件的内容结构,非对话输出",
  },
];

/**
 * 解析单个文档,收集其 ```markdown 输出模板中的排版缺陷。
 *
 * 逐行状态机跟踪三层结构:文档正文、markdown 模板块、模板块内的嵌套代码块。
 * 只有处于 markdown 模板块且不在嵌套代码块内的行才参与判定 —— 嵌套代码块(如 ```yaml)
 * 内的内容会被渲染器原样保留,不存在折叠问题。
 *
 * @param {string} filePath 待检查文档的绝对路径
 * @param {string} relPath 用于报告的相对路径
 * @returns {Array<{file: string, line: number, kind: string, lines: string[]}>} 缺陷列表
 */
export function scanDocument(filePath, relPath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const findings = [];
  let inTemplate = false;
  let templateFence = 0;
  let nestedFence = 0;
  let run = [];

  const flushRun = () => {
    // 单行裸段落前后有空行,渲染时自成一段,不会折叠;只有连续两行以上才是缺陷。
    if (run.length >= 2) {
      const texts = run.map((item) => item.text);
      // YAML 特征:首行以冒号结尾,后续至少一行是缩进的 key: value。
      const looksLikeYaml = /:\s*$/.test(texts[0]) &&
        run.slice(1).some((item) => /^\s+\S+:/.test(item.raw));
      findings.push({
        file: relPath,
        line: run[0].line,
        kind: looksLikeYaml ? "yaml-block" : "bare-paragraph",
        lines: texts,
      });
    }
    run = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    const fence = raw.match(/^\s*(`{3,})(\S*)/);

    if (fence) {
      const width = fence[1].length;
      const lang = fence[2];
      if (!inTemplate) {
        if (lang === "markdown") {
          inTemplate = true;
          templateFence = width;
          nestedFence = 0;
          run = [];
        }
        continue;
      }
      if (nestedFence) {
        // 收尾 fence 不带语言标记,且宽度不小于开启它的 fence。
        if (width >= nestedFence && !lang) nestedFence = 0;
        continue;
      }
      if (width >= templateFence && !lang) {
        flushRun();
        inTemplate = false;
      } else {
        flushRun();
        nestedFence = width;
      }
      continue;
    }

    if (!inTemplate || nestedFence) continue;

    if (!raw.trim()) {
      flushRun();
      continue;
    }

    if (/^\s*•/.test(raw)) {
      flushRun();
      findings.push({
        file: relPath,
        line: lineNo,
        kind: "bullet-char",
        lines: [raw.trim()],
      });
      continue;
    }

    // 语义级检测:重复编号条目(如 `CHK-001`)用列表项承载,且下挂嵌套字段子项。
    // 这类写法在源码里语法完全合法 —— 前三类检测全部放行 —— 但终端渲染器会把松散列表
    // 压平,相邻条目之间的空行消失,多个问题糊成一整段无法分辨。必须改用标题承载条目,
    // 标题是块级元素,渲染器会稳定给出加粗与上下留白。
    //
    // 匹配面必须覆盖所有等价写法,否则守卫只锁住当前这一种历史形态,换个写法就能绕过:
    // 无序/有序列表标记、可选 task checkbox、可选加粗包裹、ID 反引号可有可无。
    const idItem = raw.match(
      /^(\s*)(?:[-*+]|\d+[.)])\s*(?:\[[ x]\]\s*)?(?:\*\*)?`?([A-Z][A-Z0-9]*-\d+)`?/,
    );
    if (idItem) {
      const indent = idItem[1].length;
      // 向后找第一个非空行:若它是更深缩进的列表项,说明该条目下挂了字段子项。
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      const nested = j < lines.length ? lines[j].match(/^(\s*)-\s/) : null;
      if (nested && nested[1].length > indent) {
        flushRun();
        findings.push({
          file: relPath,
          line: lineNo,
          kind: "list-borne-finding",
          lines: [raw.trim()],
        });
        continue;
      }
    }

    // 块级元素开头的行本身就是独立块,不会与相邻行折叠。
    if (/^\s*([-*+>|#]|\d+[.)])/.test(raw)) {
      flushRun();
      continue;
    }

    run.push({ line: lineNo, text: raw.trim(), raw });
  }

  flushRun();
  return findings;
}

/** 判断某条缺陷是否命中豁免名单。 */
function isAllowed(finding) {
  return ALLOWLIST.some(
    (item) =>
      finding.file.endsWith(item.file) &&
      finding.lines[0].startsWith(item.startsWith),
  );
}

/** 递归列出目录下的所有 Markdown 文档。 */
function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * 扫描守卫范围内的全部 skill 文档。
 *
 * @returns {{root: string, findings: object[], scanned: number}} 使用的源根、缺陷列表与扫描文档数
 */
export function collectOutputTemplateFindings() {
  const root = SOURCE_ROOTS.find((candidate) => fs.existsSync(candidate));
  if (!root) {
    throw new Error(
      `找不到 ${GUARDED_VARIANT} 强化包源:请执行 git submodule update --init --recursive`,
    );
  }
  // .claude 与 .agents 两份副本内容相同,由 sync 与 check-snapshot 保证一致,只扫 .claude 即可。
  const skillsRoot = path.join(root, ".claude", "skills");
  const files = listMarkdown(skillsRoot);
  const findings = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    findings.push(...scanDocument(file, rel).filter((item) => !isAllowed(item)));
  }
  return { root, findings, scanned: files.length };
}

const KIND_HINT = {
  "bare-paragraph": "连续裸段落行会折叠成一段,改用 `- **字段**：值` 列表项",
  "bullet-char": "`•` 不是 Markdown 列表标记,改用 `- `",
  "yaml-block": "YAML 结构需包进 ```yaml 代码块,否则缩进塌陷",
  "list-borne-finding":
    "带嵌套字段的编号条目会被渲染器压平糊成一段,改用 `#### `<ID>`` 标题承载",
};

function printFindings(findings, scanned) {
  console.log(`输出模板渲染契约:已扫描 ${scanned} 个 skill 文档`);
  if (!findings.length) {
    console.log("  ok  未发现折叠风险");
    return;
  }
  for (const item of findings) {
    console.log(
      `  ${item.kind.padEnd(20)} ${item.file}:${item.line}  ${item.lines.length} 行`,
    );
    console.log(`      ${item.lines[0].slice(0, 76)}`);
    console.log(`      → ${KIND_HINT[item.kind]}`);
  }
}

function main() {
  const { findings, scanned } = collectOutputTemplateFindings();
  printFindings(findings, scanned);
  if (findings.length) {
    console.error(`输出模板渲染契约检查失败:${findings.length} 处待修复`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`输出模板检查失败:${error.message}`);
    process.exitCode = 1;
  }
}
