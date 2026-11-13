// Shared page harness: URL parameters, HUD, input, frame timing and the benchmark protocol.
// It is identical for every engine, so the numbers it produces are directly comparable.
//
//   const harness = createHarness({ engine: 'three.js', version: 'r187', canvas });
//   const world = createWorld({ ...harness.params, colorSpace: 'linear' });
//   const sim = createSim(world, { input: harness.input, autopilot: harness.params.autopilot });
//   harness.mark('engine-ready');            // after the renderer / engine object exists
//   ... build the scene ...
//   harness.mark('scene-ready');
//   harness.setStatsProvider(() => ({ drawCalls, triangles }));   // the engine's own counters, last frame
//   per frame:
//     const { time, dt } = harness.beginFrame();   // start of the frame's work
//     sim.update(time, dt); ...copy transforms...
//     harness.beginRender();                        // optional: splits "update" from "render"
//     ...engine render call...
//     harness.endFrame();                           // right after the render call returns
//
// URL parameters (all optional):
//   npcs=24 density=1 shadows=1 aa=1 seed=1 dpr=<n> hud=1
//   bench=1 [frames=600 warmup=120 sync=0 census=1]   deterministic benchmark run
//   freeze=<seconds>                                   freeze simulation time (for screenshots)
//   autopilot=1                                        scripted player and camera (always on with bench=1)

import './style.css';

const ENGINES = [
  ['three', 'Three.js'],
  ['babylon', 'Babylon.js'],
  ['playcanvas', 'PlayCanvas'],
  ['raw', '原生 WebGL2'],
];

function parseParams() {
  const q = new URLSearchParams(location.search);
  // parameters after '#' override the query string; links between pages use the hash
  for (const [k, v] of new URLSearchParams(location.hash.replace(/^#/, ''))) q.set(k, v);
  const num = (k, d) => (q.has(k) && q.get(k) !== '' && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  const bench = q.get('bench') === '1';
  return {
    bench,
    chain: q.get('chain') === '1', // started from bench.html: store the result and move on to the next run
    all: q,
    frames: Math.max(1, Math.floor(num('frames', 600))),
    warmup: Math.max(0, Math.floor(num('warmup', 120))),
    sync: q.get('sync') === '1',
    census: q.get('census') !== '0',
    npcs: Math.max(0, Math.floor(num('npcs', 24))),
    density: Math.max(0.05, num('density', 1)),
    shadows: q.get('shadows') !== '0',
    aa: q.get('aa') !== '0',
    seed: Math.floor(num('seed', 1)),
    hud: q.get('hud') !== '0',
    freeze: q.has('freeze') ? num('freeze', 0) : null,
    autopilot: bench || q.get('autopilot') === '1', // scripted player + camera instead of user input
    dpr: q.has('dpr') ? Math.max(0.25, num('dpr', 1)) : bench ? 1 : Math.min(window.devicePixelRatio || 1, 2),
  };
}

function summarize(samples) {
  const n = samples.length;
  if (!n) return null;
  const sorted = Float64Array.from(samples).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (sorted[i] - mean) ** 2;
  const at = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
  const r = (v) => Math.round(v * 1000) / 1000;
  return { mean: r(mean), median: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), min: r(sorted[0]), max: r(sorted[n - 1]), stdev: r(Math.sqrt(sq / n)) };
}

function createInput(canvas) {
  const keys = new Set();
  let lookX = 0, lookY = 0, zoom = 0, jump = false;
  let dragId = null, lastX = 0, lastY = 0;
  const stick = { x: 0, y: 0 };
  const isTyping = (e) => e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '');
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    keys.add(e.code);
    if (e.code === 'Space') jump = true;
    if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('pointerdown', (e) => {
    dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    lookX += e.clientX - lastX; lookY += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  });
  const release = (e) => { if (e.pointerId === dragId) dragId = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => { zoom += e.deltaY; e.preventDefault(); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const down = (...codes) => (codes.some((c) => keys.has(c)) ? 1 : 0);
  return {
    stick,
    /** Movement axes plus the look / zoom deltas accumulated since the previous call. */
    sample() {
      const out = {
        moveX: clampUnit(down('KeyD', 'ArrowRight') - down('KeyA', 'ArrowLeft') + stick.x),
        moveZ: clampUnit(down('KeyW', 'ArrowUp') - down('KeyS', 'ArrowDown') + stick.y),
        run: keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(stick.x, stick.y) > 0.92,
        jump, lookX, lookY, zoom,
      };
      lookX = lookY = zoom = 0; jump = false;
      return out;
    },
    pressJump() { jump = true; },
  };
}

const clampUnit = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Touch joystick + jump button, only shown on touch devices. */
function createTouchControls(input) {
  const root = document.createElement('div');
  root.className = 'lp-touch';
  root.innerHTML = '<div class="lp-stick"><div class="lp-knob"></div></div><button class="lp-jump" type="button">跳</button>';
  document.body.appendChild(root);
  const pad = root.querySelector('.lp-stick'), knob = root.querySelector('.lp-knob');
  let id = null;
  const move = (e) => {
    const r = pad.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    input.stick.x = x; input.stick.y = -y;
    knob.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
  };
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null; input.stick.x = input.stick.y = 0; knob.style.transform = '';
  };
  pad.addEventListener('pointerdown', (e) => { id = e.pointerId; pad.setPointerCapture?.(id); move(e); e.preventDefault(); });
  pad.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  root.querySelector('.lp-jump').addEventListener('pointerdown', (e) => { input.pressJump(); e.preventDefault(); });
}

const CHAIN_KEY = 'lowpoly-chain';
function loadChain() {
  try { const s = sessionStorage.getItem(CHAIN_KEY); if (s) return JSON.parse(s); } catch { /* storage unavailable */ }
  try { const n = JSON.parse(window.name || 'null'); if (n && n.lowpolyChain) return n.lowpolyChain; } catch { /* not ours */ }
  return null;
}
function saveChain(chain) {
  try { sessionStorage.setItem(CHAIN_KEY, JSON.stringify(chain)); } catch { /* storage unavailable */ }
  try { window.name = JSON.stringify({ lowpolyChain: chain }); } catch { /* ignore */ }
}
/** bench.html queues runs; each finished run stores a compact result and navigates to the next one. */
function advanceChain(result) {
  const chain = loadChain();
  if (!chain || !chain.queue || chain.index >= chain.queue.length) return;
  const job = chain.queue[chain.index];
  chain.results.push({
    engine: job.engine, name: result.engine, version: result.version, scenario: job.scenario, mode: job.mode,
    fps: result.fps, cpu: result.cpu, update: result.update, render: result.render, interval: result.interval, total: result.total,
    census: result.census && { drawCalls: result.census.drawCalls, triangles: result.census.triangles, glCalls: result.census.glCalls },
    memory: result.memory, marks: result.marks, canvas: result.canvas, gl: result.gl && { renderer: result.gl.renderer },
  });
  chain.index++;
  saveChain(chain);
  const next = chain.queue[chain.index];
  setTimeout(() => {
    if (!next) { location.href = '../../bench.html'; return; }
    location.href = `../${next.engine}/index.html#${next.hash}`;
    if (next.engine === job.engine) location.reload();
  }, 300);
}

/** Wrap every WebGL function on the context to count calls (used only for a few un-timed frames). */
function installCensus(gl) {
  const counts = Object.create(null);
  const totals = { calls: 0, drawCalls: 0, drawCallsToCanvas: 0, drawCallsOffscreen: 0, instancedDrawCalls: 0, triangles: 0, instances: 0 };
  const wrapped = [];
  let offscreen = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) !== null;
  const tri = (mode, count) => (mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0);
  const draw = (mode, count, instances, instanced) => {
    totals.drawCalls++;
    if (offscreen) totals.drawCallsOffscreen++; else totals.drawCallsToCanvas++;
    if (instanced) { totals.instancedDrawCalls++; totals.instances += instances; }
    totals.triangles += tri(mode, count) * instances;
  };
  const seen = new Set();
  for (let proto = Object.getPrototypeOf(gl); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (seen.has(name) || name === 'constructor') continue;
      seen.add(name);
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (!desc || typeof desc.value !== 'function') continue;
      const fn = desc.value;
      counts[name] = 0;
      gl[name] = function (...args) {
        counts[name]++;
        totals.calls++;
        switch (name) {
          case 'drawArrays': draw(args[0], args[2], 1, false); break;
          case 'drawElements': draw(args[0], args[1], 1, false); break;
          case 'drawRangeElements': draw(args[0], args[3], 1, false); break;
          case 'drawArraysInstanced': draw(args[0], args[2], args[3], true); break;
          case 'drawElementsInstanced': draw(args[0], args[1], args[4], true); break;
          case 'bindFramebuffer': if (args[0] !== 0x8ca8 /* READ_FRAMEBUFFER */) offscreen = args[1] !== null; break;
          default:
        }
        return fn.apply(gl, args);
      };
      wrapped.push(name);
    }
  }
  return { counts, totals, uninstall() { for (const name of wrapped) delete gl[name]; } };
}

/**
 * @param {Object} o
 * @param {string} o.engine   display name, e.g. 'Three.js'
 * @param {string} o.version  engine version string
 * @param {HTMLCanvasElement} o.canvas
 */
export function createHarness({ engine, version, canvas }) {
  const params = parseParams();
  const created = performance.now();
  const marks = { 'harness-created': Math.round(created) };
  const input = createInput(canvas);
  let statsProvider = () => ({});
  const resizeListeners = [];

  document.documentElement.classList.add('lp-root');
  canvas.classList.add('lp-canvas');

  // ---- HUD ----------------------------------------------------------------
  const hud = document.createElement('div');
  hud.className = 'lp-hud';
  const here = location.pathname.replace(/index\.html$/, '').replace(/\/$/, '').split('/').pop();
  const RUN_KEYS = ['bench', 'chain', 'frames', 'warmup', 'sync', 'census'];
  const withParams = (changes = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of params.all) if (!RUN_KEYS.includes(k)) q.set(k, v);
    for (const [k, v] of Object.entries(changes)) { if (v === null) q.delete(k); else q.set(k, v); }
    const s = q.toString();
    return `index.html${s ? `#${s}` : ''}`;
  };
  const search = withParams().replace('index.html', '');
  window.addEventListener('hashchange', () => location.reload());
  hud.innerHTML = `
    <div class="lp-panel">
      <div class="lp-title">${engine} <span>${version}</span></div>
      <div class="lp-stats" data-stats>…</div>
      <div class="lp-scene">NPC ${params.npcs} · 植被密度 ×${params.density} · 陰影 ${params.shadows ? '開' : '關'}</div>
      <div class="lp-presets">
        <a href="${withParams({ npcs: null, density: null })}">一般</a>
        <a href="${withParams({ npcs: 300, density: null })}">人群 ×300</a>
        <a href="${withParams({ npcs: null, density: 4 })}">植被 ×4</a>
        <a href="${withParams({ shadows: params.shadows ? 0 : null })}">陰影 ${params.shadows ? '關' : '開'}</a>
      </div>
      <div class="lp-help">WASD／方向鍵移動 · Shift 跑 · 空白鍵跳 · 拖曳轉視角 · 滾輪縮放</div>
    </div>
    <nav class="lp-nav">
      ${ENGINES.map(([dir, label]) => `<a href="../${dir}/index.html${search}"${dir === here ? ' class="lp-current"' : ''}>${label}</a>`).join('')}
      <a href="../../bench.html">效能比較</a>
      <a href="../../index.html">首頁</a>
    </nav>`;
  if (params.hud) document.body.appendChild(hud);
  const statsEl = hud.querySelector('[data-stats]');
  if (params.hud && !params.bench && matchMedia('(pointer: coarse)').matches) createTouchControls(input);

  // ---- viewport -----------------------------------------------------------
  const viewport = { cssWidth: 0, cssHeight: 0, dpr: params.dpr, width: 0, height: 0 };
  const measure = () => {
    viewport.cssWidth = Math.max(1, window.innerWidth);
    viewport.cssHeight = Math.max(1, window.innerHeight);
    viewport.width = Math.round(viewport.cssWidth * viewport.dpr);
    viewport.height = Math.round(viewport.cssHeight * viewport.dpr);
  };
  measure();
  window.addEventListener('resize', () => { measure(); for (const fn of resizeListeners) fn(viewport); });

  // ---- frame timing -------------------------------------------------------
  const N = params.frames;
  const rec = params.bench ? {
    cpu: new Float32Array(N), update: new Float32Array(N), render: new Float32Array(N),
    interval: new Float32Array(N), total: new Float32Array(N), heap: new Float64Array(N),
  } : null;
  const CENSUS_FRAMES = 4;
  const frameInfo = { time: 0, dt: 0, frame: 0 };
  let frame = 0, measured = 0, phase = params.bench ? 'warmup' : 'live';
  let tBegin = 0, tRender = 0, lastBegin = 0, lastInterval = 0, realTime = 0, lastNow = 0;
  let gl = null, glInfo = null, census = null, censusFrames = 0, measureStart = 0, measureEnd = 0;
  let hudAccum = 0, hudFrames = 0, hudCpu = 0, hudLast = performance.now();
  let result = null;

  function captureGl() {
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) { glInfo = { api: 'unknown (no WebGL context on the canvas)' }; return; }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    glInfo = {
      api: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      contextAttributes: gl.getContextAttributes(),
    };
  }

  function beginFrame() {
    const now = performance.now();
    lastInterval = lastBegin ? now - lastBegin : 0;
    lastBegin = now;
    if (params.bench) {
      frameInfo.time = frame / 60;
      frameInfo.dt = 1 / 60;
    } else if (params.freeze !== null) {
      frameInfo.time = params.freeze;
      frameInfo.dt = 0;
    } else {
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      realTime += dt;
      frameInfo.time = realTime;
      frameInfo.dt = dt;
    }
    lastNow = now;
    frameInfo.frame = frame;
    tRender = 0;
    tBegin = performance.now();
    return frameInfo;
  }

  function beginRender() {
    tRender = performance.now();
  }

  function endFrame() {
    const tEnd = performance.now();
    let total = 0;
    if (frame === 0) {
      captureGl();
      marks['first-frame'] = Math.round(tEnd);
    }
    if (params.bench && params.sync && gl) {
      gl.finish();
      total = performance.now() - tBegin;
    }
    const cpu = tEnd - tBegin;

    if (phase === 'measure') {
      rec.cpu[measured] = cpu;
      rec.update[measured] = tRender ? tRender - tBegin : 0;
      rec.render[measured] = tRender ? tEnd - tRender : 0;
      rec.interval[measured] = lastInterval;
      rec.total[measured] = total;
      rec.heap[measured] = performance.memory ? performance.memory.usedJSHeapSize : 0;
      measured++;
      if (measured === N) {
        measureEnd = performance.now();
        if (params.census && gl) { phase = 'census'; census = installCensus(gl); censusFrames = 0; }
        else finish();
      }
    } else if (phase === 'census') {
      if (++censusFrames === CENSUS_FRAMES) { census.uninstall(); finish(); }
    } else if (phase === 'warmup' && frame + 1 >= params.warmup) {
      phase = 'measure';
      measureStart = performance.now();
    }

    frame++;
    if (frame === 3) window.__demoReady = true;

    // HUD (about four updates per second)
    hudFrames++; hudAccum += lastInterval; hudCpu += cpu;
    if (params.hud && tEnd - hudLast > 250) {
      const s = statsProvider() || {};
      const fps = hudAccum > 0 ? (1000 * hudFrames) / hudAccum : 0;
      const fmt = (v) => (v === undefined || v === null ? '–' : v >= 10000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v)));
      let text = `FPS ${fps.toFixed(0)} · CPU ${(hudCpu / hudFrames).toFixed(2)} ms · draw calls ${fmt(s.drawCalls)} · 三角形 ${fmt(s.triangles)}`;
      if (phase === 'warmup') text = `暖機中 ${frame}/${params.warmup} · ${text}`;
      else if (phase === 'measure') text = `量測中 ${measured}/${N} · ${text}`;
      else if (phase === 'census') text = `統計 WebGL 呼叫… · ${text}`;
      else if (phase === 'done') text = `完成 · 平均 ${result.interval.mean.toFixed(2)} ms/幀 · CPU ${result.cpu.mean.toFixed(2)} ms`;
      statsEl.textContent = text;
      hudFrames = 0; hudAccum = 0; hudCpu = 0; hudLast = tEnd;
      if (params.bench && window.parent !== window && phase !== 'done') {
        window.parent.postMessage({ type: 'lowpoly-bench-progress', phase, frame, total: params.warmup + N }, '*');
      }
    }
  }

  function finish() {
    phase = 'done';
    const heap = rec.heap;
    let allocated = 0, drops = 0, distinct = new Set();
    for (let i = 1; i < N; i++) {
      const d = heap[i] - heap[i - 1];
      if (d > 0) allocated += d; else if (d < 0) drops++;
      if (distinct.size < 4) distinct.add(heap[i]);
    }
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const scripts = resources.filter((r) => r.initiatorType === 'script' || /\.m?js(\?|$)/.test(r.name));
    const sum = (list, key) => list.reduce((a, r) => a + (r[key] || 0), 0);
    const c = census;
    const perFrame = (v) => Math.round((v / CENSUS_FRAMES) * 10) / 10;
    const top = c ? Object.entries(c.counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, perFrame(v)]) : null;
    const round = (arr) => Array.from(arr, (v) => Math.round(v * 100) / 100);
    result = {
      engine, version,
      params: { ...params, all: undefined },
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio: window.devicePixelRatio,
      gl: glInfo,
      canvas: { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, samples: gl ? gl.getParameter(gl.SAMPLES) : null },
      marks, // milliseconds since navigation start
      navigation: nav ? { responseEnd: Math.round(nav.responseEnd), domContentLoaded: Math.round(nav.domContentLoadedEventEnd) } : null,
      scripts: { count: scripts.length, decodedBytes: sum(scripts, 'decodedBodySize'), transferBytes: sum(scripts, 'transferSize') },
      frames: N,
      wallSeconds: Math.round(measureEnd - measureStart) / 1000,
      fps: Math.round((N / ((measureEnd - measureStart) / 1000)) * 100) / 100,
      cpu: summarize(rec.cpu), // ms of main-thread work per frame: beginFrame -> endFrame
      update: summarize(rec.update), // beginFrame -> beginRender (simulation + copying transforms)
      render: summarize(rec.render), // beginRender -> endFrame (the engine's render call)
      interval: summarize(rec.interval), // ms between consecutive frames
      total: params.sync ? summarize(rec.total) : null, // beginFrame -> after gl.finish() (sync=1 only)
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        precise: distinct.size > 2,
        allocatedBytesPerFrame: Math.round(allocated / N),
        heapDrops: drops,
      } : null,
      engineStats: statsProvider() || {},
      census: c ? {
        frames: CENSUS_FRAMES,
        glCalls: perFrame(c.totals.calls),
        drawCalls: perFrame(c.totals.drawCalls),
        drawCallsToCanvas: perFrame(c.totals.drawCallsToCanvas),
        drawCallsOffscreen: perFrame(c.totals.drawCallsOffscreen),
        instancedDrawCalls: perFrame(c.totals.instancedDrawCalls),
        instances: perFrame(c.totals.instances),
        triangles: perFrame(c.totals.triangles),
        top,
      } : null,
      samples: { cpu: round(rec.cpu), interval: round(rec.interval), total: params.sync ? round(rec.total) : null },
    };
    window.__benchResult = result;
    if (params.chain) advanceChain(result);
    if (window.parent !== window) window.parent.postMessage({ type: 'lowpoly-bench-result', result }, '*');
  }

  return {
    params,
    input,
    viewport,
    /** Register a callback for window resizes; it receives the viewport ({cssWidth, cssHeight, dpr, width, height}). */
    onResize(fn) { resizeListeners.push(fn); },
    /** Record a startup milestone (milliseconds since navigation start). Use 'engine-ready' and 'scene-ready'. */
    mark(name) { marks[name] = Math.round(performance.now()); },
    setStatsProvider(fn) { statsProvider = fn; },
    beginFrame,
    beginRender,
    endFrame,
    get phase() { return phase; },
    get result() { return result; },
  };
}
