const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

/**
 * 写入可执行的测试替身。
 *
 * @param {string} target 文件路径。
 * @param {string} content 脚本内容。
 * @return {void}
 */
function writeExecutable(target, content) {
    fs.writeFileSync(target, content, { mode: 0o755 });
}

test('run.sh 将旧运行时产物迁出 Plugin 管理树', { skip: process.platform === 'win32' }, t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-rpa-runtime-layout-'));
    const sourceSkill = path.resolve(__dirname, '..', '..');
    const skillRoot = path.join(tempRoot, 'skill');
    const recorderRoot = path.join(skillRoot, 'recorder');
    const projectRoot = path.join(tempRoot, 'project');
    const dataRoot = path.join(projectRoot, '.craft-rpa');
    const fakeBin = path.join(tempRoot, 'bin');
    let launchPid = null;

    t.after(() => {
        if (launchPid !== null) {
            try { process.kill(launchPid, 'SIGTERM'); } catch (error) { /* 测试进程可能已结束。 */ }
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    fs.cpSync(sourceSkill, skillRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });

    const profileTarget = path.join(dataRoot, 'profile');
    const sessionTarget = path.join(dataRoot, 'sessions', 'old', 'session.jsonl');
    fs.mkdirSync(profileTarget, { recursive: true });
    fs.mkdirSync(path.dirname(sessionTarget), { recursive: true });
    fs.writeFileSync(path.join(profileTarget, 'preserved.txt'), 'profile\n');
    fs.writeFileSync(sessionTarget, '{"kind":"legacy"}\n');
    fs.symlinkSync(profileTarget, path.join(recorderRoot, 'profile'), 'dir');
    fs.symlinkSync(sessionTarget, path.join(recorderRoot, 'session.jsonl'));
    fs.mkdirSync(path.join(recorderRoot, 'node_modules', 'playwright'), { recursive: true });
    fs.writeFileSync(path.join(recorderRoot, 'node_modules', 'playwright', 'package.json'), '{}\n');

    writeExecutable(path.join(fakeBin, 'npm'), `#!/usr/bin/env bash
mkdir -p "$PWD/node_modules/playwright"
printf '{}\\n' > "$PWD/node_modules/playwright/package.json"
`);
    writeExecutable(path.join(fakeBin, 'node'), `#!/usr/bin/env bash
printf '%s\\n' "$CRAFT_RPA_SESSION_FILE" > "$CRAFT_RPA_HOME/fake-session-file"
printf '%s\\n' "$CRAFT_RPA_PROFILE_DIR" > "$CRAFT_RPA_HOME/fake-profile-dir"
printf '%s\\n' "$CRAFT_RPA_PLAYWRIGHT_MODULE" > "$CRAFT_RPA_HOME/fake-playwright-module"
while true; do /bin/sleep 1; done
`);

    const result = spawnSync('bash', [path.join(skillRoot, 'scripts', 'run.sh'), 'start', 'about:blank'], {
        cwd: projectRoot,
        env: {
            ...process.env,
            CRAFT_RPA_HOME: dataRoot,
            PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
        },
        encoding: 'utf8',
        timeout: 10000,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    launchPid = Number.parseInt(fs.readFileSync(path.join(dataRoot, '.launch.pid'), 'utf8'), 10);
    assert.equal(Number.isInteger(launchPid), true);
    assert.equal(fs.existsSync(path.join(recorderRoot, 'profile')), false);
    assert.equal(fs.existsSync(path.join(recorderRoot, 'session.jsonl')), false);
    assert.equal(fs.existsSync(path.join(recorderRoot, 'node_modules')), false);
    assert.equal(fs.readFileSync(path.join(profileTarget, 'preserved.txt'), 'utf8'), 'profile\n');
    assert.equal(fs.readFileSync(sessionTarget, 'utf8'), '{"kind":"legacy"}\n');

    const runtimeRoot = path.join(dataRoot, 'runtime', 'recorder');
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'node_modules', 'playwright', 'package.json')), true);
    assert.equal(
        fs.readFileSync(path.join(dataRoot, 'fake-profile-dir'), 'utf8').trim(),
        profileTarget,
    );
    assert.equal(
        fs.readFileSync(path.join(dataRoot, 'fake-playwright-module'), 'utf8').trim(),
        path.join(runtimeRoot, 'node_modules', 'playwright'),
    );
    const sessionFile = fs.readFileSync(path.join(dataRoot, 'fake-session-file'), 'utf8').trim();
    assert.equal(sessionFile.startsWith(path.join(dataRoot, 'sessions')), true);
    assert.equal(sessionFile.endsWith(path.join('', 'session.jsonl')), true);
    assert.equal(fs.existsSync(sessionFile), true);
});
