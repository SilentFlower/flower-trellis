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
      }

      commit.references = commit.references.filter(
        (reference) => issues.indexOf(reference.prefix + reference.issue) === -1,
      );

      return commit;
    },
    commitGroupsSort(a, b) {
      return commitGroupOrder.indexOf(a.title) - commitGroupOrder.indexOf(b.title);
    },
  },
};
