import * as THREE from "three";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { World, WY } from "./world";
import { B, I, def, isBlock, FOOD } from "./blocks";
import { initAudio, setUnderwater, sfx } from "./audio";
import { G, emit, addItem, held, sysChat, toast, type Slot } from "./store";

export const DAY_LEN = 480; // seconds per full day/night cycle
const NET_TICK = 1 / 8; // ≤5 players per room keeps N²×tick within budget
const REACH = 5.5;
const PVP_REACH = 3.6;

export type NetState = {
  id: string; name: string; x: number; y: number; z: number; ry: number; rp: number; hp: number; sw: number; h: number;
};
export type Drop = { id: string; item: number; count: number; x: number; y: number; z: number; born: number };
export type Remote = { s: NetState; hurt: number; color: number };
type Particle = { p: THREE.Vector3; v: THREE.Vector3; life: number; c: THREE.Color };

type Ev =
  | { t: "hit"; from: string; fromName: string; target: string; dmg: number; kx: number; kz: number }
  | { t: "death"; id: string; name: string; killer: string; drops: Drop[] }
  | { t: "pickup"; dropId: string }
  | { t: "block"; x: number; y: number; z: number; b: number }
  | { t: "chest"; key: string; items: Slot[] }
  | { t: "chat"; name: string; text: string }
  | { t: "time"; offset: number }
  | { t: "sync"; to: string; edits: number[]; drops: Drop[]; chests: [string, Slot[]][]; offset: number };

const STARTER: Slot[] = [
  { id: I.SWORD, count: 1 }, { id: I.PICK, count: 1 }, { id: B.PLANKS, count: 32 }, { id: B.COBBLE, count: 32 },
  { id: B.GLASS, count: 16 }, { id: B.BRICKS, count: 32 }, { id: B.TORCH, count: 16 }, { id: I.BREAD, count: 6 }, { id: B.FENCE, count: 16 },
  { id: B.LADDER, count: 12 }, { id: B.LOG, count: 8 }, { id: B.SAND, count: 16 }, { id: B.BED, count: 2 }, { id: B.FLOWER, count: 6 },
];

const hashColor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export class Engine {
  world = new World();
  id: string = crypto.randomUUID();
  channel: RealtimeChannel | null = null;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  spawnPt = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  inWater = false;
  keys = new Set<string>();
  mining = false;
  mineKey = "";
  mineProgress = 0;
  target: { x: number; y: number; z: number } | null = null;
  remotes = new Map<string, Remote>();
  drops = new Map<string, Drop>();
  edits = new Map<string, number>();
  chestsTouched = new Set<string>();
  synced = false;
  timeOffset = 0;
  attackCd = 0;
  swingT = 0;
  swingCount = 0;
  hungerT = 0;
  regenT = 0;
  starveT = 0;
  fallTop: number | null = null;
  particles: Particle[] = [];
  onRosterChange: (ids: string[]) => void = () => {};
  onDropsChange: () => void = () => {};
  private netAcc = 0;
  private last = { x: 0, y: 0, z: 0, ry: 0, rp: 0, at: -10, hp: 20, sw: 0, h: 0 };
  private elapsed = 0;
  private seenIds = new Set<string>();

  constructor() {
    this.world.generate();
    const n = this.world.spawn;
    this.spawnPt.copy(n);
    this.pos.copy(n);
    STARTER.forEach((s, i) => (G.inv[i] = s ? { ...s } : null));
  }

  // ---------- time ----------
  dayTime() {
    const abs = Date.now() / 1000 + this.timeOffset;
    return (abs / DAY_LEN) % 1; // 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
  }
  isNight() {
    const t = this.dayTime();
    return t > 0.52 && t < 0.98;
  }

  // ---------- networking ----------
  send(ev: Ev) {
    this.channel?.send({ type: "broadcast", event: "ev", payload: ev });
  }
  onRoster(list: { id: string; name: string }[]) {
    const prev = new Set(this.remotes.keys());
    const ids = list.map((p) => p.id).filter((id) => id !== this.id);
    G.roster = list;
    const newcomers = ids.filter((id) => !this.seenIds.has(id));
    for (const id of ids) {
      this.seenIds.add(id);
      if (!this.remotes.has(id)) {
        const name = list.find((p) => p.id === id)?.name ?? "player";
        this.remotes.set(id, {
          s: { id, name, x: 0, y: -100, z: 0, ry: 0, rp: 0, hp: 20, sw: 0, h: 0 },
          hurt: 0,
          color: hashColor(id),
        });
        if (this.synced || prev.size > 0) sysChat(`${name} joined the world`);
      }
    }
    for (const id of prev)
      if (!ids.includes(id)) {
        sysChat(`${this.remotes.get(id)?.s.name ?? "Someone"} left`);
        this.remotes.delete(id);
      }
    // coordinator = smallest id among those already in the room; shares world edits with newcomers
    const all = [this.id, ...ids].sort();
    if (all.length === 1) this.synced = true;
    if (newcomers.length && this.synced && all.filter((x) => !newcomers.includes(x))[0] === this.id) {
      const edits: number[] = [];
      for (const [k, b] of this.edits) edits.push(...k.split(",").map(Number), b);
      const chests: [string, Slot[]][] = [...this.chestsTouched].map((k) => [k, this.world.chests.get(k) ?? []]);
      for (const to of newcomers)
        this.send({ t: "sync", to, edits: edits.slice(-12000), drops: [...this.drops.values()], chests, offset: this.timeOffset });
    }
    this.onRosterChange(ids);
    emit();
  }
  onState(s: NetState) {
    const r = this.remotes.get(s.id);
    if (r) {
      const renamed = s.name !== r.s.name;
      r.s = s;
      if (renamed) emit();
    }
  }
  onEvent(e: Ev) {
    switch (e.t) {
      case "hit": {
        const r = this.remotes.get(e.target);
        if (r) r.hurt = performance.now();
        if (e.target === this.id && G.ui !== "dead") {
          this.vel.x += e.kx * 7;
          this.vel.z += e.kz * 7;
          this.vel.y = 5;
          this.damage(e.dmg, e.fromName);
        }
        break;
      }
      case "death":
        e.drops.forEach((d) => this.drops.set(d.id, { ...d, born: performance.now() }));
        this.onDropsChange();
        if (e.killer === G.name && e.killer) G.kills++;
        sysChat(e.killer ? `${e.name} was slain by ${e.killer}` : `${e.name} died`);
        break;
      case "pickup":
        if (this.drops.delete(e.dropId)) this.onDropsChange();
        break;
      case "block":
        this.applyBlock(e.x, e.y, e.z, e.b, false);
        break;
      case "chest":
        this.world.chests.set(e.key, e.items);
        this.chestsTouched.add(e.key);
        if (G.chestKey === e.key) emit();
        break;
      case "chat":
        G.chat = [...G.chat.slice(-40), { name: e.name, text: e.text, t: performance.now() }];
        emit();
        break;
      case "time":
        this.timeOffset = e.offset;
        break;
      case "sync":
        if (e.to !== this.id || this.synced) return;
        this.synced = true;
        for (let i = 0; i + 3 < e.edits.length; i += 4)
          this.applyBlock(e.edits[i]!, e.edits[i + 1]!, e.edits[i + 2]!, e.edits[i + 3]!, false);
        e.drops.forEach((d) => this.drops.set(d.id, { ...d, born: performance.now() }));
        e.chests.forEach(([k, v]) => {
          this.world.chests.set(k, v);
          this.chestsTouched.add(k);
        });
        this.timeOffset = e.offset;
        this.onDropsChange();
        break;
    }
  }
  sendChat(text: string) {
    const msg = text.trim().slice(0, 200);
    if (!msg) return;
    G.chat = [...G.chat.slice(-40), { name: G.name, text: msg, t: performance.now() }];
    this.send({ t: "chat", name: G.name, text: msg });
    emit();
  }
  saveChest(key: string) {
    const items = this.world.chests.get(key);
    if (!items) return;
    this.chestsTouched.add(key);
    this.send({ t: "chest", key, items });
  }

  // ---------- world edits ----------
  applyBlock(x: number, y: number, z: number, b: number, broadcast: boolean) {
    this.world.set(x, y, z, b);
    this.edits.set(`${x},${y},${z}`, b);
    if (broadcast) this.send({ t: "block", x, y, z, b });
  }
  burst(x: number, y: number, z: number, color: THREE.Color, n = 14, speed = 3) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 220) this.particles.shift();
      this.particles.push({
        p: new THREE.Vector3(x + Math.random() * 0.8 - 0.4, y + Math.random() * 0.8 - 0.4, z + Math.random() * 0.8 - 0.4),
        v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed),
        life: 0.6 + Math.random() * 0.5,
        c: color.clone().multiplyScalar(0.7 + Math.random() * 0.5),
      });
    }
  }

  // ---------- health ----------
  damage(n: number, by = "") {
    if (G.ui === "dead") return;
    G.hp = Math.max(0, G.hp - n);
    G.hurtAt = performance.now();
    sfx("hit", 0.8);
    this.burst(this.pos.x, this.pos.y + 1, this.pos.z, new THREE.Color(0.8, 0.05, 0.05), 8);
    if (G.hp <= 0) this.die(by);
    emit();
  }
  die(killer: string) {
    const drops: Drop[] = [];
    G.inv.forEach((s, i) => {
      if (!s) return;
      drops.push({
        id: crypto.randomUUID(), item: s.id, count: s.count, born: performance.now(),
        x: this.pos.x + (Math.random() - 0.5) * 2, y: this.pos.y + 0.5, z: this.pos.z + (Math.random() - 0.5) * 2,
      });
      G.inv[i] = null;
    });
    drops.forEach((d) => this.drops.set(d.id, d));
    this.onDropsChange();
    this.send({ t: "death", id: this.id, name: G.name, killer, drops });
    sysChat(killer ? `You were slain by ${killer}` : "You died");
    G.killedBy = killer;
    G.deaths++;
    G.ui = "dead";
    this.mining = false;
    if (document.pointerLockElement) document.exitPointerLock();
    emit();
  }
  startAudio() {
    initAudio();
  }
  respawn() {
    G.hp = 20;
    G.hunger = 20;
    addItem(I.BREAD, 4);
    this.pos.copy(this.spawnPt);
    this.vel.set(0, 0, 0);
    this.fallTop = null;
    G.ui = "play";
    emit();
  }

  // ---------- input actions ----------
  lookDir(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
  }
  private remoteHit(o: THREE.Vector3, d: THREE.Vector3) {
    const ray = new THREE.Ray(o, d);
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    let best: { id: string; dist: number } | null = null;
    for (const [id, r] of this.remotes) {
      if (r.s.hp <= 0 || r.s.y < -50) continue;
      box.min.set(r.s.x - 0.45, r.s.y, r.s.z - 0.45);
      box.max.set(r.s.x + 0.45, r.s.y + 1.95, r.s.z + 0.45);
      if (ray.intersectBox(box, p)) {
        const dist = p.distanceTo(o);
        if (dist < PVP_REACH && (!best || dist < best.dist)) best = { id, dist };
      }
    }
    return best;
  }
  primaryDown() {
    this.swing();
    const o = this.eye();
    const d = this.lookDir();
    const hit = this.remoteHit(o, d);
    const blk = this.world.raycast(o, d, REACH);
    if (hit && (!blk || hit.dist < blk.dist)) {
      if (this.attackCd > 0) return;
      this.attackCd = 0.5;
      const r = this.remotes.get(hit.id);
      if (!r) return;
      r.hurt = performance.now();
      const dmg = held()?.id === I.SWORD ? 5 : 1;
      const kx = Math.sign(r.s.x - this.pos.x) * Math.min(1, Math.abs(r.s.x - this.pos.x));
      const kz = Math.sign(r.s.z - this.pos.z) * Math.min(1, Math.abs(r.s.z - this.pos.z));
      sfx("hit");
      this.send({ t: "hit", from: this.id, fromName: G.name, target: hit.id, dmg, kx, kz });
      this.burst(r.s.x, r.s.y + 1.2, r.s.z, new THREE.Color(0.9, 0.1, 0.1), 10);
      return;
    }
    this.mining = true;
  }
  swing() {
    this.swingT = 1;
    this.swingCount++;
  }
  use() {
    const o = this.eye();
    const d = this.lookDir();
    const hit = this.world.raycast(o, d, REACH);
    const h = held();
    if (hit) {
      const key = `${hit.x},${hit.y},${hit.z}`;
      if (hit.b === B.BED) {
        this.spawnPt.set(hit.x + 0.5, hit.y + 1, hit.z + 0.5);
        if (this.isNight()) {
          const abs = Date.now() / 1000 + this.timeOffset;
          const target = (Math.floor(abs / DAY_LEN) + 1 + 0.01) * DAY_LEN;
          this.timeOffset += target - abs;
          this.send({ t: "time", offset: this.timeOffset });
          sysChat(`${G.name} slept through the night`);
          this.send({ t: "chat", name: "", text: `${G.name} slept through the night` });
          G.hp = Math.min(20, G.hp + 4);
          emit();
        } else toast("Respawn point set — you can only sleep at night");
        return;
      }
      if (hit.b === B.CHEST) {
        if (!this.world.chests.has(key)) this.world.chests.set(key, Array(27).fill(null));
        G.chestKey = key;
        this.openUI("chest");
        return;
      }
      if (hit.b === B.CRAFT) {
        this.openUI("craft");
        return;
      }
    }
    if (h && FOOD[h.id]) {
      if (G.hunger >= 20) return toast("You're not hungry");
      G.hunger = Math.min(20, G.hunger + (FOOD[h.id] ?? 0));
      h.count--;
      if (h.count <= 0) G.inv[G.sel] = null;
      this.swing();
      emit();
      return;
    }
    if (hit && h && isBlock(h.id)) {
      const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
      const cur = this.world.get(px, py, pz);
      if ((cur !== B.AIR && cur !== B.WATER) || py >= WY || py < 1) return;
      if (this.boxHits(px, py, pz, this.pos.x, this.pos.y, this.pos.z)) return;
      for (const r of this.remotes.values()) if (this.boxHits(px, py, pz, r.s.x, r.s.y, r.s.z)) return;
      this.applyBlock(px, py, pz, h.id, true);
      sfx("place");
      if (h.id === B.CHEST) this.world.chests.set(`${px},${py},${pz}`, Array(27).fill(null));
      h.count--;
      if (h.count <= 0) G.inv[G.sel] = null;
      this.swing();
      emit();
    }
  }
  private boxHits(bx: number, by: number, bz: number, px: number, py: number, pz: number) {
    return px + 0.3 > bx && px - 0.3 < bx + 1 && py + 1.8 > by && py < by + 1 && pz + 0.3 > bz && pz - 0.3 < bz + 1;
  }
  openUI(mode: "inventory" | "chest" | "craft" | "chat") {
    G.ui = mode;
    this.mining = false;
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    emit();
  }

  // ---------- simulation ----------
  private collides(px: number, py: number, pz: number) {
    const x0 = Math.floor(px - 0.3), x1 = Math.floor(px + 0.3 - 1e-4);
    const y0 = Math.floor(py), y1 = Math.floor(py + 1.8 - 1e-4);
    const z0 = Math.floor(pz - 0.3), z1 = Math.floor(pz + 0.3 - 1e-4);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (this.world.solid(x, y, z)) return true;
    return false;
  }
  private moveAxis(axis: "x" | "y" | "z", d: number) {
    const steps = Math.ceil(Math.abs(d) / 0.3) || 1;
    const s = d / steps;
    for (let i = 0; i < steps; i++) {
      this.pos[axis] += s;
      if (this.collides(this.pos.x, this.pos.y, this.pos.z)) {
        this.pos[axis] -= s;
        if (axis === "y" && s < 0) this.onGround = true;
        this.vel[axis] = 0;
        return;
      }
    }
  }

  update(rawDt: number, camera: THREE.Camera) {
    const dt = Math.min(rawDt, 0.05);
    this.elapsed += dt;
    const playing = G.ui === "play";
    const alive = G.ui !== "dead" && G.ui !== "menu";
    const w = this.world;
    const wasWater = this.inWater;
    this.inWater = w.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.5), Math.floor(this.pos.z)) === B.WATER;
    if (wasWater !== this.inWater && G.ui !== "menu" && this.elapsed > 1) {
      const sy = Math.floor(this.pos.y + 0.5) + (this.inWater ? 0.9 : -0.1);
      this.burst(this.pos.x, sy, this.pos.z, new THREE.Color(0.75, 0.9, 1), 26, 4.5);
      sfx("splash", Math.min(1, 0.4 + Math.abs(this.vel.y) / 10));
    }
    const headWater = w.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 1.62), Math.floor(this.pos.z)) === B.WATER;
    if (headWater !== G.underwater) {
      G.underwater = headWater;
      setUnderwater(headWater);
      emit();
    }

    if (alive) {
      const k = playing ? this.keys : new Set<string>();
      const fwd = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
      const str = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
      const sprint = k.has("ShiftLeft") && G.hunger > 6 && fwd > 0;
      let speed = sprint ? 6.8 : 4.4;
      if (this.inWater) speed *= 0.55;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      let wx = -sy * fwd + cy * str, wz = -cy * fwd - sy * str;
      const len = Math.hypot(wx, wz) || 1;
      wx = (wx / len) * speed;
      wz = (wz / len) * speed;
      if (!fwd && !str) wx = wz = 0;
      const acc = 1 - Math.exp(-(this.onGround ? 16 : this.inWater ? 6 : 4) * dt);
      this.vel.x += (wx - this.vel.x) * acc;
      this.vel.z += (wz - this.vel.z) * acc;
      const fx = Math.floor(this.pos.x), fz = Math.floor(this.pos.z);
      const onLadder = w.get(fx, Math.floor(this.pos.y + 0.2), fz) === B.LADDER || w.get(fx, Math.floor(this.pos.y + 1.2), fz) === B.LADDER;
      if (onLadder) {
        const up = k.has("Space") || fwd > 0;
        this.vel.y = up ? 3.2 : k.has("ShiftLeft") ? 0 : Math.max(this.vel.y - 20 * dt, -2.2);
        this.fallTop = null;
      } else if (this.inWater) {
        // buoyant: hold Space to swim up, otherwise drift down gently
        this.vel.y -= 5 * dt;
        this.vel.y *= Math.exp(-3 * dt);
        if (k.has("Space")) this.vel.y = Math.min(this.vel.y + 20 * dt, headWater ? 3.4 : 4.6);
        this.vel.y = Math.max(this.vel.y, -1.6);
      } else {
        this.vel.y = Math.max(this.vel.y - 28 * dt, -50);
        if (k.has("Space") && this.onGround) this.vel.y = 8.6;
      }
      const wasGround = this.onGround;
      this.onGround = false;
      this.moveAxis("x", this.vel.x * dt);
      this.moveAxis("z", this.vel.z * dt);
      this.moveAxis("y", this.vel.y * dt);

      // fall damage
      if (this.inWater) this.fallTop = null;
      else if (!this.onGround) this.fallTop = Math.max(this.fallTop ?? this.pos.y, this.pos.y);
      else if (!wasGround && this.fallTop !== null) {
        const dist = this.fallTop - this.pos.y;
        if (dist > 3.5) this.damage(Math.floor(dist - 3));
        this.fallTop = null;
      }
      if (this.pos.y < -10) this.damage(40);

      // hunger
      this.hungerT += dt * (sprint ? 3 : 1) + (fwd || str ? dt * 0.3 : 0);
      if (this.hungerT > 25) {
        this.hungerT = 0;
        if (G.hunger > 0) G.hunger--;
        emit();
      }
      if (G.hunger >= 16 && G.hp < 20) {
        this.regenT += dt;
        if (this.regenT > 3) {
          this.regenT = 0;
          G.hp++;
          this.hungerT += 4;
          emit();
        }
      }
      if (G.hunger <= 0) {
        this.starveT += dt;
        if (this.starveT > 4) {
          this.starveT = 0;
          if (G.hp > 1) this.damage(1);
        }
      }

      // pickups
      for (const d of this.drops.values()) {
        if (performance.now() - d.born < 1200) continue;
        if (Math.hypot(d.x - this.pos.x, d.y - (this.pos.y + 0.6), d.z - this.pos.z) < 1.6) {
          const left = addItem(d.item, d.count);
          if (left === d.count) continue;
          this.drops.delete(d.id);
          this.send({ t: "pickup", dropId: d.id });
          if (left > 0) {
            const nd = { ...d, id: crypto.randomUUID(), count: left };
            this.drops.set(nd.id, nd);
          }
          this.onDropsChange();
          emit();
        }
      }
    }

    // camera
    camera.position.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
    camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");

    // targeting + mining
    this.attackCd -= dt;
    this.swingT = Math.max(0, this.swingT - dt * 4);
    const hit = playing ? w.raycast(this.eye(), this.lookDir(), REACH) : null;
    this.target = hit ? { x: hit.x, y: hit.y, z: hit.z } : null;
    if (this.mining && playing && hit) {
      const key = `${hit.x},${hit.y},${hit.z}`;
      if (key !== this.mineKey) {
        this.mineKey = key;
        this.mineProgress = 0;
      }
      const d = def(hit.b);
      const h = held()?.id;
      const mult = h === I.PICK ? (d.stone ? 5 : 1.6) : h === I.SWORD && hit.b === B.LEAVES ? 3 : 1;
      this.mineProgress += (dt * mult) / d.hard;
      if (this.swingT < 0.2) this.swing();
      if (this.mineProgress >= 1) this.breakBlock(hit.x, hit.y, hit.z, hit.b);
    } else {
      this.mineProgress = 0;
      this.mineKey = "";
    }

    // particles
    for (const p of this.particles) {
      p.v.y -= 12 * dt;
      p.p.addScaledVector(p.v, dt);
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // clock label
    const t = this.dayTime();
    const hours = Math.floor(((t * 24 + 6) % 24));
    const label = `${String(hours).padStart(2, "0")}:00 ${this.isNight() ? "Night" : "Day"}`;
    if (label !== G.clock) {
      G.clock = label;
      emit();
    }

    this.netSend(dt);
  }

  private breakBlock(x: number, y: number, z: number, b: number) {
    const key = `${x},${y},${z}`;
    this.applyBlock(x, y, z, B.AIR, true);
    this.mineProgress = 0;
    this.mineKey = "";
    const give = b === B.GRASS ? B.DIRT : b === B.STONE ? B.COBBLE : b === B.LEAVES ? (Math.random() < 0.25 ? I.APPLE : 0) : b;
    if (give) addItem(give, 1);
    if (b === B.CHEST) {
      (this.world.chests.get(key) ?? []).forEach((s) => s && addItem(s.id, s.count));
      this.world.chests.delete(key);
    }
    sfx("break");
    const tile = getTileColor(b);
    this.burst(x + 0.5, y + 0.5, z + 0.5, tile, 16);
    this.hungerT += 0.5;
    emit();
  }

  private netSend(dt: number) {
    this.netAcc += dt;
    const ch = this.channel;
    if (!ch || document.hidden || G.ui === "menu") return;
    if (this.netAcc < NET_TICK) return;
    this.netAcc = 0;
    const q = (v: number) => Math.round(v * 100) / 100;
    const s = {
      x: q(this.pos.x), y: q(G.ui === "dead" ? -100 : this.pos.y), z: q(this.pos.z), ry: q(this.yaw), rp: q(this.pitch),
      hp: G.hp, sw: this.swingCount, h: held()?.id ?? 0,
    };
    const l = this.last;
    const moved =
      Math.abs(s.x - l.x) + Math.abs(s.y - l.y) + Math.abs(s.z - l.z) + Math.abs(s.ry - l.ry) + Math.abs(s.rp - l.rp) > 0.01 ||
      s.hp !== l.hp || s.sw !== l.sw || s.h !== l.h;
    if (!moved && this.elapsed - l.at < 1) return;
    this.last = { ...s, at: this.elapsed };
    ch.send({ type: "broadcast", event: "state", payload: { id: this.id, name: G.name, ...s } satisfies NetState });
  }
}

const BLOCK_COLORS: Record<number, [number, number, number]> = {
  [B.GRASS]: [0.37, 0.62, 0.21], [B.DIRT]: [0.52, 0.38, 0.26], [B.STONE]: [0.5, 0.5, 0.5], [B.COBBLE]: [0.45, 0.45, 0.45],
  [B.PLANKS]: [0.63, 0.5, 0.3], [B.LOG]: [0.42, 0.32, 0.19], [B.LEAVES]: [0.23, 0.5, 0.15], [B.SAND]: [0.86, 0.81, 0.64],
  [B.GLASS]: [0.75, 0.9, 0.95], [B.BRICKS]: [0.5, 0.5, 0.5], [B.BED]: [0.7, 0.13, 0.14], [B.CHEST]: [0.62, 0.42, 0.17],
  [B.CRAFT]: [0.6, 0.45, 0.28], [B.CORAL]: [0.88, 0.32, 0.44], [B.TORCH]: [1, 0.75, 0.3], [B.FENCE]: [0.63, 0.5, 0.3],
  [B.LADDER]: [0.55, 0.4, 0.22], [B.FLOWER]: [0.85, 0.15, 0.15], [B.FLOWER_Y]: [0.95, 0.85, 0.2],
};
export function getTileColor(b: number) {
  const c = BLOCK_COLORS[b] ?? [0.6, 0.6, 0.6];
  return new THREE.Color(c[0], c[1], c[2]);
}
