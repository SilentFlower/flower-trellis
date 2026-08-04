const addBangNotes = require("conventional-changelog-conventionalcommits/add-bang-notes");

const types = [
  { type: "feat", section: "✨ 新功能 Features" },
  { type: "fix", scope: "release", hidden: true },
  { type: "fix", section: "🐛 修复 Bug Fixes" },
  { type: "perf", section: "⚡ 性能 Performance" },
  { type: "refactor", section: "♻️ 重构 Refactor" },
  { type: "docs", section: "📝 文档 Docs" },
  { type: "chore", scope: "trellis", section: "🧰 维护 Maintenance" },
  { type: "chore", hidden: true },
  { type: "style", hidden: true },
  { type: "test", hidden: true },
  { type: "ci", hidden: true },
  { type: "build", hidden: true },
];

const localizedSubjects = new Map([
  ["d20b417", "将 Workflow Gate 原生融入 Trellis 全流程"],
  ["b8dd135", "修复 Gate 迁移后的流程入口与跨平台兼容问题"],
  ["268140a", "新增自动任务循环 runner"],
  ["add task runner enhancement", "新增自动任务循环 runner"],
  ["e05c3cf", "升级捆绑 Trellis 到 0.6.5，并修复 route_state.py 状态清理"],
  [
    "upgrade bundled trellis to 0.6.5",
    "升级捆绑 Trellis 到 0.6.5，并修复 route_state.py 状态清理",
  ],
  ["afa9282", "精简 route state helper 默认输出"],
  ["reduce route state helper output", "精简 route state helper 默认输出"],
  ["cc98c02", "项目侧待更新提示会显示对应版本更新摘要"],
  ["c4e83ab", "同步项目 Flower 版本状态"],
  ["update flower manifest to 0.5.0-beta.1", "同步项目 Flower 版本状态"],
  ["d8a3dcd", "首次实现默认检查，连续调整可暂缓后续 Check-All"],
  ["74d5d12", "防止 Python 写入失败导致任务与 session 状态漂移"],
  ["32ec993", "新增插件能力授权策略"],
  ["3688744", "新增 GitLab 市场外部来源"],
  ["0d7c5b1", "新增插件运行时生命周期"],
  ["2e9fd18", "迁移 skill-garden 到插件运行时"],
  ["f79ce33", "执行 Flower 自更新同步"],
  ["ef1a8c4", "拆分 Check-All 检查档位并同步快照"],
  ["5397204", "将匿名遥测上报默认超时延长至 10 秒"],
  ["8b48a5c", "同步 Check-All fact-status 文档修复规则"],
  ["5af8e7a", "新增 linked worktree 入口准备能力"],
  ["b1df949", "新增对话内 Flower 手动升级入口"],
]);

const detailedReleaseSubjects = new Map([
  [
    "d20b417",
    {
      order: 0,
      details: [
        "将请求路由、任务规划、质量检查、提交发布、auto-loop 与进度恢复等 13 个 Workflow Gate 收敛到对应的原生 phase、state、skill、hook 或 helper。",
        "Workflow Hub 缩减为轻量 owner 索引和必要的跨阶段顺序，减少重复规则、上下文占用与后续所有权漂移。",
        "为可确定判断的非法状态增加零副作用硬阻断，并通过 Patch 冲突检查、上下文预算和幂等安装测试保证升级兼容性。",
      ],
    },
  ],
  [
    "b8dd135",
    {
      order: 1,
      details: [
        "发布、部署等项目工作流动作会先发现项目 SOP，再进入准确能力，避免将 beta 发布误路由到只生成上线操作单的 `trellis-release`。",
        "恢复 planning 与 in-progress 状态下的活动任务范围隔离，防止无关请求误入当前任务流程。",
        "`trellis-continue` 会在判断阶段前读取并克制展示未完成进度，同时保持不自动绑定任务、不从进度推断阶段。",
        "恢复规划语义就绪检查与最新 brief 的显式确认，避免仅因规划文件存在就自动启动任务。",
        "实现完成后重新进入 Pre-Check；交互式提交在 Git 操作前校验当前 Update-Spec 结果。",
        "将 Workflow Gate Skill 与 Update-Spec、Finish-Work 入口同步到 17 个平台的原生目录，并统一安装、检测与卸载清理。",
      ],
    },
  ],
  [
    "db4f943",
    {
      order: 2,
      details: [
        "将 0.6 的 Workflow、Skill、Hook 与平台配置统一为 `insert / replace / remove` Patch schema v2。",
        "支持 Bundle 选择、全量 preflight、changed-only apply、首次备份、旧 marker 迁移和 manifest provenance。",
        "Flower JS 与 Skill-Garden Python consumer 共享 Core Patch 声明和 fixture，并保持结构化结果 parity。",
      ],
    },
  ],
  [
    "2472058",
    {
      order: 3,
      details: [
        "对全部 0.6 Patch 目标执行上游 baseline、Patch 与最终产物三方冲突检查。",
        "运行时、`npm test`、`check-snapshot` 与维护者脚本复用同一套 compatibility/conflict evaluator。",
        "清理 route、Check-All、Update-Spec 与 Trellis Push 的互斥协议和重复流程，并区分 info、warning 与阻断错误。",
        "结构化配置只修改受管字段，损坏 JSON/YAML/TOML、required Patch 漂移或冲突检查失败时保持零写入。",
        "Trellis `0.6.5` 已完成完整验证；未登记的同线 `0.6.x` 通过全量检查后 warning 放行，`0.7+`、`1.x` 或无效版本会阻断强化。",
        "`0.5` / `old` 继续使用原有 legacy 注入路径，避免稳定版升级破坏旧项目。",
      ],
    },
  ],
]);

const commitGroupOrder = types.flatMap((type) => type.section).filter(Boolean);
const releaseAsRe = /release-as:\s*\w*@?([0-9]+\.[0-9]+\.[0-9a-z]+(-[0-9a-z.]+)?)\s*/i;

function expandTemplate(template, context) {
  return Object.keys(context).reduce(
    (expanded, key) => expanded.replace(new RegExp(`{{${key}}}`, "g"), context[key]),
    template,
  );
}

function findTypeEntry(commit) {
  const typeKey = (commit.revert ? "revert" : commit.type || "").toLowerCase();
  return types.find((entry) => {
    if (entry.type !== typeKey) {
      return false;
    }
    if (entry.scope && entry.scope !== commit.scope) {
      return false;
    }
    return true;
  });
}

module.exports = {
  header:
    "# Changelog\n\n本项目所有重要变更都会记录在此文件。\n\n版本号遵循 [SemVer](https://semver.org/lang/zh-CN/);提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范。\n",
  types,
  writerOpts: {
    transform(commit, context) {
      let discard = true;
      const issues = [];
      const entry = findTypeEntry(commit);

      addBangNotes(commit);

      if (
        (commit.footer && releaseAsRe.test(commit.footer)) ||
        (commit.body && releaseAsRe.test(commit.body))
      ) {
        discard = false;
      }

      commit.notes.forEach((note) => {
        note.title = "BREAKING CHANGES";
        discard = false;
      });

      if (discard && (entry === undefined || entry.hidden)) {
        return undefined;
      }

      if (entry) {
        commit.type = entry.section;
      }

      if (commit.scope === "*") {
        commit.scope = "";
      }

      if (typeof commit.hash === "string") {
        commit.shortHash = commit.hash.substring(0, 7);
      }

      if (typeof commit.subject === "string") {
        const localizedSubject =
          localizedSubjects.get(commit.shortHash) ||
          localizedSubjects.get(commit.subject);
        if (localizedSubject) {
          commit.subject = localizedSubject;
        }

        const re = /(#)([0-9]+)/g;
        commit.subject = commit.subject.replace(re, (_, prefix, issue) => {
          issues.push(prefix + issue);
          const url = expandTemplate("{{host}}/{{owner}}/{{repository}}/issues/{{id}}", {
            host: context.host,
            owner: context.owner,
            repository: context.repository,
            id: issue,
          });
          return `[${prefix}${issue}](${url})`;
        });

        commit.subject = commit.subject.replace(
          /\B@([a-z0-9](?:-?[a-z0-9/]){0,38})/g,
          (_, user) => {
            if (user.includes("/")) {
              return `@${user}`;
            }

            const usernameUrl = expandTemplate("{{host}}/{{user}}", {
              host: context.host,
              user,
            });
            return `[@${user}](${usernameUrl})`;
          },
        );

        const releaseSubject = detailedReleaseSubjects.get(commit.shortHash);
        if (releaseSubject) {
          const commitUrl = expandTemplate(
            "{{host}}/{{owner}}/{{repository}}/commit/{{hash}}",
            {
              host: context.host,
              owner: context.owner,
              repository: context.repository,
              hash: commit.hash,
            },
          );
          const detailLines = releaseSubject.details.map((detail) => `  - ${detail}`);
          const sectionLines = (releaseSubject.sections || []).flatMap((section) => [
            "",
            "",
            `### ${section.title}`,
            "",
            ...section.items.map((item) => `* ${item}`),
          ]);

          commit.subject = [
            `${commit.subject} ([${commit.shortHash}](${commitUrl}))`,
            ...detailLines,
            ...sectionLines,
          ].join("\n");
          commit.hash = null;
        }
      }

      commit.references = commit.references.filter(
        (reference) => issues.indexOf(reference.prefix + reference.issue) === -1,
      );

      return commit;
    },
    commitGroupsSort(a, b) {
      return commitGroupOrder.indexOf(a.title) - commitGroupOrder.indexOf(b.title);
    },
    commitsSort(a, b) {
      const aOrder = detailedReleaseSubjects.get(a.shortHash)?.order;
      const bOrder = detailedReleaseSubjects.get(b.shortHash)?.order;

      if (aOrder !== undefined || bOrder !== undefined) {
        return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
      }

      return `${a.scope || ""}${a.subject || ""}`.localeCompare(
        `${b.scope || ""}${b.subject || ""}`,
      );
    },
  },
};
