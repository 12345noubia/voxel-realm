import { useEffect, useRef, useState } from "react";
import type { Engine } from "./engine";
import { B, I, COLS, ROWS, T, getAtlas, itemName, itemTile, maxStack } from "./blocks";
import { G, emit, useGame, addItem, countItem, removeItem, type Slot } from "./store";

export function requestLock() {
  const c = document.querySelector("canvas");
  try {
    const p = c?.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => document.dispatchEvent(new Event("pointerlockerror")));
  } catch {
    document.dispatchEvent(new Event("pointerlockerror"));
  }
}
export function closeUI(engine: Engine) {
  if (G.cursor) { addItem(G.cursor.id, G.cursor.count); G.cursor = null; }
  if (G.ui === "chest" && G.chestKey) engine.saveChest(G.chestKey);
  G.chestKey = null;
  G.ui = "paused";
  emit();
  requestLock();
}

function Icon({ tile, size = 32 }: { tile: number; size?: number }) {
  const c = tile % COLS, r = Math.floor(tile / COLS);
  return (
    <div
      className="pixel"
      style={{
        width: size, height: size, backgroundImage: `url(${getAtlas().url})`,
        backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
        backgroundPosition: `${(c / (COLS - 1)) * 100}% ${(r / (ROWS - 1)) * 100}%`,
      }}
    />
  );
}
function SlotView({ s, active, onClick }: { s: Slot; active?: boolean; onClick?: () => void }) {
  return (
    <div className={`mc-slot ${active ? "mc-slot-active" : ""}`} onMouseDown={(e) => { e.stopPropagation(); onClick?.(); }} title={s ? itemName(s.id) : ""}>
      {s && <Icon tile={itemTile(s.id)} />}
      {s && s.count > 1 && <span className="mc-count">{s.count}</span>}
    </div>
  );
}
function clickSlot(arr: Slot[], i: number) {
  const s = arr[i] ?? null, c = G.cursor;
  if (c && s && c.id === s.id) {
    const add = Math.min(maxStack(s.id) - s.count, c.count);
    s.count += add; c.count -= add;
    if (c.count <= 0) G.cursor = null;
  } else { arr[i] = c; G.cursor = s; }
  emit();
}

const RECIPES: { out: [number, number]; need: [number, number][]; basic?: boolean }[] = [
  { out: [B.PLANKS, 4], need: [[B.LOG, 1]], basic: true },
  { out: [B.CRAFT, 1], need: [[B.PLANKS, 4]], basic: true },
  { out: [B.CHEST, 1], need: [[B.PLANKS, 8]] },
  { out: [B.BED, 1], need: [[B.PLANKS, 3], [B.LEAVES, 3]] },
  { out: [B.BRICKS, 4], need: [[B.COBBLE, 4]] },
  { out: [B.GLASS, 2], need: [[B.SAND, 2]] },
  { out: [I.SWORD, 1], need: [[B.COBBLE, 2], [B.PLANKS, 1]] },
  { out: [I.PICK, 1], need: [[B.COBBLE, 3], [B.PLANKS, 2]] },
  { out: [I.BREAD, 1], need: [[I.APPLE, 2]] },
  { out: [B.TORCH, 4], need: [[B.PLANKS, 1]], basic: true },
  { out: [B.FENCE, 3], need: [[B.PLANKS, 4]] },
  { out: [B.LADDER, 3], need: [[B.PLANKS, 3]] },
];
function Crafting({ table }: { table: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="mc-label">{table ? "Crafting Table" : "Crafting (use a table for more)"}</div>
      {RECIPES.filter((r) => table || r.basic).map((r, i) => {
        const ok = r.need.every(([id, n]) => countItem(id) >= n);
        return (
          <button key={i} disabled={!ok} className="mc-recipe" onMouseDown={(e) => {
            e.stopPropagation();
            if (!ok) return;
            r.need.forEach(([id, n]) => removeItem(id, n));
            addItem(r.out[0], r.out[1]);
            emit();
          }}>
            <Icon tile={itemTile(r.out[0])} size={24} />
            <span>{r.out[1]}× {itemName(r.out[0])}</span>
            <span className="ml-auto opacity-70">{r.need.map(([id, n]) => `${n} ${itemName(id)}`).join(" + ")}</span>
          </button>
        );
      })}
    </div>
  );
}
function InvGrid() {
  return (
    <>
      <div className="grid grid-cols-9 gap-0.5">{G.inv.slice(9).map((s, i) => <SlotView key={i} s={s} onClick={() => clickSlot(G.inv, i + 9)} />)}</div>
      <div className="mt-2 grid grid-cols-9 gap-0.5">{G.inv.slice(0, 9).map((s, i) => <SlotView key={i} s={s} onClick={() => clickSlot(G.inv, i)} />)}</div>
    </>
  );
}

function Bars({ hp, hunger }: { hp: number; hunger: number }) {
  return (
    <div className="flex w-[420px] justify-between">
      <div className="flex">{Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="relative"><Icon tile={T.heartEmpty} size={18} />
          {hp >= i * 2 + 1 && <div className="absolute inset-0 overflow-hidden" style={{ width: hp >= i * 2 + 2 ? 18 : 9 }}><Icon tile={T.heart} size={18} /></div>}
        </div>))}</div>
      <div className="flex flex-row-reverse">{Array.from({ length: 10 }, (_, i) => <Icon key={i} tile={hunger >= i * 2 + 1 ? T.food : T.foodEmpty} size={18} />)}</div>
    </div>
  );
}

function Chat({ engine, open }: { engine: Engine; open: boolean }) {
  const [, tick] = useState(0);
  const [text, setText] = useState("");
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const now = performance.now();
  const msgs = G.chat.filter((m) => open || now - m.t < 10000).slice(-9);
  return (
    <div className="absolute bottom-28 left-3 w-[420px] max-w-[90vw]">
      {msgs.map((m, i) => (
        <div key={i} className={`mc-chatline ${m.sys ? "mc-chat-sys" : ""}`}>{m.sys || !m.name ? m.text : <><b>&lt;{m.name}&gt;</b> {m.text}</>}</div>
      ))}
      {open && (
        <input autoFocus className="mc-input mt-1 w-full" placeholder="Say something… (Enter to send, Esc to close)" value={text} maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { engine.sendChat(text); setText(""); G.ui = "paused"; emit(); requestLock(); }
            if (e.key === "Escape") { setText(""); G.ui = "paused"; emit(); requestLock(); }
          }} />
      )}
    </div>
  );
}

function Menu({ onJoin }: { onJoin: (n: string, r: string) => void }) {
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  useEffect(() => {
    setName(`Steve${Math.floor(Math.random() * 900 + 100)}`);
    const q = new URL(window.location.href).searchParams.get("room");
    setRoom((q ?? Math.random().toString(36).slice(2, 6)).toUpperCase());
  }, []);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-overlay">
      <div className="mc-panel w-[440px] max-w-[94vw] p-6">
        <h1 className="mc-title">BLOCKFRONT</h1>
        <p className="mb-4 text-center text-lg">Voxel survival · PvP · up to 5 friends per world</p>
        <label className="mc-label">Your name</label>
        <input className="mc-input mb-3 w-full" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
        <label className="mc-label">World code (share it to play together)</label>
        <input className="mc-input mb-4 w-full uppercase" value={room} maxLength={8} onChange={(e) => setRoom(e.target.value.toUpperCase())} />
        <button className="mc-btn w-full" disabled={!name.trim() || !room.trim()} onClick={() => onJoin(name.trim(), room.trim())}>Join World</button>
        <div className="mt-4 grid grid-cols-2 gap-x-4 text-base leading-tight opacity-90">
          <span>WASD move · Space jump</span><span>Shift sprint · Mouse look</span>
          <span>Left click mine / attack</span><span>Right click place / use</span>
          <span>1–9 / wheel hotbar</span><span>E inventory · T chat</span>
          <span>Right click bed at night</span><span>Chests & crafting tables</span>
        </div>
      </div>
    </div>
  );
}

export function Hud({ engine, onJoin }: { engine: Engine; onJoin: (n: string, r: string) => void }) {
  const st = useGame();
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const hurt = useRef(0);
  hurt.current = st.hurtAt;
  const recentHurt = performance.now() - st.hurtAt < 350;
  if (st.ui === "menu") return <Menu onJoin={onJoin} />;
  const invOpen = st.ui === "inventory" || st.ui === "chest" || st.ui === "craft";
  const chest = st.chestKey ? engine.world.chests.get(st.chestKey) : undefined;
  return (
    <div className="pointer-events-none absolute inset-0 mc-font" onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}>
      {st.underwater && <div className="absolute inset-0 bg-water-tint" />}
      {recentHurt && <div className="absolute inset-0 mc-hurt" />}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl leading-none mc-shadow">+</div>
      <div className="absolute left-3 top-3 mc-shadow text-lg leading-tight">
        <div>World <b>{st.room}</b> · <span className={st.status === "online" ? "text-online" : "text-destructive"}>{st.status}</span></div>
        <div>{st.clock} · ⚔ {st.kills} · ☠ {st.deaths}</div>
      </div>
      <div className="absolute right-3 top-3 mc-panel-dark px-3 py-2 text-lg leading-tight">
        <div className="mc-label-light">Players ({st.roster.length || 1})</div>
        <div>{st.name} (you)</div>
        {st.roster.filter((p) => p.id !== engine.id).map((p) => <div key={p.id}>{p.name}</div>)}
      </div>
      {st.toast && performance.now() - st.toastAt < 2500 && <div className="absolute left-1/2 top-[60%] -translate-x-1/2 mc-shadow text-xl">{st.toast}</div>}
      <Chat engine={engine} open={st.ui === "chat"} />
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
        <div className="mc-shadow text-lg">{st.inv[st.sel] ? itemName(st.inv[st.sel]!.id) : ""}</div>
        <Bars hp={st.hp} hunger={st.hunger} />
        <div className="mc-hotbar flex">{st.inv.slice(0, 9).map((s, i) => <SlotView key={i} s={s} active={i === st.sel} />)}</div>
      </div>
      {st.ui === "paused" && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-overlay" onClick={() => requestLock()}>
          <div className="mc-panel p-6 text-center"><h2 className="mc-title text-3xl">Paused</h2><p className="text-xl">Click to play</p></div>
        </div>
      )}
      {st.ui === "dead" && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-4 bg-death">
          <h2 className="mc-title text-5xl">You died!</h2>
          <p className="text-xl mc-shadow">{st.killedBy ? `Slain by ${st.killedBy} — your loot was dropped` : "Your items were dropped where you fell"}</p>
          <button className="mc-btn" onClick={() => { engine.respawn(); requestLock(); }}>Respawn</button>
        </div>
      )}
      {invOpen && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-overlay" onMouseDown={() => closeUI(engine)}>
          <div className="mc-panel flex flex-wrap gap-6 p-4" onMouseDown={(e) => e.stopPropagation()}>
            <div>
              {st.ui === "chest" && chest && (
                <>
                  <div className="mc-label">Chest</div>
                  <div className="mb-3 grid grid-cols-9 gap-0.5">{chest.map((s, i) => <SlotView key={i} s={s} onClick={() => { clickSlot(chest, i); engine.saveChest(st.chestKey!); }} />)}</div>
                </>
              )}
              <div className="mc-label">Inventory</div>
              <InvGrid />
            </div>
            {st.ui !== "chest" && <div className="w-[330px]"><Crafting table={st.ui === "craft"} /></div>}
          </div>
          {st.cursor && <div className="fixed pointer-events-none" style={{ left: mouse.x - 16, top: mouse.y - 16 }}><Icon tile={itemTile(st.cursor.id)} /></div>}
        </div>
      )}
    </div>
  );
}
