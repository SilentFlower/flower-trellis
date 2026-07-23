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
]);

const detailedReleaseSubjects = new Map([
  [
    "db4f943",
    {
      order: 0,
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
      order: 1,
      details: [
        "对全部 0.6 Patch 目标执行上游 baseline、Patch 与最终产物三方冲突检查。",
        "运行时、`npm test`、`check-snapshot` 与维护者脚本复用同一套 compatibility/conflict evaluator。",
      ],
      sections: [
        {
          title: "🐛 修复 Bug Fixes",
          items: [
            "**workflow:** 清理 route、Check-All、Update-Spec 与 Trellis Push 的互斥协议和重复流程。",
            "**config:** 结构化配置只修改受管字段，损坏 JSON/YAML/TOML 时失败且不覆盖用户配置。",
            "**install:** required Patch 或冲突检查失败时，Patch、资产、stale 清理和 manifest 保持零写入。",
            "**diagnostics:** 将未安装目标记为 info，并将 optional skip 与阻断错误分开报告。",
          ],
        },
        {
          title: "🔒 兼容与安全",
          items: [
            "Trellis `0.6.5` 已登记并通过完整验证。",
            "未登记的同线 `0.6.x` 在完整 Patch 与冲突检查通过后 warning 放行。",
            "`0.7+`、`1.x` 或无效版本会阻断强化，并提示使用匹配版本或 `--no-enhance`。",
            "`0.5` / `old` 继续使用原有 legacy 注入路径。",
          ],
        },
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
