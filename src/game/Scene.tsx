import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Engine, Drop } from "./engine";
import { B, T, U, GeoBuilder, getMaterials, isBlock, itemGeometry, itemMaterial } from "./blocks";
import { sfx } from "./audio";
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
      <Fish engine={engine} />
      <Torches engine={engine} />
      <Underwater engine={engine} />
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
const WATER_FOG = new THREE.Color(0.05, 0.33, 0.4);

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

  useFrame(({ clock }) => {
    const t = engine.dayTime();
    const a = t * Math.PI * 2;
    U.uTime.value = clock.elapsedTime;
    const sx = Math.cos(a), sy = Math.sin(a);
    const day = THREE.MathUtils.clamp(sy * 2.5 + 0.35, 0, 1);
    const dusk = Math.max(0, 1 - Math.abs(sy) * 3.5) * 0.55;
    U.uDay.value = 0.25 + day * 0.75;
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
function Fish({ engine }: { engine: Engine }) {
  const SCHOOLS = 5, PER = 12, N = SCHOOLS * PER;
  const body = useRef<THREE.InstancedMesh>(null);
  const tail = useRef<THREE.InstancedMesh>(null);
  const fin = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const flee = useMemo(() => Array.from({ length: SCHOOLS }, () => ({ x: 0, z: 0, k: 0 })), []);
  const phase = useMemo(() => Array.from({ length: SCHOOLS }, () => 0), []);
  useEffect(() => {
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const h = [0.07, 0.13, 0.55, 0.95, 0.5, 0.0][Math.floor(Math.random() * 6)]! + (Math.random() - 0.5) * 0.04;
      body.current?.setColorAt(i, c.setHSL(h, 0.9, 0.55));
      tail.current?.setColorAt(i, c.setHSL((h + 0.5 + Math.random() * 0.2) % 1, 0.85, Math.random() < 0.4 ? 0.92 : 0.45));
      fin.current?.setColorAt(i, c.setHSL(h, 0.7, 0.3));
    }
    [body, tail, fin].forEach((r) => { if (r.current?.instanceColor) r.current.instanceColor.needsUpdate = true; });
  }, [N]);
  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, 0.05);
    const t = clock.elapsedTime;
    const p = engine.pos;
    for (let k = 0; k < SCHOOLS; k++) {
      const cx0 = 16 + 9 * Math.sin(t * 0.05 + k * 1.7);
      const cz0 = 48 + 38 * Math.sin(t * 0.03 + k * 2.3);
      const f = flee[k]!;
      const dx = cx0 + f.x - p.x, dz = cz0 + f.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const scared = d < 6 && p.y < 15 ? (6 - d) / 6 : 0;
      f.x += (dx / d) * scared * 8 * dt;
      f.z += (dz / d) * scared * 8 * dt;
      f.x *= Math.exp(-0.25 * dt);
      f.z *= Math.exp(-0.25 * dt);
      f.k += (scared - f.k) * (1 - Math.exp(-4 * dt));
      phase[k]! += dt * (0.9 + f.k * 2.5);
      const cx = Math.max(3, Math.min(30, cx0 + f.x)), cz = Math.max(4, Math.min(92, cz0 + f.z));
      const cy = 9.5 + 1.3 * Math.sin(t * 0.2 + k);
      const ds = k % 2 ? 1 : -1;
      for (let j = 0; j < PER; j++) {
        const i = k * PER + j;
        const ang = phase[k]! * ds + j * 0.52;
        const rad = 1.1 + (j % 3) * 0.6 + f.k * 0.8;
        const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
        const y = cy + ((j % 4) - 1.5) * 0.4 + Math.sin(t * 2 + j) * 0.08;
        const vx = -Math.sin(ang) * ds, vz = Math.cos(ang) * ds;
        const yaw = Math.atan2(-vz, vx);
        const wig = Math.sin(t * (12 + f.k * 14) + j * 1.7);
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, yaw + wig * 0.12, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        body.current?.setMatrixAt(i, dummy.matrix);
        const fx = Math.cos(yaw), fz = -Math.sin(yaw);
        dummy.position.set(x - fx * 0.27, y, z - fz * 0.27);
        dummy.rotation.set(0, yaw + wig * 0.6, 0);
        dummy.updateMatrix();
        tail.current?.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x - fx * 0.02, y + 0.15, z - fz * 0.02);
        dummy.rotation.set(0, yaw, 0);
        dummy.updateMatrix();
        fin.current?.setMatrixAt(i, dummy.matrix);
      }
    }
    [body, tail, fin].forEach((r) => { if (r.current) r.current.instanceMatrix.needsUpdate = true; });
  });
  return (
    <>
      <instancedMesh ref={body} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry args={[0.4, 0.24, 0.13]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={tail} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry args={[0.16, 0.22, 0.03]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={fin} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry args={[0.18, 0.08, 0.02]} />
        <meshLambertMaterial />
      </instancedMesh>
    </>
  );
}

// ---------------- torches: flickering voxel flames + tower floodlight ----------------
function Torches({ engine }: { engine: Engine }) {
  const MAX = 160, PER = 4;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const list = useRef<THREE.Vector3[]>([]);
  const ver = useRef(-1);
  const acc = useRef(0);
  const flood = useRef<THREE.PointLight>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const fl = useMemo(() => engine.world.floodlight(), [engine]);
  useFrame(({ clock }, dt) => {
    acc.current += dt;
    if (ver.current !== engine.world.version && acc.current > 0.5) {
      acc.current = 0;
      ver.current = engine.world.version;
      list.current = engine.world.torches().slice(0, MAX);
    }
    const im = mesh.current;
    if (!im) return;
    const t = clock.elapsedTime;
    let n = 0;
    list.current.forEach((p, ti) => {
      for (let k = 0; k < PER; k++) {
        const ph = (t * (1.6 + k * 0.3) + k * 0.27 + ti * 0.13) % 1;
        const core = k === 0;
        const s = core ? 0.13 + Math.sin(t * 23 + ti) * 0.025 : 0.07 * (1 - ph);
        dummy.position.set(
          p.x + (core ? 0 : Math.sin(ti + k * 2.1 + t * 3) * 0.05),
          p.y + (core ? 0.06 + Math.sin(t * 17 + ti) * 0.015 : 0.1 + ph * 0.35),
          p.z + (core ? 0 : Math.cos(ti + k * 1.3 + t * 2.6) * 0.05),
        );
        dummy.rotation.set(0, t * 2 + k, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        im.setMatrixAt(n, dummy.matrix);
        im.setColorAt(n, core ? col.setRGB(1, 0.85, 0.35) : col.setRGB(1, 0.55 - ph * 0.35, 0.1));
        n++;
      }
    });
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    if (flood.current) {
      const night = engine.isNight() || G.underwater;
      flood.current.intensity = (night ? 60 : 12) * (0.92 + Math.sin(t * 9) * 0.04);
    }
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX * PER]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <pointLight ref={flood} position={[fl.x, fl.y, fl.z]} color={0xffd9a0} distance={34} decay={1.4} intensity={20} />
    </>
  );
}

// ---------------- underwater: light shafts + rising bubbles/dust ----------------
function Underwater({ engine }: { engine: Engine }) {
  const { camera } = useThree();
  const rays = useRef<THREE.Group>(null);
  const pts = useRef<THREE.Points>(null);
  const COUNT = 260;
  const seeds = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * Math.PI * 2 + Math.random(), r: 3 + Math.random() * 8, w: 0.6 + Math.random() * 1.4 })), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) { p[i * 3] = (Math.random() - 0.5) * 16; p[i * 3 + 1] = Math.random() * 10; p[i * 3 + 2] = (Math.random() - 0.5) * 16; }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  const rayMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xc8f4ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }), []);
  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, 0.05);
    const on = G.underwater;
    const t = clock.elapsedTime;
    const day = THREE.MathUtils.clamp(Math.sin(engine.dayTime() * Math.PI * 2) * 2.5 + 0.35, 0, 1);
    if (rays.current) {
      rays.current.visible = on && day > 0.05;
      rays.current.position.set(camera.position.x, 0, camera.position.z);
      rays.current.children.forEach((c, i) => {
        const s = seeds[i]!;
        c.position.set(Math.cos(s.a + t * 0.02) * s.r, 14 - 7, Math.sin(s.a + t * 0.02) * s.r);
        c.rotation.set(0.25 * Math.sin(t * 0.3 + i), Math.atan2(camera.position.x - (camera.position.x + c.position.x), camera.position.z - (camera.position.z + c.position.z)), 0.18);
        c.scale.set(s.w, 1, 1);
      });
      rayMat.opacity = (0.05 + 0.04 * Math.sin(t * 0.7)) * day;
    }
    if (pts.current) {
      pts.current.visible = on;
      if (on) {
        pts.current.position.set(camera.position.x, camera.position.y - 5, camera.position.z);
        const a = geo.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < COUNT; i++) {
          let y = a.getY(i) + dt * (i % 3 === 0 ? 1.4 : 0.15);
          if (y > 10) y = 0;
          a.setY(i, y);
          a.setX(i, a.getX(i) + Math.sin(t + i) * dt * 0.1);
        }
        a.needsUpdate = true;
      }
    }
  });
  return (
    <>
      <group ref={rays} visible={false}>
        {seeds.map((_, i) => (
          <mesh key={i} material={rayMat}>
            <planeGeometry args={[1.2, 18]} />
          </mesh>
        ))}
      </group>
      <points ref={pts} geometry={geo} visible={false}>
        <pointsMaterial size={0.07} color={0xd8f6ff} transparent opacity={0.7} depthWrite={false} />
      </points>
    </>
  );
}

// ---------------- land mobs: villagers, pigs, creepers ----------------
type Mob = {
  kind: "villager" | "pig" | "creeper"; x: number; y: number; z: number; hx: number; hz: number; tx: number; tz: number;
  yaw: number; wait: number; phase: number; fuse: number; dead: number;
};

function Mobs({ engine }: { engine: Engine }) {
  const mobs = useMemo<Mob[]>(() => {
    const w = engine.world;
    const out: Mob[] = [];
    const add = (kind: Mob["kind"], x: number, z: number) =>
      out.push({ kind, x, z, y: w.groundBelow(x, 46, z), hx: x, hz: z, tx: x, tz: z, yaw: 0, wait: 1 + Math.random() * 2, phase: 0, fuse: 0, dead: 0 });
    HOUSES.forEach((h) => add("villager", h.x + 3.5, h.z + 8.5));
    [[64, 40], [70, 36], [62, 52], [86, 40]].forEach(([x, z]) => add("pig", x! + 0.5, z! + 0.5));
    [[44, 84], [88, 14], [42, 12]].forEach(([x, z]) => add("creeper", x! + 0.5, z! + 0.5));
    return out;
  }, [engine]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, 0.05);
    const w = engine.world;
    const p = engine.pos;
    mobs.forEach((mob, i) => {
      const g = refs.current[i];
      if (mob.dead > 0) {
        mob.dead -= dt;
        if (g) g.visible = false;
        if (mob.dead <= 0) { mob.x = mob.hx; mob.z = mob.hz; mob.y = w.groundBelow(mob.x, 46, mob.z); }
        return;
      }
      const dp = Math.hypot(p.x - mob.x, p.y - mob.y, p.z - mob.z);
      const playing = G.ui === "play" || G.ui === "paused" || G.ui === "chat" || G.ui === "inventory";
      if (mob.kind === "creeper" && playing) {
        if (dp < 12 && dp > 1.6) { mob.tx = p.x; mob.tz = p.z; mob.wait = 0; }
        if (dp < 2.8) {
          if (mob.fuse === 0) sfx("hiss");
          mob.fuse += dt;
        } else mob.fuse = Math.max(0, mob.fuse - dt * 2);
        if (mob.fuse > 1.5) {
          mob.fuse = 0;
          mob.dead = 25;
          sfx("boom");
          engine.burst(mob.x, mob.y + 1, mob.z, new THREE.Color(0.85, 0.85, 0.85), 60, 9);
          if (dp < 4.5) engine.damage(Math.max(1, Math.round(10 * (1 - dp / 4.5))), "a Creeper");
          return;
        }
      }
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
          const sp = (mob.kind === "pig" ? 1 : mob.kind === "creeper" ? (mob.fuse > 0 ? 0.3 : 1.6) : 1.3) * dt;
          const nx = mob.x + (dx / d) * sp, nz = mob.z + (dz / d) * sp;
          const ny = w.groundBelow(nx, mob.y + 1.2, nz);
          const wet = w.get(Math.floor(nx), Math.floor(mob.y), Math.floor(nz)) === B.WATER || w.get(Math.floor(nx), ny, Math.floor(nz)) === B.WATER;
          if (ny - mob.y > 1.1 || mob.y - ny > 3 || wet || w.solid(Math.floor(nx), ny + 1, Math.floor(nz))) mob.wait = 1 + Math.random() * 2;
          else {
            mob.x = nx;
            mob.z = nz;
            mob.y += (ny - mob.y) * Math.min(1, dt * 12);
            mob.phase += dt * (mob.kind === "creeper" ? 8 : 6);
            mob.yaw = lerpAngle(mob.yaw, Math.atan2(-dx, -dz), 1 - Math.exp(-8 * dt));
          }
        }
      }
      if (g) {
        g.visible = true;
        g.position.set(mob.x, mob.y, mob.z);
        g.rotation.y = mob.yaw;
        const swing = mob.wait > 0 ? 0 : Math.sin(mob.phase) * 0.6;
        const puff = mob.fuse > 0 ? 1 + Math.abs(Math.sin(clock.elapsedTime * 18)) * 0.12 * (mob.fuse / 1.5 + 0.3) : 1;
        g.scale.set(puff, 1 + (puff - 1) * 0.5, puff);
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
          {m.kind === "villager" ? <Villager /> : m.kind === "pig" ? <Pig /> : <Creeper />}
        </group>
      ))}
    </>
  );
}

function Villager() {
  const m = useMemo(() => {
    const c = (x: number) => new THREE.MeshLambertMaterial({ color: x });
    return { robe: c(0x6b4a2e), trim: c(0x9a7444), dark: c(0x3e2a18), skin: c(0xc4906c), nose: c(0xb07a58), eye: c(0xffffff), pupil: c(0x22b04a), brow: c(0x3a2414) };
  }, []);
  return (
    <group scale={0.9}>
      <group position={[-0.125, 0.5, 0]} userData={{ leg: 1 }}>
        <Box size={[0.24, 0.5, 0.24]} pos={[0, -0.25, 0]} mat={m.dark} />
      </group>
      <group position={[0.125, 0.5, 0]} userData={{ leg: -1 }}>
        <Box size={[0.24, 0.5, 0.24]} pos={[0, -0.25, 0]} mat={m.dark} />
      </group>
      <Box size={[0.52, 1.0, 0.32]} pos={[0, 1.0, 0]} mat={m.robe} />
      <Box size={[0.62, 0.2, 0.4]} pos={[0, 0.56, 0]} mat={m.trim} />
      <Box size={[0.56, 0.06, 0.36]} pos={[0, 1.47, 0]} mat={m.trim} />
      {/* folded arms */}
      <Box size={[0.26, 0.36, 0.28]} pos={[-0.39, 1.33, -0.1]} mat={m.robe} />
      <Box size={[0.26, 0.36, 0.28]} pos={[0.39, 1.33, -0.1]} mat={m.robe} />
      <Box size={[0.8, 0.25, 0.26]} pos={[0, 1.17, -0.27]} mat={m.robe} />
      <Box size={[0.3, 0.2, 0.04]} pos={[0, 1.17, -0.41]} mat={m.skin} />
      <group position={[0, 1.5, 0]}>
        <Box size={[0.5, 0.64, 0.5]} pos={[0, 0.32, 0]} mat={m.skin} />
        <Box size={[0.13, 0.27, 0.14]} pos={[0, 0.2, -0.31]} mat={m.nose} />
        <Box size={[0.12, 0.07, 0.02]} pos={[-0.12, 0.37, -0.255]} mat={m.eye} />
        <Box size={[0.12, 0.07, 0.02]} pos={[0.12, 0.37, -0.255]} mat={m.eye} />
        <Box size={[0.055, 0.07, 0.025]} pos={[-0.09, 0.37, -0.26]} mat={m.pupil} />
        <Box size={[0.055, 0.07, 0.025]} pos={[0.09, 0.37, -0.26]} mat={m.pupil} />
        <Box size={[0.4, 0.05, 0.025]} pos={[0, 0.44, -0.258]} mat={m.brow} />
      </group>
    </group>
  );
}

function Pig() {
  const pink = useMemo(() => new THREE.MeshLambertMaterial({ color: 0xf0a0a8 }), []);
  const snout = useMemo(() => new THREE.MeshLambertMaterial({ color: 0xd9788a }), []);
  const dark = useMemo(() => new THREE.MeshLambertMaterial({ color: 0x2a1a1a }), []);
  const white = useMemo(() => new THREE.MeshLambertMaterial({ color: 0xffffff }), []);
  const legs: [number, number, number][] = [[-0.2, 0.3, -0.35], [0.2, 0.3, -0.35], [-0.2, 0.3, 0.35], [0.2, 0.3, 0.35]];
  return (
    <group>
      <Box size={[0.62, 0.52, 1.0]} pos={[0, 0.56, 0]} mat={pink} />
      <Box size={[0.5, 0.5, 0.5]} pos={[0, 0.76, -0.66]} mat={pink} />
      <Box size={[0.28, 0.18, 0.1]} pos={[0, 0.66, -0.95]} mat={snout} />
      <Box size={[0.05, 0.06, 0.02]} pos={[-0.06, 0.67, -1.0]} mat={dark} />
      <Box size={[0.05, 0.06, 0.02]} pos={[0.06, 0.67, -1.0]} mat={dark} />
      <Box size={[0.09, 0.09, 0.02]} pos={[-0.15, 0.86, -0.915]} mat={white} />
      <Box size={[0.09, 0.09, 0.02]} pos={[0.15, 0.86, -0.915]} mat={white} />
      <Box size={[0.045, 0.09, 0.025]} pos={[-0.13, 0.86, -0.92]} mat={dark} />
      <Box size={[0.045, 0.09, 0.025]} pos={[0.13, 0.86, -0.92]} mat={dark} />
      <mesh position={[-0.2, 1.03, -0.62]} rotation={[0.3, 0, 0.5]} material={pink}><boxGeometry args={[0.16, 0.06, 0.16]} /></mesh>
      <mesh position={[0.2, 1.03, -0.62]} rotation={[0.3, 0, -0.5]} material={pink}><boxGeometry args={[0.16, 0.06, 0.16]} /></mesh>
      <Box size={[0.06, 0.06, 0.1]} pos={[0, 0.72, 0.54]} mat={snout} />
      {legs.map((lp, i) => (
        <group key={i} position={lp} userData={{ leg: i % 3 === 0 ? 1 : -1 }}>
          <Box size={[0.2, 0.3, 0.2]} pos={[0, -0.15, 0]} mat={pink} />
          <Box size={[0.21, 0.05, 0.21]} pos={[0, -0.28, 0]} mat={dark} />
        </group>
      ))}
    </group>
  );
}

let creeperGeo: { skin: THREE.BufferGeometry; head: THREE.BufferGeometry } | null = null;
function getCreeperGeo() {
  if (creeperGeo) return creeperGeo;
  const a = new GeoBuilder();
  a.box(-0.5, -0.5, -0.5, [0, 0, 0], [1, 1, 1], [T.creeper, T.creeper, T.creeper], 1.1);
  const h = new GeoBuilder();
  h.box(-0.5, -0.5, -0.5, [0, 0, 0], [1, 1, 1], [T.creeper, T.creeper, T.creeper], 1.1, T.creeperFace);
  creeperGeo = { skin: a.build(), head: h.build() };
  return creeperGeo;
}
function Creeper() {
  const geo = getCreeperGeo();
  const mat = getMaterials().opaque;
  const legs: [number, number, number][] = [[-0.13, 0.38, -0.2], [0.13, 0.38, -0.2], [-0.13, 0.38, 0.2], [0.13, 0.38, 0.2]];
  return (
    <group>
      {legs.map((lp, i) => (
        <group key={i} position={lp} userData={{ leg: i === 0 || i === 3 ? 1 : -1 }}>
          <mesh geometry={geo.skin} material={mat} position={[0, -0.19, i < 2 ? -0.02 : 0.02]} scale={[0.25, 0.38, 0.25]} />
        </group>
      ))}
      <mesh geometry={geo.skin} material={mat} position={[0, 0.92, 0]} scale={[0.5, 0.82, 0.27]} />
      <mesh geometry={geo.head} material={mat} position={[0, 1.58, 0]} scale={0.5} />
    </group>
  );
}
