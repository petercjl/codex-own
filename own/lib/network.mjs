import fs from 'node:fs';
import crypto from 'node:crypto';
import {EnvHttpProxyAgent, fetch} from 'undici';

const dispatcher = new EnvHttpProxyAgent();
export const progress = message => process.stderr.write(`[codex-own] ${message}\n`);
export function networkFetch(url, options = {}) {
  return fetch(url, {dispatcher, redirect: 'error', ...options});
}
export async function fileHash(file) {
  const h = crypto.createHash('sha256');
  for await (const b of fs.createReadStream(file)) h.update(b);
  return h.digest('hex');
}
export async function verifiedDownload(url, dest, expected, {
  fetcher = networkFetch, report = progress, idleMs = 30000, attempts = 3, retryMs = 1000,
} = {}) {
  const error = (code, message) => Object.assign(new Error(message), {code});
  if (fs.existsSync(dest)) throw error('TARGET_EXISTS', 'Download destination already exists');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    let file, bytes = 0, timer, cancelled = false;
    const start = Date.now();
    const cancel = () => { cancelled = true; controller.abort(); };
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), idleMs); };
    const tick = () => report(`下载 ${Math.floor(bytes / expected.size * 100)}% · ${(bytes / 1048576).toFixed(1)} / ${(expected.size / 1048576).toFixed(1)} MiB · ${((Date.now()-start)/1000).toFixed(0)}s`);
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    const interval = setInterval(tick, 3000);
    try {
      report(`连接 npm 下载服务（尝试 ${attempt}/${attempts}）`);
      reset();
      const response = await fetcher(url, {signal: controller.signal});
      if (!response.ok) { await response.body?.cancel(); throw error('DOWNLOAD_HTTP', `npm HTTP ${response.status}`); }
      file = await fs.promises.open(dest, 'wx', 0o600);
      const h = crypto.createHash('sha256');
      for await (const data of response.body) {
        reset(); bytes += data.length;
        if (bytes > expected.size) throw error('CHECKSUM_MISMATCH', 'Download exceeded expected size');
        h.update(data);
        let offset = 0;
        while (offset < data.length) offset += (await file.write(data, offset, data.length-offset)).bytesWritten;
      }
      if (bytes !== expected.size || h.digest('hex') !== expected.sha256) throw error('CHECKSUM_MISMATCH', 'Download verification failed');
      tick();
      return;
    } catch (e) {
      controller.abort();
      if (file) { await file.close(); file = null; fs.unlinkSync(dest); }
      if (cancelled) throw error('CANCELLED', 'Download cancelled. Verified earlier parts are retained; rerun the install command to continue.');
      if (e.code === 'CHECKSUM_MISMATCH' || e.code === 'EEXIST') throw e;
      if (attempt === attempts) throw error('DOWNLOAD_FAILED', `npm download failed after ${attempts} attempts (${e.code === 'DOWNLOAD_HTTP' ? e.message : e.code || e.cause?.code || 'timeout/network'}). Check network access to registry.npmjs.org and retry; verified parts are retained.`);
      report(`下载暂不可用（${e.code === 'DOWNLOAD_HTTP' ? e.message : e.code || e.cause?.code || 'timeout/network'}），稍后重试当前分片；已校验分片保留。`);
      await new Promise(r=>setTimeout(r,retryMs*attempt));
      if (cancelled) throw error('CANCELLED', 'Download cancelled. Verified earlier parts are retained; rerun the install command to continue.');
    } finally {
      clearTimeout(timer); clearInterval(interval);
      process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
      if (file) await file.close();
    }
  }
}
