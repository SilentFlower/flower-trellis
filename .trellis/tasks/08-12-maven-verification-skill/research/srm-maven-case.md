# SRM Maven 慢构建实证

## 仓库

- 父仓：`/root/project/srm-dingtalk-notification-governance`
- Maven 子仓：`srm-server`
- 根 POM目标：Java 8（`maven.compiler.source/target=8`）
- 顶层模块：17 个；嵌套 addons 后，历史定向 reactor 常见 19～29 个模块。

## 重复验证

历史 Trellis 会话显示：

- implement 定向测试/编译会拉起 27～29 个依赖模块。
- 修复后会重跑相同 reactor。
- Check-All 重检缺少统一 evidence 新鲜度契约，可能再次运行。
- `-rf` 无法稳定作为独立恢复方案；若本轮上游 SNAPSHOT 未安装到本地仓库，续跑会缺类。

## 生命周期额外开销

外部父 POM：

```text
com.xhiot.xhiot-boot:xhiot-boot:1.2.6-SNAPSHOT
```

其 effective build 将 `maven-source-plugin:jar` 绑定到 `compile`：

```xml
<execution>
  <phase>compile</phase>
  <goals>
    <goal>jar</goal>
  </goals>
</execution>
```

当前插件描述确认 `skipSource` 由 `${maven.source.skip}` 控制，因此非 sources 验证可使用：

```text
-Dmaven.source.skip=true
```

当前 target 中可见 26 个 sources jar，总计约 5.49 MiB。体积不是唯一成本，多模块源码扫描、压缩和写盘会随每次 reactor 重复。

多个应用模块在 `prepare-package` 绑定 `maven-dependency-plugin:copy-dependencies`：

- `srm-api-manage/target/lib`：约 225 MiB，478 个 JAR。
- `srm-api-supplier/target/lib`：约 213 MiB，441 个 JAR。
- `srm-api-mobile/target/lib`：约 203 MiB，419 个 JAR。

因此普通编译验证不应无理由升级到 `package`。

## 环境放大因素

- 默认运行时 JDK 为 21，项目实际需要 Java 8；未先识别工具链会造成失败后重跑。
- Maven 本地仓库由 settings 配置为 `/mnt/d/develop/maven-dependcies`，位于 WSL 挂载盘；大量依赖小文件访问可能慢于 Linux 文件系统。
- Skill 只能报告该风险，不得修改 settings 或自动迁移仓库。

## 对通用 Skill 的约束

- 不能把 SRM 的 Java 路径、模块名、父坐标或本地仓库路径硬编码进通用实现。
- 必须通过真实 POM/effective model发现生命周期绑定。
- quick 必须保留 `-am`，否则 SRM 会读取本地仓库中的陈旧 SNAPSHOT 并出现缺类；final 仍需覆盖必要上游和消费者。
- Check-All 应复用同一 diff/toolchain/coverage 的 final evidence，而不是重新跑 reactor。

## 全 WSL 环境下的增量策略实测

统一使用 Linux Java 8、Linux Maven 3.6.3、ext4 项目目录与 ext4 本地仓库后：

- 普通 `-pl srm-api-manage -am compile` 三轮为 134.63、89.82、109.42 秒，平均 111.29 秒。
- 跳过 sources 的 conservative final 三轮为 126.14、75.51、72.34 秒，平均 91.33 秒。
- 保留 `-am` 并加入 `-Dmaven.compiler.useIncrementalCompilation=false` 后为 9.94 秒；Maven仍遍历 27 项 reactor，但不再因 classpath 时间戳变化整模块重编。
- 显式 `-T 1C` 后为 7.34 秒；再跳过资源复制为 6.38 秒，但资源完整性证明成本高于约 1 秒收益，首波不自动加入该参数。
- 把 `ContractPageData.class` 时间戳设为过期后，优化 quick 在 8.07 秒内成功，并实际只重编对应源文件；说明它不是关闭编译或单纯空跑。

本轮 Skill 实现完成后的 forward-test 继续使用 Linux Java 8、Linux Maven 3.6.3、ext4 项目与 ext4 本地仓库：

- 默认 quick 计划约 4.02 秒，实际执行端到端 8.32 秒，Maven 报告 6.27 秒；命令自动包含 `-pl srm-api-manage -am`、sources skip 与 source-stale 参数。
- 同一现场显式 `--threads 1C` 的执行端到端为 9.76 秒，Maven Wall Clock 为 7.28 秒，未优于串行 quick；因此并行保持显式选项，不作为默认优化。
- final auto 计划确认使用 conservative 编译，不包含 source-stale 参数；quick evidence 与 final 计划指纹严格区分。
- `/root/project/srm-dingtalk-notification-governance/srm-server` 的只读 package 计划识别 Java 8、compile 阶段 `maven-source-plugin:jar` 和 `srm-api-manage` 在 prepare-package 的 `copy-dependencies`，未执行该 reactor，也未修改业务文件或 POM。

`maven.compiler.useIncrementalCompilation=false` 的命名容易误解。对 Maven Compiler Plugin 3.1+，该值会改用源文件/class stale 判断；默认 true 还会因依赖 JAR变化触发整个模块重新编译。该策略适合 quick，final 默认仍需保守处理跨模块 ABI、常量内联和注解处理器风险。
