import type {RequestHandler} from 'express';

// Install before body parsers: obsolete clients must not upload model payloads.
export const rejectRetiredCodexProxy: RequestHandler = (req,res,next) => {
  let path = req.path;
  try { path = decodeURIComponent(path); } catch { /* Router handles malformed paths. */ }
  if (/^\/api\/codex-own\/proxy(?:\/|$)/i.test(path) || /^\/api\/company\/v1\/proxy\/codex-own(?:\/|$)/i.test(path)) {
    res.set('cache-control','no-store').status(410).json({ok:false,error:{code:'CLIENT_UPDATE_REQUIRED',message:'此版本的云端模型代理已停用，请更新 codex-own 到支持模型直连的版本。'}});
    return;
  }
  next();
};
