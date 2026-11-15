// Optional local-only inference service. A POST is the sole generation trigger.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, createReadStream } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cache = process.env.PHOTO_CAT_MLX_CACHE || join(homedir(), 'Library/Caches/sunlit-photo-cat-mlx');
const python = join(cache, 'venv/bin/python');
const runner = join(dirname(fileURLToPath(import.meta.url)), 'run.py');
const jobs = new Map();
let active = null;
const ready = () => existsSync(join(cache, 'ready.json')) && existsSync(python) && existsSync(join(cache, 'weights/shape-small/model.fp16.safetensors')) && existsSync(join(cache, 'runtime/python/shape/hy3dmlx/pipeline.py'));
const reply = (res, status, body) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return reply(res, 403, {error:'Only local origins are allowed'});
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://127.0.0.1:8790');
  if (url.pathname === '/health') return reply(res, 200, {ready:ready(), busy:!!active, backend:'hunyuan3d-2mini-mlx', cloud:false});
  try {
    if (req.method === 'POST' && url.pathname === '/jobs') {
      if (!ready()) return reply(res, 503, {error:'Run python3 server/photo-cat-mlx/setup.py first'});
      if (active) return reply(res, 409, {error:'One local generation is already running'});
      const type = req.headers['content-type']?.split(';')[0];
      const ext = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[type];
      if (!ext) return reply(res, 415, {error:'Upload PNG, JPEG, or WebP as the raw request body'});
      const chunks=[]; let size=0;
      for await (const chunk of req) {
        size+=chunk.length;
        if (size > 20*1024*1024) return reply(res, 413, {error:'Maximum upload is 20 MiB'});
        chunks.push(chunk);
      }
      if (active) return reply(res, 409, {error:'One local generation is already running'});
      if (!size) return reply(res, 400, {error:'Empty image'});
      const id=randomUUID(), folder=join(cache,'jobs',id);
      const input=join(folder,`input.${ext}`), output=join(folder,'model.glb');
      const job={id,status:'running',log:'',folder};
      active=id; jobs.set(id,job);
      try {
        await mkdir(folder,{recursive:true}); await writeFile(input,Buffer.concat(chunks));
        const child=spawn(python,[runner,input,'--out',output,'--project-colors'], {env:{...process.env,PYTHONUNBUFFERED:'1'}});
        const append = chunk => { job.log=(job.log+chunk.toString()).slice(-12000); };
        child.stdout.on('data',append); child.stderr.on('data',append);
        child.on('error',error=>{job.status='failed';job.log+=error.message;active=null;});
        child.on('close',code=>{job.status=code===0 && existsSync(output)?'complete':'failed';active=null;});
      } catch(error) { job.status='failed';active=null; throw error; }
      return reply(res,202,{id,status:job.status});
    }
    const match = url.pathname.match(/^\/jobs\/([a-f0-9-]{36})(\/model\.glb)?$/);
    if (req.method==='GET' && match) {
      const job=jobs.get(match[1]);
      if (!job) return reply(res,404,{error:'Unknown job'});
      if (match[2]) {
        if(job.status!=='complete') return reply(res,409,{error:'Model is not ready'});
        res.writeHead(200,{'Content-Type':'model/gltf-binary','Content-Disposition':'attachment; filename="photo-cat.glb"'});
        return createReadStream(join(job.folder,'model.glb')).pipe(res);
      }
      let metadata=null;
      if(job.status==='complete') metadata=JSON.parse(await readFile(join(job.folder,'model.json'),'utf8'));
      return reply(res,200,{id:job.id,status:job.status,log:job.log,metadata,modelUrl:job.status==='complete'?`/jobs/${job.id}/model.glb`:null});
    }
    reply(res,404,{error:'Not found'});
  } catch(error) { reply(res,500,{error:error.message}); }
}).listen(8790,'127.0.0.1',()=>console.log('Local photo inference: http://127.0.0.1:8790'));
