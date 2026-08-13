"""maven_verify.py 分层计划、执行与证据复用测试。"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
HELPER = PROJECT_ROOT / "vendor/skill-garden/.trellis/0.6/scripts/maven_verify.py"


def _load_helper_module():
    """加载 helper 模块，供纯函数和平台判断回归测试使用。"""
    module_name = "flower_trellis_maven_verify_test"
    spec = importlib.util.spec_from_file_location(module_name, HELPER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 helper：{HELPER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


ROOT_POM = """
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>demo-parent</artifactId>
  <version>1.0-SNAPSHOT</version>
  <packaging>pom</packaging>
  <properties>
    <maven.compiler.target>1.8</maven.compiler.target>
  </properties>
  <modules>
    <module>core</module>
    <module>app</module>
  </modules>
</project>
"""


CORE_POM = """
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.example</groupId>
    <artifactId>demo-parent</artifactId>
    <version>1.0-SNAPSHOT</version>
  </parent>
  <artifactId>core</artifactId>
</project>
"""


APP_POM = """
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.example</groupId>
    <artifactId>demo-parent</artifactId>
    <version>1.0-SNAPSHOT</version>
  </parent>
  <artifactId>app</artifactId>
  <properties>
    <maven.compiler.target>17</maven.compiler.target>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>core</artifactId>
      <version>${project.version}</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-dependency-plugin</artifactId>
        <executions>
          <execution>
            <id>copy-runtime</id>
            <phase>prepare-package</phase>
            <goals><goal>copy-dependencies</goal></goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
"""


EFFECTIVE_POM = """
<projects>
  <project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>org.example</groupId>
    <artifactId>demo-parent</artifactId>
    <version>1.0-SNAPSHOT</version>
    <build>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-compiler-plugin</artifactId>
          <version>3.8.1</version>
          <executions>
            <execution>
              <id>default-compile</id>
              <phase>compile</phase>
              <goals><goal>compile</goal></goals>
            </execution>
          </executions>
        </plugin>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-source-plugin</artifactId>
          <version>3.3.1</version>
          <executions>
            <execution>
              <id>attach-sources</id>
              <phase>compile</phase>
              <goals><goal>jar</goal></goals>
            </execution>
          </executions>
        </plugin>
      </plugins>
    </build>
  </project>
  <project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>org.example</groupId>
    <artifactId>app</artifactId>
    <version>1.0-SNAPSHOT</version>
    <build>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-dependency-plugin</artifactId>
          <version>3.7.1</version>
          <executions>
            <execution>
              <id>copy-runtime</id>
              <phase>prepare-package</phase>
              <goals><goal>copy-dependencies</goal></goals>
            </execution>
          </executions>
        </plugin>
      </plugins>
    </build>
  </project>
</projects>
"""


REPACKAGE_EFFECTIVE_POM = """
<projects>
  <project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>org.example</groupId>
    <artifactId>demo-parent</artifactId>
    <version>1.0-SNAPSHOT</version>
  </project>
  <project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>org.example</groupId>
    <artifactId>app</artifactId>
    <version>1.0-SNAPSHOT</version>
    <build>
      <plugins>
        <plugin>
          <groupId>org.springframework.boot</groupId>
          <artifactId>spring-boot-maven-plugin</artifactId>
          <version>2.1.16.RELEASE</version>
          <executions>
            <execution>
              <id>repackage</id>
              <goals><goal>repackage</goal></goals>
            </execution>
          </executions>
        </plugin>
      </plugins>
    </build>
  </project>
</projects>
"""


class MavenVerifyTest(unittest.TestCase):
    """在隔离 Git/Maven fixture 验证 helper 完整行为。"""

    def setUp(self) -> None:
        """创建包含两个 module 与伪 Maven 的隔离仓库。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-maven-verify-")
        self.root = Path(self.temp.name) / "repo with spaces"
        self.root.mkdir()
        self.home = self.root / "home"
        self.home.mkdir()
        self.write("pom.xml", ROOT_POM)
        self.write("core/pom.xml", CORE_POM)
        self.write("core/src/main/java/Core.java", "class Core {}\n")
        self.write("app/pom.xml", APP_POM)
        self.write("app/src/main/java/App.java", "class App {}\n")
        self.write("effective-pom.xml", EFFECTIVE_POM)
        self.fake_maven = self.root / "bin/fake mvn"
        self.fake_maven.parent.mkdir(parents=True)
        self.fake_maven.write_text(
            textwrap.dedent(
                """\
                #!/bin/sh
                if [ "$1" = "-version" ]; then
                  if [ -n "${FAKE_MAVEN_VERSION_MARKER:-}" ]; then
                    : > "$FAKE_MAVEN_VERSION_MARKER"
                  fi
                  echo "Apache Maven ${FAKE_MAVEN_VERSION:-3.9.9}"
                  exit 0
                fi
                mkdir -p .trellis/.runtime
                printf '%s\\n' "$@" > .trellis/.runtime/fake-maven-argv.txt
                for argument in "$@"; do
                  case "$argument" in
                    -Doutput=*)
                      cp effective-pom.xml "${argument#-Doutput=}"
                      exit 0
                      ;;
                  esac
                done
                if [ "${FAKE_MAVEN_AGGREGATE_TESTS:-0}" = "1" ]; then
                  echo "Tests run: 2, Failures: 0, Errors: 0, Skipped: 0"
                  echo "Tests run: 3, Failures: 0, Errors: 0, Skipped: 0"
                  echo "Results:"
                  echo "Tests run: 5, Failures: 0, Errors: 0, Skipped: 0"
                else
                  echo "Tests run: 2, Failures: 0, Errors: 0, Skipped: 0"
                fi
                if [ "${FAKE_MAVEN_MUTATE_SOURCE:-0}" = "1" ]; then
                  printf '%s\\n' 'class Core { int concurrent; }' > core/src/main/java/Core.java
                fi
                exit "${FAKE_MAVEN_EXIT:-0}"
                """
            ),
            encoding="utf-8",
        )
        self.fake_maven.chmod(self.fake_maven.stat().st_mode | stat.S_IXUSR)
        self.run_command(["git", "init", "-q"])
        self.run_command(["git", "config", "user.name", "Tester"])
        self.run_command(["git", "config", "user.email", "tester@example.com"])
        self.run_command(["git", "add", "."])
        self.run_command(["git", "commit", "-qm", "initial"])
        self.env = {
            **os.environ,
            "HOME": str(self.home),
            "MAVEN_CONFIG": str(self.home / ".m2"),
        }

    def tearDown(self) -> None:
        """删除临时 fixture。"""
        self.temp.cleanup()

    def write(self, relative: str, content: str) -> None:
        """写入 fixture 文件。"""
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).strip() + "\n", encoding="utf-8")

    def run_command(
        self,
        argv: list[str],
        *,
        env: dict[str, str] | None = None,
        input_text: str | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """在 fixture 根执行命令。"""
        return subprocess.run(
            argv,
            cwd=self.root,
            env=env,
            input=input_text,
            capture_output=True,
            text=True,
            check=check,
        )

    def helper(
        self,
        *args: str,
        env: dict[str, str] | None = None,
        input_text: str | None = None,
        expected_code: int = 0,
    ) -> tuple[subprocess.CompletedProcess[str], dict]:
        """执行 helper 并解析 stdout JSON。"""
        result = self.run_command(
            ["python3", str(HELPER), *args],
            env=env or self.env,
            input_text=input_text,
            check=False,
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            self.fail(f"helper stdout 不是 JSON：{result.stdout}\nstderr={result.stderr}\n{error}")
        self.assertEqual(result.returncode, expected_code, result.stderr or payload)
        return result, payload

    def plan(self, mode: str = "quick", goal: str = "compile", *extra: str) -> dict:
        """生成并持久化计划。"""
        plan_path = self.root / f".trellis/.runtime/maven-verification/{mode}-{goal}.json"
        _, payload = self.helper(
            "plan",
            "--mode",
            mode,
            "--goal",
            goal,
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            "--output",
            str(plan_path),
            "--json",
            *extra,
        )
        self.assertEqual(payload["status"], "planned")
        return payload

    def test_quick_compile_selects_changed_module_and_skips_sources(self) -> None:
        """quick compile 保留上游，并启用受支持的 source-stale 策略。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan()

        self.assertEqual(plan["changedModules"], ["core"])
        self.assertEqual(plan["selectedModules"], ["core"])
        self.assertIn("-pl", plan["argv"])
        self.assertIn("-am", plan["argv"])
        self.assertIn("-Dmaven.source.skip=true", plan["argv"])
        self.assertIn("-Dmaven.compiler.useIncrementalCompilation=false", plan["argv"])
        self.assertEqual(
            plan["compileStrategy"],
            {"requested": "auto", "effective": "source-stale", "supported": True},
        )
        self.assertIn("-am", plan["fallbackArgv"])
        self.assertNotIn(
            "-Dmaven.compiler.useIncrementalCompilation=false",
            plan["fallbackArgv"],
        )
        self.assertEqual(
            [item["artifact"] for item in plan["lifecycle"]["expensiveBindings"]],
            ["sources"],
        )
        self.assertNotIn("copy-dependencies", json.dumps(plan["lifecycle"]["bindings"]))
        self.assertEqual(plan["javaTargets"], ["1.8"])

    def test_quick_app_execution_coverage_includes_local_upstream(self) -> None:
        """quick 的 evidence 覆盖必须包含 `-am` 实际带入的本地上游。"""
        self.write("app/src/main/java/App.java", "class App { int value; }")

        plan = self.plan()

        self.assertEqual(plan["selectedModules"], ["app"])
        self.assertEqual(plan["executionModules"], ["app", "core"])
        self.assertEqual(plan["coverage"]["modules"], ["app", "core"])
        self.assertIn("-am", plan["argv"])

    def test_final_compile_defaults_to_conservative(self) -> None:
        """final auto 默认保持 Maven 保守编译语义。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan("final")

        self.assertEqual(plan["compileStrategy"]["effective"], "conservative")
        self.assertNotIn("-Dmaven.compiler.useIncrementalCompilation=false", plan["argv"])
        self.assertIsNone(plan["fallbackArgv"])

    def test_final_source_stale_requires_explicit_request(self) -> None:
        """低风险 final 只有显式请求才进入 source-stale。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan("final", "compile", "--compile-strategy", "source-stale")

        self.assertEqual(plan["compileStrategy"]["effective"], "source-stale")
        self.assertIn("-Dmaven.compiler.useIncrementalCompilation=false", plan["argv"])
        self.assertTrue(any(item["code"] == "source-stale-local-feedback" for item in plan["warnings"]))

    def test_quick_auto_degrades_when_compiler_plugin_is_too_old(self) -> None:
        """compiler plugin 过旧时 quick auto 降级并报告。"""
        self.write("effective-pom.xml", EFFECTIVE_POM.replace("3.8.1", "3.0"))
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan()

        self.assertEqual(plan["compileStrategy"]["effective"], "conservative")
        self.assertFalse(plan["compileStrategy"]["supported"])
        self.assertNotIn("-Dmaven.compiler.useIncrementalCompilation=false", plan["argv"])
        self.assertIsNone(plan["fallbackArgv"])
        self.assertTrue(
            any(item["code"] == "compiler-source-stale-unsupported" for item in plan["warnings"])
        )

    def test_quick_auto_accepts_two_segment_minimum_compiler_version(self) -> None:
        """官方两段版本 3.1 必须按最低兼容版本启用 source-stale。"""
        self.write("effective-pom.xml", EFFECTIVE_POM.replace("3.8.1", "3.1"))
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan()

        self.assertTrue(plan["compileStrategy"]["supported"])
        self.assertEqual(plan["compileStrategy"]["effective"], "source-stale")
        self.assertIn("-Dmaven.compiler.useIncrementalCompilation=false", plan["argv"])

    def test_explicit_source_stale_fails_when_compiler_plugin_is_too_old(self) -> None:
        """显式 source-stale 在兼容性不足时失败关闭。"""
        self.write("effective-pom.xml", EFFECTIVE_POM.replace("3.8.1", "3.0"))
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        _, payload = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--compile-strategy",
            "source-stale",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            expected_code=5,
        )

        self.assertEqual(payload["reasons"][0]["code"], "compiler-source-stale-unsupported")

    def test_source_stale_rejects_lifecycle_after_compile(self) -> None:
        """source-stale 不能扩展到 test/package 等更高 lifecycle。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        _, payload = self.helper(
            "plan",
            "--mode",
            "final",
            "--goal",
            "test",
            "--compile-strategy",
            "source-stale",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            expected_code=5,
        )

        self.assertEqual(payload["reasons"][0]["code"], "source-stale-goal-unsupported")

    def test_threads_are_explicit_and_fingerprinted(self) -> None:
        """并行度只在显式请求时进入 argv 与计划语义。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        default = self.plan()
        parallel = self.plan("quick", "compile", "--threads", "1.5c")

        self.assertIsNone(default["threads"])
        self.assertNotIn("-T", default["argv"])
        self.assertEqual(parallel["threads"], "1.5C")
        self.assertEqual(parallel["argv"][1:3], ["-T", "1.5C"])
        self.assertNotEqual(default["planFingerprint"], parallel["planFingerprint"])
        self.assertTrue(any(item["code"] == "parallel-build-explicit" for item in parallel["warnings"]))

    def test_invalid_threads_fail_closed(self) -> None:
        """非法 Maven 并行度不得进入执行计划。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        _, payload = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--threads",
            "0",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            expected_code=5,
        )

        self.assertEqual(payload["reasons"][0]["code"], "threads-invalid")

    def test_final_package_includes_consumer_and_reports_copy_dependencies(self) -> None:
        """final package 覆盖显式消费者，并报告 prepare-package 依赖复制。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan("final", "package", "--consumer", "app")

        self.assertEqual(plan["selectedModules"], ["app", "core"])
        self.assertEqual(plan["consumerModules"], ["app"])
        self.assertIn("-am", plan["argv"])
        artifacts = {item["artifact"] for item in plan["lifecycle"]["expensiveBindings"]}
        self.assertEqual(artifacts, {"sources", "copy-dependencies"})
        self.assertEqual(
            sum(
                item["artifact"] == "copy-dependencies"
                for item in plan["lifecycle"]["expensiveBindings"]
            ),
            1,
        )
        self.assertTrue(any(item["code"] == "expensive-lifecycle-bindings" for item in plan["warnings"]))

    def test_package_excludes_unselected_module_bindings(self) -> None:
        """package 只报告实际 reactor 范围内的模块级昂贵绑定。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan("final", "package", "--module", "core")

        self.assertEqual(plan["selectedModules"], ["core"])
        self.assertEqual(plan["executionModules"], ["core"])
        artifacts = {item["artifact"] for item in plan["lifecycle"]["expensiveBindings"]}
        self.assertEqual(artifacts, {"sources"})
        self.assertNotIn("copy-dependencies", json.dumps(plan["lifecycle"]["bindings"]))

    @unittest.skipUnless(shutil.which("mvn"), "本机未安装 Maven")
    def test_installed_maven_smoke_with_frozen_effective_model(self) -> None:
        """真实 Maven 只做版本探测，并完成冻结 effective model 分析。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        _, plan = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--module",
            "core",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            shutil.which("mvn") or "mvn",
        )

        self.assertEqual(plan["status"], "planned")
        self.assertTrue(plan["toolchain"]["maven"]["version"].startswith("Apache Maven"))
        self.assertIn("-Dmaven.source.skip=true", plan["argv"])

    def test_default_maven_reuses_same_side_path(self) -> None:
        """未显式指定 Maven 时复用 POSIX 构建侧 PATH，不固定版本。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        path_maven = self.fake_maven.parent / "mvn"
        path_maven.symlink_to(self.fake_maven.name)
        env = {**self.env, "PATH": f"{self.fake_maven.parent}{os.pathsep}{self.env['PATH']}"}

        _, plan = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--module",
            "core",
            "--effective-pom",
            "effective-pom.xml",
            env=env,
        )

        self.assertEqual(plan["toolchain"]["maven"]["buildSide"], "posix")
        self.assertEqual(plan["toolchain"]["maven"]["source"], "path")
        self.assertEqual(plan["toolchain"]["maven"]["runner"], "direct")
        self.assertEqual(plan["argv"][0], str(path_maven.resolve()))

    def test_windows_arguments_preserve_backslashes_and_quoted_spaces(self) -> None:
        """Windows Maven 参数解析不能吞掉本地仓库路径中的反斜杠。"""
        helper_module = _load_helper_module()

        tokens = helper_module._split_maven_arguments(
            r'-Dmaven.repo.local=C:\Users\SilentFlower\.m2\repository -Dlabel="hello world"',
            "MAVEN_OPTS",
            "windows",
        )

        self.assertEqual(
            tokens,
            [
                r"-Dmaven.repo.local=C:\Users\SilentFlower\.m2\repository",
                "-Dlabel=hello world",
            ],
        )

    def test_wsl_custom_windows_mount_uses_mount_source(self) -> None:
        """WSL 自定义 automount root 仍应按 Windows 文件系统选择构建侧。"""
        helper_module = _load_helper_module()
        filesystem = {
            "type": "9p",
            "mountPoint": "/windows/d",
            "source": "D:\\",
            "ioRisk": True,
        }

        with mock.patch.object(helper_module, "_is_wsl", return_value=True), mock.patch.object(
            helper_module,
            "_filesystem_info",
            return_value=filesystem,
        ):
            build_side, actual_filesystem = helper_module._project_build_side(self.root)

        self.assertEqual(build_side, "windows")
        self.assertEqual(actual_filesystem, filesystem)

    def test_posix_project_rejects_windows_maven(self) -> None:
        """POSIX 项目显式传入 Windows Maven 时失败关闭。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        _, payload = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--module",
            "core",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            "C:\\tools\\apache-maven\\bin\\mvn.cmd",
            expected_code=5,
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["reasons"][0]["code"], "maven-toolchain-side-mismatch")

    def test_toolchain_uses_java_home_instead_of_path_java(self) -> None:
        """Java 证据必须与 Maven 优先采用的 JAVA_HOME 保持一致。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        java_home = self.root / "jdk 8"
        java_executable = java_home / "bin/java"
        java_executable.parent.mkdir(parents=True)
        java_executable.write_text(
            "#!/bin/sh\necho 'openjdk version \"1.8.0_472\"' >&2\n",
            encoding="utf-8",
        )
        java_executable.chmod(java_executable.stat().st_mode | stat.S_IXUSR)

        _, plan = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--module",
            "core",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            env={**self.env, "JAVA_HOME": str(java_home)},
        )

        self.assertEqual(plan["toolchain"]["java"]["major"], 8)
        self.assertEqual(plan["toolchain"]["java"]["home"], str(java_home))
        self.assertEqual(plan["toolchain"]["java"]["executable"], str(java_executable))
        self.assertEqual(plan["toolchain"]["java"]["version"], 'openjdk version "1.8.0_472"')

    def test_inferred_consumer_is_advisory_only(self) -> None:
        """反向依赖结果只提供建议，不能静默扩大 final 范围。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan("final")

        self.assertEqual(plan["inferredConsumers"], ["app"])
        self.assertEqual(plan["selectedModules"], ["core"])
        self.assertTrue(any(item["code"] == "consumer-suggestions-not-selected" for item in plan["warnings"]))

    def test_root_pom_change_selects_full_reactor(self) -> None:
        """根 POM变化按 reactor-wide 风险处理。"""
        self.write("pom.xml", ROOT_POM.replace("1.0-SNAPSHOT", "1.0.1-SNAPSHOT"))

        plan = self.plan()

        self.assertTrue(plan["rootPomChanged"])
        self.assertEqual(plan["selectedModules"], [".", "app", "core"])
        self.assertNotIn("-pl", plan["argv"])

    def test_maven_config_change_selects_reactor_and_records_test_skip(self) -> None:
        """项目 Maven 配置变化覆盖全 reactor，并进入测试覆盖语义。"""
        self.write(".mvn/maven.config", "-DskipTests")

        plan = self.plan("final", "test")

        self.assertEqual(plan["selectedModules"], [".", "app", "core"])
        self.assertEqual(plan["reactorWideChanges"], [".mvn/maven.config"])
        self.assertNotIn("-pl", plan["argv"])
        self.assertTrue(plan["coverage"]["testsSkipped"])
        self.assertFalse(plan["coverage"]["testCompilationSkipped"])
        self.assertTrue(any(item["code"] == "tests-skipped-by-configuration" for item in plan["warnings"]))

    def test_jvm_config_change_selects_reactor_and_records_test_skip(self) -> None:
        """项目 JVM 配置中的系统属性也进入 Maven 覆盖语义。"""
        self.write(".mvn/jvm.config", "-Dmaven.test.skip=true")

        plan = self.plan("final", "test")

        self.assertEqual(plan["selectedModules"], [".", "app", "core"])
        self.assertEqual(plan["reactorWideChanges"], [".mvn/jvm.config"])
        self.assertTrue(plan["coverage"]["testsSkipped"])
        self.assertTrue(plan["coverage"]["testCompilationSkipped"])
        self.assertEqual(
            plan["toolchain"]["maven"]["arguments"]["jvmConfig"],
            ["-Dmaven.test.skip=true"],
        )

    def test_maven_args_is_ignored_before_maven_39(self) -> None:
        """Maven 3.9 之前不能把 MAVEN_ARGS 误算成生效参数。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        env = {
            **self.env,
            "FAKE_MAVEN_VERSION": "3.6.3",
            "MAVEN_ARGS": "-DskipTests",
        }
        plan_path = self.root / ".trellis/.runtime/maven-verification/maven-36.json"

        _, plan = self.helper(
            "plan",
            "--mode",
            "final",
            "--goal",
            "test",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            "--output",
            str(plan_path),
            env=env,
        )

        self.assertFalse(plan["coverage"]["testsSkipped"])
        self.assertIsNone(plan["toolchain"]["maven"]["arguments"]["MAVEN_ARGS"])
        self.assertEqual(
            plan["toolchain"]["maven"]["localRepository"],
            str(self.home / ".m2/repository"),
        )
        self.assertEqual(
            plan["toolchain"]["maven"]["ignoredArguments"]["reason"],
            "requires-maven-3.9",
        )

    def test_local_repository_uses_effective_argument_priority_and_spaces(self) -> None:
        """本地仓库读取 Maven 参数优先级，并保留带空格路径。"""
        self.write(
            ".mvn/maven.config",
            '-Dmaven.repo.local="/tmp/project repository"',
        )
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        env = {
            **self.env,
            "MAVEN_OPTS": '-Dmaven.repo.local="/tmp/jvm repository"',
            "MAVEN_ARGS": '-Dmaven.repo.local="/tmp/final repository"',
        }
        plan_path = self.root / ".trellis/.runtime/maven-verification/repository.json"

        _, plan = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            "--output",
            str(plan_path),
            env=env,
        )

        self.assertEqual(
            plan["toolchain"]["maven"]["localRepository"],
            "/tmp/final repository",
        )

    def test_relative_local_repository_is_resolved_from_maven_root(self) -> None:
        """相对本地仓库路径按 Maven 命令 cwd 解析。"""
        self.write(".mvn/maven.config", "-Dmaven.repo.local=relative-repository")
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan()

        self.assertEqual(
            plan["toolchain"]["maven"]["localRepository"],
            str(self.root / "relative-repository"),
        )

    def test_explicit_local_repository_applies_to_plan_run_and_check(self) -> None:
        """显式仓库必须贯穿 effective model、执行 argv 与 evidence 复用。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        repository = self.root / "fast repository"
        repository.mkdir()
        plan_path = self.root / ".trellis/.runtime/maven-verification/fast-repository.json"

        _, plan = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--module",
            "core",
            "--local-repository",
            str(repository),
            "--maven-executable",
            str(self.fake_maven),
            "--output",
            str(plan_path),
        )

        repository_argument = f"-Dmaven.repo.local={repository}"
        self.assertIn(repository_argument, plan["effectivePomCommand"])
        self.assertIn(repository_argument, plan["argv"])
        self.assertIn(repository_argument, plan["fallbackArgv"])
        self.assertEqual(plan["localRepositoryOverride"], str(repository))
        self.assertEqual(plan["toolchain"]["maven"]["localRepository"], str(repository))

        _, result = self.helper("run", "--plan-json", str(plan_path))
        self.assertEqual(result["status"], "success")
        executed = (self.root / ".trellis/.runtime/fake-maven-argv.txt").read_text(encoding="utf-8")
        self.assertIn(repository_argument, executed.splitlines())

        _, checked = self.helper(
            "check",
            "--latest",
            "--require-plan",
            str(plan_path),
        )
        self.assertEqual(checked["status"], "reusable")

    def test_explicit_repository_path_is_excluded_from_semantic_fingerprint(self) -> None:
        """不同本机仓库路径不应破坏跨目录可比较的计划语义指纹。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        plans = []
        for name in ("first repository", "second repository"):
            repository = self.root / name
            repository.mkdir()
            plan_path = self.root / f".trellis/.runtime/maven-verification/{name}.json"
            _, plan = self.helper(
                "plan",
                "--mode",
                "quick",
                "--goal",
                "compile",
                "--module",
                "core",
                "--local-repository",
                str(repository),
                "--effective-pom",
                "effective-pom.xml",
                "--maven-executable",
                str(self.fake_maven),
                "--output",
                str(plan_path),
            )
            plans.append(plan)

        self.assertNotEqual(plans[0]["argv"], plans[1]["argv"])
        self.assertNotEqual(
            plans[0]["planIntegrityFingerprint"],
            plans[1]["planIntegrityFingerprint"],
        )
        self.assertEqual(plans[0]["planFingerprint"], plans[1]["planFingerprint"])

    def test_configured_repository_path_is_excluded_from_semantic_fingerprint(self) -> None:
        """Maven 环境参数中的仓库路径也必须只进入本机完整性指纹。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        plans = []
        for name in ("first repository", "second repository"):
            repository = self.root / name
            plan_path = self.root / f".trellis/.runtime/maven-verification/config-{name}.json"
            _, plan = self.helper(
                "plan",
                "--mode",
                "quick",
                "--goal",
                "compile",
                "--module",
                "core",
                "--effective-pom",
                "effective-pom.xml",
                "--maven-executable",
                str(self.fake_maven),
                "--output",
                str(plan_path),
                env={
                    **self.env,
                    "MAVEN_ARGS": f'-Dmaven.repo.local="{repository}"',
                },
            )
            plans.append(plan)

        self.assertNotEqual(
            plans[0]["toolchain"]["maven"]["arguments"],
            plans[1]["toolchain"]["maven"]["arguments"],
        )
        self.assertNotEqual(
            plans[0]["planIntegrityFingerprint"],
            plans[1]["planIntegrityFingerprint"],
        )
        self.assertEqual(plans[0]["planFingerprint"], plans[1]["planFingerprint"])

    def test_offline_explicit_local_repository_must_exist(self) -> None:
        """离线计划不得接受尚未准备的显式本地仓库。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        _, payload = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--module",
            "core",
            "--offline",
            "yes",
            "--local-repository",
            str(self.root / "missing repository"),
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            expected_code=5,
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["reasons"][0]["code"], "local-repository-missing-offline")

    def test_model_fingerprint_ignores_diagnostic_absolute_paths(self) -> None:
        """相同 Maven 模型输入位于不同用户目录时保持可比较指纹。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        plans = []
        for name in ("first", "second"):
            config_home = Path(self.temp.name) / f"{name}-maven-config"
            config_home.mkdir(parents=True)
            (config_home / "settings.xml").write_text(
                "<settings><localRepository>/tmp/shared-maven-repository</localRepository></settings>\n",
                encoding="utf-8",
            )
            plan_path = self.root / f".trellis/.runtime/maven-verification/{name}.json"
            _, plan = self.helper(
                "plan",
                "--mode",
                "quick",
                "--goal",
                "compile",
                "--effective-pom",
                "effective-pom.xml",
                "--maven-executable",
                str(self.fake_maven),
                "--output",
                str(plan_path),
                env={**self.env, "MAVEN_CONFIG": str(config_home)},
            )
            plans.append(plan)

        self.assertNotEqual(
            plans[0]["rawPom"]["modelInputs"][0]["path"],
            plans[1]["rawPom"]["modelInputs"][0]["path"],
        )
        self.assertEqual(plans[0]["rawPom"]["fingerprint"], plans[1]["rawPom"]["fingerprint"])
        self.assertEqual(plans[0]["pom"]["fingerprint"], plans[1]["pom"]["fingerprint"])
        self.assertEqual(plans[0]["planFingerprint"], plans[1]["planFingerprint"])

    def test_default_phase_mapping_reports_repackage(self) -> None:
        """execution 未写 phase 时仍按已确认 goal 默认阶段识别 repackage。"""
        self.write("effective-pom.xml", REPACKAGE_EFFECTIVE_POM)
        self.write("app/src/main/java/App.java", "class App { int value; }")

        plan = self.plan("final", "package", "--module", "app")

        binding = next(
            item
            for item in plan["lifecycle"]["expensiveBindings"]
            if item.get("artifact") == "repackage"
        )
        self.assertEqual(binding["phase"], "package")
        self.assertEqual(binding["phaseSource"], "default-goal-mapping")

    def test_sources_skip_requires_confirmed_plugin_version(self) -> None:
        """未确认支持 skipSource 的插件版本不能自动添加跳过参数。"""
        self.write("effective-pom.xml", EFFECTIVE_POM.replace("3.3.1", "2.4.0"))
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan()

        self.assertNotIn("-Dmaven.source.skip=true", plan["argv"])
        self.assertEqual(plan["lifecycle"]["skippedBindings"], [])
        self.assertTrue(any(item["code"] == "sources-skip-unsupported" for item in plan["warnings"]))

    def test_test_jar_no_fork_is_classified_as_sources(self) -> None:
        """test-jar-no-fork 也必须进入 sources 成本与跳过语义。"""
        self.write(
            "effective-pom.xml",
            EFFECTIVE_POM.replace("<goal>jar</goal>", "<goal>test-jar-no-fork</goal>"),
        )
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan()

        self.assertIn("-Dmaven.source.skip=true", plan["argv"])
        self.assertEqual(
            [item["artifact"] for item in plan["lifecycle"]["expensiveBindings"]],
            ["sources"],
        )
        self.assertEqual(
            [item["goal"] for item in plan["lifecycle"]["skippedBindings"]],
            ["test-jar-no-fork"],
        )

    def test_unresolved_dependency_coordinate_does_not_guess_consumer(self) -> None:
        """未解析坐标降低置信度，不能靠唯一 artifactId 猜消费者。"""
        self.write(
            "app/pom.xml",
            APP_POM.replace(
                "<groupId>org.example</groupId>\n      <artifactId>core</artifactId>",
                "<groupId>${missing.group}</groupId>\n      <artifactId>core</artifactId>",
            ),
        )
        self.run_command(["git", "add", "app/pom.xml"])
        self.run_command(["git", "commit", "-qm", "unresolved dependency fixture"])
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        plan = self.plan("final")

        self.assertEqual(plan["inferredConsumers"], [])
        self.assertEqual(plan["executionModules"], ["core"])
        self.assertEqual(plan["confidence"], "low")
        self.assertTrue(any(item["code"] == "dependency-coordinate-unresolved" for item in plan["warnings"]))

    def test_run_preserves_exact_argv_and_reusable_evidence(self) -> None:
        """run 精确执行 argv，runtime 产物不让 evidence 自我失效。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        plan = self.plan("final", "test", "--consumer", "app", "--test", "CoreTest")
        plan_path = self.root / ".trellis/.runtime/maven-verification/final-test.json"

        _, result = self.helper(
            "run",
            "--plan-stdin",
            "--json",
            input_text=plan_path.read_text(encoding="utf-8"),
        )

        self.assertEqual(result["status"], "success")
        argv_lines = (self.root / ".trellis/.runtime/fake-maven-argv.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(argv_lines, plan["argv"][1:])
        evidence = self.root / result["evidence"]
        data = json.loads(evidence.read_text(encoding="utf-8"))
        self.assertEqual(data["execution"]["tests"]["run"], 2)

        _, checked = self.helper(
            "check",
            "--latest",
            "--require-plan",
            str(plan_path),
        )
        self.assertEqual(checked["status"], "reusable")
        self.assertEqual(checked["coverage"], "full")

    def test_check_does_not_execute_project_wrapper(self) -> None:
        """audit-only check 只校验 wrapper 指纹，不执行可能下载发行包的 wrapper。"""
        wrapper = self.root / "mvnw"
        shutil.copyfile(self.fake_maven, wrapper)
        wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR)
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        marker = Path(self.temp.name) / "wrapper-version-called.txt"
        env = {**self.env, "FAKE_MAVEN_VERSION_MARKER": str(marker)}
        plan_path = self.root / ".trellis/.runtime/maven-verification/wrapper.json"
        _, plan = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--effective-pom",
            "effective-pom.xml",
            "--output",
            str(plan_path),
            "--json",
            env=env,
        )
        self.assertEqual(plan["toolchain"]["maven"]["source"], "project-wrapper")
        self.helper("run", "--plan-json", str(plan_path), env=env)
        self.assertTrue(marker.is_file())
        marker.unlink()

        _, checked = self.helper(
            "check",
            "--latest",
            "--require-plan",
            str(plan_path),
            env=env,
        )

        self.assertEqual(checked["status"], "reusable")
        self.assertFalse(marker.exists())

        wrapper.write_text(wrapper.read_text(encoding="utf-8") + "# changed\n", encoding="utf-8")
        _, stale = self.helper("check", "--latest", env=env, expected_code=3)
        self.assertEqual(stale["status"], "stale")
        self.assertTrue(
            any(item["code"] == "maven-executable-changed" for item in stale["reasons"])
        )
        self.assertFalse(marker.exists())

    def test_check_does_not_execute_explicit_project_wrapper(self) -> None:
        """显式指定当前项目 wrapper 时，audit-only check 仍不得执行它。"""
        wrapper = self.root / "mvnw"
        shutil.copyfile(self.fake_maven, wrapper)
        wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR)
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        marker = Path(self.temp.name) / "explicit-wrapper-version-called.txt"
        env = {**self.env, "FAKE_MAVEN_VERSION_MARKER": str(marker)}
        plan_path = self.root / ".trellis/.runtime/maven-verification/explicit-wrapper.json"
        _, plan = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(wrapper),
            "--output",
            str(plan_path),
            "--json",
            env=env,
        )
        self.assertEqual(plan["toolchain"]["maven"]["source"], "explicit")
        self.helper("run", "--plan-json", str(plan_path), env=env)
        self.assertTrue(marker.is_file())
        marker.unlink()

        _, checked = self.helper(
            "check",
            "--latest",
            "--require-plan",
            str(plan_path),
            env=env,
        )

        self.assertEqual(checked["status"], "reusable")
        self.assertFalse(marker.exists())

    def test_run_rejects_tampered_plan_semantics(self) -> None:
        """run 必须在执行前重算计划指纹，阻断 argv 篡改。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        plan["argv"] = ["/bin/true"]
        plan_path.write_text(json.dumps(plan), encoding="utf-8")

        _, result = self.helper("run", "--plan-json", str(plan_path), expected_code=5)

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["reasons"][0]["code"], "plan-fingerprint-mismatch")

    def test_run_rejects_tampered_plan_project_root(self) -> None:
        """本机完整性指纹必须阻断只修改绝对执行根的计划。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        plan["projectRoot"] = "/tmp"
        plan_path.write_text(json.dumps(plan), encoding="utf-8")

        _, result = self.helper("run", "--plan-json", str(plan_path), expected_code=5)

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["reasons"][0]["code"], "plan-fingerprint-mismatch")

    def test_run_marks_evidence_stale_when_source_changes_during_execution(self) -> None:
        """Maven 执行窗口内源码变化时不得签发成功 evidence。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"

        _, result = self.helper(
            "run",
            "--plan-json",
            str(plan_path),
            env={**self.env, "FAKE_MAVEN_MUTATE_SOURCE": "1"},
            expected_code=3,
        )

        self.assertEqual(result["status"], "stale")
        self.assertTrue(any(item["code"] == "workspace-changed-during-run" for item in result["reasons"]))
        evidence = json.loads((self.root / result["evidence"]).read_text(encoding="utf-8"))
        self.assertEqual(evidence["status"], "stale")

    def test_test_statistics_prefers_module_aggregate(self) -> None:
        """测试统计使用 Results 后的模块汇总，避免类级与汇总重复相加。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan("final", "test")
        plan_path = self.root / ".trellis/.runtime/maven-verification/final-test.json"

        _, result = self.helper(
            "run",
            "--plan-json",
            str(plan_path),
            env={**self.env, "FAKE_MAVEN_AGGREGATE_TESTS": "1"},
        )

        evidence = json.loads((self.root / result["evidence"]).read_text(encoding="utf-8"))
        self.assertEqual(evidence["execution"]["tests"]["run"], 5)

    def test_check_reports_partial_for_higher_lifecycle(self) -> None:
        """compile evidence 不能满足 test 要求。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        self.helper("run", "--plan-json", str(plan_path))

        _, checked = self.helper(
            "check",
            "--latest",
            "--require-goal",
            "test",
            expected_code=2,
        )

        self.assertEqual(checked["status"], "partial")
        self.assertEqual(checked["reasons"][0]["code"], "lifecycle-insufficient")

    def test_check_reports_partial_for_missing_sources_artifact(self) -> None:
        """跳过 sources 的 compile evidence 不能满足 sources 制品验收。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        self.helper("run", "--plan-json", str(plan_path))

        _, checked = self.helper(
            "check",
            "--latest",
            "--require-artifact",
            "sources",
            expected_code=2,
        )

        self.assertEqual(checked["status"], "partial")
        self.assertTrue(any(item["code"] == "artifacts-missing" for item in checked["reasons"]))

    def test_check_reports_stale_after_source_change(self) -> None:
        """evidence 产生后源码变化必须失效。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        self.helper("run", "--plan-json", str(plan_path))
        self.write("core/src/main/java/Core.java", "class Core { int other; }")

        _, checked = self.helper("check", "--latest", expected_code=3)

        self.assertEqual(checked["status"], "stale")
        self.assertTrue(any(item["code"] == "workspace-changed" for item in checked["reasons"]))

    def test_check_reports_stale_after_log_change(self) -> None:
        """命令日志内容被修改时 evidence 必须失效。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        _, result = self.helper("run", "--plan-json", str(plan_path))
        evidence = json.loads((self.root / result["evidence"]).read_text(encoding="utf-8"))
        log_path = self.root / evidence["execution"]["log"]
        log_path.write_text("truncated\n", encoding="utf-8")

        _, checked = self.helper("check", "--latest", expected_code=3)

        self.assertEqual(checked["status"], "stale")
        self.assertTrue(any(item["code"] == "log-changed" for item in checked["reasons"]))

    def test_check_rejects_tampered_require_plan(self) -> None:
        """check 不得信任被篡改但保留旧指纹的 require plan。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        self.helper("run", "--plan-json", str(plan_path))
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        plan["coverage"]["level"] = "package"
        plan_path.write_text(json.dumps(plan), encoding="utf-8")

        _, checked = self.helper(
            "check",
            "--latest",
            "--require-plan",
            str(plan_path),
            expected_code=5,
        )

        self.assertEqual(checked["status"], "blocked")
        self.assertEqual(checked["reasons"][0]["code"], "plan-fingerprint-mismatch")

    def test_latest_corrupt_evidence_blocks_without_falling_back(self) -> None:
        """最新 evidence 损坏时保留现场并阻塞，不能回退较旧成功证据。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        self.helper("run", "--plan-json", str(plan_path))
        evidence_dir = self.root / ".trellis/.runtime/maven-verification"
        corrupt = evidence_dir / "99991231235959999-deadbeefdead.json"
        corrupt.write_text("{broken", encoding="utf-8")

        _, checked = self.helper("check", "--latest", expected_code=5)

        self.assertEqual(checked["status"], "blocked")
        self.assertEqual(checked["reasons"][0]["code"], "json-unreadable")
        self.assertTrue(corrupt.is_file())

    def test_check_rejects_tampered_evidence_coverage(self) -> None:
        """check 必须阻断被修改的 evidence 覆盖字段。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        _, result = self.helper("run", "--plan-json", str(plan_path))
        evidence_path = self.root / result["evidence"]
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        evidence["coverage"]["level"] = "install"
        evidence_path.write_text(json.dumps(evidence), encoding="utf-8")

        _, checked = self.helper("check", "--latest", expected_code=5)

        self.assertEqual(checked["status"], "blocked")
        self.assertEqual(checked["reasons"][0]["code"], "evidence-fingerprint-mismatch")

    def test_check_reports_stale_after_external_parent_change(self) -> None:
        """外部父 POM变化必须让既有 evidence 失效。"""
        parent_pom = self.home / ".m2/repository/org/example/external-parent/1.0/external-parent-1.0.pom"
        parent_pom.parent.mkdir(parents=True)
        parent_pom.write_text(
            "<project><modelVersion>4.0.0</modelVersion><groupId>org.example</groupId>"
            "<artifactId>external-parent</artifactId><version>1.0</version></project>\n",
            encoding="utf-8",
        )
        root_with_parent = ROOT_POM.replace(
            "<modelVersion>4.0.0</modelVersion>",
            "<modelVersion>4.0.0</modelVersion><parent><groupId>org.example</groupId>"
            "<artifactId>external-parent</artifactId><version>1.0</version><relativePath/>"
            "</parent>",
        )
        self.write("pom.xml", root_with_parent)
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        self.helper("run", "--plan-json", str(plan_path))
        parent_pom.write_text(
            "<project><modelVersion>4.0.0</modelVersion><groupId>org.example</groupId>"
            "<artifactId>external-parent</artifactId><version>1.0</version>"
            "<properties><changed>true</changed></properties></project>\n",
            encoding="utf-8",
        )

        _, checked = self.helper("check", "--latest", expected_code=3)

        self.assertEqual(checked["status"], "stale")
        self.assertTrue(any(item["code"] == "pom-changed" for item in checked["reasons"]))

    def test_check_reports_stale_after_supplied_effective_pom_change(self) -> None:
        """仓外 frozen effective POM变化必须让既有 evidence 失效。"""
        external_effective = Path(self.temp.name) / "external-effective-pom.xml"
        external_effective.write_text(textwrap.dedent(EFFECTIVE_POM).strip() + "\n", encoding="utf-8")
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        plan_path = self.root / ".trellis/.runtime/maven-verification/external-effective.json"
        self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--effective-pom",
            str(external_effective),
            "--maven-executable",
            str(self.fake_maven),
            "--output",
            str(plan_path),
        )
        self.helper("run", "--plan-json", str(plan_path))
        external_effective.write_text(
            external_effective.read_text(encoding="utf-8").replace("3.3.1", "3.3.2"),
            encoding="utf-8",
        )

        _, checked = self.helper("check", "--latest", expected_code=3)

        self.assertEqual(checked["status"], "stale")
        self.assertTrue(any(item["code"] == "effective-pom-changed" for item in checked["reasons"]))

    def test_failed_run_still_writes_failed_evidence(self) -> None:
        """失败 Maven 命令也要保留日志和 evidence。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        self.plan()
        plan_path = self.root / ".trellis/.runtime/maven-verification/quick-compile.json"
        failed_env = {**self.env, "FAKE_MAVEN_EXIT": "7"}

        _, result = self.helper(
            "run",
            "--plan-json",
            str(plan_path),
            env=failed_env,
            expected_code=7,
        )

        self.assertEqual(result["status"], "failed")
        evidence = json.loads((self.root / result["evidence"]).read_text(encoding="utf-8"))
        self.assertEqual(evidence["execution"]["exitCode"], 7)
        _, checked = self.helper("check", "--latest", expected_code=4)
        self.assertEqual(checked["status"], "failed")

    def test_test_pattern_requires_test_lifecycle(self) -> None:
        """compile 计划不得携带不会执行的测试 pattern。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        _, payload = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--test",
            "CoreTest",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            expected_code=5,
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["reasons"][0]["code"], "test-goal-insufficient")

    def test_missing_artifact_binding_fails_closed(self) -> None:
        """不存在的附属制品绑定不能被宣称为覆盖。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        _, payload = self.helper(
            "plan",
            "--mode",
            "final",
            "--goal",
            "package",
            "--artifact",
            "shade",
            "--effective-pom",
            "effective-pom.xml",
            "--maven-executable",
            str(self.fake_maven),
            expected_code=5,
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["reasons"][0]["code"], "artifact-binding-missing")


@unittest.skipUnless(
    Path("/proc/sys/kernel/osrelease").is_file()
    and "microsoft" in Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8").lower()
    and shutil.which("cmd.exe")
    and shutil.which("wslpath"),
    "仅在可调用 Windows 工具链的 WSL 中运行",
)
class WslWindowsMavenVerifyTest(unittest.TestCase):
    """验证 WSL 中 Windows 文件系统项目始终使用 Windows 工具链。"""

    def setUp(self) -> None:
        """在 Windows 临时目录创建带空格的 Git/Maven fixture。"""
        temp_result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[System.IO.Path]::GetTempPath()",
            ],
            capture_output=True,
            check=True,
        )
        windows_temp = temp_result.stdout.decode("utf-8-sig", errors="replace").strip()
        host_temp = subprocess.run(
            ["wslpath", "-u", windows_temp],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        self.root = Path(host_temp) / f"flower maven windows {os.getpid()}"
        self.root.mkdir()
        self.write("pom.xml", ROOT_POM)
        self.write("core/pom.xml", CORE_POM)
        self.write("core/src/main/java/Core.java", "class Core {}")
        self.write("app/pom.xml", APP_POM)
        self.write("app/src/main/java/App.java", "class App {}")
        self.write("effective-pom.xml", EFFECTIVE_POM)
        self.write(
            "mvnw.cmd",
            """
            @echo off
            if "%~1"=="-version" goto version
            if not exist .trellis\\.runtime mkdir .trellis\\.runtime
            > .trellis\\.runtime\\fake-windows-maven-argv.txt echo %~1
            shift
            :write_args
            if "%~1"=="" goto done
            >> .trellis\\.runtime\\fake-windows-maven-argv.txt echo %~1
            shift
            goto write_args
            :version
            echo Apache Maven 3.8.3
            echo Maven home: E:\\apache-maven-3.8.3
            echo Java version: 1.8.0_432, vendor: Test, runtime: C:\\Java\\jdk8\\jre
            :done
            exit /b 0
            """,
        )
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.name", "Tester"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.email", "tester@example.com"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "initial"], cwd=self.root, check=True)

    def tearDown(self) -> None:
        """删除 Windows 临时 fixture。"""
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, relative: str, content: str) -> None:
        """写入 Windows fixture 文件。"""
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).strip() + "\n", encoding="utf-8")

    def helper(self, *args: str, expected_code: int = 0) -> dict:
        """执行 helper 并返回 JSON。"""
        result = subprocess.run(
            ["python3", str(HELPER), *args],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        payload = json.loads(result.stdout)
        self.assertEqual(result.returncode, expected_code, result.stderr or payload)
        return payload

    def test_windows_mount_uses_wrapper_java_and_repository(self) -> None:
        """Windows 挂载项目从 plan 到 run 保持 Windows Maven/JDK/仓库。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")
        plan_path = self.root / ".trellis/.runtime/maven-verification/windows.json"
        plan = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--module",
            "core",
            "--effective-pom",
            "effective-pom.xml",
            "--output",
            str(plan_path),
        )

        self.assertEqual(plan["toolchain"]["maven"]["buildSide"], "windows")
        self.assertEqual(plan["toolchain"]["maven"]["source"], "project-wrapper")
        self.assertEqual(plan["toolchain"]["maven"]["runner"], "windows-cmd")
        self.assertTrue(plan["argv"][0].lower().endswith("mvnw.cmd"))
        self.assertEqual(plan["toolchain"]["java"]["major"], 8)
        self.assertRegex(plan["toolchain"]["maven"]["localRepositoryBuildPath"], r"^[A-Za-z]:\\")
        self.assertTrue(plan["toolchain"]["maven"]["localRepository"].startswith("/mnt/"))
        self.assertFalse(
            any(
                item["id"] == "user-settings" and item["path"].startswith("/root/")
                for item in plan["rawPom"]["modelInputs"]
            )
        )

        result = self.helper("run", "--plan-json", str(plan_path))

        self.assertEqual(result["status"], "success")
        evidence = json.loads((self.root / result["evidence"]).read_text(encoding="utf-8"))
        self.assertEqual(evidence["toolchain"]["maven"]["buildSide"], "windows")
        self.assertEqual(evidence["execution"]["hostArgv"][:4], ["cmd.exe", "/d", "/c", "call"])

    def test_windows_mount_rejects_wsl_ext4_repository(self) -> None:
        """Windows Maven 不得显式混用 WSL ext4 本地仓库。"""
        self.write("core/src/main/java/Core.java", "class Core { int value; }")

        payload = self.helper(
            "plan",
            "--mode",
            "quick",
            "--goal",
            "compile",
            "--module",
            "core",
            "--effective-pom",
            "effective-pom.xml",
            "--local-repository",
            "/tmp/wsl-only-maven-repository",
            expected_code=5,
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["reasons"][0]["code"], "path-side-mismatch")


if __name__ == "__main__":
    unittest.main()
