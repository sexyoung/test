#!/usr/bin/env node
// Build each demo in isolation, run it in headless Chromium and collect comparable metrics.
//
//   node bench/run.mjs --quick --engines three          fast smoke test + screenshots for one engine
//   node bench/run.mjs                                   full benchmark (all engines, all scenarios)
//
// Options
//   --engines a,b,c      three | babylon | playcanvas | raw   (default: every demo that exists)
//   --scenarios a,b      default | crowd | dense | noshadow    (default: all; --quick: default)
//   --runs N             repetitions per engine x scenario     (default 3; --quick: 1)
//   --frames N --warmup N   measured / warm-up frames          (default 600 / 120; --quick: 60 / 20)
//   --sync               add sync=1: gl.finish() every frame, so "total" includes the GPU work
//   --query "k=v&k2=v2"  extra URL parameters for every run
//   --width N --height N viewport (default 1280 x 720)
//   --shots              also save the deterministic hero / fly screenshots (always on with --quick)
//   --save-reference     copy the raw renderer's screenshots to bench/reference/
//   --no-build           reuse bench/.build from a previous invocation
//   --out file.json      where to write the results (default bench/results/latest.json; --quick: bench/out/quick-<engines>.json)
//   --channel chrome     use an installed browser instead of the bundled headless shell
//   --headed             show the browser window (needs a display; uses the real GPU if there is one)
//   --timeout seconds    per-run timeout (default 900)

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm, readdir, stat, copyFile } from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join, extname, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'bench/.build');
const OUT = join(ROOT, 'bench/out');
const REFERENCE = join(ROOT, 'bench/reference');
const ALL_ENGINES = ['three', 'babylon', 'playcanvas', 'raw'];
const SCENARIOS = {
  default: { label: '一般場景（NPC 24）', query: {} },
  crowd: { label: '人群壓力（NPC 400）', query: { npcs: 400 } },
  dense: { label: '植被壓力（密度 ×6）', query: { density: 6 } },
  noshadow: { label: '關閉陰影', query: { shadows: 0 } },
};
const SHOTS = {
  hero: { freeze: 8, hud: 0 },
  fly: { freeze: 14, autopilot: 1, hud: 0 },
};

// ---- arguments ----------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const quick = flag('quick');
const engines = (opt('engines', '') ? opt('engines').split(',') : ALL_ENGINES).filter((e) => {
  if (!ALL_ENGINES.includes(e)) throw new Error(`unknown engine "${e}"`);
  const ok = existsSync(join(ROOT, 'demos', e, 'index.html')) && existsSync(join(ROOT, 'demos', e, 'main.js'));
  if (!ok) console.warn(`! skipping "${e}": demos/${e}/index.html or main.js is missing`);
  return ok;
});
const scenarioNames = opt('scenarios', '') ? opt('scenarios').split(',') : quick ? ['default'] : Object.keys(SCENARIOS);
for (const s of scenarioNames) if (!SCENARIOS[s]) throw new Error(`unknown scenario "${s}"`);
const runs = Number(opt('runs', quick ? 1 : 3));
const frames = Number(opt('frames', quick ? 60 : 600));
const warmup = Number(opt('warmup', quick ? 20 : 120));
const width = Number(opt('width', 1280)), height = Number(opt('height', 720));
const timeoutMs = Number(opt('timeout', 900)) * 1000;
const extraQuery = Object.fromEntries(new URLSearchParams(opt('query', '')));
if (flag('sync')) extraQuery.sync = 1;
const wantShots = quick || flag('shots') || flag('save-reference');
const outFile = resolve(ROOT, opt('out', quick ? `bench/out/quick-${engines.join('+')}.json` : 'bench/results/latest.json'));

// ---- cross-process lock (several agents may run this at once; never overlap measurements) ----

const LOCK = join(ROOT, 'bench/.lock');
let haveLock = false;
async function acquireLock() {
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, 'pid'), String(process.pid));
      haveLock = true;
      return;
    } catch {
      let stale = false;
      try {
        const pid = Number(readFileSync(join(LOCK, 'pid'), 'utf8'));
        try { process.kill(pid, 0); } catch { stale = true; }
      } catch { stale = Date.now() - started > 5000; }
      if (stale) { try { await rm(LOCK, { recursive: true, force: true }); } catch { /* raced */ } continue; }
      if (Date.now() - started > 45 * 60 * 1000) throw new Error('timed out waiting for bench/.lock');
      if ((Date.now() - started) % 30000 < 1000) console.log('… waiting for another bench/run.mjs to finish');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
function releaseLock() {
  if (!haveLock) return;
  try { rmSync(LOCK, { recursive: true, force: true }); } catch { /* already gone */ }
}
process.on('exit', releaseLock);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// ---- build ---------------------------------------------------------------------

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function buildEngine(engine) {
  const outDir = join(BUILD, engine);
  if (!flag('no-build') || !existsSync(outDir)) {
    const { build } = await import('vite');
    const started = Date.now();
    await build({
      configFile: false,
      root: ROOT,
      base: './',
      logLevel: 'error',
      build: {
        outDir,
        emptyOutDir: true,
        target: 'es2022',
        reportCompressedSize: false,
        chunkSizeWarningLimit: 100000,
        rollupOptions: { input: { [engine]: join(ROOT, 'demos', engine, 'index.html') } },
      },
    });
    console.log(`  built ${engine} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  const files = [];
  const total = { raw: 0, gzip: 0, brotli: 0 }, js = { raw: 0, gzip: 0, brotli: 0 };
  for (const file of await walk(outDir)) {
    const ext = extname(file);
    if (!['.js', '.css', '.html', '.wasm'].includes(ext)) continue;
    const data = await readFile(file);
    const entry = { file: relative(outDir, file), raw: data.length, gzip: gzipSync(data, { level: 9 }).length, brotli: brotliCompressSync(data).length };
    files.push(entry);
    for (const k of ['raw', 'gzip', 'brotli']) { total[k] += entry[k]; if (ext === '.js') js[k] += entry[k]; }
  }
  return { outDir, files, js, total };
}

// ---- static server ---------------------------------------------------------------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
function serve(rootDir) {
  return new Promise((done) => {
    const server = createServer(async (req, res) => {
      try {
        let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (path.endsWith('/')) path += 'index.html';
        const file = join(rootDir, path);
        if (!file.startsWith(rootDir)) throw new Error('outside root');
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => done(server));
  });
}

// ---- browser ---------------------------------------------------------------------

const { chromium } = await import('playwright-core');
const launchOptions = {
  headless: !flag('headed'),
  channel: opt('channel', undefined),
  args: ['--enable-precise-memory-info', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
};

function watch(page, errors) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText || ''}`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
}

const queryString = (q) => new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();

async function measure(engine, port, query) {
  const browser = await chromium.launch(launchOptions);
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    watch(page, errors);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const url = `http://127.0.0.1:${port}/demos/${engine}/index.html?${queryString(query)}`;
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => window.__benchResult, null, { timeout: timeoutMs, polling: 250 });
    const result = await page.evaluate(() => window.__benchResult);
    await cdp.send('HeapProfiler.collectGarbage');
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    return {
      result,
      cdp: {
        jsHeapUsedAfterGC: metrics.JSHeapUsedSize, jsHeapTotal: metrics.JSHeapTotalSize,
        scriptSeconds: metrics.ScriptDuration, taskSeconds: metrics.TaskDuration, nodes: metrics.Nodes,
      },
      browserVersion: browser.version(),
      errors,
    };
  } catch (e) {
    errors.push(`runner: ${String(e.message).split('\n')[0]}`);
    return { result: null, cdp: null, errors };
  } finally {
    await browser.close();
  }
}

async function screenshot(engine, port, query, file) {
  const browser = await chromium.launch(launchOptions);
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    watch(page, errors);
    await page.goto(`http://127.0.0.1:${port}/demos/${engine}/index.html?${queryString(query)}`, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => window.__demoReady, null, { timeout: timeoutMs, polling: 100 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: file });
  } catch (e) {
    errors.push(`runner: ${String(e.message).split('\n')[0]}`);
  } finally {
    await browser.close();
  }
  return errors;
}

/** Mean absolute per-channel difference (0..255) and share of clearly different pixels between two PNGs. */
async function imageDiff(fileA, fileB) {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    const toUrl = async (f) => `data:image/png;base64,${(await readFile(f)).toString('base64')}`;
    return await page.evaluate(async ([a, b]) => {
      const load = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const A = await load(a), B = await load(b);
      if (A.width !== B.width || A.height !== B.height) return { error: `size mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}` };
      let sum = 0, different = 0;
      const mean = [0, 0, 0, 0, 0, 0];
      const n = A.width * A.height;
      for (let i = 0; i < n; i++) {
        let worst = 0;
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(A.data[i * 4 + k] - B.data[i * 4 + k]);
          sum += d;
          if (d > worst) worst = d;
          mean[k] += A.data[i * 4 + k];
          mean[3 + k] += B.data[i * 4 + k];
        }
        if (worst > 32) different++;
      }
      return {
        meanAbsDiff: Math.round((sum / (n * 3)) * 100) / 100,
        differentPixelsPct: Math.round((different / n) * 10000) / 100,
        meanColorA: mean.slice(0, 3).map((v) => Math.round(v / n)),
        meanColorB: mean.slice(3).map((v) => Math.round(v / n)),
      };
    }, [await toUrl(fileA), await toUrl(fileB)]);
  } finally {
    await browser.close();
  }
}

// ---- main ------------------------------------------------------------------------

const median = (list) => {
  const s = list.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d));
const kb = (v) => `${(v / 1024).toFixed(0)} KB`;

if (!engines.length) { console.error('no engines to run'); process.exit(1); }
await acquireLock();
await mkdir(OUT, { recursive: true });
await mkdir(dirname(outFile), { recursive: true });

console.log(`engines: ${engines.join(', ')} | scenarios: ${scenarioNames.join(', ')} | runs: ${runs} | frames: ${frames} (+${warmup} warm-up) | ${width}x${height}`);
const bundles = {}, servers = {}, ports = {};
for (const e of engines) {
  bundles[e] = await buildEngine(e);
  servers[e] = await serve(bundles[e].outDir);
  ports[e] = servers[e].address().port;
}

const records = [];
const failures = [];
let browserVersion = null;

// screenshots (deterministic poses) + similarity to the reference renderer
const shots = {};
if (wantShots) {
  for (const e of engines) {
    shots[e] = {};
    for (const [name, q] of Object.entries(SHOTS)) {
      const file = join(OUT, `${e}-${name}.png`);
      const errors = await screenshot(e, ports[e], { ...extraQuery, ...q }, file);
      if (errors.length) failures.push(...errors.map((x) => `${e} ${name} shot: ${x}`));
      const entry = { file: relative(ROOT, file), errors };
      if (flag('save-reference') && e === 'raw' && existsSync(file)) {
        await mkdir(REFERENCE, { recursive: true });
        await copyFile(file, join(REFERENCE, `${name}.png`));
      }
      const ref = join(REFERENCE, `${name}.png`);
      if (existsSync(ref) && existsSync(file) && e !== 'raw') entry.vsReference = await imageDiff(ref, file);
      shots[e][name] = entry;
      console.log(`  shot ${e}/${name}: ${entry.file}${entry.vsReference ? `  vs reference: ${JSON.stringify(entry.vsReference)}` : ''}${errors.length ? `  ERRORS: ${errors.join(' | ')}` : ''}`);
    }
  }
}

for (const scenario of scenarioNames) {
  for (let run = 0; run < runs; run++) {
    // rotate the order every run so no engine always goes first
    const order = engines.map((_, i) => engines[(i + run) % engines.length]);
    for (const e of order) {
      const query = { bench: 1, frames, warmup, ...SCENARIOS[scenario].query, ...extraQuery };
      const started = Date.now();
      const m = await measure(e, ports[e], query);
      browserVersion = m.browserVersion || browserVersion;
      records.push({ engine: e, scenario, run, query, ...m });
      if (m.errors.length) failures.push(...m.errors.map((x) => `${e} ${scenario} #${run}: ${x}`));
      const r = m.result;
      console.log(r
        ? `  ${scenario.padEnd(9)} #${run} ${e.padEnd(10)} interval ${fmt(r.interval.mean)} ms (${fmt(r.fps, 1)} fps)  cpu ${fmt(r.cpu.mean)} ms  p95 ${fmt(r.cpu.p95)}  draws ${r.census ? r.census.drawCalls : '–'}  tris ${r.census ? Math.round(r.census.triangles) : '–'}  [${((Date.now() - started) / 1000).toFixed(0)} s]${m.errors.length ? '  ERRORS' : ''}`
        : `  ${scenario.padEnd(9)} #${run} ${e.padEnd(10)} FAILED: ${m.errors.join(' | ')}`);
    }
  }
}
for (const s of Object.values(servers)) s.close();

// per engine x scenario summary: the median across runs of each per-run statistic
const summary = {};
for (const scenario of scenarioNames) {
  summary[scenario] = {};
  for (const e of engines) {
    const rs = records.filter((r) => r.engine === e && r.scenario === scenario && r.result);
    if (!rs.length) { summary[scenario][e] = null; continue; }
    const pick = (fn) => median(rs.map((r) => { try { return fn(r); } catch { return NaN; } }));
    const first = rs[0].result;
    summary[scenario][e] = {
      runs: rs.length,
      fps: pick((r) => r.result.fps),
      intervalMean: pick((r) => r.result.interval.mean), intervalP95: pick((r) => r.result.interval.p95), intervalP99: pick((r) => r.result.interval.p99),
      cpuMean: pick((r) => r.result.cpu.mean), cpuMedian: pick((r) => r.result.cpu.median), cpuP95: pick((r) => r.result.cpu.p95), cpuP99: pick((r) => r.result.cpu.p99), cpuMax: pick((r) => r.result.cpu.max),
      updateMean: pick((r) => r.result.update.mean), renderMean: pick((r) => r.result.render.mean),
      totalMean: pick((r) => r.result.total.mean), totalP95: pick((r) => r.result.total.p95),
      firstFrameMs: pick((r) => r.result.marks['first-frame']), engineReadyMs: pick((r) => r.result.marks['engine-ready']), sceneReadyMs: pick((r) => r.result.marks['scene-ready']), harnessCreatedMs: pick((r) => r.result.marks['harness-created']),
      heapUsedAfterGcMB: pick((r) => r.cdp.jsHeapUsedAfterGC / 1048576),
      allocatedKBPerFrame: pick((r) => r.result.memory.allocatedBytesPerFrame / 1024),
      scriptSeconds: pick((r) => r.cdp.scriptSeconds),
      drawCalls: first.census?.drawCalls ?? null, drawCallsToCanvas: first.census?.drawCallsToCanvas ?? null, drawCallsOffscreen: first.census?.drawCallsOffscreen ?? null,
      instancedDrawCalls: first.census?.instancedDrawCalls ?? null, triangles: first.census?.triangles ?? null, glCalls: first.census?.glCalls ?? null,
      engineStats: first.engineStats, canvas: first.canvas, gl: first.gl, version: first.version,
    };
  }
}

const output = {
  meta: {
    date: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30), browserVersion, viewport: { width, height }, frames, warmup, runs, extraQuery,
    scenarios: Object.fromEntries(scenarioNames.map((s) => [s, SCENARIOS[s]])),
  },
  bundles: Object.fromEntries(engines.map((e) => [e, { js: bundles[e].js, total: bundles[e].total, files: bundles[e].files }])),
  shots, summary, failures, records,
};
await writeFile(outFile, JSON.stringify(output));

console.log('\nBundle (production build of each demo, includes the ~shared scene code):');
for (const e of engines) console.log(`  ${e.padEnd(10)} JS ${kb(bundles[e].js.raw).padStart(8)} raw  ${kb(bundles[e].js.gzip).padStart(8)} gzip  ${kb(bundles[e].js.brotli).padStart(8)} brotli`);
for (const scenario of scenarioNames) {
  console.log(`\n${scenario} — ${SCENARIOS[scenario].label}`);
  console.log('  engine      fps    frame ms   cpu ms  cpu p95   update   render  total(sync)  draws    tris     GL calls  heap MB  first frame');
  for (const e of engines) {
    const s = summary[scenario][e];
    if (!s) { console.log(`  ${e.padEnd(10)} FAILED`); continue; }
    console.log(`  ${e.padEnd(10)} ${fmt(s.fps, 1).padStart(5)}  ${fmt(s.intervalMean).padStart(8)}  ${fmt(s.cpuMean).padStart(7)}  ${fmt(s.cpuP95).padStart(7)}  ${fmt(s.updateMean).padStart(7)}  ${fmt(s.renderMean).padStart(7)}  ${fmt(s.totalMean).padStart(10)}  ${String(s.drawCalls ?? '–').padStart(6)}  ${String(s.triangles ? Math.round(s.triangles) : '–').padStart(8)}  ${String(s.glCalls ?? '–').padStart(8)}  ${fmt(s.heapUsedAfterGcMB, 1).padStart(7)}  ${fmt(s.firstFrameMs, 0).padStart(8)} ms`);
  }
}
console.log(`\nresults: ${relative(ROOT, outFile)}`);
if (failures.length) {
  console.log(`\n${failures.length} problem(s):`);
  for (const f of [...new Set(failures)].slice(0, 40)) console.log(`  - ${f}`);
  process.exitCode = 1;
}
