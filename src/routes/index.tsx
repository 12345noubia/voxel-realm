import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const Game = lazy(() => import("@/game/Game"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Blockfront — Voxel Survival PvP" },
      { name: "description", content: "Multiplayer voxel survival: mine, build, fight friends and steal their loot in a blocky 3D world." },
      { property: "og:title", content: "Blockfront — Voxel Survival PvP" },
      { property: "og:description", content: "Mine, build and battle friends in a multiplayer voxel world with day/night, villagers and an underwater base." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <Game />
      </Suspense>
    </ClientOnly>
  ),
});

function Loading() {
  return <div className="flex min-h-screen items-center justify-center bg-background text-2xl text-foreground mc-font">Generating world…</div>;
}
