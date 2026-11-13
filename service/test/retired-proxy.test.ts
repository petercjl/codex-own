import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {rejectRetiredCodexProxy} from '../retired-proxy.ts';

test('retired codex proxies reject before parsing; authentication and other applications remain reachable', async () => {
  const app=express(); let downstream=0;
  app.use(rejectRetiredCodexProxy);
  app.use(express.json({limit:1}));
  app.use((_req,res)=>{downstream++;res.json({reachable:true});});
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const port=(server.address() as {port:number}).port;
  try {
    for(const path of ['/api/codex-own/proxy/a/v1/responses','/api/codex-own/proxy/a/v1/messages','/api/company/v1/proxy/codex-own/a/v1/responses','/api/company/v1/proxy/codex%2Down/a/v1/responses']) {
      const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:'invalid json and over parser limit'});
      assert.equal(response.status,410);
      assert.equal((await response.json()).error.code,'CLIENT_UPDATE_REQUIRED');
    }
    assert.equal(downstream,0);
    for(const path of ['/api/codex-own/session','/api/codex-own/direct-models','/api/codex-own/auth/start','/api/company/v1/proxy/tuda/a/v1/responses']) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status,200);
    }
    assert.equal(downstream,4);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
