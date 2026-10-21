#!/usr/bin/env node
// Repository-only macOS development lifecycle. Never enters npm publication.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const repository = path.resolve(import.meta.dirname, '..');
const appName = 'codex-own 开发版.app';
const identifier = 'local.codex-own.development';
const require = createRequire(import.meta.url);
const extraSources = ['own/dev.mjs', 'own/test/dev.test.mjs', 'own/DEVELOPMENT.md'];
const writeNew = (file, value) => {
  if (fs.existsSync(file)) throw Error('Evidence already exists: ' + file);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
};
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options
});

export function sourceInventory(root) {
  const tracked = run('git', ['ls-files', '-z'], {cwd: root}).split('\0').filter(Boolean);
  const names = [...new Set([...tracked, ...extraSources.filter(n => fs.existsSync(path.join(root, n)))])].sort();
  const files = names.map(name => {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return {name, missing: true};
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return {name, link: fs.readlinkSync(file)};
    return {name, mode: stat.mode & 0o777, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
  });
  return {sha256: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), files};
}

export function assertDevelopment(app, {plist = require('plist'), expectedFingerprint} = {}) {
  const resources = path.join(app, 'Contents/Resources');
  const marker = JSON.parse(fs.readFileSync(path.join(resources, 'own-development.json')));
  const info = plist.parse(fs.readFileSync(path.join(app, 'Contents/Info.plist'), 'utf8'));
  if (info.CFBundleIdentifier !== identifier || info.CFBundleExecutable !== 'codex-own-launch' ||
      marker.schema !== 1 || marker.channel !== 'development' || marker.automaticUpdates !== false)
    throw Error('Refusing a non-development application: ' + app);
  if (expectedFingerprint && marker.sourceFingerprint !== expectedFingerprint)
    throw Error('Candidate source fingerprint mismatch');
  const launcher = fs.readFileSync(path.join(app, 'Contents/MacOS/codex-own-launch'), 'utf8');
  if (!launcher.includes('/.codex-own-dev') || !launcher.includes('/usr/bin/dscl'))
    throw Error('Development launcher does not preserve account home/profile isolation');
  return marker;
}

export function matchesOfficialInput(info, checkOutput) {
  const match = checkOutput.match(/mac-arm64:\s+(\S+)\s+\(build\s+(\d+)\)/);
  return Boolean(match && info.CFBundleIdentifier === 'com.openai.codex' &&
    info.CFBundleShortVersionString === match[1] && String(info.CFBundleVersion) === match[2]);
}

export function backupProfile(source, destination) {
  if (fs.existsSync(destination)) throw Error('Profile backup already exists');
  const skippedSockets = [];
  fs.cpSync(source, destination, {
    recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
    verbatimSymlinks: true,
    filter(file) {
      const stat = fs.lstatSync(file);
      if (stat.isSocket()) { skippedSockets.push(path.relative(source, file)); return false; }
      if (!stat.isDirectory() && !stat.isFile() && !stat.isSymbolicLink())
        throw Error('Unsupported profile entry: ' + path.relative(source, file));
      return true;
    }
  });
  return {path: destination, skippedSockets};
}

// The previous bundle is retained outside application discovery. A failed
// validation restores it; a partially installed candidate is retained as evidence.
export function replaceDevelopment({candidate, target, backup, failed, verify, rename = fs.renameSync}) {
  for (const destination of [backup, failed]) {
    if (fs.existsSync(destination)) throw Error('Recovery destination already exists: ' + destination);
  }
  if (!fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink())
    throw Error('Expected an existing regular development app directory');
  rename(target, backup);
  try {
    rename(candidate, target);
    verify(target);
  } catch (error) {
    if (fs.existsSync(target)) rename(target, failed);
    rename(backup, target);
    throw error;
  }
}

function nodeRuntime(home) {
  const stable = path.join(home, 'Library/Application Support/codex-own-independent/runtimes');
  const dev = path.join(home, '.codex-own-dev/Library/Application Support/codex-own-independent/runtimes');
  const candidates = [process.env.OWN_UPDATER_NODE, ...[dev, stable].flatMap(root => {
    const receipt = path.join(root, 'active.json');
    if (!fs.existsSync(receipt)) return [];
    const {version} = JSON.parse(fs.readFileSync(receipt));
    if (!/^[a-zA-Z0-9._-]+$/.test(version)) throw Error('Invalid active runtime version');
    return [path.join(root, 'versions', version, 'node/bin/node')];
  }), process.execPath].filter(Boolean);
  for (const node of candidates) {
    try {
      const actual = JSON.parse(run(node, ['-p', 'JSON.stringify({version:process.versions.node,arch:process.arch,platform:process.platform})']));
      if (+actual.version.split('.')[0] < 22 || actual.arch !== 'arm64' || actual.platform !== 'darwin') continue;
      const libs = run('/usr/bin/otool', ['-L', node]).trim().split('\n').slice(1);
      if (libs.some(line => !/^\s*\/(usr\/lib|System\/Library)\//.test(line))) continue;
      return {node, ...actual};
    } catch {}
  }
  throw Error('No standalone macOS ARM64 Node >=22 available; inspect private runtime installation');
}

function processRows() {
  return run('/bin/ps', ['-axo', 'pid=,ppid=,command=']).split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{pid: +match[1], parent: +match[2], command: match[3]}] : [];
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node own/dev.mjs [--install] [--launch]\nBuilds a frozen source snapshot, runs native/GUI checks, then optionally backs up and replaces the fixed development app. --launch requires --install. Reports are in out/dev-build-*.noindex.');
    return;
  }
  if (args.some(a => !['--install', '--launch'].includes(a)) || (args.includes('--launch') && !args.includes('--install')))
    throw Error('Invalid arguments; use --help');
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Development lifecycle supports macOS ARM64');
  const install = args.includes('--install'), home = os.userInfo().homedir;
  const target = path.join('/Applications', appName);
  if (install) {
    // Existence, ownership and signature are checked before creating output.
    assertDevelopment(target);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
    const ancestors = new Set([process.pid]);
    const rows = processRows();
    for (let row = rows.find(r => r.pid === process.pid); row; row = rows.find(r => r.pid === row.parent)) {
      if (ancestors.has(row.parent)) break;
      ancestors.add(row.parent);
    }
    if (rows.some(r => ancestors.has(r.pid) && r.command.startsWith(target + '/')))
      throw Error('Run installation from a terminal/Agent outside the development app');
  }
  const runtime = nodeRuntime(home);
  const {macSigningArguments} = await import('./builders/mac-signing.mjs');
  const signer = macSigningArguments(true)[1];
  const outputRoot = path.join(repository, 'out'); fs.mkdirSync(outputRoot, {recursive: true});
  const lock = path.join(outputRoot, '.development-build.lock');
  if (fs.existsSync(lock)) throw Error('Development lifecycle lock exists; inspect its owner before retrying: ' + lock);
  fs.mkdirSync(lock, {mode: 0o700});
  writeNew(path.join(lock, 'owner.json'), {pid: process.pid, started: new Date().toISOString()});
  const fresh = fs.mkdtempSync(path.join(outputRoot, 'dev-build-'));
  const output = fresh + '.noindex';
  if (fs.existsSync(output)) throw Error('Build output already exists');
  fs.renameSync(fresh, output);
  const report = {schema: 1, started: new Date().toISOString(), output, target, runtime, signer, stages: []};
  const env = {...process.env, OWN_UPDATER_NODE: runtime.node};
  for (const key of Object.keys(env)) if (/^(OWN_(VERSION|DEVELOPMENT|PREPARED_APP|CLI_SOURCE|GUI_MANIFEST|AGENT_BRIDGE_MODULE)|CODEX_|OPENAI_|CHATGPT_|ELECTRON_|NODE_OPTIONS$|NODE_REPL_|BASH_ENV$|ZDOTDIR$)/.test(key)) delete env[key];
  const execute = (stage, command, argv, cwd = repository, moreEnv = {}) => {
    console.error('[codex-own-dev] ' + stage);
    const log = path.join(output, stage + '.log');
    if (fs.existsSync(log)) throw Error('Stage log exists');
    const fd = fs.openSync(log, 'wx', 0o600);
    let result;
    try { result = spawnSync(command, argv, {cwd, env: {...env, ...moreEnv}, stdio: ['ignore', fd, fd]}); }
    finally { fs.closeSync(fd); }
    report.stages.push({stage, ok: result.status === 0, log});
    if (result.status !== 0) throw Error('Stage failed: ' + stage + '; see ' + log);
  };
  try {
    report.sourceRef = run('git', ['rev-parse', 'HEAD']).trim();
    report.branch = run('git', ['branch', '--show-current']).trim();
    const inventory = sourceInventory(repository); report.sourceFingerprint = inventory.sha256;
    writeNew(path.join(output, 'source-inventory.json'), inventory);
    const snapshot = path.join(output, 'source');
    execute('snapshot', 'git', ['clone', '--shared', '--no-checkout', repository, snapshot]);
    run('git', ['checkout', '--detach', report.sourceRef], {cwd: snapshot});
    for (const item of inventory.files) {
      const dest = path.join(snapshot, item.name);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      if (item.missing) continue;
      fs.mkdirSync(path.dirname(dest), {recursive: true});
      if (item.link) fs.symlinkSync(item.link, dest);
      else fs.copyFileSync(path.join(repository, item.name), dest, fs.constants.COPYFILE_EXCL);
    }
    if (sourceInventory(repository).sha256 !== inventory.sha256 || sourceInventory(snapshot).sha256 !== inventory.sha256)
      throw Error('Source changed while snapshotting; retry with a stable checkout');
    for (const name of ['node_modules', 'own/node_modules']) {
      const dependency = path.join(repository, name); fs.statSync(dependency);
      fs.symlinkSync(dependency, path.join(snapshot, name), 'dir');
    }
    // Add provenance at the existing marker creation point, before signing.
    const builder = path.join(snapshot, 'own/builders/mac.mjs');
    const original = fs.readFileSync(builder, 'utf8');
    const needle = "automaticUpdates:false,sourceRef:";
    if (original.split(needle).length !== 2) throw Error('Unknown development marker contract');
    fs.writeFileSync(builder, original.replace(needle, `automaticUpdates:false,sourceFingerprint:${JSON.stringify(inventory.sha256)},sourceRef:`));
    execute('unit', runtime.node, ['--test', '--test-concurrency=2', 'test/dev.test.mjs', 'test/instance-isolation.test.mjs', 'test/mac-signing.test.mjs'], path.join(snapshot, 'own'));
    const build = path.join(output, 'candidate');
    execute('official-version', runtime.node, ['scripts/sync-upstream.js', '--check-only', '--platform', 'mac-arm64'], snapshot);
    const check = fs.readFileSync(path.join(output, 'official-version.log'), 'utf8');
    const inputs = ['/Applications/ChatGPT.app', '/Applications/Codex.app'];
    let upstream;
    for (const input of inputs) {
      if (!fs.existsSync(path.join(input, 'Contents/Info.plist'))) continue;
      const info = require('plist').parse(fs.readFileSync(path.join(input, 'Contents/Info.plist'), 'utf8'));
      if (!matchesOfficialInput(info, check)) continue;
      try {
        run('/usr/bin/codesign', ['--verify', '--deep', '--strict', input]);
        // Require OpenAI's signed, designated identity, rather than a renamed fork.
        run('/usr/bin/codesign', ['--verify', '-R', '=anchor apple generic and identifier "com.openai.codex" and certificate leaf[subject.OU] = "2DC432GLL2"', input]);
      } catch { continue; }
      upstream = input;
      report.upstreamInput = {path: input, version: info.CFBundleShortVersionString, build: info.CFBundleVersion, originalSignatureVerified: true};
      break;
    }
    execute('build', runtime.node, ['own/build.mjs', '--local-only', '--development', '--output', build, ...(upstream ? ['--upstream-app', upstream] : [])], snapshot);
    const result = JSON.parse(fs.readFileSync(path.join(build, 'local-build.json')));
    const candidate = result.app;
    assertDevelopment(candidate, {expectedFingerprint: inventory.sha256});
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=identifier "${identifier}" and certificate leaf = H"${signer.toLowerCase()}"`, candidate]);
    const bridge = path.join(candidate, 'Contents/Resources/own-updater/lib/subagent-bridge.cjs');
    for (const [stage, script] of [['protocol', 'test-official-compat.mjs'], ['patch', 'test-patch-compat.mjs'], ['history', 'test-history-resume.mjs']])
      execute(stage, runtime.node, ['own/ci/' + script, candidate], snapshot, {OWN_AGENT_BRIDGE_MODULE: bridge});
    const cache = path.join(home, 'Library/Application Support/codex-own-independent/runtimes/npm-assets');
    execute('gui', runtime.node, ['own/ci/test-desktop-startup.mjs', candidate, path.join(output, 'gui'), ...(fs.existsSync(cache) ? [cache] : [])], snapshot);
    report.candidate = candidate; report.verified = true;
    if (install) {
      console.error('[codex-own-dev] Gracefully quitting the development app for installation');
      const main = target + '/Contents/MacOS/ChatGPT';
      if (processRows().some(r => r.command.startsWith(main)))
        run('/usr/bin/osascript', ['-e', `tell application id "${identifier}" to quit`], {timeout: 15000});
      for (let i = 0; i < 60 && processRows().some(r => r.command.startsWith(main)); i++) await pause(500);
      if (processRows().some(r => r.command.startsWith(main))) throw Error('Development app has not exited; installation deferred');
      // Refuse surviving backends instead of replacing binaries beneath them.
      const remaining = processRows().filter(r => r.command.startsWith(target + '/') && !r.command.includes('browser_crashpad_handler'));
      if (remaining.length) throw Error('Development child processes remain; installation deferred, PIDs: ' + remaining.map(r => r.pid).join(','));
      assertDevelopment(target);
      const data = path.join(home, '.codex-own-dev/Library/Application Support/codex-own-independent');
      if (fs.existsSync(data)) {
        report.dataBackup = path.join(output, 'profile-backup');
        if (fs.existsSync(report.dataBackup)) throw Error('Profile backup exists');
        console.error('[codex-own-dev] Backing up the profile (transient sockets are recorded separately)');
        report.profileBackup = backupProfile(data, report.dataBackup);
      }
      report.appBackup = path.join(output, 'previous-development.bundle');
      const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
      execute('unregister-candidate', lsregister, ['-u', candidate]);
      replaceDevelopment({candidate, target, backup: report.appBackup, failed: path.join(output, 'failed-development.bundle'), verify: app => {
        assertDevelopment(app, {expectedFingerprint: inventory.sha256});
        run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      }});
      report.installed = true;
      execute('register', lsregister, ['-f', target]);
      if (args.includes('--launch')) {
        execute('launch', '/usr/bin/open', ['-a', target]);
        for (let i = 0; i < 40 && !processRows().some(r => r.command.startsWith(main)); i++) await pause(500);
        if (!processRows().some(r => r.command.startsWith(main))) throw Error('Installed app did not start');
        report.launched = true;
      }
    }
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.message;
    throw error;
  } finally {
    report.finished = new Date().toISOString();
    writeNew(path.join(output, 'result.json'), report);
    fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock);
    console.error('[codex-own-dev] Report: ' + path.join(output, 'result.json'));
  }
  console.log(JSON.stringify(report));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
