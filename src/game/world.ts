import * as THREE from "three";
import { B, I, T, def, FACES, GeoBuilder, getMaterials } from "./blocks";
import type { Slot } from "./store";

export const WX = 96;
export const WY = 48;
export const WZ = 96;
export const SEA = 14;
export const CH = 16;
const NCX = WX / CH;
const NCZ = WZ / CH;

export function hash2(x: number, z: number, s = 0) {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, z: number, s: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s), c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x: number, z: number) => vnoise(x, z, 1) * 0.6 + vnoise(x * 2, z * 2, 2) * 0.3 + vnoise(x * 4, z * 4, 3) * 0.1;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const HOUSES = [
  { x: 56, z: 28 },
  { x: 74, z: 48 },
  { x: 54, z: 66 },
  { x: 80, z: 74 },
];
export const TOWER = { x: 10, z: 44 };

export class World {
  data = new Uint8Array(WX * WY * WZ);
  chests = new Map<string, Slot[]>();
  dirty = new Set<number>();
  group = new THREE.Group();
  meshes = new Map<number, THREE.Mesh[]>();
  spawn = new THREE.Vector3(66, 30, 44);
  version = 0;

  idx(x: number, y: number, z: number) {
    return x + z * WX + y * WX * WZ;
  }
  inside(x: number, y: number, z: number) {
    return x >= 0 && x < WX && y >= 0 && y < WY && z >= 0 && z < WZ;
  }
  get(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return y < 0 ? B.STONE : B.AIR;
    return this.data[this.idx(x, y, z)] ?? 0;
  }
  /** Solid for collision; world edges are invisible walls. */
  solid(x: number, y: number, z: number) {
    if (x < 0 || z < 0 || x >= WX || z >= WZ) return true;
    if (y < 0) return true;
    return def(this.get(x, y, z)).solid;
  }
  set(x: number, y: number, z: number, b: number) {
    if (!this.inside(x, y, z)) return;
    this.data[this.idx(x, y, z)] = b;
    this.version++;
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    this.markDirty(cx, cz);
    if (x % CH === 0) this.markDirty(cx - 1, cz);
    if (x % CH === CH - 1) this.markDirty(cx + 1, cz);
    if (z % CH === 0) this.markDirty(cx, cz - 1);
    if (z % CH === CH - 1) this.markDirty(cx, cz + 1);
  }
  private markDirty(cx: number, cz: number) {
    if (cx >= 0 && cz >= 0 && cx < NCX && cz < NCZ) this.dirty.add(cx + cz * NCX);
  }
  private put(x: number, y: number, z: number, b: number) {
    if (this.inside(x, y, z)) this.data[this.idx(x, y, z)] = b;
  }

  /** First air cell standing on solid ground, scanning downward from y. */
  groundBelow(x: number, y: number, z: number) {
    const xi = Math.floor(x), zi = Math.floor(z);
    for (let yy = Math.min(WY - 1, Math.floor(y)); yy >= 0; yy--) if (this.solid(xi, yy, zi)) return yy + 1;
    return 0;
  }

  generate() {
    const heights = new Int16Array(WX * WZ);
    for (let x = 0; x < WX; x++)
      for (let z = 0; z < WZ; z++) {
        const land = 17 + fbm(x / 22, z / 22) * 12;
        const sea = 6 + fbm(x / 10 + 50, z / 10) * 3;
        const t = smooth(16, 36, x + (fbm(z / 15, 3) - 0.5) * 12);
        const h = Math.round(sea + (land - sea) * t);
        heights[x + z * WX] = h;
        for (let y = 0; y <= h; y++) {
          let b: number = y < h - 3 ? B.STONE : y < h ? B.DIRT : h <= SEA + 1 ? B.SAND : B.GRASS;
          if (h <= SEA + 1 && y >= h - 2) b = B.SAND;
          this.put(x, y, z, b);
        }
        for (let y = h + 1; y <= SEA; y++) this.put(x, y, z, B.WATER);
        if (h < SEA - 2 && hash2(x, z, 11) < 0.07) {
          const tall = 1 + Math.floor(hash2(x, z, 12) * 3);
          for (let k = 1; k <= tall; k++) this.put(x, h + k, z, B.CORAL);
        }
      }

    const nearHouse = (x: number, z: number) =>
      HOUSES.some((h) => x >= h.x - 4 && x <= h.x + 10 && z >= h.z - 4 && z <= h.z + 12) ||
      (x >= TOWER.x - 4 && x <= TOWER.x + 10 && z >= TOWER.z - 4 && z <= TOWER.z + 10);

    // trees + wildflowers
    for (let x = 3; x < WX - 3; x++)
      for (let z = 3; z < WZ - 3; z++) {
        const h = heights[x + z * WX] ?? 0;
        if (this.get(x, h, z) !== B.GRASS || nearHouse(x, z)) continue;
        const fh = hash2(x, z, 21);
        if (fh < 0.035 && this.get(x, h + 1, z) === B.AIR) this.put(x, h + 1, z, fh < 0.017 ? B.FLOWER : B.FLOWER_Y);
        if (hash2(x, z, 7) > 0.022) continue;
        const th = 4 + Math.floor(hash2(x, z, 8) * 2);
        for (let k = 1; k <= th; k++) this.put(x, h + k, z, B.LOG);
        for (let dy = th - 2; dy <= th + 1; dy++) {
          const r = dy >= th ? 1 : 2;
          for (let dx = -r; dx <= r; dx++)
            for (let dz = -r; dz <= r; dz++) {
              if (Math.abs(dx) === r && Math.abs(dz) === r && hash2(x + dx, z + dz, dy) < 0.6) continue;
              const cur = this.get(x + dx, h + dy, z + dz);
              if (cur === B.AIR || cur === B.FLOWER || cur === B.FLOWER_Y) this.put(x + dx, h + dy, z + dz, B.LEAVES);
            }
        }
      }

    HOUSES.forEach((h, i) => this.house(h.x, h.z, Math.max(SEA + 2, heights[h.x + 3 + (h.z + 3) * WX] ?? 20), i));
    this.tower(TOWER.x, TOWER.z);

    const sx = 66, sz = 44;
    this.spawn.set(sx + 0.5, this.groundBelow(sx, WY - 1, sz), sz + 0.5);
  }

  private flatten(x0: number, z0: number, x1: number, z1: number, base: number) {
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        for (let y = 1; y < WY; y++) {
          const cur = this.get(x, y, z);
          if (y < base - 2) {
            if (cur === B.AIR || cur === B.WATER) this.put(x, y, z, B.STONE);
          } else if (y < base) this.put(x, y, z, B.DIRT);
          else if (y === base) this.put(x, y, z, B.GRASS);
          else this.put(x, y, z, B.AIR);
        }
      }
  }

  private loot(seed: number, extra: Slot[]): Slot[] {
    const s: Slot[] = Array(27).fill(null);
    const pool = [
      { id: I.APPLE, n: 3 }, { id: I.BREAD, n: 2 }, { id: B.GLASS, n: 12 }, { id: B.PLANKS, n: 16 },
      { id: B.BRICKS, n: 16 }, { id: B.LOG, n: 6 }, { id: B.COBBLE, n: 20 }, { id: B.TORCH, n: 8 }, { id: B.FENCE, n: 8 },
    ];
    extra.forEach((e, i) => (s[i * 4] = e));
    for (let k = 0; k < 5; k++) {
      const p = pool[Math.floor(hash2(seed, k, 31) * pool.length)]!;
      const slot = 1 + Math.floor(hash2(seed, k, 32) * 25);
      if (!s[slot]) s[slot] = { id: p.id, count: 1 + Math.floor(hash2(seed, k, 33) * p.n) };
    }
    return s;
  }

  /** Rustic cabin: cobble foundation, log frame, stepped gable roof, chimney, yard fence, flowerbeds, lamp posts. */
  private house(x0: number, z0: number, base: number, n: number) {
    this.flatten(x0 - 3, z0 - 3, x0 + 9, z0 + 11, base);
    const y0 = base;
    const P = (dx: number, y: number, dz: number, b: number) => this.put(x0 + dx, y, z0 + dz, b);
    for (let dx = 0; dx < 7; dx++) for (let dz = 0; dz < 7; dz++) { P(dx, y0, dz, B.COBBLE); P(dx, y0 - 1, dz, B.COBBLE); }
    for (let y = y0 + 1; y <= y0 + 4; y++)
      for (let dx = 0; dx < 7; dx++)
        for (let dz = 0; dz < 7; dz++) {
          const ex = dx === 0 || dx === 6, ez = dz === 0 || dz === 6;
          if (!ex && !ez) continue;
          const pillar = (ex && ez) || (ez && dz === 0 && dx === 3) || (ex && dz === 3);
          P(dx, y, dz, y === y0 + 1 ? B.COBBLE : pillar ? B.LOG : B.PLANKS);
          if (ex && ez) P(dx, y, dz, B.LOG);
        }
    for (let y = y0 + 2; y <= y0 + 3; y++) {
      for (const k of [2, 4]) { P(k, y, 0, B.GLASS); P(0, y, k, B.GLASS); P(6, y, k, B.GLASS); }
      P(1, y, 6, B.GLASS); P(5, y, 6, B.GLASS);
    }
    for (const k of [2, 4]) for (let y = y0 + 1; y <= y0 + 4; y++) P(k, y, 6, B.LOG); // door frame
    P(3, y0 + 1, 6, B.AIR); P(3, y0 + 2, 6, B.AIR); P(3, y0 + 3, 6, B.PLANKS);
    // stepped gable roof (ridge runs front-to-back) with overhangs
    for (let L = 0; L <= 4; L++) {
      const y = y0 + 5 + L, lo = -1 + L, hi = 7 - L;
      for (let dz = -1; dz <= 7; dz++) { P(lo, y, dz, L === 4 ? B.LOG : B.PLANKS); P(hi, y, dz, L === 4 ? B.LOG : B.PLANKS); }
      if (L === 0) for (let dx = 0; dx <= 6; dx++) for (let dz = 0; dz <= 6; dz++) P(dx, y, dz, B.PLANKS);
      else for (let dx = lo + 1; dx < hi; dx++) { P(dx, y, 0, B.PLANKS); P(dx, y, 6, B.PLANKS); }
    }
    P(3, y0 + 7, 6, B.GLASS); P(3, y0 + 7, 0, B.GLASS);
    for (let y = y0 + 5; y <= y0 + 9; y++) P(5, y, 4, B.COBBLE); // chimney
    // interior
    P(1, y0 + 1, 1, B.BED); P(1, y0 + 1, 2, B.BED);
    P(5, y0 + 1, 1, B.CHEST); P(5, y0 + 1, 3, B.CRAFT);
    P(3, y0 + 1, 1, B.TORCH); P(5, y0 + 1, 5, B.TORCH);
    const extra: Slot[] = n === 0 ? [{ id: I.SWORD, count: 1 }] : n === 2 ? [{ id: I.PICK, count: 1 }] : [];
    this.chests.set(`${x0 + 5},${y0 + 1},${z0 + 1}`, this.loot(n + 1, extra));
    // yard: path, flowerbeds, lamp posts, fence
    for (let dz = 7; dz <= 10; dz++) P(3, y0, dz, B.COBBLE);
    for (const dx of [0, 1, 5, 6]) { P(dx, y0, 7, B.DIRT); P(dx, y0 + 1, 7, (dx + n) % 2 ? B.FLOWER : B.FLOWER_Y); }
    for (const dx of [2, 4]) { P(dx, y0 + 1, 9, B.FENCE); P(dx, y0 + 2, 9, B.TORCH); }
    for (let dx = -2; dx <= 8; dx++) for (let dz = -2; dz <= 10; dz++) {
      const edge = dx === -2 || dx === 8 || dz === -2 || dz === 10;
      if (edge && !(dz === 10 && dx >= 2 && dx <= 4)) P(dx, y0 + 1, dz, B.FENCE);
    }
  }

  /** Multi-tier glass + stone-brick observation tower on a railed sea-floor platform. */
  private tower(x0: number, z0: number) {
    const fy = 5;
    const roof = SEA + 4;
    const P = (dx: number, y: number, dz: number, b: number) => this.put(x0 + dx, y, z0 + dz, b);
    for (let dx = -3; dx <= 9; dx++)
      for (let dz = -3; dz <= 9; dz++) {
        for (let y = 1; y <= fy; y++) P(dx, y, dz, y === fy ? B.BRICKS : B.STONE);
        for (let y = fy + 1; y <= SEA; y++) P(dx, y, dz, B.WATER);
        for (let y = SEA + 1; y < WY; y++) P(dx, y, dz, B.AIR);
        if (dx === -3 || dx === 9 || dz === -3 || dz === 9) P(dx, fy + 1, dz, B.FENCE);
      }
    for (let y = fy + 1; y < roof; y++)
      for (let dx = 0; dx < 7; dx++)
        for (let dz = 0; dz < 7; dz++) {
          const ex = dx === 0 || dx === 6, ez = dz === 0 || dz === 6;
          const band = y === fy + 4 || y === SEA;
          let b: number = B.AIR;
          if (ex || ez) {
            if ((ex && ez) || band) b = B.BRICKS;
            else if (y <= fy + 3) b = y === fy + 2 && (dx === 3 || dz === 3) ? B.GLASS : B.BRICKS;
            else b = B.GLASS;
          } else if (band) b = B.BRICKS; // floors
          P(dx, y, dz, b);
        }
    for (let dx = -1; dx <= 7; dx++)
      for (let dz = -1; dz <= 7; dz++) {
        P(dx, roof, dz, B.BRICKS);
        if (dx === -1 || dx === 7 || dz === -1 || dz === 7) P(dx, roof + 1, dz, B.FENCE);
      }
    // surface door
    P(3, SEA + 1, 6, B.AIR); P(3, SEA + 2, 6, B.AIR);
    for (let dz = 7; dz <= 8; dz++) P(3, SEA, dz, B.PLANKS); // little dock
    // ladder shaft through every floor up to the roof hatch
    for (let y = fy + 1; y <= roof; y++) P(1, y, 1, B.LADDER);
    // floodlight mast
    P(3, roof + 1, 3, B.FENCE); P(3, roof + 2, 3, B.FENCE); P(3, roof + 3, 3, B.TORCH);
    // furnishings per tier
    P(5, fy + 1, 5, B.CHEST); P(3, fy + 1, 3, B.TORCH); P(5, fy + 1, 1, B.CORAL);
    P(5, fy + 5, 5, B.CHEST); P(3, fy + 5, 3, B.TORCH); P(1, fy + 5, 5, B.BED); P(2, fy + 5, 5, B.CRAFT);
    P(5, SEA + 1, 5, B.CRAFT); P(5, SEA + 1, 1, B.TORCH);
    this.chests.set(`${x0 + 5},${fy + 1},${z0 + 5}`, this.loot(99, [{ id: I.SWORD, count: 1 }, { id: B.GLASS, count: 32 }]));
    this.chests.set(`${x0 + 5},${fy + 5},${z0 + 5}`, this.loot(77, [{ id: B.LADDER, count: 8 }, { id: B.TORCH, count: 12 }]));
  }

  /** Floodlight anchor for the scene. */
  floodlight() {
    return new THREE.Vector3(TOWER.x + 3.5, SEA + 7.5, TOWER.z + 3.5);
  }

  // ---------- meshing ----------
  private drawFace(b: number, n: number) {
    if (n === B.AIR) return true;
    const nd = def(n);
    if (!nd.trans && !nd.cutout) return false;
    if (n === b) return false;
    if (b === B.WATER) return !!nd.cutout;
    return true;
  }

  buildChunk(ci: number) {
    const cx = ci % NCX, cz = Math.floor(ci / NCX);
    const op = new GeoBuilder();
    const tr = new GeoBuilder();
    const wa = new GeoBuilder();
    for (let y = 0; y < WY; y++)
      for (let z = cz * CH; z < cz * CH + CH; z++)
        for (let x = cx * CH; x < cx * CH + CH; x++) {
          const b = this.data[this.idx(x, y, z)] ?? 0;
          if (b === B.AIR) continue;
          const d = def(b);
          if (d.shape) {
            this.shape(op, x, y, z, b);
            continue;
          }
          const gb = b === B.WATER ? wa : d.trans ? tr : op;
          const topH = b === B.WATER && this.get(x, y + 1, z) !== B.WATER ? 0.88 : 1;
          for (const f of FACES) {
            const n = this.get(x + f.d[0], y + f.d[1], z + f.d[2]);
            if (x + f.d[0] < 0 || z + f.d[2] < 0 || x + f.d[0] >= WX || z + f.d[2] >= WZ) {
              if (b === B.WATER) continue;
            }
            if (!this.drawFace(b, n)) continue;
            // simple depth shading: darker deeper underground / underwater
            const light = y < SEA - 4 ? 0.75 + (y / (SEA - 4)) * 0.25 : 1;
            gb.face(x, y, z, f, d.tiles[f.t], light, topH);
          }
        }
    const old = this.meshes.get(ci);
    old?.forEach((m) => {
      this.group.remove(m);
      m.geometry.dispose();
    });
    const mats = getMaterials();
    const a = new THREE.Mesh(op.build(), mats.opaque);
    const t = new THREE.Mesh(tr.build(), mats.trans);
    const wm = new THREE.Mesh(wa.build(), mats.water);
    t.renderOrder = 1;
    wm.renderOrder = 2;
    this.group.add(a, t, wm);
    this.meshes.set(ci, [a, t, wm]);
  }

  private shape(gb: GeoBuilder, x: number, y: number, z: number, b: number) {
    const tri = (t: number): [number, number, number] => [t, t, t];
    switch (def(b).shape) {
      case "bed": {
        const head = this.get(x, y, z - 1) !== B.BED;
        const legs: [number, number][] = [[0.02, 0.02], [0.83, 0.02], [0.02, 0.83], [0.83, 0.83]];
        for (const [lx, lz] of legs) gb.box(x, y, z, [lx, 0, lz], [lx + 0.15, 0.32, lz + 0.15], [T.logTop, T.logSide, T.logTop]);
        gb.box(x, y, z, [0, 0.22, 0], [1, 0.36, 1], tri(T.planks));
        gb.box(x, y, z, [0.04, 0.36, 0.02], [0.96, 0.5, 0.98], tri(T.woolWhite));
        if (head) {
          gb.box(x, y, z, [0, 0.22, 0], [1, 0.95, 0.08], tri(T.planks));
          gb.box(x, y, z, [0.14, 0.5, 0.1], [0.86, 0.68, 0.42], tri(T.woolWhite), 1.1);
          gb.box(x, y, z, [0.02, 0.36, 0.48], [0.98, 0.62, 1], tri(T.woolRed));
        } else {
          gb.box(x, y, z, [0.02, 0.36, 0], [0.98, 0.62, 0.98], tri(T.woolRed));
          gb.box(x, y, z, [0, 0.22, 0.92], [1, 0.62, 1], tri(T.planks));
        }
        break;
      }
      case "torch":
        gb.box(x, y, z, [0.44, 0, 0.44], [0.56, 0.6, 0.56], [T.logTop, T.logSide, T.logTop]);
        gb.box(x, y, z, [0.42, 0.6, 0.42], [0.58, 0.68, 0.58], tri(T.stone), 0.5);
        break;
      case "fence": {
        gb.box(x, y, z, [0.375, 0, 0.375], [0.625, 1, 0.625], tri(T.planks));
        const link = (n: number) => n === B.FENCE || (def(n).solid && !def(n).shape && !def(n).trans);
        const rails = (a: [number, number, number], c: [number, number, number]) => {
          gb.box(x, y, z, [a[0], 0.38, a[2]], [c[0], 0.52, c[2]], tri(T.planks));
          gb.box(x, y, z, [a[0], 0.74, a[2]], [c[0], 0.88, c[2]], tri(T.planks));
        };
        if (link(this.get(x + 1, y, z))) rails([0.625, 0, 0.44], [1, 0, 0.56]);
        if (link(this.get(x - 1, y, z))) rails([0, 0, 0.44], [0.375, 0, 0.56]);
        if (link(this.get(x, y, z + 1))) rails([0.44, 0, 0.625], [0.56, 0, 1]);
        if (link(this.get(x, y, z - 1))) rails([0.44, 0, 0], [0.56, 0, 0.375]);
        break;
      }
      case "ladder": {
        const t = tri(T.ladder);
        if (this.solid(x - 1, y, z)) gb.box(x, y, z, [0, 0, 0], [0.06, 1, 1], t);
        else if (this.solid(x + 1, y, z)) gb.box(x, y, z, [0.94, 0, 0], [1, 1, 1], t);
        else if (this.solid(x, y, z - 1)) gb.box(x, y, z, [0, 0, 0], [1, 1, 0.06], t);
        else gb.box(x, y, z, [0, 0, 0.94], [1, 1, 1], t);
        break;
      }
      case "cross": {
        const t = def(b).tiles[0];
        gb.quad([[x + 0.15, y, z + 0.15], [x + 0.85, y, z + 0.85], [x + 0.85, y + 0.9, z + 0.85], [x + 0.15, y + 0.9, z + 0.15]], t);
        gb.quad([[x + 0.85, y, z + 0.15], [x + 0.15, y, z + 0.85], [x + 0.15, y + 0.9, z + 0.85], [x + 0.85, y + 0.9, z + 0.15]], t);
        break;
      }
    }
  }

  /** Positions of every torch (for flame particles). */
  torches() {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < this.data.length; i++)
      if (this.data[i] === B.TORCH) {
        const x = i % WX, z = Math.floor(i / WX) % WZ, y = Math.floor(i / (WX * WZ));
        out.push(new THREE.Vector3(x + 0.5, y + 0.72, z + 0.5));
      }
    return out;
  }
  buildAll() {
    for (let i = 0; i < NCX * NCZ; i++) this.buildChunk(i);
    this.dirty.clear();
  }
  rebuildDirty(max = 3) {
    let n = 0;
    for (const ci of this.dirty) {
      this.dirty.delete(ci);
      this.buildChunk(ci);
      if (++n >= max) break;
    }
  }

  /** DDA voxel raycast; skips air and water. */
  raycast(o: THREE.Vector3, dir: THREE.Vector3, maxD: number) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = Math.abs(1 / dir.x), tdy = Math.abs(1 / dir.y), tdz = Math.abs(1 / dir.z);
    let tmx = sx > 0 ? (x + 1 - o.x) * tdx : (o.x - x) * tdx;
    let tmy = sy > 0 ? (y + 1 - o.y) * tdy : (o.y - y) * tdy;
    let tmz = sz > 0 ? (z + 1 - o.z) * tdz : (o.z - z) * tdz;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxD) {
      const b = this.get(x, y, z);
      if (b !== B.AIR && b !== B.WATER) return { x, y, z, nx, ny, nz, b, dist: t };
      if (tmx < tmy && tmx < tmz) {
        x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0;
      } else if (tmy < tmz) {
        y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0;
      } else {
        z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz;
      }
    }
    return null;
  }
}
