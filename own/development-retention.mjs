// Repository tooling only (excluded from npm): bounded development recovery.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const parts = ['source', 'profile-backup', 'previous-development.bundle', 'candidate', 'official-cli', 'failed-development.bundle'];
const recovery = ['source', 'profile-backup', 'previous-development.bundle'];
const exists = p => fs.existsSync(p) || (() => {try {fs.lstatSync(p); return true;} catch {return false;}})();
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const run = (cmd, args, options = {}) => execFileSync(cmd, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options});
function directory(p) {
  const s = fs.lstatSync(p);
  if (!s.isDirectory() || s.isSymbolicLink() || fs.realpathSync(p) !== p) throw Error('Unsafe directory: ' + p);
  return s;
}
function write(p, value) {
  if (exists(p)) throw Error('Evidence exists: ' + p);
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
}
const hash = p => {
  const h = crypto.createHash('sha256'), fd = fs.openSync(p, 'r'), b = Buffer.alloc(1024 * 1024);
  try {for (let n; (n = fs.readSync(fd, b)) > 0;) h.update(b.subarray(0, n));} finally {fs.closeSync(fd);}
  return h.digest('hex');
};
function removeOwnedTree(root) {
  // Runtime caches deliberately contain 0500 directories. Only normalize the
  // already-authorized disposable tree, never traverse dependency links.
  function writable(p) {
    const s = fs.lstatSync(p);
    if (!s.isDirectory() || s.isSymbolicLink()) return;
    if (s.uid !== process.getuid()) throw Error('Disposable directory is not owned by current user: ' + p);
    if ((s.mode & 0o700) !== 0o700) fs.chmodSync(p, (s.mode & 0o777) | 0o700);
    for (const e of fs.readdirSync(p)) writable(path.join(p, e));
  }
  directory(root); writable(root);
  fs.rmSync(root, {recursive: true, maxRetries: 5, retryDelay: 200});
}
function files(root, relative = '') {
  const result = [];
  for (const e of fs.readdirSync(path.join(root, relative), {withFileTypes: true})) {
    const name = path.join(relative, e.name), p = path.join(root, name), s = fs.lstatSync(p);
    if (s.isDirectory()) result.push(...files(root, name));
    else if (s.isFile() || s.isSymbolicLink()) result.push({name, mode: s.mode & 0o777, size: s.size, link: s.isSymbolicLink() ? fs.readlinkSync(p) : null});
    else throw Error('Unsupported backup entry: ' + p);
  }
  return result;
}
function marker(target) {
  directory(target);
  const value = json(path.join(target, 'Contents/Resources/own-development.json'));
  if (value.schema !== 1 || value.channel !== 'development' || value.automaticUpdates !== false || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint))
    throw Error('Unrecognized development installation');
  return value;
}
export function developmentBuildRoots(repository) {
  let scope = path.resolve(repository);
  // A build launched from an isolated release checkout shares the outer
  // workspace's retention boundary, rather than accumulating its own two pairs.
  while (path.basename(scope) === 'repo' && path.basename(path.dirname(path.dirname(scope))) === 'out') {
    const outer = path.dirname(path.dirname(path.dirname(scope)));
    if (!exists(path.join(outer, '.git'))) break;
    scope = outer;
  }
  const output = path.join(scope, 'out'), roots = [output];
  directory(output);
  // Isolated release checkouts use out/<operation>/repo/out. Never walk source trees.
  for (const e of fs.readdirSync(output, {withFileTypes: true})) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    const nested = path.join(output, e.name, 'repo/out');
    if (exists(nested)) {directory(nested); roots.push(nested);}
  }
  return roots;
}
function assertIdle(roots, allowedLock) {
  for (const root of roots) {
    directory(root);
    const lock = path.join(root, '.development-build.lock');
    if (!exists(lock)) continue;
    if (!allowedLock || lock !== allowedLock || json(path.join(lock, 'owner.json')).pid !== process.pid)
      throw Error('Development build lock exists: ' + lock);
  }
}
function stamp(p) {
  const s = directory(p);
  return {dev: s.dev, ino: s.ino, mtimeMs: s.mtimeMs};
}
function processes() {return run('/bin/ps', ['-axo', 'command=']).split('\n');}
function referenced(p, rows) {return rows.some(row => row.includes(p));}
export function planDevelopmentCleanup({repository, target, liveData, now = Date.now(), allowedLock}) {
  const roots = developmentBuildRoots(repository);
  assertIdle(roots, allowedLock);
  const installed = marker(target), builds = [], warnings = [];
  for (const root of roots) for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (!/^dev-build-[A-Za-z0-9_-]+\.noindex$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const dir = path.join(root, entry.name), result = path.join(dir, 'result.json');
    directory(dir);
    if (!exists(result)) {warnings.push({path: dir, reason: 'INCOMPLETE_BUILD'}); continue;}
    const report = json(result), inventoryFile = path.join(dir, 'source-inventory.json');
    if (report.output !== dir || report.target !== target || !report.sourceFingerprint || !exists(inventoryFile)) {
      warnings.push({path: dir, reason: 'UNKNOWN_PROVENANCE'}); continue;
    }
    const inventory = json(inventoryFile);
    if (inventory.sha256 !== report.sourceFingerprint || !Array.isArray(inventory.files) ||
        crypto.createHash('sha256').update(JSON.stringify(inventory.files)).digest('hex') !== inventory.sha256)
      throw Error('Source inventory mismatch: ' + dir);
    const pin = path.join(dir, 'retention-pin.json');
    if (exists(pin)) {
      const p = json(pin);
      if (!p.reason || !Number.isFinite(Date.parse(p.reviewAfter))) throw Error('Invalid retention pin: ' + pin);
      // An expired pin requires review; expiry never authorizes deletion.
      report.pin = p;
    }
    builds.push({dir, root, report, resultSha256: hash(result), inventorySha256: hash(inventoryFile)});
  }
  const successful = builds.filter(b => b.report.ok && b.report.installed && b.report.verified &&
    recovery.every(n => exists(path.join(b.dir, n)))).sort((a, b) => Date.parse(b.report.finished) - Date.parse(a.report.finished));
  const current = successful.find(b => b.report.sourceFingerprint === installed.sourceFingerprint);
  if (!current) throw Error('Current installed source fingerprint has no complete verified recovery build');
  const previous = successful.find(b => b !== current), kept = [current, ...(previous ? [previous] : [])];
  if (!previous) warnings.push({reason: 'ONLY_ONE_COMPLETE_RECOVERY'});
  const keep = new Set(kept.map(b => b.dir)), rows = processes(), targets = [];
  for (const b of builds) {
    if (b.report.pin || referenced(b.dir, rows)) {warnings.push({path: b.dir, reason: b.report.pin ? 'PINNED' : 'PROCESS_REFERENCE'}); continue;}
    const superseded = successful.some(s => s.report.sourceFingerprint === b.report.sourceFingerprint);
    if (!b.report.ok && !superseded && !(Date.parse(b.report.finished) < now - 7 * 86400000)) {
      warnings.push({path: b.dir, reason: 'RECENT_FAILED_BUILD'}); continue;
    }
    for (const name of parts) {
      if (keep.has(b.dir) && recovery.includes(name)) continue;
      const p = path.join(b.dir, name);
      if (!exists(p)) continue;
      targets.push({path: p, build: b.dir, part: name, stamp: stamp(p)});
    }
  }
  return {schema: 1, repository: path.resolve(repository), roots, target, liveData, installedFingerprint: installed.sourceFingerprint,
    retained: kept.map(b => b.dir), builds, targets, warnings};
}

async function verifyProfiles(plan, audit) {
  directory(plan.liveData);
  const {DatabaseSync} = await import('node:sqlite');
  const checks = [];
  for (const build of plan.retained) {
    const root = path.join(build, 'profile-backup'); directory(root);
    for (const item of files(root)) {
      if (item.link !== null) continue;
      const p = path.join(root, item.name), fd = fs.openSync(p, 'r'), header = Buffer.alloc(16);
      try {fs.readSync(fd, header);} finally {fs.closeSync(fd);}
      if (header.toString() !== 'SQLite format 3\0') continue;
      const tmp = fs.mkdtempSync(path.join(audit, 'sqlite-')), dest = path.join(tmp, 'copy.sqlite');
      fs.copyFileSync(p, dest, fs.constants.COPYFILE_EXCL);
      for (const suffix of ['-wal', '-shm']) if (exists(p + suffix)) fs.copyFileSync(p + suffix, dest + suffix, fs.constants.COPYFILE_EXCL);
      const db = new DatabaseSync(dest);
      try {
        const result = db.prepare('PRAGMA quick_check').all();
        if (result.length !== 1 || Object.values(result[0])[0] !== 'ok') throw Error('Invalid recovery database: ' + p);
        checks.push({build, file: item.name, quickCheck: 'ok'});
      } finally {db.close(); fs.rmSync(tmp, {recursive: true});}
    }
  }
  return checks;
}
function archiveSource(b, audit) {
  const source = path.join(b.dir, 'source'), repo = path.dirname(b.root);
  const gitDir = run('git', ['-C', repo, 'rev-parse', '--absolute-git-dir']).trim();
  const base = run('git', ['-C', source, 'rev-parse', 'HEAD']).trim();
  if (base !== b.report.sourceRef) throw Error('Source base changed: ' + source);
  const env = {...process.env, GIT_INDEX_FILE: path.join(audit, crypto.randomUUID() + '.index'), GIT_OPTIONAL_LOCKS: '0'};
  if (exists(env.GIT_INDEX_FILE)) throw Error('Archive index exists');
  const g = args => run('git', ['--git-dir=' + gitDir, '--work-tree=' + source, ...args], {env, cwd: source});
  // Generated official inputs are outside the frozen source inventory.
  const inventory = json(path.join(b.dir, 'source-inventory.json'));
  if (inventory.files.some(f => /^(src|node_modules|own\/node_modules)(\/|$)/.test(f.name)))
    throw Error('Generated input overlaps frozen source inventory');
  const ignored = g(['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const unexpected = ignored.filter(n => !n.startsWith('src/') && !/^(node_modules|own\/node_modules)(\/|$)/.test(n) && n !== 'scripts/.versions.json');
  if (unexpected.length) throw Error('Unclassified ignored source files: ' + source);
  g(['read-tree', base]);
  g(['add', '-A', '--', '.', ':(exclude)node_modules', ':(exclude)own/node_modules']);
  if (exists(path.join(source, 'scripts/.versions.json'))) g(['add', '-f', '--', 'scripts/.versions.json']);
  const tree = g(['write-tree']).trim();
  // Re-add and compare to detect a concurrently changed source snapshot.
  const commit = g(['-c', 'user.name=Development recovery', '-c', 'user.email=recovery@localhost', 'commit-tree', tree, '-p', base, '-m', 'Preserve ' + path.basename(b.dir)]).trim();
  const ref = 'refs/own-recovery/' + path.basename(audit) + '/' + path.basename(b.dir);
  g(['update-ref', ref, commit, '0000000000000000000000000000000000000000']);
  if (g(['rev-parse', ref + '^{tree}']).trim() !== tree) throw Error('Recovery tree verification failed');
  const listing = g(['ls-tree', '-r', '--name-only', tree]).trim().split('\n').filter(Boolean);
  if (!listing.length) throw Error('Empty recovery tree');
  // Git's clean filters must reproduce the current worktree, including untracked files.
  g(['diff', '--exit-code', '--ignore-submodules', tree, '--', '.', ':(exclude)src', ':(exclude)node_modules', ':(exclude)own/node_modules']);
  fs.unlinkSync(env.GIT_INDEX_FILE);
  return {build: b.dir, repository: repo, base, tree, commit, ref, files: listing.length};
}
function sameFile(old, candidate, item) {
  if (!exists(candidate)) return false;
  const s = fs.lstatSync(candidate);
  if (item.link !== null) return s.isSymbolicLink() && fs.readlinkSync(candidate) === item.link;
  return s.isFile() && s.size === item.size && hash(old) === hash(candidate);
}
function archiveProfile(build, covered, audit) {
  const root = path.join(build, 'profile-backup'), all = files(root);
  const unique = all.filter(item => !covered.some(c => sameFile(path.join(root, item.name), path.join(c, item.name), item)));
  // Keep a coherent SQLite/WAL set whenever any member differs.
  const groups = new Set(unique.filter(f => /\.(db|sqlite)(-(wal|shm))?$/.test(f.name)).map(f => f.name.replace(/-(wal|shm)$/, '')));
  for (const item of all) if (groups.has(item.name.replace(/-(wal|shm)$/, '')) && !unique.includes(item)) unique.push(item);
  if (!unique.length) return {build, uniqueFiles: 0};
  const dir = fs.mkdtempSync(path.join(audit, 'profile-')), archive = path.join(dir, 'unique-data.tar.gz');
  const list = path.join(dir, 'files.list');
  write(path.join(dir, 'manifest.json'), unique.map(f => ({...f, sha256: f.link === null ? hash(path.join(root, f.name)) : null})));
  if (exists(list) || exists(archive)) throw Error('Archive output exists');
  fs.writeFileSync(list, unique.map(f => f.name + '\0').join(''), {flag: 'wx', mode: 0o600});
  run('tar', ['-czf', archive, '-C', root, '--null', '-T', list]); fs.chmodSync(archive, 0o600);
  const verify = path.join(dir, 'verify'); fs.mkdirSync(verify, {mode: 0o700});
  run('tar', ['-xzf', archive, '-C', verify]);
  const manifest = json(path.join(dir, 'manifest.json'));
  for (const item of manifest) {
    const p = path.join(verify, item.name), original = path.join(root, item.name);
    if (!sameFile(original, p, item) || (item.sha256 && hash(p) !== item.sha256) ||
        (fs.lstatSync(p).mode & 0o777) !== item.mode) throw Error('Unique profile archive verification failed');
  }
  removeOwnedTree(verify);
  return {build, uniqueFiles: unique.length, archive, sha256: hash(archive)};
}
export async function runDevelopmentCleanup(options) {
  const roots = developmentBuildRoots(options.repository);
  assertIdle(roots, options.allowedLock);
  // The same lock serializes cleanup and builds, including all discovered workspaces.
  const held = [];
  try {
    for (const root of roots) {
      const lock = path.join(root, '.development-build.lock');
      if (lock === options.allowedLock) continue;
      fs.mkdirSync(lock, {mode: 0o700}); held.push(lock);
      write(path.join(lock, 'owner.json'), {pid: process.pid, operation: 'development-retention', started: new Date().toISOString()});
    }
    // All locks are ours; the planner accepts these through this internal scan.
    let plan = options.plan, resume, audit;
    if (options.resumeAudit) {
      audit = path.resolve(options.resumeAudit); directory(audit);
      if (path.dirname(audit) !== path.join(options.repository, 'out') || !/^development-retention-[A-Za-z0-9]+$/.test(path.basename(audit)))
        throw Error('Invalid retention recovery directory');
      if (exists(path.join(audit, 'result.json'))) throw Error('Retention operation already completed');
      plan = json(path.join(audit, 'plan.json'));
      resume = json(path.join(audit, 'recovery.json'));
      if (plan.repository !== options.repository || plan.target !== options.target || plan.liveData !== options.liveData || resume.audit !== audit)
        throw Error('Retention recovery identity mismatch');
      for (const a of resume.sourceArchives) {
        if (run('git', ['-C', a.repository, 'rev-parse', a.ref + '^{tree}']).trim() !== a.tree)
          throw Error('Source recovery reference changed');
      }
      for (const a of resume.profileArchives) if (a.uniqueFiles) {
        if (!a.archive.startsWith(audit + '/') || hash(a.archive) !== a.sha256) throw Error('Profile recovery archive changed');
      }
    }
    if (!plan) throw Error('A reviewed cleanup plan is required');
    if (JSON.stringify(roots) !== JSON.stringify(plan.roots) || marker(plan.target).sourceFingerprint !== plan.installedFingerprint)
      throw Error('Installation or build roots changed; create a new plan');
    const out = path.join(options.repository, 'out');
    if (!resume) {
      audit = fs.mkdtempSync(path.join(out, 'development-retention-')); fs.chmodSync(audit, 0o700);
      write(path.join(audit, 'plan.json'), plan);
    }
    const freeBefore = fs.statfsSync(out), before = freeBefore.bavail * freeBefore.bsize;
    const result = resume || {schema: 1, audit, retained: plan.retained, warnings: plan.warnings, sourceArchives: [], profileArchives: [], removed: [], availableBeforeBytes: before};
    const validate = () => {
      if (marker(plan.target).sourceFingerprint !== plan.installedFingerprint) throw Error('Installed app changed during cleanup');
      for (const b of plan.builds) {
        if (hash(path.join(b.dir, 'result.json')) !== b.resultSha256 || hash(path.join(b.dir, 'source-inventory.json')) !== b.inventorySha256)
          throw Error('Build evidence changed during cleanup: ' + b.dir);
      }
      const rows = processes();
      for (const t of plan.targets) {
        if (path.dirname(t.path) !== t.build || !parts.includes(path.basename(t.path)) || !plan.builds.some(b => b.dir === t.build && path.dirname(b.dir) === b.root && roots.includes(b.root)) ||
            referenced(t.path, rows)) throw Error('Cleanup target changed or is in use: ' + t.path);
        if (resume && !exists(t.path)) continue;
        const current = stamp(t.path);
        if (resume ? current.ino !== t.stamp.ino || current.dev !== t.stamp.dev : JSON.stringify(current) !== JSON.stringify(t.stamp))
          throw Error('Cleanup directory identity changed: ' + t.path);
        if (resume && t.part === 'source' && !result.sourceArchives.some(a => a.build === t.build)) throw Error('Source recovery proof missing');
        if (resume && t.part === 'profile-backup' && !result.profileArchives.some(a => a.build === t.build)) throw Error('Profile recovery proof missing');
      }
    };
    validate();
    const verifyApp = options.verifyRecoveryApp || (app => {
      marker(app);
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    });
    verifyApp(plan.target);
    for (const build of plan.retained) verifyApp(path.join(build, 'previous-development.bundle'));
    console.error('[development-retention] Verifying retained profile databases');
    result.databaseChecks = await verifyProfiles(plan, audit);
    for (const b of plan.builds.filter(b => !resume && plan.targets.some(t => t.build === b.dir && t.part === 'source'))) {
      console.error('[development-retention] Archiving source: ' + path.basename(b.dir));
      result.sourceArchives.push(archiveSource(b, audit));
    }
    const covered = [plan.liveData, ...plan.retained.map(b => path.join(b, 'profile-backup'))];
    for (const t of plan.targets.filter(t => !resume && t.part === 'profile-backup')) {
      console.error('[development-retention] Preserving unique profile data: ' + path.basename(t.build));
      result.profileArchives.push(archiveProfile(t.build, covered, audit));
    }
    if (!resume) write(path.join(audit, 'recovery.json'), result);
    validate();
    // Persist all recovery proofs before the first removal; keep original build reports.
    for (const t of plan.targets) {
      if (resume && !exists(t.path)) {result.removed.push({path: t.path, removedBeforeResume: true}); continue;}
      console.error('[development-retention] Removing verified obsolete directory: ' + t.path);
      const bytes = Number(run('du', ['-sk', t.path]).split(/\s/)[0]) * 1024;
      removeOwnedTree(t.path); result.removed.push({path: t.path, allocatedBytes: bytes});
    }
    for (const build of plan.retained) for (const part of recovery) directory(path.join(build, part));
    directory(plan.liveData);
    const after = fs.statfsSync(out);
    result.reclaimedBytes = after.bavail * after.bsize - (result.availableBeforeBytes ?? before);
    if (resume) result.resumed = true;
    result.availableBytes = after.bavail * after.bsize;
    result.finished = new Date().toISOString();
    write(path.join(audit, 'result.json'), result);
    return result;
  } finally {
    for (const lock of held.reverse()) {
      if (json(path.join(lock, 'owner.json')).pid !== process.pid) throw Error('Cleanup lock owner changed');
      fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock);
    }
  }
}
