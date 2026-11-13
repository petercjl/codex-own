import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {officialLayout} from './official-cli.mjs';

// OpenAI's Windows root layout is also used by its WinGet package. Retain all
// resources and identify the relocated entry point in codex-package.json.
// https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/install-context/src/lib.rs
export function installOfficialWindowsCli(resources, prepared, backupRoot, pin) {
  const receipt = JSON.parse(fs.readFileSync(path.join(prepared, 'receipt.json')));
  const vendor = path.join(prepared, 'package/vendor/x86_64-pc-windows-msvc');
  const binary = officialLayout(vendor, pin.version, 'win32-x64');
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (receipt.provider !== 'openai' || receipt.version !== pin.version || receipt.packageVersion !== pin.version + '-win32-x64' ||
      receipt.integrity !== pin.integrity || receipt.archiveSha256 !== pin.archiveSha256 || hash(binary) !== receipt.binarySha256)
    throw Error('Pinned official Windows CLI receipt mismatch');
  const manifest = JSON.parse(fs.readFileSync(path.join(vendor, 'codex-package.json')));
  const copies = new Map([
    ['codex.exe', binary],
    ['codex-code-mode-host.exe', path.join(vendor, 'bin/codex-code-mode-host.exe')],
    ['rg.exe', path.join(vendor, 'codex-path/rg.exe')],
    ['codex-resources', path.join(vendor, 'codex-resources')],
    ['codex-path', path.join(vendor, 'codex-path')]
  ]);
  // Preflight every source and target before moving the owned candidate's old
  // files into a recovery directory outside the application being packaged.
  if (!fs.statSync(resources).isDirectory() || fs.lstatSync(resources).isSymbolicLink() || fs.existsSync(backupRoot)) throw Error('Unsafe official CLI staging destination');
  for (const [name, source] of copies) {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw Error('Invalid official CLI resource: ' + name);
    if (fs.existsSync(path.join(resources, name)) && fs.lstatSync(path.join(resources, name)).isSymbolicLink()) throw Error('Unexpected CLI destination link');
  }
  for (const name of ['codex-command-runner.exe', 'codex-windows-sandbox-setup.exe']) {
    if (!fs.lstatSync(path.join(vendor, 'codex-resources', name)).isFile()) throw Error('Missing official Windows sandbox helper');
  }
  fs.mkdirSync(backupRoot, {mode: 0o700});
  for (const name of [...copies.keys(), 'codex-package.json']) {
    const target = path.join(resources, name);
    if (fs.existsSync(target)) fs.renameSync(target, path.join(backupRoot, name));
  }
  for (const [name, source] of copies) fs.cpSync(source, path.join(resources, name), {recursive: true, errorOnExist: true, force: false});
  fs.writeFileSync(path.join(resources, 'codex-package.json'), JSON.stringify({...manifest, entrypoint: 'codex.exe'}, null, 2), {flag: 'wx'});
  if (hash(path.join(resources, 'codex.exe')) !== receipt.binarySha256) throw Error('Installed official Windows CLI changed');
  return {...receipt, relocation: 'windows-root-layout-v1'};
}
