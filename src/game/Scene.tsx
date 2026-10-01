import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Engine, Drop } from "./engine";
import { B, isBlock, itemGeometry, itemMaterial } from "./blocks";
import { HOUSES, fbm, WX, WZ } from "./world";
import { G, useGame } from "./store";

const lerpAngle = (a: number, b: number, t: number) => {
  const d = b - a;
  return a + Math.atan2(Math.sin(d), Math.cos(d)) * t;
};

export function GameScene({ engine }: { engine: Engine }) {
  return (
    <>
      <Loop engine={engine} />
      <Terrain engine={engine} />
      <SkyAndLight engine={engine} />
      <Clouds engine={engine} />
      <Hand engine={engine} />
      <Remotes engine={engine} />
      <Drops engine={engine} />
      <Particles engine={engine} />
      <Selection engine={engine} />
      <Fish />
      <Mobs engine={engine} />
    </>
  );
}

function Loop({ engine }: { engine: Engine }) {
  useFrame(({ camera }, dt) => {
    if (G.ui === "menu") engine.yaw += Math.min(dt, 0.05) * 0.06;
    engine.update(dt, camera);
  }, -1);
  return null;
}

function Terrain({ engine }: { engine: Engine }) {
  useMemo(() => engine.world.buildAll(), [engine]);
  useFrame(() => engine.world.rebuildDirty(3));
  return <primitive object={engine.world.group} />;
}

// ---------------- sky ----------------
const NIGHT = new THREE.Color(0.015, 0.025, 0.08);
const DAY = new THREE.Color(0.47, 0.66, 1.0);
const DUSK = new THREE.Color(0.98, 0.52, 0.28);
const WATER_FOG = new THREE.Color(0.06, 0.3, 0.42);

function SkyAndLight({ engine }: { engine: Engine }) {
  const { scene, camera } = useThree();
  const amb = useRef<THREE.AmbientLight>(null);
  const dir = useRef<THREE.DirectionalLight>(null);
  const sun = useRef<THREE.Mesh>(null);
  const moon = useRef<THREE.Mesh>(null);
  const stars = useRef<THREE.Points>(null);
  const bg = useMemo(() => new THREE.Color(), []);
  const fog = useMemo(() => new THREE.Fog(0x88aaff, 40, 120), []);
  const starGeo = useMemo(() => {
    const p: number[] = [];
    for (let i = 0; i < 500; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.05, Math.random() - 0.5).normalize().multiplyScalar(260);
      p.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    return g;
  }, []);
  useEffect(() => {
    scene.background = bg;
    scene.fog = fog;
    if (dir.current) scene.add(dir.current.target);
  }, [scene, bg, fog]);

  useFrame(() => {
    const t = engine.dayTime();
    const a = t * Math.PI * 2;
    const sx = Math.cos(a), sy = Math.sin(a);
    const day = THREE.MathUtils.clamp(sy * 2.5 + 0.35, 0, 1);
    const dusk = Math.max(0, 1 - Math.abs(sy) * 3.5) * 0.55;
    bg.copy(NIGHT).lerp(DAY, day).lerp(DUSK, dusk);
    if (G.underwater) {
      fog.color.copy(WATER_FOG).multiplyScalar(0.35 + day * 0.65);
      bg.copy(fog.color);
      fog.near = 1;
      fog.far = 26;
    } else {
      fog.color.copy(bg);
      fog.near = 45;
      fog.far = 130;
    }
    const cp = camera.position;
    sun.current?.position.set(cp.x + sx * 200, cp.y + sy * 200, cp.z + 40);
    sun.current?.lookAt(cp);
    moon.current?.position.set(cp.x - sx * 200, cp.y - sy * 200, cp.z - 40);
    moon.current?.lookAt(cp);
    if (stars.current) {
      stars.current.position.copy(cp);
      stars.current.rotation.z = a;
      (stars.current.material as THREE.PointsMaterial).opacity = 1 - day;
    }
    if (amb.current) amb.current.intensity = 0.32 + 0.6 * day;
    if (dir.current) {
      const up = sy > -0.05;
      const k = up ? 1 : -1;
      dir.current.position.set(cp.x + sx * 60 * k, cp.y + Math.abs(sy) * 60 + 10, cp.z + 25);
      dir.current.target.position.copy(cp);
      dir.current.intensity = up ? 0.25 + day * 1.05 : 0.22;
      dir.current.color.set(up ? (dusk > 0.2 ? 0xffc89a : 0xfff4e0) : 0x9fb6ff);
    }
  });

  return (
    <>
      <ambientLight ref={amb} intensity={0.8} />
      <hemisphereLight args={[0xbfd9ff, 0x5a4a30, 0.25]} />
      <directionalLight ref={dir} intensity={1} />
      <mesh ref={sun}>
        <planeGeometry args={[26, 26]} />
        <meshBasicMaterial color={0xfff3a0} fog={false} />
      </mesh>
      <mesh ref={moon}>
        <planeGeometry args={[18, 18]} />
        <meshBasicMaterial color={0xe8ecff} fog={false} />
      </mesh>
      <points ref={stars} geometry={starGeo}>
        <pointsMaterial size={2} sizeAttenuation={false} color={0xffffff} transparent fog={false} depthWrite={false} />
      </points>
    </>
  );
}

function Clouds({ engine }: { engine: Engine }) {
  const SPAN = 480;
  const a = useRef<THREE.InstancedMesh>(null);
  const b = useRef<THREE.InstancedMesh>(null);
  const cells = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < 40; i++)
      for (let j = 0; j < 40; j++) if (fbm(i / 4 + 9, j / 4 + 3) > 0.6) out.push([i * 12 - SPAN / 2 + WX / 2, 0, j * 12 - SPAN / 2 + WZ / 2]);
    return out;
  }, []);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: false }), []);
  useEffect(() => {
    const m = new THREE.Matrix4();
    for (const mesh of [a.current, b.current]) {
      if (!mesh) continue;
      cells.forEach(([x, , z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, 72, z)));
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [cells]);
  useFrame(({ clock }) => {
    const off = (clock.elapsedTime * 1.4) % SPAN;
    a.current?.position.set(off, 0, 0);
    b.current?.position.set(off - SPAN, 0, 0);
    const t = engine.dayTime();
    const day = THREE.MathUtils.clamp(Math.sin(t * Math.PI * 2) * 2.5 + 0.35, 0, 1);
    mat.color.setScalar(0.25 + day * 0.75);
  });
  const n = Math.max(1, cells.length);
  return (
    <>
      <instancedMesh ref={a} args={[undefined, undefined, n]} material={mat}>
        <boxGeometry args={[12, 4, 12]} />
      </instancedMesh>
      <instancedMesh ref={b} args={[undefined, undefined, n]} material={mat}>
        <boxGeometry args={[12, 4, 12]} />
      </instancedMesh>
    </>
  );
}

// ---------------- first-person hand ----------------
function Hand({ engine }: { engine: Engine }) {
  const st = useGame();
  const id = st.inv[st.sel]?.id ?? 0;
  const root = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const bob = useRef(0);
  useFrame((_, dt) => {
    if (!root.current || !inner.current) return;
    root.current.position.copy(camera.position);
    root.current.quaternion.copy(camera.quaternion);
    root.current.visible = G.ui !== "dead" && G.ui !== "menu";
    const spd = Math.hypot(engine.vel.x, engine.vel.z);
    bob.current += dt * spd * 2.2;
    const s = Math.sin(engine.swingT * Math.PI);
    inner.current.position.set(0.48 - s * 0.15, -0.5 + Math.abs(Math.sin(bob.current)) * 0.03 - s * 0.05, -0.75 - s * 0.15);
    inner.current.rotation.set(-s * 1.0, -0.35 + s * 0.3, s * 0.3);
  });
  return (
    <group ref={root}>
      <group ref={inner}>
        {id ? (
          <mesh
            geometry={itemGeometry(id)}
            material={itemMaterial(id)}
            scale={isBlock(id) ? 0.32 : 0.55}
            rotation={isBlock(id) ? [0.1, 0.6, 0] : [0, -1.2, 0.3]}
            renderOrder={5}
          />
        ) : (
          <mesh position={[0.05, -0.05, 0.1]} rotation={[0.9, 0, 0]}>
            <boxGeometry args={[0.18, 0.18, 0.6]} />
            <meshLambertMaterial color={0xd09a72} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// ---------------- remote players ----------------
function Remotes({ engine }: { engine: Engine }) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    engine.onRosterChange = (i) => setIds([...i]);
    setIds([...engine.remotes.keys()]);
    return () => {
      engine.onRosterChange = () => {};
    };
  }, [engine]);
  return (
    <>
      {ids.map((id) => (
        <Avatar key={id} engine={engine} id={id} />
      ))}
    </>
  );
}

type Limb = React.RefObject<THREE.Group | null>;
function Box({ size, pos, mat }: { size: [number, number, number]; pos: [number, number, number]; mat: THREE.Material }) {
  return (
    <mesh position={pos} material={mat}>
      <boxGeometry args={size} />
    </mesh>
  );
}

function useHumanoidMats(shirtHue: number, kind: "player" | "villager") {
  return useMemo(() => {
    const m = (c: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color: c });
    return kind === "player"
      ? {
          skin: m(0xc68c66), shirt: m(new THREE.Color().setHSL(shirtHue, 0.6, 0.45)), pants: m(0x3b3fa8), hair: m(0x4a2f1a),
          eye: m(0xffffff), pupil: m(0x3a4fd0), shoe: m(0x555555),
        }
      : {
          skin: m(0xc4906c), shirt: m(0x6b4a2e), pants: m(0x5a3d24), hair: m(0x4a3220),
          eye: m(0xffffff), pupil: m(0x2fa83a), shoe: m(0x3b2a1a),
        };
  }, [shirtHue, kind]);
}

function Humanoid({
  mats, head, armL, armR, legL, legR, villager, children,
}: {
  mats: ReturnType<typeof useHumanoidMats>; head: Limb; armL: Limb; armR: Limb; legL: Limb; legR: Limb; villager?: boolean; children?: React.ReactNode;
}) {
  return (
    <group scale={0.9}>
      <group ref={legL} position={[-0.125, 0.75, 0]}>
        <Box size={[0.25, 0.75, 0.25]} pos={[0, -0.375, 0]} mat={mats.pants} />
        <Box size={[0.26, 0.12, 0.26]} pos={[0, -0.69, 0]} mat={mats.shoe} />
      </group>
      <group ref={legR} position={[0.125, 0.75, 0]}>
        <Box size={[0.25, 0.75, 0.25]} pos={[0, -0.375, 0]} mat={mats.pants} />
        <Box size={[0.26, 0.12, 0.26]} pos={[0, -0.69, 0]} mat={mats.shoe} />
      </group>
      <Box size={villager ? [0.52, 0.95, 0.32] : [0.5, 0.75, 0.25]} pos={[0, villager ? 1.05 : 1.125, 0]} mat={mats.shirt} />
      <group ref={armL} position={[-0.375, 1.5, 0]}>
        <Box size={[0.25, 0.75, 0.25]} pos={[0, -0.375, 0]} mat={villager ? mats.shirt : mats.skin} />
        {!villager && <Box size={[0.26, 0.3, 0.26]} pos={[0, -0.15, 0]} mat={mats.shirt} />}
      </group>
      <group ref={armR} position={[0.375, 1.5, 0]}>
        <Box size={[0.25, 0.75, 0.25]} pos={[0, -0.375, 0]} mat={villager ? mats.shirt : mats.skin} />
        {!villager && <Box size={[0.26, 0.3, 0.26]} pos={[0, -0.15, 0]} mat={mats.shirt} />}
        {children}
      </group>
      <group ref={head} position={[0, 1.5, 0]}>
        <Box size={villager ? [0.5, 0.62, 0.5] : [0.5, 0.5, 0.5]} pos={[0, villager ? 0.31 : 0.25, 0]} mat={mats.skin} />
        <Box size={[0.52, 0.12, 0.52]} pos={[0, villager ? 0.58 : 0.46, 0]} mat={mats.hair} />
        <Box size={[0.52, 0.3, 0.06]} pos={[0, villager ? 0.4 : 0.32, 0.24]} mat={mats.hair} />
        <Box size={[0.1, 0.06, 0.02]} pos={[-0.12, villager ? 0.36 : 0.27, -0.255]} mat={mats.eye} />
        <Box size={[0.1, 0.06, 0.02]} pos={[0.12, villager ? 0.36 : 0.27, -0.255]} mat={mats.eye} />
        <Box size={[0.05, 0.06, 0.025]} pos={[-0.095, villager ? 0.36 : 0.27, -0.26]} mat={mats.pupil} />
        <Box size={[0.05, 0.06, 0.025]} pos={[0.095, villager ? 0.36 : 0.27, -0.26]} mat={mats.pupil} />
        {villager ? (
          <Box size={[0.12, 0.25, 0.12]} pos={[0, 0.2, -0.3]} mat={mats.skin} />
        ) : (
          <Box size={[0.2, 0.05, 0.02]} pos={[0, 0.1, -0.255]} mat={mats.hair} />
        )}
      </group>
    </group>
  );
}

function Avatar({ engine, id }: { engine: Engine; id: string }) {
  const r0 = engine.remotes.get(id);
  const mats = useHumanoidMats(((r0?.color ?? 0) % 360) / 360, "player");
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const item = useRef<THREE.Mesh>(null);
  const tag = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const anim = useRef({ phase: 0, swing: 0, lastSw: -1, seen: false });
  const tgt = useMemo(() => new THREE.Vector3(), []);
  const prev = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const r = engine.remotes.get(id);
    const g = root.current;
    if (!r || !g) return;
    const s = r.s;
    if (s.y < -50) {
      g.visible = false;
      anim.current.seen = false;
      return;
    }
    tgt.set(s.x, s.y, s.z);
    prev.copy(g.position);
    if (!anim.current.seen || g.position.distanceTo(tgt) > 6) g.position.copy(tgt);
    else g.position.lerp(tgt, 1 - Math.exp(-12 * dt));
    anim.current.seen = true;
    g.visible = true;
    g.rotation.y = lerpAngle(g.rotation.y, s.ry, 1 - Math.exp(-12 * dt));
    const speed = Math.hypot(g.position.x - prev.x, g.position.z - prev.z) / Math.max(dt, 1e-3);
    const a = anim.current;
    a.phase += dt * speed * 2.4;
    const amp = Math.min(1, speed / 4) * 0.8;
    if (a.lastSw !== s.sw) {
      if (a.lastSw !== -1) a.swing = 1;
      a.lastSw = s.sw;
    }
    a.swing = Math.max(0, a.swing - dt * 4);
    if (head.current) head.current.rotation.x = s.rp;
    if (legL.current) legL.current.rotation.x = Math.sin(a.phase) * amp;
    if (legR.current) legR.current.rotation.x = -Math.sin(a.phase) * amp;
    if (armL.current) armL.current.rotation.x = -Math.sin(a.phase) * amp;
    if (armR.current) armR.current.rotation.x = Math.sin(a.phase) * amp + Math.sin(a.swing * Math.PI) * 1.6;
    if (item.current) {
      item.current.visible = s.h > 0;
      if (s.h > 0) {
        item.current.geometry = itemGeometry(s.h);
        item.current.material = itemMaterial(s.h);
      }
    }
    const hurt = performance.now() - r.hurt < 300;
    Object.values(mats).forEach((m) => m.emissive.setRGB(hurt ? 0.7 : 0, 0, 0));
    if (tag.current && tag.current.textContent !== s.name) tag.current.textContent = s.name;
    if (bar.current) bar.current.style.width = `${(s.hp / 20) * 100}%`;
  });

  return (
    <group ref={root} visible={false}>
      <Humanoid mats={mats} head={head} armL={armL} armR={armR} legL={legL} legR={legR}>
        <mesh ref={item} position={[0, -0.7, -0.25]} scale={0.4} rotation={[0, 1.57, 0]} visible={false} />
      </Humanoid>
      <Html position={[0, 2.25, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="mc-nametag">
          <div ref={tag}>{r0?.s.name}</div>
          <div className="mc-nametag-bar">
            <div ref={bar} className="mc-nametag-fill" />
          </div>
        </div>
      </Html>
    </group>
  );
}

// ---------------- dropped items ----------------
function Drops({ engine }: { engine: Engine }) {
  const [list, setList] = useState<Drop[]>([]);
  const refs = useRef(new Map<string, THREE.Group>());
  useEffect(() => {
    engine.onDropsChange = () => setList([...engine.drops.values()]);
    setList([...engine.drops.values()]);
    return () => {
      engine.onDropsChange = () => {};
    };
  }, [engine]);
  useFrame(({ clock }, dt) => {
    for (const d of engine.drops.values()) {
      const ground = engine.world.groundBelow(d.x, d.y + 0.5, d.z) + 0.3;
      d.y += (ground - d.y) * (1 - Math.exp(-8 * Math.min(dt, 0.05)));
      const g = refs.current.get(d.id);
      if (g) {
        g.position.set(d.x, d.y + Math.sin(clock.elapsedTime * 2 + d.x) * 0.08, d.z);
        g.rotation.y = clock.elapsedTime * 1.5 + d.z;
      }
    }
  });
  return (
    <>
      {list.map((d) => (
        <group
          key={d.id}
          ref={(g) => {
            if (g) refs.current.set(d.id, g);
            else refs.current.delete(d.id);
          }}
        >
          <mesh geometry={itemGeometry(d.item)} material={itemMaterial(d.item)} scale={isBlock(d.item) ? 0.28 : 0.45} />
        </group>
      ))}
    </>
  );
}

// ---------------- particles ----------------
function Particles({ engine }: { engine: Engine }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useEffect(() => {
    const im = mesh.current;
    if (!im) return;
    im.setColorAt(0, new THREE.Color(1, 1, 1));
  }, []);
  useFrame(() => {
    const im = mesh.current;
    if (!im) return;
    const ps = engine.particles;
    const n = Math.min(ps.length, 240);
    for (let i = 0; i < n; i++) {
      const p = ps[i]!;
      const s = Math.min(1, p.life * 2) * 0.12;
      m.makeScale(s, s, s).setPosition(p.p);
      im.setMatrixAt(i, m);
      im.setColorAt(i, p.c);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 240]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

// ---------------- block selection + crack ----------------
function Selection({ engine }: { engine: Engine }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), []);
  const line = useRef<THREE.LineSegments>(null);
  const crack = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = engine.target;
    if (line.current) {
      line.current.visible = !!t;
      if (t) line.current.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    }
    if (crack.current) {
      crack.current.visible = !!t && engine.mineProgress > 0;
      if (t) crack.current.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
      const mat = crack.current.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.floor(engine.mineProgress * 8) / 8 * 0.6;
      const s = 1.01 - engine.mineProgress * 0.02;
      crack.current.scale.setScalar(s);
    }
  });
  return (
    <>
      <lineSegments ref={line} geometry={edges}>
        <lineBasicMaterial color={0x111111} />
      </lineSegments>
      <mesh ref={crack}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={0x000000} transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}

// ---------------- fish schools ----------------
function Fish() {
  const N = 56;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const palette = [0xff8c1a, 0xffd23f, 0x3fa9f5, 0xff5d73];
  useEffect(() => {
    const im = mesh.current;
    if (!im) return;
    for (let i = 0; i < N; i++) im.setColorAt(i, new THREE.Color(palette[Math.floor(i / 14) % palette.length]));
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, []);
  useFrame(({ clock }) => {
    const im = mesh.current;
    if (!im) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < N; i++) {
      const k = Math.floor(i / 14);
      const j = i % 14;
      const cx = 16 + 9 * Math.sin(t * 0.05 + k * 1.7);
      const cz = 48 + 36 * Math.sin(t * 0.03 + k * 2.3);
      const cy = 9.5 + 1.2 * Math.sin(t * 0.2 + k);
      const dirSign = k % 2 ? 1 : -1;
      const ang = t * 0.9 * dirSign + j * 0.45;
      const rad = 1.1 + (j % 3) * 0.55;
      p.set(cx + Math.cos(ang) * rad, cy + ((j % 4) - 1.5) * 0.35, cz + Math.sin(ang) * rad);
      const heading = Math.atan2(Math.cos(ang) * dirSign, -Math.sin(ang) * dirSign) ;
      q.setFromAxisAngle(up, -heading + Math.sin(t * 8 + j) * 0.15);
      m.compose(p, q, sc);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} frustumCulled={false}>
      <boxGeometry args={[0.42, 0.22, 0.12]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

// ---------------- land mobs: villagers + pigs ----------------
type Mob = { kind: "villager" | "pig"; x: number; y: number; z: number; hx: number; hz: number; tx: number; tz: number; yaw: number; wait: number; phase: number };

function Mobs({ engine }: { engine: Engine }) {
  const mobs = useMemo<Mob[]>(() => {
    const w = engine.world;
    const out: Mob[] = [];
    HOUSES.forEach((h) => {
      const x = h.x + 3.5, z = h.z + 9.5;
      out.push({ kind: "villager", x, z, y: w.groundBelow(x, 46, z), hx: x, hz: z, tx: x, tz: z, yaw: 0, wait: 1, phase: 0 });
    });
    [[64, 40], [70, 36], [62, 52], [86, 40]].forEach(([x, z]) => {
      const px = x! + 0.5, pz = z! + 0.5;
      out.push({ kind: "pig", x: px, z: pz, y: w.groundBelow(px, 46, pz), hx: px, hz: pz, tx: px, tz: pz, yaw: 0, wait: 2, phase: 0 });
    });
    return out;
  }, [engine]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const w = engine.world;
    mobs.forEach((mob, i) => {
      if (mob.wait > 0) {
        mob.wait -= dt;
        if (mob.wait <= 0) {
          mob.tx = mob.hx + (Math.random() - 0.5) * 14;
          mob.tz = mob.hz + (Math.random() - 0.5) * 14;
        }
      } else {
        const dx = mob.tx - mob.x, dz = mob.tz - mob.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) mob.wait = 2 + Math.random() * 4;
        else {
          const sp = (mob.kind === "pig" ? 1 : 1.3) * dt;
          const nx = mob.x + (dx / d) * sp, nz = mob.z + (dz / d) * sp;
          const ny = w.groundBelow(nx, mob.y + 1.2, nz);
          const wet = w.get(Math.floor(nx), Math.floor(mob.y), Math.floor(nz)) === B.WATER || w.get(Math.floor(nx), ny, Math.floor(nz)) === B.WATER;
          if (ny - mob.y > 1.1 || mob.y - ny > 3 || wet || w.solid(Math.floor(nx), ny + 1, Math.floor(nz))) mob.wait = 1 + Math.random() * 2;
          else {
            mob.x = nx;
            mob.z = nz;
            mob.y += (ny - mob.y) * Math.min(1, dt * 12);
            mob.phase += dt * 6;
            mob.yaw = lerpAngle(mob.yaw, Math.atan2(-dx, -dz), 1 - Math.exp(-8 * dt));
          }
        }
      }
      const g = refs.current[i];
      if (g) {
        g.position.set(mob.x, mob.y, mob.z);
        g.rotation.y = mob.yaw;
        const swing = mob.wait > 0 ? 0 : Math.sin(mob.phase) * 0.6;
        g.userData["swing"] = swing;
        g.traverse((o) => {
          if (o.userData["leg"] !== undefined) o.rotation.x = swing * (o.userData["leg"] as number);
        });
      }
    });
  });
  return (
    <>
      {mobs.map((m, i) => (
        <group key={i} ref={(g) => { refs.current[i] = g; }}>
          {m.kind === "villager" ? <Villager /> : <Pig />}
        </group>
      ))}
    </>
  );
}

function Villager() {
  const mats = useHumanoidMats(0, "villager");
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  useEffect(() => {
    if (legL.current) legL.current.userData["leg"] = 1;
    if (legR.current) legR.current.userData["leg"] = -1;
    if (armL.current) armL.current.rotation.x = -0.9;
    if (armR.current) armR.current.rotation.x = -0.9;
  }, []);
  return <Humanoid mats={mats} head={head} armL={armL} armR={armR} legL={legL} legR={legR} villager />;
}

function Pig() {
  const pink = useMemo(() => new THREE.MeshLambertMaterial({ color: 0xf0a0a8 }), []);
  const snout = useMemo(() => new THREE.MeshLambertMaterial({ color: 0xd9788a }), []);
  const dark = useMemo(() => new THREE.MeshLambertMaterial({ color: 0x2a1a1a }), []);
  const legs: [number, number, number][] = [[-0.2, 0.3, -0.35], [0.2, 0.3, -0.35], [-0.2, 0.3, 0.35], [0.2, 0.3, 0.35]];
  return (
    <group>
      <Box size={[0.6, 0.5, 1.0]} pos={[0, 0.55, 0]} mat={pink} />
      <Box size={[0.5, 0.5, 0.5]} pos={[0, 0.75, -0.65]} mat={pink} />
      <Box size={[0.25, 0.18, 0.08]} pos={[0, 0.68, -0.92]} mat={snout} />
      <Box size={[0.08, 0.08, 0.02]} pos={[-0.14, 0.85, -0.905]} mat={dark} />
      <Box size={[0.08, 0.08, 0.02]} pos={[0.14, 0.85, -0.905]} mat={dark} />
      {legs.map((p, i) => (
        <group key={i} position={p} userData={{ leg: i % 2 ? 1 : -1 }}>
          <Box size={[0.2, 0.3, 0.2]} pos={[0, -0.15, 0]} mat={pink} />
        </group>
      ))}
    </group>
  );
}
