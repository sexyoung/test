// Reference renderer: plain WebGL2, no engine.
// It defines the intended look (lighting maths, shadows, fog, colour pipeline) that the
// three engine demos reproduce, and it doubles as a "no engine overhead" baseline.

import { createWorld } from '../../shared/world.js';
import { createSim } from '../../shared/sim.js';
import { createHarness } from '../../shared/harness.js';
import { mat4Perspective, mat4LookAt, mat4Ortho, mat4Multiply, mat4Compose } from '../../shared/math.js';

const canvas = document.getElementById('app');
const harness = createHarness({ engine: '原生 WebGL2', version: '無引擎', canvas });
const { params, viewport } = harness;

const gl = canvas.getContext('webgl2', { antialias: params.aa, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' });
if (!gl) throw new Error('WebGL2 is not available');
harness.mark('engine-ready');

const world = createWorld({ seed: params.seed, npcs: params.npcs, density: params.density, colorSpace: 'linear' });
const sim = createSim(world, { input: harness.input, autopilot: params.autopilot });
const { env } = world;

// ---- shaders ----------------------------------------------------------------

const VS = (instanced) => `#version 300 es
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
${instanced ? 'layout(location=3) in mat4 aModel;' : 'uniform mat4 uModel;'}
uniform mat4 uViewProj;
uniform mat4 uView;
uniform mat4 uLightViewProj;
out vec3 vNormal;
out vec3 vColor;
out float vDepth;
out vec4 vShadowPos;
void main() {
  mat4 model = ${instanced ? 'aModel' : 'uModel'};
  vec4 world = model * vec4(aPosition, 1.0);
  vNormal = mat3(model) * aNormal; // uniform scale only, normalised per fragment
  vColor = aColor;
  vDepth = -(uView * world).z;
  vShadowPos = uLightViewProj * world;
  gl_Position = uViewProj * world;
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vNormal;
in vec3 vColor;
in float vDepth;
in vec4 vShadowPos;
uniform vec3 uSunDir, uSunColor, uFillDir, uFillColor, uAmbient, uFogColor;
uniform vec2 uFog;        // near, far
uniform vec4 uFlags;      // lit, fog, receiveShadow, opacity
uniform sampler2DShadow uShadowMap;
uniform float uShadowTexel;
out vec4 outColor;

float shadowFactor() {
  vec3 p = vShadowPos.xyz / vShadowPos.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  p.z -= 0.00035;
  // 3x3 tent PCF from four hardware-filtered (2x2) comparison taps
  float s = texture(uShadowMap, vec3(p.xy + vec2(-0.5, -0.5) * uShadowTexel, p.z));
  s += texture(uShadowMap, vec3(p.xy + vec2(0.5, -0.5) * uShadowTexel, p.z));
  s += texture(uShadowMap, vec3(p.xy + vec2(-0.5, 0.5) * uShadowTexel, p.z));
  s += texture(uShadowMap, vec3(p.xy + vec2(0.5, 0.5) * uShadowTexel, p.z));
  return s * 0.25;
}

void main() {
  vec3 c = vColor;
  if (uFlags.x > 0.5) {
    vec3 n = normalize(vNormal);
    float sun = max(dot(n, uSunDir), 0.0);
    if (uFlags.z > 0.5 && sun > 0.0) sun *= shadowFactor();
    c *= uAmbient + uSunColor * sun + uFillColor * max(dot(n, uFillDir), 0.0);
  }
  if (uFlags.y > 0.5) c = mix(c, uFogColor, clamp((vDepth - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0));
  c = mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); // linear -> sRGB
  outColor = vec4(c, uFlags.w);
}`;

const DEPTH_VS = (instanced) => `#version 300 es
layout(location=0) in vec3 aPosition;
${instanced ? 'layout(location=3) in mat4 aModel;' : 'uniform mat4 uModel;'}
uniform mat4 uLightViewProj;
void main() { gl_Position = uLightViewProj * ${instanced ? 'aModel' : 'uModel'} * vec4(aPosition, 1.0); }`;

const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

function createProgram(vs, fs) {
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const uniforms = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(prog, i).name;
    uniforms[name] = gl.getUniformLocation(prog, name);
  }
  return { prog, uniforms };
}

const programs = {
  mainInstanced: createProgram(VS(true), FS),
  mainSingle: createProgram(VS(false), FS),
  depthInstanced: createProgram(DEPTH_VS(true), DEPTH_FS),
  depthSingle: createProgram(DEPTH_VS(false), DEPTH_FS),
};

// ---- geometry ---------------------------------------------------------------

const buffers = new Map();
function geometryBuffers(name) {
  let b = buffers.get(name);
  if (!b) {
    const g = world.geometries[name];
    const make = (data) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return buf;
    };
    b = { position: make(g.positions), normal: make(g.normals), color: make(g.colors), vertexCount: g.vertexCount, vao: null };
    buffers.set(name, b);
  }
  return b;
}

function createVao(b, instanceBuffer) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  [b.position, b.normal, b.color].forEach((buf, loc) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  });
  if (instanceBuffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    for (let k = 0; k < 4; k++) {
      gl.enableVertexAttribArray(3 + k);
      gl.vertexAttribPointer(3 + k, 4, gl.FLOAT, false, 64, k * 16);
      gl.vertexAttribDivisor(3 + k, 1);
    }
  }
  gl.bindVertexArray(null);
  return vao;
}

const flagsOf = (material, receiveShadow) => {
  const m = world.materials[material];
  return [m.lit ? 1 : 0, m.fog ? 1 : 0, receiveShadow && params.shadows ? 1 : 0, m.opacity];
};

const statics = world.statics.map((s) => {
  const b = geometryBuffers(s.geometry);
  const instanceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, s.matrices, gl.STATIC_DRAW);
  return { ...s, vao: createVao(b, instanceBuffer), vertexCount: b.vertexCount, spec: world.materials[s.material], flags: flagsOf(s.material, s.receiveShadow) };
});

const nodeCount = world.dynamics.count;
const worldMatrices = new Float32Array(nodeCount * 16);
const local = new Float32Array(16);
const dynamics = world.dynamics.nodes.map((n, i) => {
  const b = n.geometry ? geometryBuffers(n.geometry) : null;
  if (b && !b.vao) b.vao = createVao(b, null);
  return {
    ...n, index: i, matrix: worldMatrices.subarray(i * 16, i * 16 + 16),
    vao: b ? b.vao : null, vertexCount: b ? b.vertexCount : 0,
    spec: world.materials[n.material], flags: flagsOf(n.material, n.receiveShadow),
  };
});
const dynamicMeshes = dynamics.filter((d) => d.vao);

// ---- shadow map -------------------------------------------------------------

const SHADOW = env.shadow;
const shadowTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW.mapSize, SHADOW.mapSize);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
const shadowFbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTexture, 0);
gl.drawBuffers([gl.NONE]);
gl.readBuffer(gl.NONE);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

const lightView = new Float32Array(16), lightProj = new Float32Array(16), lightViewProj = new Float32Array(16);
{
  const d = env.sun.direction, c = SHADOW.center;
  mat4LookAt(lightView, [c[0] + d[0] * SHADOW.distance, c[1] + d[1] * SHADOW.distance, c[2] + d[2] * SHADOW.distance], c);
  mat4Ortho(lightProj, -SHADOW.halfSize, SHADOW.halfSize, -SHADOW.halfSize, SHADOW.halfSize, SHADOW.near, SHADOW.far);
  mat4Multiply(lightViewProj, lightProj, lightView);
}

harness.mark('scene-ready');

// ---- frame ------------------------------------------------------------------

const proj = new Float32Array(16), view = new Float32Array(16), viewProj = new Float32Array(16);
const scale3 = (c, s) => [c[0] * s, c[1] * s, c[2] * s];
const stats = { drawCalls: 0, triangles: 0 };
harness.setStatsProvider(() => stats);

function resize() {
  canvas.width = viewport.width;
  canvas.height = viewport.height;
}
resize();
harness.onResize(resize);

function setFrameUniforms(p) {
  const u = p.uniforms;
  gl.useProgram(p.prog);
  gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniformMatrix4fv(u.uLightViewProj, false, lightViewProj);
  gl.uniform3fv(u.uSunDir, env.sun.direction);
  gl.uniform3fv(u.uSunColor, scale3(env.sun.color, env.sun.intensity));
  gl.uniform3fv(u.uFillDir, env.fill.direction);
  gl.uniform3fv(u.uFillColor, scale3(env.fill.color, env.fill.intensity));
  gl.uniform3fv(u.uAmbient, scale3(env.ambient.color, env.ambient.intensity));
  gl.uniform3fv(u.uFogColor, env.fog.color);
  gl.uniform2f(u.uFog, env.fog.near, env.fog.far);
  gl.uniform1i(u.uShadowMap, 0);
  gl.uniform1f(u.uShadowTexel, 1 / SHADOW.mapSize);
}

function drawStatic(s, program) {
  gl.bindVertexArray(s.vao);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, s.vertexCount, s.count);
  stats.drawCalls++;
  stats.triangles += (s.vertexCount / 3) * s.count;
}

function drawDynamic(d, program) {
  gl.uniformMatrix4fv(program.uniforms.uModel, false, d.matrix);
  gl.bindVertexArray(d.vao);
  gl.drawArrays(gl.TRIANGLES, 0, d.vertexCount);
  stats.drawCalls++;
  stats.triangles += d.vertexCount / 3;
}

function frame() {
  const { time, dt } = harness.beginFrame();
  sim.update(time, dt);

  // world matrices of the dynamic nodes (parents always precede children)
  const P = sim.positions, Q = sim.quaternions, S = sim.scales;
  for (let i = 0; i < nodeCount; i++) {
    const d = dynamics[i];
    if (d.parent < 0) {
      mat4Compose(d.matrix, 0, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3], S[i]);
    } else {
      mat4Compose(local, 0, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3], S[i]);
      mat4Multiply(d.matrix, dynamics[d.parent].matrix, local);
    }
  }

  harness.beginRender();
  stats.drawCalls = 0;
  stats.triangles = 0;

  // shadow pass
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.enable(gl.CULL_FACE);
  if (params.shadows) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.viewport(0, 0, SHADOW.mapSize, SHADOW.mapSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.cullFace(gl.FRONT); // store back faces: no acne on lit surfaces
    gl.useProgram(programs.depthInstanced.prog);
    gl.uniformMatrix4fv(programs.depthInstanced.uniforms.uLightViewProj, false, lightViewProj);
    for (const s of statics) if (s.castShadow) drawStatic(s, programs.depthInstanced);
    gl.useProgram(programs.depthSingle.prog);
    gl.uniformMatrix4fv(programs.depthSingle.uniforms.uLightViewProj, false, lightViewProj);
    for (const d of dynamicMeshes) if (d.castShadow) drawDynamic(d, programs.depthSingle);
  }

  // main pass
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.cullFace(gl.BACK);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  mat4Perspective(proj, env.camera.fov, canvas.width / canvas.height, env.camera.near, env.camera.far);
  mat4LookAt(view, sim.camera.eye, sim.camera.target);
  mat4Multiply(viewProj, proj, view);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, shadowTexture);

  const drawStatics = (transparent) => {
    const p = programs.mainInstanced;
    for (const s of statics) {
      if (s.spec.transparent !== transparent) continue;
      gl.depthMask(s.spec.depthWrite);
      if (s.spec.background) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
      gl.uniform4fv(p.uniforms.uFlags, s.flags);
      drawStatic(s, p);
    }
  };
  setFrameUniforms(programs.mainInstanced);
  drawStatics(false);
  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  setFrameUniforms(programs.mainSingle);
  for (const d of dynamicMeshes) {
    gl.uniform4fv(programs.mainSingle.uniforms.uFlags, d.flags);
    drawDynamic(d, programs.mainSingle);
  }
  // transparent last
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(programs.mainInstanced.prog);
  drawStatics(true);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.bindVertexArray(null);

  harness.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
