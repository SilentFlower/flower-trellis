const baseConfig = require("./.versionrc.cjs");
const stablePreset = require("./scripts/lib/stable-release-preset.cjs");

module.exports = {
  ...baseConfig,
  preset: {
    name: require.resolve("./scripts/lib/stable-release-preset.cjs"),
  },
  writerOpts: {
    ...baseConfig.writerOpts,
    finalizeContext(context) {
      const previousTag = stablePreset.selectLatestStableTag(context.gitSemverTags || []);
      return {
        ...context,
        previousTag,
        currentTag: `v${context.version}`,
        linkCompare: true,
      };
    },
  },
};
