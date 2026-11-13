import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {planDevelopmentCleanup, runDevelopmentCleanup} from '../development-retention.mjs';

const test = (name, fn) => nodeTest(name, {skip: process.platform !== 'darwin' && 'macOS development tooling'}, fn);

const put = (p, value) => {fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));};
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'own-retention-')));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const repository = path.join(root, 'repo'), target = path.join(root, 'development.app'), liveData = path.join(root, 'live');
  fs.mkdirSync(repository); fs.mkdirSync(liveData); fs.mkdirSync(path.join(repository, 'out'));
  execFileSync('git', ['init', '-q', repository]);
  put(path.join(repository, 'code.txt'), 'base');
  put(path.join(repository, '.gitignore'), 'src/\nnode_modules/\n');
  execFileSync('git', ['-C', repository, 'add', '.']);
  execFileSync('git', ['-C', repository, '-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','base']);
  const base = execFileSync('git', ['-C',repository,'rev-parse','HEAD'], {encoding:'utf8'}).trim();
  const builds = [];
  function build(name, n, overrides = {}) {
    const dir = path.join(repository,'out','dev-build-'+name+'.noindex'); fs.mkdirSync(dir);
    execFileSync('git',['clone','-q','--shared',repository,path.join(dir,'source')]);
    put(path.join(dir,'source','code.txt'), 'snapshot ' + n);
    put(path.join(dir,'source','extra.txt'), 'untracked ' + n);
    put(path.join(dir,'source','src','generated.txt'), 'reproducible official input');
    const inventory = {files:[{name:'code.txt',sha256:digest('snapshot '+n)}]};
    inventory.sha256 = digest(JSON.stringify(inventory.files));
    put(path.join(dir,'source-inventory.json'),inventory);
    for (const part of ['previous-development.bundle','candidate','gui']) fs.mkdirSync(path.join(dir,part));
    put(path.join(dir,'profile-backup','config.json'),'common');
    const db = new DatabaseSync(path.join(dir,'profile-backup','state.sqlite'));
    db.exec('create table history (value text); insert into history values (\'old\')'); db.close();
    const report = {schema:1,output:dir,target,sourceRef:base,sourceFingerprint:inventory.sha256,ok:true,installed:true,verified:true,
      finished:new Date(Date.now() - (4-n)*60000).toISOString(),...overrides};
    put(path.join(dir,'result.json'),report);
    builds.push(dir); return dir;
  }
  const old = build('old',1), previous=build('previous',2), current=build('current',3);
  put(path.join(old,'profile-backup','history.jsonl'),'unique history\n');
  put(path.join(target,'Contents/Resources/own-development.json'),{schema:1,channel:'development',automaticUpdates:false,sourceFingerprint:JSON.parse(fs.readFileSync(path.join(current,'result.json'))).sourceFingerprint});
  return {repository,target,liveData,old,previous,current,build};
}
test('plan retains fingerprint-matched install and predecessor, and does not mutate',t=>{
  const f=fixture(t),plan=planDevelopmentCleanup(f);
  assert.deepEqual(plan.retained,[f.current,f.previous]);
  assert.ok(plan.targets.some(p=>p.path===path.join(f.old,'source')));
  assert.ok(!plan.targets.some(p=>p.path===path.join(f.current,'source')));
  assert.ok(fs.existsSync(path.join(f.old,'source')));
});
test('real cleanup archives source and unique private data, validates SQLite, and is repeatable',async t=>{
  const f=fixture(t),plan=planDevelopmentCleanup(f);
  const result=await runDevelopmentCleanup({...f,plan,verifyRecoveryApp:()=>{}});
  assert.ok(!fs.existsSync(path.join(f.old,'source')));
  assert.ok(!fs.existsSync(path.join(f.current,'candidate')));
  for(const b of [f.previous,f.current]) for(const p of ['source','profile-backup','previous-development.bundle']) assert.ok(fs.existsSync(path.join(b,p)));
  assert.equal(result.databaseChecks.length,2);
  const a=result.sourceArchives[0];
  assert.equal(execFileSync('git',['-C',f.repository,'show',a.ref+':extra.txt'],{encoding:'utf8'}),'untracked 1');
  const archive=result.profileArchives[0];
  assert.ok(archive.uniqueFiles>=1);
  assert.match(execFileSync('tar',['-xOzf',archive.archive,'history.jsonl'],{encoding:'utf8'}),/unique history/);
  assert.equal(fs.statSync(archive.archive).mode&0o777,0o600);
  assert.equal(planDevelopmentCleanup(f).targets.length,0);
  assert.ok(fs.existsSync(path.join(f.old,'result.json')));
});
test('unmatched installed provenance blocks all pruning',t=>{
  const f=fixture(t),p=path.join(f.target,'Contents/Resources/own-development.json'),m=JSON.parse(fs.readFileSync(p));
  m.sourceFingerprint='0'.repeat(64);put(p,m);
  assert.throws(()=>planDevelopmentCleanup(f),/no complete verified/);
  assert.ok(fs.existsSync(path.join(f.old,'source')));
});
test('nested release workspace is found by installed fingerprint instead of directory age',t=>{
  const f=fixture(t),out=path.join(f.repository,'out','release','repo','out');fs.mkdirSync(out,{recursive:true});
  const moved=path.join(out,path.basename(f.current));fs.renameSync(f.current,moved);
  const report=JSON.parse(fs.readFileSync(path.join(moved,'result.json')));report.output=moved;put(path.join(moved,'result.json'),report);
  assert.deepEqual(planDevelopmentCleanup(f).retained,[moved,f.previous]);
  assert.deepEqual(planDevelopmentCleanup({...f,repository:path.dirname(out)}).retained,[moved,f.previous]);
});
test('cleanup runs inside the builder lock and preserves caller ownership',async t=>{
  const f=fixture(t),allowedLock=path.join(f.repository,'out/.development-build.lock');fs.mkdirSync(allowedLock);
  put(path.join(allowedLock,'owner.json'),{pid:process.pid});
  const options={...f,allowedLock};
  await runDevelopmentCleanup({...options,plan:planDevelopmentCleanup(options),verifyRecoveryApp:()=>{}});
  assert.equal(JSON.parse(fs.readFileSync(path.join(allowedLock,'owner.json'))).pid,process.pid);
});
test('interrupted deletion resumes from verified archives without repeating or losing recovery',async t=>{
  const f=fixture(t),remove=fs.rmSync;
  fs.rmSync=(p,...args)=>{if(p===path.join(f.old,'profile-backup'))throw Error('transient directory busy');return remove(p,...args);};
  try{await assert.rejects(runDevelopmentCleanup({...f,plan:planDevelopmentCleanup(f),verifyRecoveryApp:()=>{}}),/transient directory busy/);}
  finally{fs.rmSync=remove;}
  const audit=fs.readdirSync(path.join(f.repository,'out')).find(n=>n.startsWith('development-retention-'));
  assert.ok(!fs.existsSync(path.join(f.old,'source')));
  const result=await runDevelopmentCleanup({...f,resumeAudit:path.join(f.repository,'out',audit),verifyRecoveryApp:()=>{}});
  assert.equal(result.resumed,true);assert.equal(planDevelopmentCleanup(f).targets.length,0);
  assert.ok(fs.existsSync(result.profileArchives[0].archive));
});
test('read-only cached runtime directories are reclaimed without following links or altering restore modes',async t=>{
  const f=fixture(t),cache=path.join(f.old,'profile-backup','cache','read-only');
  put(path.join(cache,'data'),'unique cached bytes');fs.chmodSync(path.join(cache,'data'),0o400);fs.chmodSync(cache,0o500);
  const external=path.join(f.liveData,'preserved');fs.mkdirSync(external);fs.chmodSync(external,0o500);
  fs.symlinkSync(external,path.join(f.old,'profile-backup','outside'));
  const result=await runDevelopmentCleanup({...f,plan:planDevelopmentCleanup(f),verifyRecoveryApp:()=>{}});
  assert.equal(fs.statSync(external).mode&0o777,0o500);
  assert.equal(planDevelopmentCleanup(f).targets.length,0);
  const entry=execFileSync('tar',['-tzvf',result.profileArchives[0].archive],{encoding:'utf8'});
  assert.match(entry,/cache\/read-only\/data/);
  fs.chmodSync(external,0o700);
});
test('live and dead build locks both require explicit inspection',t=>{
  const f=fixture(t),lock=path.join(f.repository,'out/.development-build.lock');fs.mkdirSync(lock);
  put(path.join(lock,'owner.json'),{pid:99999999});
  assert.throws(()=>planDevelopmentCleanup(f),/lock exists/);
});
test('source symlinks, pins, recent failures and changed receipts are preserved',async t=>{
  const f=fixture(t);
  const pin=path.join(f.old,'retention-pin.json');put(pin,{reason:'acceptance',reviewAfter:'2020-01-01'});
  assert.ok(!planDevelopmentCleanup(f).targets.some(p=>p.build===f.old));
  fs.unlinkSync(pin);
  const failed=f.build('failure',4,{ok:false,installed:false});
  assert.ok(!planDevelopmentCleanup(f).targets.some(p=>p.build===failed));
  const plan=planDevelopmentCleanup(f);
  fs.appendFileSync(path.join(f.old,'result.json'),' ');
  await assert.rejects(runDevelopmentCleanup({...f,plan,verifyRecoveryApp:()=>{}}),/evidence changed/);
  assert.ok(fs.existsSync(path.join(f.old,'source')));
});
test('failed recovery signature or corrupt retained DB stops before deletion',async t=>{
  const f=fixture(t);
  await assert.rejects(runDevelopmentCleanup({...f,plan:planDevelopmentCleanup(f),verifyRecoveryApp:()=>{throw Error('signature');}}),/signature/);
  const p=path.join(f.current,'profile-backup','state.sqlite');
  const fd=fs.openSync(p,'r+');fs.writeSync(fd,Buffer.alloc(100,255),0,100,100);fs.closeSync(fd);
  await assert.rejects(runDevelopmentCleanup({...f,plan:planDevelopmentCleanup(f),verifyRecoveryApp:()=>{}}));
  assert.ok(fs.existsSync(path.join(f.old,'profile-backup')));
});
test('unclassified ignored source files and replacement directory links block deletion',async t=>{
  const f=fixture(t),src=path.join(f.old,'source');
  put(path.join(src,'.gitignore'),'private.secret\n');put(path.join(src,'private.secret'),'fixture');
  await assert.rejects(runDevelopmentCleanup({...f,plan:planDevelopmentCleanup(f),verifyRecoveryApp:()=>{}}),/Unclassified ignored/);
  assert.ok(fs.existsSync(src));
  fs.rmSync(path.join(f.old,'candidate'),{recursive:true});fs.symlinkSync(f.liveData,path.join(f.old,'candidate'));
  assert.throws(()=>planDevelopmentCleanup(f),/Unsafe directory/);
});
