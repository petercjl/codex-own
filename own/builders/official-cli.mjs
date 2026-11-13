// Explicit, pinned OpenAI CLI inputs with verified native package layouts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function validateCliVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Official CLI requires an exact stable version');
  return version;
}
export function verifyIntegrity(bytes, integrity) {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity || '') ||
      'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64') !== integrity)
    throw Error('Official CLI npm integrity mismatch');
}
export function officialTarget(target = 'darwin-arm64') {
  if (target === 'darwin-arm64') return {target, triple: 'aarch64-apple-darwin', suffix: ''};
  if (target === 'win32-x64') return {target, triple: 'x86_64-pc-windows-msvc', suffix: '.exe'};
  throw Error('Unsupported official CLI target');
}
export function officialLayout(vendor, version, target = 'darwin-arm64') {
  const {triple, suffix} = officialTarget(target);
  const layout = JSON.parse(fs.readFileSync(path.join(vendor, 'codex-package.json')));
  if (layout.layoutVersion !== 1 || layout.version !== version || layout.target !== triple ||
      layout.variant !== 'codex' || layout.entrypoint !== 'bin/codex' + suffix ||
      layout.resourcesDir !== 'codex-resources' || layout.pathDir !== 'codex-path')
    throw Error('Unsupported official CLI layout');
  for (const name of ['bin/codex' + suffix, 'bin/codex-code-mode-host' + suffix, 'codex-path/rg' + suffix])
    if (!fs.lstatSync(path.join(vendor, name)).isFile()) throw Error('Missing official CLI component: ' + name);
  return path.join(vendor, layout.entrypoint);
}
export async function prepareOfficialCli(version, destination, {cacheRoot, target = 'darwin-arm64'} = {}) {
  validateCliVersion(version);
  const {triple} = officialTarget(target);
  if (fs.existsSync(destination)) throw Error('Official CLI destination exists');
  fs.mkdirSync(destination, {mode: 0o700});
  const registry = 'https://registry.npmjs.org';
  const response = await fetch(`${registry}/@openai%2fcodex/${version}-${target}`, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error('Official CLI registry status ' + response.status);
  const metadata = await response.json();
  if (metadata.name !== '@openai/codex' || metadata.version !== version + '-' + target ||
      metadata.dist?.tarball !== `${registry}/@openai/codex/-/codex-${version}-${target}.tgz`)
    throw Error('Unexpected official CLI package identity');
  const cached = cacheRoot && path.join(cacheRoot, sha(Buffer.from(metadata.dist.integrity || '')) + '.tgz');
  let bytes;
  if (cached && fs.existsSync(cached)) {
    if (!fs.lstatSync(cached).isFile()) throw Error('Official CLI cache must be a regular file');
    bytes = fs.readFileSync(cached);
  } else {
    const download = await fetch(metadata.dist.tarball, {signal: AbortSignal.timeout(180000)});
    if (!download.ok) throw Error('Official CLI download status ' + download.status);
    bytes = Buffer.from(await download.arrayBuffer());
  }
  verifyIntegrity(bytes, metadata.dist.integrity);
  if (cached && !fs.existsSync(cached)) {
    fs.mkdirSync(cacheRoot, {recursive: true, mode: 0o700});
    fs.writeFileSync(cached, bytes, {flag: 'wx', mode: 0o600});
  }
  const archive = path.join(destination, 'package.tgz');
  fs.writeFileSync(archive, bytes, {flag: 'wx', mode: 0o600});
  await require('tar').x({file: archive, cwd: destination, strict: true});
  const vendor = path.join(destination, 'package/vendor', triple);
  const binary = officialLayout(vendor, version, target);
  const actual = execFileSync(binary, ['--version'], {encoding: 'utf8', timeout: 30000}).trim();
  if (actual !== 'codex-cli ' + version) throw Error('Official CLI executable version mismatch: ' + actual);
  const receipt = {schema: 1, provider: 'openai', version, package: metadata.name,
    packageVersion: metadata.version, tarball: metadata.dist.tarball, integrity: metadata.dist.integrity,
    archiveSha256: sha(bytes), binarySha256: sha(fs.readFileSync(binary))};
  fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2), {flag: 'wx', mode: 0o600});
  return {destination, vendor, binary, ...receipt};
}
