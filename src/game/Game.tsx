import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { supabase } from "@/integrations/supabase/client";
import { Engine } from "./engine";
import { GameScene } from "./Scene";
import { Hud, closeUI, requestLock } from "./Hud";
import { G, emit } from "./store";

export default function Game() {
  const [engine] = useState(() => new Engine());
  const [room, setRoom] = useState("");

  useEffect(() => {
    if (!room) return;
    const ch = supabase.channel(`mc:${room}`, { config: { broadcast: { self: false }, presence: { key: engine.id } } });
    ch.on("broadcast", { event: "state" }, ({ payload }) => {
      if (payload.id !== engine.id) engine.onState(payload);
    })
      .on("broadcast", { event: "ev" }, ({ payload }) => engine.onEvent(payload))
      .on("presence", { event: "sync" }, () => {
        engine.onRoster(Object.entries(ch.presenceState<{ name: string }>()).map(([id, m]) => ({ id, name: m[0]?.name ?? "player" })));
      })
      .subscribe((st) => {
        console.log("[net] channel:", st);
        if (st === "SUBSCRIBED") {
          engine.channel = ch;
          void ch.track({ name: G.name });
          G.status = "online";
        } else if (st !== "CLOSED") G.status = "offline";
        emit();
      });
    return () => {
      engine.channel = null;
      void supabase.removeChannel(ch);
    };
  }, [room, engine]);

  useEffect(() => {
    const locked = () => !!document.pointerLockElement;
    const kd = (e: KeyboardEvent) => {
      if (G.ui === "chat" || G.ui === "menu") return;
      if (G.ui === "play") {
        engine.keys.add(e.code);
        if (e.code.startsWith("Digit")) {
          const n = Number(e.code.slice(5));
          if (n >= 1 && n <= 9) { G.sel = n - 1; emit(); }
        }
        if (e.code === "KeyE") engine.openUI("inventory");
        if (e.code === "KeyT" || e.code === "Enter") { e.preventDefault(); engine.openUI("chat"); }
        if (e.code === "Space") e.preventDefault();
      } else if ((G.ui === "inventory" || G.ui === "chest" || G.ui === "craft") && (e.code === "KeyE" || e.code === "Escape")) {
        closeUI(engine);
      }
    };
    const ku = (e: KeyboardEvent) => engine.keys.delete(e.code);
    const md = (e: MouseEvent) => {
      if (G.ui !== "play") return;
      if (e.button === 0) engine.primaryDown();
      if (e.button === 2) engine.use();
    };
    const mu = (e: MouseEvent) => { if (e.button === 0) engine.mining = false; };
    const mm = (e: MouseEvent) => {
      if (G.ui !== "play" || (!locked() && !noLock)) return;
      engine.yaw -= e.movementX * 0.0022;
      engine.pitch = Math.max(-1.55, Math.min(1.55, engine.pitch - e.movementY * 0.0022));
    };
    const wh = (e: WheelEvent) => {
      if (G.ui !== "play") return;
      G.sel = (G.sel + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
      emit();
    };
    let noLock = false;
    const plc = () => {
      if (locked() && G.ui === "paused") G.ui = "play";
      else if (!locked() && G.ui === "play" && !noLock) G.ui = "paused";
      emit();
    };
    const ple = () => { noLock = true; if (G.ui === "paused") { G.ui = "play"; emit(); } };
    const cm = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("mousemove", mm);
    window.addEventListener("wheel", wh);
    window.addEventListener("contextmenu", cm);
    document.addEventListener("pointerlockchange", plc);
    document.addEventListener("pointerlockerror", ple);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("wheel", wh);
      window.removeEventListener("contextmenu", cm);
      document.removeEventListener("pointerlockchange", plc);
      document.removeEventListener("pointerlockerror", ple);
    };
  }, [engine]);

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-background">
      <Canvas camera={{ fov: 75, near: 0.05, far: 600 }} dpr={[1, 1.5]} gl={{ antialias: false }}>
        <GameScene engine={engine} />
      </Canvas>
      <Hud
        engine={engine}
        onJoin={(name, code) => {
          G.name = name;
          G.room = code;
          const url = new URL(window.location.href);
          url.searchParams.set("room", code);
          window.history.replaceState(null, "", url);
          G.ui = "paused";
          setRoom(code);
          emit();
          requestLock();
        }}
      />
    </div>
  );
}
