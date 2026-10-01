<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Game architecture
- Game code lives in src/game: World (voxel data + chunk meshing), Engine (non-React simulation + net handlers), Scene (R3F), Hud (DOM), store (mutable HUD state + emit). Why: per-frame state stays out of React.
- Multiplayer is client-authoritative Lovable Cloud realtime broadcast, one channel per world code, 8 Hz state tick. Why: no game server; respects realtime message budget.
- World generation is deterministic so all clients share terrain; only edits are synced. Why: tiny payloads.
