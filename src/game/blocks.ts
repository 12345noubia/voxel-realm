import * as THREE from "three";

export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  PLANKS: 5,
  LOG: 6,
  LEAVES: 7,
  SAND: 8,
  WATER: 9,
  GLASS: 10,
  BRICKS: 11,
  BED: 12,
  CHEST: 13,
  CRAFT: 14,
  CORAL: 15,
  TORCH: 16,
  FENCE: 17,
  LADDER: 18,
  FLOWER: 19,
  FLOWER_Y: 20,
} as const;

export const I = { SWORD: 100, PICK: 101, APPLE: 102, BREAD: 103 } as const;

export const T = {
  grassTop: 0, grassSide: 1, dirt: 2, stone: 3, cobble: 4, planks: 5, logSide: 6, logTop: 7,
  leaves: 8, sand: 9, water: 10, glass: 11, bricks: 12, bedTop: 13, bedSide: 14, chestSide: 15,
  chestTop: 16, craftTop: 17, craftSide: 18, coral: 19, sword: 20, pick: 21, apple: 22, bread: 23,
  heart: 24, heartEmpty: 25, food: 26, foodEmpty: 27,
  torch: 28, ladder: 29, flowerRed: 30, flowerYellow: 31, creeper: 32, creeperFace: 33, woolRed: 34, woolWhite: 35,
} as const;

export type Def = {
  name: string;
  tiles: [number, number, number]; // top, side, bottom
  hard: number;
  solid: boolean;
  trans?: boolean; // glass / water: transparent pass
  cutout?: boolean; // leaves: alpha-tested
  stone?: boolean; // faster with pickaxe
  shape?: "bed" | "torch" | "fence" | "ladder" | "cross"; // custom model instead of a cube
};

const DEFS: Record<number, Def> = {
  [B.GRASS]: { name: "Grass", tiles: [T.grassTop, T.grassSide, T.dirt], hard: 0.6, solid: true },
  [B.DIRT]: { name: "Dirt", tiles: [T.dirt, T.dirt, T.dirt], hard: 0.5, solid: true },
  [B.STONE]: { name: "Stone", tiles: [T.stone, T.stone, T.stone], hard: 1.8, solid: true, stone: true },
  [B.COBBLE]: { name: "Cobblestone", tiles: [T.cobble, T.cobble, T.cobble], hard: 2, solid: true, stone: true },
  [B.PLANKS]: { name: "Oak Planks", tiles: [T.planks, T.planks, T.planks], hard: 1, solid: true },
  [B.LOG]: { name: "Oak Log", tiles: [T.logTop, T.logSide, T.logTop], hard: 1.3, solid: true },
  [B.LEAVES]: { name: "Leaves", tiles: [T.leaves, T.leaves, T.leaves], hard: 0.2, solid: true, cutout: true },
  [B.SAND]: { name: "Sand", tiles: [T.sand, T.sand, T.sand], hard: 0.5, solid: true },
  [B.WATER]: { name: "Water", tiles: [T.water, T.water, T.water], hard: Infinity, solid: false, trans: true },
  [B.GLASS]: { name: "Glass", tiles: [T.glass, T.glass, T.glass], hard: 0.3, solid: true, trans: true },
  [B.BRICKS]: { name: "Stone Bricks", tiles: [T.bricks, T.bricks, T.bricks], hard: 1.8, solid: true, stone: true },
  [B.BED]: { name: "Bed", tiles: [T.bedTop, T.bedSide, T.planks], hard: 0.3, solid: true, cutout: true, shape: "bed" },
  [B.CHEST]: { name: "Chest", tiles: [T.chestTop, T.chestSide, T.chestTop], hard: 1, solid: true },
  [B.CRAFT]: { name: "Crafting Table", tiles: [T.craftTop, T.craftSide, T.planks], hard: 1, solid: true },
  [B.CORAL]: { name: "Coral", tiles: [T.coral, T.coral, T.coral], hard: 0.3, solid: true },
  [B.TORCH]: { name: "Torch", tiles: [T.torch, T.torch, T.torch], hard: 0.05, solid: false, cutout: true, shape: "torch" },
  [B.FENCE]: { name: "Oak Fence", tiles: [T.planks, T.planks, T.planks], hard: 1, solid: true, cutout: true, shape: "fence" },
  [B.LADDER]: { name: "Ladder", tiles: [T.ladder, T.ladder, T.ladder], hard: 0.4, solid: false, cutout: true, shape: "ladder" },
  [B.FLOWER]: { name: "Poppy", tiles: [T.flowerRed, T.flowerRed, T.flowerRed], hard: 0.05, solid: false, cutout: true, shape: "cross" },
  [B.FLOWER_Y]: { name: "Dandelion", tiles: [T.flowerYellow, T.flowerYellow, T.flowerYellow], hard: 0.05, solid: false, cutout: true, shape: "cross" },
};

const AIR_DEF: Def = { name: "Air", tiles: [0, 0, 0], hard: 0, solid: false };
export const def = (id: number): Def => DEFS[id] ?? AIR_DEF;
export const isBlock = (id: number) => id > 0 && id < 100;
export const maxStack = (id: number) => (id === I.SWORD || id === I.PICK ? 1 : 64);

export function itemName(id: number): string {
  if (isBlock(id)) return def(id).name;
  return ({ [I.SWORD]: "Stone Sword", [I.PICK]: "Stone Pickaxe", [I.APPLE]: "Apple", [I.BREAD]: "Bread" } as Record<number, string>)[id] ?? "?";
}
export function itemTile(id: number): number {
  if (isBlock(id)) return id === B.GRASS ? T.grassSide : id === B.BED ? T.woolRed : def(id).tiles[1];
  return ({ [I.SWORD]: T.sword, [I.PICK]: T.pick, [I.APPLE]: T.apple, [I.BREAD]: T.bread } as Record<number, number>)[id] ?? 0;
}
export const FOOD: Record<number, number> = { [I.APPLE]: 4, [I.BREAD]: 6 };

// ---------- procedural pixel atlas (8 x 5 tiles of 16px) ----------
export const COLS = 8;
export const ROWS = 5;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGBA = [number, number, number, number?];
type Painter = (x: number, y: number, r: () => number) => RGBA | null;

const jit = (c: [number, number, number], amt: number, r: () => number): RGBA => {
  const k = (r() - 0.5) * amt;
  return [c[0] + k, c[1] + k, c[2] + k];
};
const PLANK: [number, number, number] = [162, 130, 78];
const plank = (x: number, y: number, r: () => number): RGBA => {
  if (y % 4 === 3) return [112, 86, 52];
  if (x === (Math.floor(y / 4) * 6 + 3) % 16) return [125, 96, 58];
  return jit(PLANK, 18, r);
};
const heartFn = (x: number, y: number, s: number) => {
  const X = (x + 0.5 - 8) / s;
  const Y = (8 - (y + 0.5)) / s + 0.25;
  return Math.pow(X * X + Y * Y - 1, 3) - X * X * Y * Y * Y <= 0;
};

const camo = (r: () => number): RGBA => {
  const v = r();
  return v < 0.25 ? [140, 215, 110] : v < 0.6 ? [80, 170, 62] : v < 0.85 ? [50, 130, 45] : [30, 90, 30];
};
const flower = (x: number, y: number, petal: [number, number, number], mid: [number, number, number]): RGBA | null => {
  const d = Math.hypot(x - 7.5, y - 4.5);
  if (d < 1.2) return mid;
  if (d < 3.4) return petal;
  if (y >= 7 && (x === 7 || x === 8)) return [50, 130, 40];
  if ((y === 10 && x >= 4 && x <= 6) || (y === 11 && x >= 9 && x <= 11)) return [70, 150, 50];
  return null;
};

const PAINT: Record<number, Painter> = {
  [T.grassTop]: (_x, _y, r) => jit([95, 159, 53], 34, r),
  [T.grassSide]: (x, y, r) => (y < 3 + ((x * 7) % 3 === 0 ? 1 : 0) ? jit([95, 159, 53], 30, r) : jit([134, 96, 67], 24, r)),
  [T.dirt]: (_x, _y, r) => jit([134, 96, 67], 26, r),
  [T.stone]: (_x, _y, r) => jit([125, 125, 125], 22, r),
  [T.cobble]: (_x, _y, r) => jit([118, 118, 118], 26, r), // overwritten by voronoi below
  [T.planks]: plank,
  [T.logSide]: (x, _y, r) => jit(x % 4 === 0 ? [82, 62, 36] : [107, 81, 49], 16, r),
  [T.logTop]: (x, y, r) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > 6.8) return jit([107, 81, 49], 14, r);
    return jit(Math.floor(d) % 2 ? [184, 148, 92] : [152, 118, 70], 10, r);
  },
  [T.leaves]: (_x, _y, r) => (r() < 0.2 ? null : jit([58, 128, 38], 40, r)),
  [T.sand]: (_x, _y, r) => jit([219, 207, 163], 18, r),
  [T.water]: (x, y, r) => {
    const w = (x + y * 2 + Math.floor(y / 5) * 3) % 9 < 2;
    const c = jit(w ? [90, 150, 235] : [48, 98, 210], 10, r);
    return [c[0], c[1], c[2], 165];
  },
  [T.glass]: (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [215, 238, 242, 235];
    if ((x - y === 4 || x - y === 5) && x > 4 && x < 11) return [255, 255, 255, 170];
    return [175, 225, 235, 40];
  },
  [T.bricks]: (x, y, r) => {
    const mortar = y % 8 === 7 || (y < 8 ? x === 15 : x === 7);
    if (mortar) return [78, 78, 80];
    if (y % 8 === 0 || (y < 8 ? x === 0 : x === 8)) return [150, 150, 152];
    return jit([126, 126, 128], 16, r);
  },
  [T.bedTop]: (x, y, r) => (y < 5 ? (x === 0 || x === 15 ? [200, 200, 200] : jit([232, 232, 232], 8, r)) : jit([175, 32, 36], 18, r)),
  [T.bedSide]: (x, y, r) => (y < 7 ? jit([175, 32, 36], 18, r) : y < 11 || x < 3 || x > 12 ? plank(x, y, r) : null),
  [T.chestSide]: (x, y, r) => {
    if (x === 0 || x === 15 || y === 0 || y === 15 || y === 5) return [60, 40, 18];
    if (x >= 7 && x <= 8 && y >= 4 && y <= 8) return [190, 190, 195];
    return jit([158, 108, 44], 18, r);
  },
  [T.chestTop]: (x, y, r) => (x === 0 || x === 15 || y === 0 || y === 15 ? [60, 40, 18] : jit([158, 108, 44], 18, r)),
  [T.craftTop]: (x, y, r) => (x === 0 || y === 0 || x === 15 || y === 15 ? [90, 60, 30] : x % 5 === 0 || y % 5 === 0 ? [110, 78, 44] : jit([176, 136, 84], 14, r)),
  [T.craftSide]: (x, y, r) => {
    if (y < 3) return jit([110, 78, 44], 10, r);
    if (x >= 3 && x <= 5 && y >= 5 && y <= 12) return [150, 150, 155];
    if (x >= 10 && x <= 12 && y >= 5 && y <= 7) return [120, 120, 125];
    if (x === 11 && y > 7 && y < 13) return [90, 62, 30];
    return plank(x, y, r);
  },
  [T.coral]: (_x, _y, r) => (r() < 0.12 ? [140, 40, 70] : jit([225, 82, 112], 34, r)),
  [T.sword]: (x, y) => {
    const s = x + y;
    if (x >= 5 && y <= 11 && Math.abs(s - 15) <= 1) return s === 15 ? [235, 235, 240] : [150, 150, 158];
    if (Math.abs(x - y + 6) <= 0 && x >= 2 && x <= 7) return [70, 50, 25];
    if (x <= 4 && y >= 11 && Math.abs(s - 15) <= 0.5) return [120, 82, 40];
    return null;
  },
  [T.pick]: (x, y) => {
    const head = Math.abs(y - (2 + Math.abs(x - 8) * 0.45)) < 1.1 && x >= 2 && x <= 14 && y <= 6;
    if (head) return [160, 160, 168];
    if (Math.abs(x + y - 17) <= 0.5 && x >= 3 && x <= 11) return [120, 82, 40];
    return null;
  },
  [T.apple]: (x, y) => {
    if (x === 8 && y >= 1 && y <= 3) return [90, 60, 25];
    if ((x === 9 || x === 10) && y === 2) return [60, 160, 50];
    const d = Math.hypot(x - 7.5, y - 9);
    if (d < 5.5) return d < 2 && x < 7 && y < 9 ? [255, 160, 160] : [205, 28, 32];
    return null;
  },
  [T.bread]: (x, y) => {
    const e = ((x - 7.5) / 6.8) ** 2 + ((y - 9) / 3.8) ** 2;
    if (e > 1) return null;
    if (e > 0.75) return [140, 90, 40];
    return (x + y) % 4 === 0 && y < 9 ? [160, 105, 45] : [205, 150, 75];
  },
  [T.heart]: (x, y) => (heartFn(x, y, 6) ? (heartFn(x, y, 4.6) ? (x < 6 && y < 7 ? [255, 140, 140] : [220, 24, 34]) : [40, 0, 0]) : null),
  [T.heartEmpty]: (x, y) => (heartFn(x, y, 6) ? (heartFn(x, y, 4.6) ? [55, 30, 30, 160] : [30, 0, 0]) : null),
  [T.food]: (x, y) => {
    if (Math.abs(x - 15 + y) <= 0.7 && x >= 9 && x <= 14) return [235, 230, 215];
    const d = Math.hypot(x - 6, y - 9);
    if (d < 5) return d > 4 ? [90, 45, 15] : [170, 95, 40];
    return null;
  },
  [T.torch]: (x, y) => {
    if (y <= 2 && x >= 7 && x <= 8) return [255, 240, 150];
    if (y >= 3 && y <= 5 && x >= 6 && x <= 9) return y === 3 ? [255, 200, 60] : [240, 130, 30];
    if (y >= 6 && x >= 7 && x <= 8) return [120, 82, 40];
    return null;
  },
  [T.ladder]: (x, y) => {
    if (x === 2 || x === 3 || x === 12 || x === 13) return [110, 80, 45];
    if (y % 4 === 1 && x > 3 && x < 12) return [150, 112, 62];
    return null;
  },
  [T.flowerRed]: (x, y) => flower(x, y, [210, 30, 35], [60, 30, 20]),
  [T.flowerYellow]: (x, y) => flower(x, y, [250, 215, 40], [230, 140, 20]),
  [T.creeper]: (_x, _y, r) => camo(r),
  [T.creeperFace]: (x, y, r) => {
    const eye = y >= 4 && y <= 7 && ((x >= 2 && x <= 5) || (x >= 10 && x <= 13));
    const mouth = (y >= 8 && y <= 10 && x >= 6 && x <= 9) || (y >= 10 && y <= 13 && (x === 5 || x === 6 || x === 9 || x === 10));
    return eye || mouth ? [20, 30, 20] : camo(r);
  },
  [T.woolRed]: (x, y, r) => jit((x + y) % 5 === 0 ? [150, 26, 30] : [180, 34, 38], 14, r),
  [T.woolWhite]: (x, y, r) => jit((x + y) % 5 === 0 ? [215, 215, 215] : [238, 238, 236], 8, r),
  [T.foodEmpty]: (x, y) => {
    if (Math.abs(x - 15 + y) <= 0.7 && x >= 9 && x <= 14) return [90, 90, 90];
    const d = Math.hypot(x - 6, y - 9);
    if (d < 5) return d > 4 ? [30, 30, 30] : [70, 60, 55, 170];
    return null;
  },
};

type Atlas = { canvas: HTMLCanvasElement; url: string; tex: THREE.CanvasTexture };
let atlas: Atlas | null = null;

export function getAtlas(): Atlas {
  if (atlas) return atlas;
  const W = COLS * 16;
  const H = ROWS * 16;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  for (const [k, fn] of Object.entries(PAINT)) {
    const i = Number(k);
    const ox = (i % COLS) * 16;
    const oy = Math.floor(i / COLS) * 16;
    const r = mulberry(i * 9973 + 17);
    let vor: ((x: number, y: number) => boolean) | null = null;
    if (i === T.cobble) {
      const pts = Array.from({ length: 9 }, () => [r() * 16, r() * 16] as const);
      vor = (x, y) => {
        const ds = pts
          .flatMap(([px, py]) => [-16, 0, 16].flatMap((ax) => [-16, 0, 16].map((ay) => Math.hypot(x - px - ax, y - py - ay))))
          .sort((a, b) => a - b);
        return (ds[1] ?? 99) - (ds[0] ?? 0) < 1.3;
      };
    }
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let col = fn(x, y, r);
        if (vor && vor(x, y)) col = [68, 68, 70];
        if (!col) continue;
        const p = ((oy + y) * W + ox + x) * 4;
        img.data[p] = Math.max(0, Math.min(255, col[0]));
        img.data[p + 1] = Math.max(0, Math.min(255, col[1]));
        img.data[p + 2] = Math.max(0, Math.min(255, col[2]));
        img.data[p + 3] = col[3] ?? 255;
      }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  atlas = { canvas: c, url: c.toDataURL(), tex };
  return atlas;
}

export function tileUV(i: number) {
  const e = 0.001;
  const u0 = (i % COLS) / COLS + e;
  const u1 = (i % COLS + 1) / COLS - e;
  const r = Math.floor(i / COLS);
  const v1 = 1 - r / ROWS - e;
  const v0 = 1 - (r + 1) / ROWS + e;
  return { u0, u1, v0, v1 };
}

/** Shared animated uniforms (updated by the sky each frame). */
export const U = { uTime: { value: 0 }, uDay: { value: 1 }, uSea: { value: 14 } };

const WPOS_VERT = (src: string, wave: boolean) =>
  src
    .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nuniform float uTime;")
    .replace(
      "#include <begin_vertex>",
      wave
        ? "#include <begin_vertex>\nvec3 wp0 = (modelMatrix * vec4(position,1.0)).xyz;\ntransformed.y += step(0.5, normal.y) * (sin(wp0.x*1.3+uTime*1.6)*0.035 + cos(wp0.z*1.7+uTime*1.2)*0.03 - 0.04);"
        : "#include <begin_vertex>",
    )
    .replace("#include <project_vertex>", "#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;");
const CAUSTIC = `
float caustic(vec2 p, float t){
  float c = sin(p.x*1.9 + t*1.1 + sin(p.y*1.3 + t*0.7)*1.7) * sin(p.y*2.1 - t*0.9 + sin(p.x*1.1 - t*0.6)*1.5);
  return pow(abs(c), 3.0);
}`;
function withCaustics(m: THREE.Material) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = WPOS_VERT(sh.vertexShader, false);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform float uDay;\nuniform float uSea;" + CAUSTIC)
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nif (vWPos.y < uSea - 0.5) { float k = caustic(vWPos.xz*0.9 + vWPos.y*0.2, uTime); float depth = clamp((uSea - vWPos.y)/10.0, 0.0, 1.0); diffuseColor.rgb = diffuseColor.rgb * mix(vec3(1.0), vec3(0.62,0.85,0.92), depth) + vec3(0.25,0.4,0.42) * k * uDay * (1.0 - depth*0.5); }",
      );
  };
  m.customProgramCacheKey = () => "caustics";
}
function waterShader(m: THREE.Material) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = WPOS_VERT(sh.vertexShader, true);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform float uDay;" + CAUSTIC)
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nfloat k = caustic(vWPos.xz*0.7, uTime*1.2) + caustic(vWPos.xz*1.6 + 3.0, uTime*1.7)*0.5;\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18,0.55,0.62), 0.45) + vec3(0.35,0.55,0.6) * k * (0.3 + 0.7*uDay);\ndiffuseColor.a = 0.62 + k*0.15;",
      );
  };
  m.customProgramCacheKey = () => "water";
}

type Mats = { opaque: THREE.MeshLambertMaterial; trans: THREE.MeshLambertMaterial; sprite: THREE.MeshLambertMaterial; water: THREE.MeshPhongMaterial };
let mats: Mats | null = null;
export function getMaterials(): Mats {
  if (mats) return mats;
  const map = getAtlas().tex;
  mats = {
    opaque: new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5 }),
    trans: new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, depthWrite: false }),
    sprite: new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }),
    water: new THREE.MeshPhongMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, shininess: 90, specular: 0x9fe8ff, side: THREE.DoubleSide }),
  };
  withCaustics(mats.opaque);
  waterShader(mats.water);
  return mats;
}

// Faces: dir, corners BL,BR,TR,TL (seen from outside), shade, tile slot (0 top,1 side,2 bottom)
export const FACES: { d: [number, number, number]; c: [number, number, number][]; s: number; t: 0 | 1 | 2 }[] = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], s: 0.8, t: 1 },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], s: 0.8, t: 1 },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1, t: 0 },
  { d: [0, -1, 0], c: [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]], s: 0.5, t: 2 },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], s: 0.65, t: 1 },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], s: 0.65, t: 1 },
];

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  face(x: number, y: number, z: number, f: (typeof FACES)[number], tile: number, light: number, topH = 1) {
    const { u0, u1, v0, v1 } = tileUV(tile);
    const n = this.pos.length / 3;
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    f.c.forEach((c, k) => {
      this.pos.push(x + c[0], y + (c[1] === 1 ? topH : 0), z + c[2]);
      this.nor.push(...f.d);
      const uvk = uvs[k]!;
      this.uv.push(uvk[0]!, uvk[1]!);
      const l = f.s * light;
      this.col.push(l, l, l);
    });
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  /** Sub-block box with pixel-correct UV cropping. a/b in 0..1 block-local units. front overrides the -z face tile. */
  box(bx: number, by: number, bz: number, a: [number, number, number], b: [number, number, number], tiles: [number, number, number], light = 1, front?: number) {
    FACES.forEach((f, fi) => {
      const { u0, u1, v0, v1 } = tileUV(fi === 5 && front !== undefined ? front : tiles[f.t]);
      const n = this.pos.length / 3;
      const ax = f.d[0] !== 0 ? 0 : f.d[1] !== 0 ? 1 : 2;
      for (const c of f.c) {
        const p: [number, number, number] = [a[0] + c[0] * (b[0] - a[0]), a[1] + c[1] * (b[1] - a[1]), a[2] + c[2] * (b[2] - a[2])];
        const uc = ax === 0 ? c[2] : c[0];
        const vc = ax === 1 ? c[2] : c[1];
        const su = ax === 0 ? [a[2], b[2]] : [a[0], b[0]];
        const sv = ax === 1 ? [a[2], b[2]] : [a[1], b[1]];
        const fu = Math.min(1, Math.max(0, su[0]! + uc * (su[1]! - su[0]!)));
        const fv = Math.min(1, Math.max(0, sv[0]! + vc * (sv[1]! - sv[0]!)));
        this.pos.push(bx + p[0], by + p[1], bz + p[2]);
        this.nor.push(...f.d);
        this.uv.push(u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv);
        const l = f.s * light;
        this.col.push(l, l, l);
      }
      this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    });
  }
  /** Double-sided quad (BL, BR, TR, TL) with a full tile. */
  quad(pts: [number, number, number][], tile: number, light = 1) {
    const { u0, u1, v0, v1 } = tileUV(tile);
    const n = this.pos.length / 3;
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    pts.forEach((p, k) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(0, 1, 0);
      this.uv.push(uvs[k]![0]!, uvs[k]![1]!);
      this.col.push(light * 0.9, light * 0.9, light * 0.9);
    });
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n, n + 2, n + 1, n, n + 3, n + 2);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const itemGeoCache = new Map<number, THREE.BufferGeometry>();
/** Geometry for a held / dropped item: cube for blocks, flat sprite for items. Centered at origin, size 1. */
export function itemGeometry(id: number): THREE.BufferGeometry {
  const hit = itemGeoCache.get(id);
  if (hit) return hit;
  let g: THREE.BufferGeometry;
  const sh = def(id).shape;
  if (isBlock(id) && sh !== "torch" && sh !== "ladder" && sh !== "cross") {
    const b = new GeoBuilder();
    for (const f of FACES) b.face(-0.5, -0.5, -0.5, f, def(id).tiles[f.t], 1.15);
    g = b.build();
  } else {
    g = new THREE.PlaneGeometry(1, 1);
    const { u0, u1, v0, v1 } = tileUV(itemTile(id));
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
  }
  itemGeoCache.set(id, g);
  return g;
}
export function itemMaterial(id: number) {
  const m = getMaterials();
  const sh = def(id).shape;
  if (!isBlock(id) || sh === "torch" || sh === "ladder" || sh === "cross") return m.sprite;
  return def(id).trans ? m.trans : m.opaque;
}
