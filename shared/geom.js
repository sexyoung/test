// Flat-shaded triangle-soup builder used by the world generator.
// Everything is authored in sRGB colours and converted once at build() time.

import { srgbToLinear, hex } from './math.js';

const col = (c) => (typeof c === 'string' ? hex(c) : c);

export function mixColor(a, b, t) {
  a = col(a); b = col(b);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleColor(c, s) {
  c = col(c);
  return [Math.min(1, c[0] * s), Math.min(1, c[1] * s), Math.min(1, c[2] * s)];
}

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function transformDir(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

export class MeshBuilder {
  constructor() {
    this.p = []; // positions, 9 numbers per triangle
    this.n = []; // normals, 9 numbers per triangle
    this.c = []; // sRGB colours, 9 numbers per triangle
    this.custom = []; // per triangle: true when the normal was supplied explicitly
  }

  get triangleCount() {
    return this.p.length / 9;
  }

  /** Add one CCW triangle. `color` may be one colour or an array of three per-vertex colours. `normal` overrides the face normal. */
  tri(a, b, c, color, normal) {
    let nx, ny, nz;
    if (normal) {
      [nx, ny, nz] = normal;
    } else {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) return this; // degenerate
      nx /= l; ny /= l; nz /= l;
    }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    const perVertex = Array.isArray(color) && Array.isArray(color[0]);
    for (let i = 0; i < 3; i++) {
      const cc = col(perVertex ? color[i] : color);
      this.c.push(cc[0], cc[1], cc[2]);
    }
    this.custom.push(!!normal);
    return this;
  }

  /** CCW quad a-b-c-d. */
  quad(a, b, c, d, color, normal) {
    this.tri(a, b, c, color, normal);
    this.tri(a, c, d, color, normal);
    return this;
  }

  /** Same triangle visible from both sides (two triangles). With `normal`, both sides share it. */
  triDouble(a, b, c, color, normal) {
    this.tri(a, b, c, color, normal);
    this.tri(a, c, b, color, normal);
    return this;
  }

  quadDouble(a, b, c, d, color, normal) {
    this.quad(a, b, c, d, color, normal);
    this.quad(a, d, c, b, color, normal);
    return this;
  }

  /**
   * Append another builder, optionally transformed by a column-major matrix.
   * Face normals are recomputed from the transformed positions (correct for any affine
   * transform); explicitly supplied normals are rotated instead.
   */
  add(other, m) {
    const tris = other.p.length / 9;
    for (let t = 0; t < tris; t++) {
      const o = t * 9;
      let a = [other.p[o], other.p[o + 1], other.p[o + 2]];
      let b = [other.p[o + 3], other.p[o + 4], other.p[o + 5]];
      let c = [other.p[o + 6], other.p[o + 7], other.p[o + 8]];
      let normal = other.custom[t] ? [other.n[o], other.n[o + 1], other.n[o + 2]] : undefined;
      if (m) {
        a = transformPoint(m, a); b = transformPoint(m, b); c = transformPoint(m, c);
        if (normal) normal = transformDir(m, normal);
      }
      const colors = [
        [other.c[o], other.c[o + 1], other.c[o + 2]],
        [other.c[o + 3], other.c[o + 4], other.c[o + 5]],
        [other.c[o + 6], other.c[o + 7], other.c[o + 8]],
      ];
      this.tri(a, b, c, colors, normal);
    }
    return this;
  }

  /** Recolour every triangle: fn(centroid, normal, triangleIndex, currentColor) -> colour. */
  recolor(fn) {
    const tris = this.p.length / 9;
    for (let t = 0; t < tris; t++) {
      const o = t * 9;
      const centroid = [
        (this.p[o] + this.p[o + 3] + this.p[o + 6]) / 3,
        (this.p[o + 1] + this.p[o + 4] + this.p[o + 7]) / 3,
        (this.p[o + 2] + this.p[o + 5] + this.p[o + 8]) / 3,
      ];
      const cc = col(fn(centroid, [this.n[o], this.n[o + 1], this.n[o + 2]], t, [this.c[o], this.c[o + 1], this.c[o + 2]]));
      for (let i = 0; i < 3; i++) {
        this.c[o + i * 3] = cc[0]; this.c[o + i * 3 + 1] = cc[1]; this.c[o + i * 3 + 2] = cc[2];
      }
    }
    return this;
  }

  // ---- primitives -------------------------------------------------------

  /** Axis-aligned box. `center` is the box centre. */
  box(w, h, d, color, center = [0, 0, 0]) {
    return this.taperedBox(w, d, w, d, h, color, [center[0], center[1] - h / 2, center[2]]);
  }

  /**
   * Box whose bottom rectangle (w0 x d0, at y=0) can differ from the top (w1 x d1, at y=h).
   * `base` is the centre of the bottom face. `colors` may be one colour or {side, top, bottom}.
   */
  taperedBox(w0, d0, w1, d1, h, colors, base = [0, 0, 0]) {
    const cs = colors && colors.side ? colors : { side: colors, top: colors, bottom: colors };
    const [bx, by, bz] = base;
    const a = [bx - w0 / 2, by, bz + d0 / 2], b = [bx + w0 / 2, by, bz + d0 / 2];
    const c = [bx + w0 / 2, by, bz - d0 / 2], d = [bx - w0 / 2, by, bz - d0 / 2];
    const e = [bx - w1 / 2, by + h, bz + d1 / 2], f = [bx + w1 / 2, by + h, bz + d1 / 2];
    const g = [bx + w1 / 2, by + h, bz - d1 / 2], i = [bx - w1 / 2, by + h, bz - d1 / 2];
    this.quad(a, b, f, e, cs.side); // +z
    this.quad(b, c, g, f, cs.side); // +x
    this.quad(c, d, i, g, cs.side); // -z
    this.quad(d, a, e, i, cs.side); // -x
    this.quad(e, f, g, i, cs.top); // top
    this.quad(d, c, b, a, cs.bottom); // bottom
    return this;
  }

  /**
   * N-sided frustum around the Y axis from y=0 (radius r0) to y=h (radius r1; 0 makes a cone).
   * `colors` may be one colour, {side, top, bottom}, or a function(sideIndex) -> colour for the sides.
   */
  prism(sides, r0, r1, h, colors, base = [0, 0, 0], { capTop = true, capBottom = true, phase = 0 } = {}) {
    const cs = typeof colors === 'function' ? { side: colors, top: colors(0), bottom: colors(0) }
      : colors && colors.side ? colors : { side: colors, top: colors, bottom: colors };
    const [bx, by, bz] = base;
    const ring = (r, y) => {
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = phase + (i / sides) * Math.PI * 2;
        pts.push([bx + Math.sin(a) * r, y, bz + Math.cos(a) * r]);
      }
      return pts;
    };
    const lo = ring(r0, by), hi = ring(r1, by + h);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const sc = typeof cs.side === 'function' ? cs.side(i) : cs.side;
      if (r1 > 1e-9 && r0 > 1e-9) this.quad(lo[i], lo[j], hi[j], hi[i], sc);
      else if (r0 > 1e-9) this.tri(lo[i], lo[j], [bx, by + h, bz], sc);
      else this.tri([bx, by, bz], hi[j], hi[i], sc);
    }
    if (capTop && r1 > 1e-9) for (let i = 1; i < sides - 1; i++) this.tri(hi[0], hi[i], hi[i + 1], cs.top);
    if (capBottom && r0 > 1e-9) for (let i = 1; i < sides - 1; i++) this.tri(lo[0], lo[i + 1], lo[i], cs.bottom);
    return this;
  }

  /** Add an indexed shape {verts:[[x,y,z]], faces:[[i,j,k]]} with a colour or colour function(faceIndex, centroid, normal). */
  indexed(shape, color, m) {
    for (let f = 0; f < shape.faces.length; f++) {
      const [i, j, k] = shape.faces[f];
      let a = shape.verts[i], b = shape.verts[j], c = shape.verts[k];
      if (m) { a = transformPoint(m, a); b = transformPoint(m, b); c = transformPoint(m, c); }
      let cc = color;
      if (typeof color === 'function') {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        cc = color(f, [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], [nx, ny, nz]);
      }
      this.tri(a, b, c, cc);
    }
    return this;
  }

  /**
   * Finish: typed arrays plus local bounds.
   * @param {string} name
   * @param {'linear'|'srgb'} colorSpace colour space of the emitted vertex colours
   */
  build(name, colorSpace = 'linear') {
    const positions = new Float32Array(this.p);
    const normals = new Float32Array(this.n);
    const colors = new Float32Array(this.c.length);
    for (let i = 0; i < colors.length; i++) colors[i] = colorSpace === 'linear' ? srgbToLinear(this.c[i]) : this.c[i];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (positions[i + k] < min[k]) min[k] = positions[i + k];
        if (positions[i + k] > max[k]) max[k] = positions[i + k];
      }
    }
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    let r2 = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i] - center[0], dy = positions[i + 1] - center[1], dz = positions[i + 2] - center[2];
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    return {
      name,
      positions,
      normals,
      colors,
      vertexCount: positions.length / 3,
      triangleCount: positions.length / 9,
      bounds: { min, max, center, radius: Math.sqrt(r2) },
    };
  }
}

// ---- indexed helper shapes ------------------------------------------------

/** Icosphere as an indexed shape. subdivisions: 0 = 20 faces, 1 = 80, 2 = 320. */
export function icosphere(subdivisions = 1, radius = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map();
    const mid = (i, j) => {
      const key = i < j ? i * 100000 + j : j * 100000 + i;
      let idx = cache.get(key);
      if (idx === undefined) {
        const a = verts[i], b = verts[j];
        idx = verts.length;
        verts.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
        cache.set(key, idx);
      }
      return idx;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  verts = verts.map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [(v[0] / l) * radius, (v[1] / l) * radius, (v[2] / l) * radius];
  });
  return { verts, faces };
}

/** Push every vertex in/out along its direction from the origin by up to +-amount (fraction of its length). */
export function jitterShape(shape, amount, rand) {
  return {
    faces: shape.faces,
    verts: shape.verts.map((v) => {
      const s = 1 + (rand() * 2 - 1) * amount;
      return [v[0] * s, v[1] * s, v[2] * s];
    }),
  };
}

/** Non-uniformly scale / offset an indexed shape (authoring only). */
export function transformShape(shape, sx, sy, sz, ox = 0, oy = 0, oz = 0) {
  return { faces: shape.faces, verts: shape.verts.map((v) => [v[0] * sx + ox, v[1] * sy + oy, v[2] * sz + oz]) };
}
