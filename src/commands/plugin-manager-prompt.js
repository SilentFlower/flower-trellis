import chalk from "chalk";
import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isTabKey,
  isUpKey,
  useKeypress,
  useMemo,
  usePagination,
  useState,
} from "@inquirer/core";

const ACCENT = "#ff6fb5";

/**
 * 截断终端列表中的长文本。
 *
 * @param {string} value 原始文本
 * @param {number} limit 最大字符数
 * @returns {string} 截断后的文本
 */
function truncate(value, limit) {
  const chars = [...String(value || "")];
  return chars.length <= limit ? chars.join("") : `${chars.slice(0, Math.max(1, limit - 1)).join("")}…`;
}

/**
 * 根据状态语义渲染低噪音状态文本。
 *
 * @param {string} label 标签文字
 * @param {"success"|"warning"|"error"|"info"|"muted"} [tone] 色调
 * @returns {string} 带颜色的标签
 */
function renderBadge(label, tone = "muted") {
  if (!label) return "";
  if (tone === "success") return chalk.green(`✓ ${label}`);
  if (tone === "warning") return chalk.yellow(`! ${label}`);
  if (tone === "error") return chalk.red(`! ${label}`);
  return chalk.gray(label);
}

/**
 * 返回一个页签内经过搜索过滤的条目。
 *
 * @param {object[]} items 原始条目
 * @param {string} query 搜索词
 * @returns {object[]} 可见条目
 */
function filterItems(items, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.searchable === false || [
    item.title,
    item.meta,
    item.description,
  ].some((value) => String(value || "").toLowerCase().includes(needle)));
}

/**
 * 找到列表中的首个可操作位置。
 *
 * @param {object[]} items 条目列表
 * @param {number} preferred 首选位置
 * @returns {number} 可操作位置
 */
function selectableIndex(items, preferred) {
  if (items.length === 0) return 0;
  const bounded = Math.max(0, Math.min(preferred, items.length - 1));
  if (!items[bounded]?.disabled) return bounded;
  const next = items.findIndex((item) => !item.disabled);
  return next === -1 ? 0 : next;
}

/**
 * 创建 Claude Code 风格的 Flower Plugin 页签管理 prompt。
 *
 * @param {{projectRoot:string,summary:string,tabs:Array<{id:string,label:string,count?:number}>,activeTab:string,itemsByTab:Record<string,object[]>,queries?:Record<string,string>,selectedByTab?:Record<string,string|null>,pageSize?:number}} config 管理器视图
 * @returns {Promise<{tab:string,action:string,queries:Record<string,string>,selectedByTab:Record<string,string|null>}>} 用户动作与恢复状态
 */
export const pluginManagerPrompt = createPrompt((config, done) => {
  const initialTab = Math.max(0, config.tabs.findIndex(({ id }) => id === config.activeTab));
  const initialSelected = Object.fromEntries(config.tabs.map(({ id }) => [id, config.selectedByTab?.[id] || null]));
  const [tabIndex, setTabIndex] = useState(initialTab);
  const [queries, setQueries] = useState({ ...config.queries });
  const [activeByTab, setActiveByTab] = useState(() => Object.fromEntries(config.tabs.map(({ id }) => {
    const items = config.itemsByTab[id] || [];
    const selected = initialSelected[id];
    const index = selected ? items.findIndex(({ value }) => value === selected) : 0;
    return [id, Math.max(0, index)];
  })));
  const [selectedByTab, setSelectedByTab] = useState(initialSelected);
  const tab = config.tabs[tabIndex];
  const query = queries[tab.id] || "";
  const items = useMemo(
    () => filterItems(config.itemsByTab[tab.id] || [], query),
    [config.itemsByTab, query, tab.id],
  );
  const active = selectableIndex(items, activeByTab[tab.id] || 0);
  const selected = items[active] || null;

  useKeypress((key) => {
    const switchTab = (offset) => {
      const next = (tabIndex + offset + config.tabs.length) % config.tabs.length;
      setTabIndex(next);
    };
    if (isTabKey(key) || key.name === "right") {
      switchTab(key.shift ? -1 : 1);
      return;
    }
    if (key.name === "left") {
      switchTab(-1);
      return;
    }
    if (isUpKey(key) || isDownKey(key)) {
      if (items.length === 0) return;
      const offset = isUpKey(key) ? -1 : 1;
      let next = active;
      do {
        next = (next + offset + items.length) % items.length;
      } while (items[next]?.disabled && next !== active);
      setActiveByTab({ ...activeByTab, [tab.id]: next });
      if (items[next] && !items[next].disabled) {
        setSelectedByTab({ ...selectedByTab, [tab.id]: items[next].value });
      }
      return;
    }
    if (isEnterKey(key)) {
      if (!selected || selected.disabled) return;
      done({
        tab: tab.id,
        action: selected.value,
        queries,
        selectedByTab: { ...selectedByTab, [tab.id]: selected.value },
      });
      return;
    }
    if (key.name === "escape") {
      if (query) {
        setQueries({ ...queries, [tab.id]: "" });
        return;
      }
      done({
        tab: tab.id,
        action: "exit",
        queries,
        selectedByTab,
      });
      return;
    }
    if (isBackspaceKey(key)) {
      setQueries({ ...queries, [tab.id]: query.slice(0, -1) });
      setActiveByTab({ ...activeByTab, [tab.id]: 0 });
      return;
    }
    if (key.name === "space") {
      setQueries({ ...queries, [tab.id]: `${query} ` });
      setActiveByTab({ ...activeByTab, [tab.id]: 0 });
      return;
    }
    if (!key.ctrl && key.name?.length === 1) {
      setQueries({ ...queries, [tab.id]: `${query}${key.name}` });
      setActiveByTab({ ...activeByTab, [tab.id]: 0 });
    }
  });

  const tabBar = config.tabs.map((entry, index) => {
    const count = Number.isInteger(entry.count) ? chalk.dim(` ${entry.count}`) : "";
    return index === tabIndex
      ? `${chalk.hex(ACCENT).bold(`● ${entry.label}`)}${count}`
      : `${chalk.gray(`  ${entry.label}`)}${count}`;
  }).join("   ");
  const page = usePagination({
    items,
    active,
    pageSize: config.pageSize || 10,
    loop: true,
    renderItem({ item, isActive }) {
      const cursor = isActive ? chalk.hex(ACCENT).bold("❯") : " ";
      const badge = renderBadge(item.badge || "", item.tone);
      const title = isActive ? chalk.bold(item.title) : item.title;
      const prefix = badge ? `${badge}  ` : "";
      const meta = item.meta ? chalk.dim(`  ${truncate(item.meta, 40)}`) : "";
      const row = `${cursor} ${prefix}${truncate(title, 46)}${meta}`;
      return item.disabled ? chalk.dim(row) : row;
    },
  });
  const selectedDescription = selected?.description
    ? selected.disabled
      ? chalk.dim(`  ${truncate(selected.description, 96)}`)
      : `${chalk.hex(ACCENT)("│")} ${truncate(selected.description, 96)}`
    : chalk.dim("  选择一个条目查看详情");
  const search = ["discover", "installed"].includes(tab.id)
    ? `${chalk.hex(ACCENT)("搜索")}  ${query || chalk.dim("输入名称、描述或来源")}`
    : chalk.dim(tab.id === "issues" ? "操作异常会集中显示在这里" : "Marketplace 与 GitLab 登录");
  const header = [
    chalk.hex(ACCENT).bold("Flower Plugin"),
    chalk.dim(config.projectRoot),
    "",
    tabBar,
    chalk.dim("─".repeat(72)),
    search,
  ].join("\n");
  const footer = chalk.dim("↑↓ 选择   Enter 打开   Tab 切换   Esc 退出");
  return `${header}\n\n${page}\n\n${selectedDescription}\n\n${footer}`;
});

/**
 * 渲染详情页中的状态事实。
 *
 * @param {{label:string,value:string,tone?:"success"|"warning"|"error"|"muted"}} fact 状态事实
 * @returns {string} 状态文本
 */
function renderFact(fact) {
  const value = `${fact.label} ${fact.value}`;
  if (fact.tone === "success") return chalk.green(`● ${value}`);
  if (fact.tone === "warning") return chalk.yellow(`● ${value}`);
  if (fact.tone === "error") return chalk.red(`● ${value}`);
  return chalk.gray(`● ${value}`);
}

/**
 * 创建与主管理器一致的详情动作 prompt。
 *
 * @param {{projectRoot:string,eyebrow:string,title:string,subtitle?:string,facts?:Array<{label:string,value:string,tone?:string}>,choices:Array<{name:string,value:string,description?:string,section?:string,icon?:string,tone?:"normal"|"primary"|"warning"|"danger"}>,pageSize?:number}} config 详情页视图
 * @returns {Promise<string>} 用户选择的动作
 */
export const pluginActionPrompt = createPrompt((config, done) => {
  const [active, setActive] = useState(0);
  const choices = config.choices;
  const selected = choices[active];

  useKeypress((key) => {
    if (isUpKey(key) || isDownKey(key)) {
      const offset = isUpKey(key) ? -1 : 1;
      setActive((active + offset + choices.length) % choices.length);
      return;
    }
    if (isEnterKey(key)) {
      done(selected.value);
      return;
    }
    if (key.name === "escape" || key.name === "left") done("back");
  });

  const page = usePagination({
    items: choices,
    active,
    pageSize: config.pageSize || 12,
    loop: true,
    renderItem({ item, index, isActive }) {
      const previous = choices[index - 1];
      const section = item.section && item.section !== previous?.section
        ? `${index > 0 ? "\n" : ""}${chalk.dim(item.section.toUpperCase())}\n`
        : "";
      const cursor = isActive ? chalk.hex(ACCENT).bold("❯") : " ";
      const icon = item.icon || (item.tone === "danger" ? "!" : "•");
      let label = `${icon}  ${item.name}`;
      if (item.tone === "primary") label = chalk.hex(ACCENT)(label);
      else if (item.tone === "warning") label = chalk.yellow(label);
      else if (item.tone === "danger") label = chalk.red(label);
      else if (!isActive) label = chalk.gray(label);
      if (isActive) label = chalk.bold(label);
      return `${section}${cursor} ${label}`;
    },
  });
  const facts = (config.facts || []).map(renderFact).join(chalk.dim("    "));
  const description = selected?.description
    ? `${chalk.hex(ACCENT)("│")} ${truncate(selected.description, 96)}`
    : chalk.dim("  选择一个操作");
  const headerLines = [
    `${chalk.hex(ACCENT).bold("Flower Plugin")}  ${chalk.dim(`› ${config.eyebrow}`)}`,
    chalk.dim(config.projectRoot),
    "",
    chalk.bold(config.title),
  ];
  if (config.subtitle) headerLines.push(chalk.dim(config.subtitle));
  if (facts) headerLines.push("", facts);
  headerLines.push(chalk.dim("─".repeat(72)));
  const header = headerLines.join("\n");
  const footer = chalk.dim("↑↓ 选择   Enter 确认   Esc 返回");
  return `${header}\n\n${page}\n\n${description}\n\n${footer}`;
});
