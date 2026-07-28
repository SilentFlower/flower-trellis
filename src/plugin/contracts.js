/**
 * @typedef {object} CapabilityRequest
 * @property {"standard"|"integration"|"system"} profile 请求的能力档位
 * @property {string[]} required 必须获得的能力
 * @property {string[]} [optional] 可选能力
 */

/**
 * @typedef {object} CapabilityGrant
 * @property {"standard"|"integration"|"system"} profile 实际授予档位
 * @property {string[]} granted 实际授予能力
 * @property {string[]} denied 被拒绝能力
 * @property {string|null} approvalDigest 项目批准摘要
 */

/**
 * @typedef {object} PluginContent
 * @property {string[]} [skills] Skill 内容路径
 * @property {string[]} [specs] 规范内容路径
 * @property {string[]} [assets] 资源内容路径
 * @property {string[]} [scripts] 被动脚本资源路径
 * @property {string[]} [tests] 测试资源路径
 */

/**
 * @typedef {object} PluginManifest
 * @property {1} schemaVersion schema 版本
 * @property {string} id Plugin 本地 ID
 * @property {string} name 展示名称
 * @property {string} version SemVer 版本
 * @property {{flower:string,trellis?:string}} compatibility Flower/Trellis 兼容范围
 * @property {Record<string,string>} [dependencies] canonical Plugin ID 到 SemVer range
 * @property {CapabilityRequest} capabilities 能力请求
 * @property {PluginContent} content 被动分发内容
 * @property {{catalog:string,bundles?:string}} [patches] Patch catalog 声明
 */

/**
 * @typedef {object} MarketplacePathSource
 * @property {"path"} type 共仓来源
 * @property {string} path Marketplace 内 POSIX 相对路径
 */

/**
 * @typedef {object} MarketplaceGitLabSource
 * @property {"gitlab"} type GitLab 来源
 * @property {string} project GitLab project path
 * @property {string} [subdir] 仓库内 POSIX 相对目录
 */

/** @typedef {MarketplacePathSource|MarketplaceGitLabSource} MarketplaceSource */

/**
 * @typedef {object} MarketplaceVersionEntry
 * @property {string} version SemVer 版本
 * @property {string} ref 发布 ref
 * @property {string} commit 40 位不可变 Git commit
 * @property {string} integrity canonical tree SHA-256
 */

/**
 * @typedef {object} MarketplacePluginEntry
 * @property {string} id Plugin 本地 ID
 * @property {string} description Plugin 描述
 * @property {MarketplaceSource} source Plugin 来源
 * @property {{maxProfile:"standard"|"integration"}} trust Marketplace 能力上限
 * @property {MarketplaceVersionEntry[]} versions 可安装版本
 */

/**
 * @typedef {object} MarketplaceManifest
 * @property {1} schemaVersion schema 版本
 * @property {string} id Marketplace ID
 * @property {string} name 展示名称
 * @property {MarketplacePluginEntry[]} plugins Plugin 索引条目
 */

/**
 * @typedef {object} BuiltinSourceDescriptor
 * @property {string} id 来源 ID
 * @property {"builtin"} type 内置来源
 * @property {string} reference 包内稳定引用
 */

/**
 * @typedef {object} LocalSourceDescriptor
 * @property {string} id 来源 ID
 * @property {"local"} type 本地来源
 * @property {string} reference 项目内 POSIX 相对引用
 */

/**
 * @typedef {object} GitLabSourceDescriptor
 * @property {string} id 来源 ID
 * @property {"gitlab"} type GitLab 来源
 * @property {string} reference GitLab project path
 * @property {string} [indexCommit] Marketplace 索引 commit
 */

/** @typedef {BuiltinSourceDescriptor|LocalSourceDescriptor|GitLabSourceDescriptor} SourceDescriptor */

/**
 * @typedef {object} CompatibilityConstraint
 * @property {string} flower Flower SemVer range
 * @property {string} [trellis] Trellis SemVer range
 */

/**
 * @typedef {object} PluginCandidate
 * @property {string} id canonical Plugin ID
 * @property {string} version SemVer 版本
 * @property {SourceDescriptor} source 来源描述
 * @property {string|null} commit 不可变 Git commit
 * @property {string} integrity canonical tree SHA-256
 * @property {PluginManifest} manifest Plugin manifest
 * @property {"standard"|"integration"} [marketplaceMaxProfile] Marketplace 进程内来源上限
 */

/**
 * @typedef {object} ResolvedPlugin
 * @property {string} id canonical Plugin ID
 * @property {string} version 已解析版本
 * @property {SourceDescriptor} source 来源描述
 * @property {string|null} commit 不可变 Git commit
 * @property {string} integrity canonical tree SHA-256
 * @property {Record<string,string>} dependencies 已解析依赖版本
 * @property {CompatibilityConstraint} compatibility 兼容范围
 * @property {CapabilityGrant} capabilities 实际能力授权
 */

/**
 * @typedef {object} ResolvedGraph
 * @property {string[]} roots 用户直接声明的 Plugin
 * @property {ResolvedPlugin[]} plugins 稳定拓扑顺序的完整 Plugin 图
 */

/**
 * @typedef {object} ContentMutation
 * @property {string} owner canonical Plugin ID
 * @property {string} target 项目内 POSIX 相对目标路径
 * @property {"write"|"remove"} operation 普通内容操作
 * @property {string|null} beforeHash 写前摘要
 * @property {string|null} afterHash 写后摘要
 * @property {string} source 内容来源标识
 */

/**
 * @typedef {object} PatchOperationProvenance
 * @property {string} id operation 本地 ID
 * @property {string} catalog catalog ID
 * @property {string} qualifiedId qualified operation ID
 * @property {string} patch Patch 本地 ID
 * @property {string} qualifiedPatch qualified Patch ID
 * @property {string} [bundle] 首个 Bundle ID
 * @property {string[]} bundles 全部 Bundle ID
 * @property {string} target 目标路径
 * @property {"applied"} status 应用状态
 * @property {string} resultHash 应用后摘要
 */

/**
 * @typedef {object} PatchMutation
 * @property {string} owner canonical Plugin ID
 * @property {string} target 项目内 POSIX 相对目标路径
 * @property {string|null} beforeHash 写前摘要
 * @property {string|null} afterHash 写后摘要
 * @property {string[]} operations qualified Patch operation ID
 * @property {PatchOperationProvenance[]} provenance Patch provenance
 */

/**
 * @typedef {object} PluginDiagnostic
 * @property {string} code 稳定诊断码
 * @property {string} path 关联路径或 JSON Pointer
 * @property {string} message 中文诊断说明
 * @property {"info"|"warning"|"error"} severity 严重度
 */

/**
 * @typedef {object} InstallPlan
 * @property {ResolvedGraph} graph 已解析依赖图
 * @property {ContentMutation[]} contentMutations 普通内容变更
 * @property {PatchMutation[]} patchMutations Patch 变更
 * @property {PluginDiagnostic[]} diagnostics 结构化诊断
 */

/**
 * @typedef {object} ProjectPluginDeclaration
 * @property {string} id canonical Plugin ID
 * @property {string} source 来源 ID
 * @property {string} version SemVer range
 * @property {string[]} [platforms] 显式平台限制
 */

/**
 * @typedef {object} ProjectPluginsFile
 * @property {1} schemaVersion schema 版本
 * @property {ProjectPluginDeclaration[]} plugins 直接 Plugin 声明
 */

/**
 * @typedef {object} PluginLock
 * @property {1} schemaVersion schema 版本
 * @property {string[]} roots 直接 Plugin canonical ID
 * @property {ResolvedPlugin[]} plugins 完整锁定图
 */

/**
 * @typedef {object} PluginPathState
 * @property {string} path 项目内 POSIX 相对路径
 * @property {"file"|"directory"} kind 路径类型
 * @property {string} hash 当前内容摘要
 * @property {"exclusive"|"shared"} ownership 所有权模式
 */

/**
 * @typedef {object} PluginPatchState
 * @property {string} operation qualified Patch operation ID
 * @property {string} target 项目内 POSIX 相对目标路径
 * @property {string} resultHash 应用后摘要
 */

/**
 * @typedef {object} PluginStateEntry
 * @property {string} id canonical Plugin ID
 * @property {string} version 已应用版本
 * @property {string[]} platforms 实际投影平台
 * @property {PluginPathState[]} paths 受管路径
 * @property {PluginPatchState[]} patches Patch 应用状态
 */

/**
 * @typedef {object} PluginState
 * @property {1} schemaVersion schema 版本
 * @property {1} transactionVersion 事务状态版本
 * @property {PluginStateEntry[]} plugins 本机实际应用状态
 * @property {{source:"legacy-flower-manifest",schemaVersion:number}} [migration] 旧状态迁移来源
 */

/** Flower Plugin DTO 契约版本。 */
export const PLUGIN_CONTRACT_VERSION = 1;
