import * as THREE from "three";
import { B, I, def, FACES, GeoBuilder, getMaterials } from "./blocks";
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
      HOUSES.some((h) => x >= h.x - 3 && x <= h.x + 9 && z >= h.z - 3 && z <= h.z + 9) ||
      (x >= TOWER.x - 2 && x <= TOWER.x + 8 && z >= TOWER.z - 2 && z <= TOWER.z + 8);

    // trees
    for (let x = 3; x < WX - 3; x++)
      for (let z = 3; z < WZ - 3; z++) {
        const h = heights[x + z * WX] ?? 0;
        if (this.get(x, h, z) !== B.GRASS || hash2(x, z, 7) > 0.022 || nearHouse(x, z)) continue;
        const th = 4 + Math.floor(hash2(x, z, 8) * 2);
        for (let k = 1; k <= th; k++) this.put(x, h + k, z, B.LOG);
        for (let dy = th - 2; dy <= th + 1; dy++) {
          const r = dy >= th ? 1 : 2;
          for (let dx = -r; dx <= r; dx++)
            for (let dz = -r; dz <= r; dz++) {
              if (Math.abs(dx) === r && Math.abs(dz) === r && hash2(x + dx, z + dz, dy) < 0.6) continue;
              if (this.get(x + dx, h + dy, z + dz) === B.AIR) this.put(x + dx, h + dy, z + dz, B.LEAVES);
            }
        }
      }

    HOUSES.forEach((h, i) => this.house(h.x, h.z, Math.max(SEA + 2, heights[h.x + 3 + (h.z + 3) * WX] ?? 20), i));
    this.tower(TOWER.x, TOWER.z);

    const sx = 66, sz = 44;
    this.spawn.set(sx + 0.5, this.groundBelow(sx, WY - 1, sz), sz + 0.5);
  }

  private flatten(x0: number, z0: number, w: number, base: number) {
    for (let x = x0 - 1; x <= x0 + w; x++)
      for (let z = z0 - 1; z <= z0 + w; z++) {
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
      { id: B.BRICKS, n: 16 }, { id: B.LOG, n: 6 }, { id: B.COBBLE, n: 20 },
    ];
    extra.forEach((e, i) => (s[i * 4] = e));
    for (let k = 0; k < 5; k++) {
      const p = pool[Math.floor(hash2(seed, k, 31) * pool.length)]!;
      const slot = 1 + Math.floor(hash2(seed, k, 32) * 25);
      if (!s[slot]) s[slot] = { id: p.id, count: 1 + Math.floor(hash2(seed, k, 33) * p.n) };
    }
    return s;
  }

  private house(x0: number, z0: number, base: number, n: number) {
    this.flatten(x0, z0, 7, base);
    const y0 = base;
    for (let dx = 0; dx < 7; dx++) for (let dz = 0; dz < 7; dz++) this.put(x0 + dx, y0, z0 + dz, B.COBBLE);
    for (let y = y0 + 1; y <= y0 + 4; y++)
      for (let dx = 0; dx < 7; dx++)
        for (let dz = 0; dz < 7; dz++) {
          const edgeX = dx === 0 || dx === 6, edgeZ = dz === 0 || dz === 6;
          if (!edgeX && !edgeZ) continue;
          this.put(x0 + dx, y, z0 + dz, edgeX && edgeZ ? B.LOG : B.PLANKS);
        }
    for (let y = y0 + 2; y <= y0 + 3; y++) {
      for (let k = 2; k <= 4; k++) {
        this.put(x0 + k, y, z0, B.GLASS);
        this.put(x0, y, z0 + k, B.GLASS);
        this.put(x0 + 6, y, z0 + k, B.GLASS);
      }
      this.put(x0 + 1, y, z0 + 6, B.GLASS);
      this.put(x0 + 5, y, z0 + 6, B.GLASS);
    }
    this.put(x0 + 3, y0 + 1, z0 + 6, B.AIR);
    this.put(x0 + 3, y0 + 2, z0 + 6, B.AIR);
    for (let dx = -1; dx <= 7; dx++) for (let dz = -1; dz <= 7; dz++) this.put(x0 + dx, y0 + 5, z0 + dz, B.BRICKS);
    for (let dx = 0; dx <= 6; dx++) for (let dz = 0; dz <= 6; dz++) this.put(x0 + dx, y0 + 6, z0 + dz, B.PLANKS);
    for (let dx = 1; dx <= 5; dx++) for (let dz = 1; dz <= 5; dz++) this.put(x0 + dx, y0 + 7, z0 + dz, B.BRICKS);
    for (let dx = 2; dx <= 4; dx++) for (let dz = 2; dz <= 4; dz++) this.put(x0 + dx, y0 + 8, z0 + dz, B.PLANKS);
    // interior
    this.put(x0 + 1, y0 + 1, z0 + 1, B.BED);
    this.put(x0 + 1, y0 + 1, z0 + 2, B.BED);
    this.put(x0 + 5, y0 + 1, z0 + 1, B.CHEST);
    this.put(x0 + 5, y0 + 1, z0 + 3, B.CRAFT);
    const extra: Slot[] = n === 0 ? [{ id: I.SWORD, count: 1 }] : n === 2 ? [{ id: I.PICK, count: 1 }] : [];
    this.chests.set(`${x0 + 5},${y0 + 1},${z0 + 1}`, this.loot(n + 1, extra));
    // path to door
    for (let k = 7; k <= 9; k++) if (this.get(x0 + 3, y0, z0 + k) === B.GRASS) this.put(x0 + 3, y0, z0 + k, B.COBBLE);
  }

  /** Underwater glass observatory with a spiral stair, reachable from the surface. */
  private tower(x0: number, z0: number) {
    const fy = 5;
    const top = SEA + 4;
    for (let dx = -1; dx <= 7; dx++)
      for (let dz = -1; dz <= 7; dz++) {
        for (let y = 1; y <= fy; y++) this.put(x0 + dx, y, z0 + dz, y === fy ? B.BRICKS : B.STONE);
        for (let y = fy + 1; y <= SEA; y++) if (dx < 0 || dx > 6 || dz < 0 || dz > 6) this.put(x0 + dx, y, z0 + dz, B.WATER);
      }
    for (let y = fy + 1; y <= top; y++)
      for (let dx = 0; dx < 7; dx++)
        for (let dz = 0; dz < 7; dz++) {
          const edgeX = dx === 0 || dx === 6, edgeZ = dz === 0 || dz === 6;
          let b: number = B.AIR;
          if (edgeX || edgeZ) b = (edgeX && edgeZ) || y === fy + 6 || y === top ? B.BRICKS : B.GLASS;
          if (y === top) b = B.BRICKS;
          this.put(x0 + dx, y, z0 + dz, b);
        }
    // roof hatch + surface door
    this.put(x0 + 3, top, z0 + 3, B.AIR);
    this.put(x0 + 3, SEA + 1, z0 + 6, B.AIR);
    this.put(x0 + 3, SEA + 2, z0 + 6, B.AIR);
    // spiral stair around inner ring
    const ring: [number, number][] = [];
    for (let k = 1; k <= 5; k++) ring.push([k, 1]);
    for (let k = 2; k <= 5; k++) ring.push([5, k]);
    for (let k = 4; k >= 1; k--) ring.push([k, 5]);
    for (let k = 4; k >= 2; k--) ring.push([1, k]);
    for (let k = 0; fy + 1 + k <= SEA + 2; k++) {
      const p = ring[k % ring.length]!;
      this.put(x0 + p[0], fy + 1 + k, z0 + p[1], B.PLANKS);
    }
    this.put(x0 + 3, fy + 1, z0 + 3, B.CHEST);
    this.chests.set(`${x0 + 3},${fy + 1},${z0 + 3}`, this.loot(99, [{ id: I.SWORD, count: 1 }, { id: B.GLASS, count: 32 }]));
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
    for (let y = 0; y < WY; y++)
      for (let z = cz * CH; z < cz * CH + CH; z++)
        for (let x = cx * CH; x < cx * CH + CH; x++) {
          const b = this.data[this.idx(x, y, z)] ?? 0;
          if (b === B.AIR) continue;
          const d = def(b);
          const gb = d.trans ? tr : op;
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
    t.renderOrder = 1;
    this.group.add(a, t);
    this.meshes.set(ci, [a, t]);
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
