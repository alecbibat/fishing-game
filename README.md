# 🎣 Driftwood Isles

*A cozy browser fishing adventure — Webfishing × Old School RuneScape × Stardew Valley.*

Stardew-style top-down pixel world (procedurally generated tiles + sprites, zero image
assets), OSRS-style interface, and rotatable 3D fish models in the dex and catch cards.

Explore a sprawling low-poly world, catch **1000 different fish**, chat with friends in
multiplayer lobbies with text floating over your head, bank your catch, brew potions from
fish, upgrade your rod at your own player-owned island, and chase transcendent sea-legends
that surface once in a blue moon carrying the rods of old heroes.

![genre](https://img.shields.io/badge/genre-cozy%20fishing%20MMO-46e0d0) ![style](https://img.shields.io/badge/style-2D%20pixel%20%2B%203D%20fish-8a6642)

---

## Quick start

```bash
npm install
npm start          # → http://localhost:3000
```

That's it. `npm start` runs a tiny Node server that serves the game **and** powers
multiplayer lobbies over WebSockets. Open the URL in any modern browser.

- **Single-player** also works from any static file host (GitHub Pages, itch.io, …) —
  just serve the `client/` directory. Multiplayer needs the Node server.
- Save data lives in your browser's localStorage (export/import from Settings).
- Works on phones too: a virtual joystick appears on touch screens, tap the
  water to cast, tap NPCs and doors to interact, pinch to zoom.

## How to play

| Input | Action |
|---|---|
| **WASD** / arrows / joystick | Walk (hold **Shift** to run) |
| Mouse wheel / pinch | Zoom |
| **Click/tap the water** | Cast at that spot (or hold **SPACE** to charge a cast) |
| **SPACE / click / tap** on the **!** | Hook the bite! |
| **SPACE / click / tap** at the right moment | Catch — tap when the marker crosses the golden zone |
| **E** / tap | Talk / interact |
| **Enter** | Chat (appears over your head) |
| **B F K J R P M I** | Backpack · Dex · Skill · Achievements · Rod · Potions · Map · Island |

Once a fish is hooked, a timing bar appears: a marker sweeps back and forth, and
you tap the moment it's inside the **golden zone**. Rarer fish need several
clean hits in a row — and the zone shrinks and the marker speeds up with each
one. Rod upgrades, bait, potions and abilities widen the zone, calm the marker,
or forgive a mistimed tap.

## What's in the world

- **16 zones**: Willowbrook town (with canals), meadow ponds, a river, a deep lake,
  the coast, Driftwood Docks, a swamp, a glacier lake, volcanic springs — plus secrets:
  the **Old Sewers** (find the grate behind the bakery), a **glowworm cavern**, and
  ferry trips to the coral reef, the open ocean, a rusty **oil rig**, and the
  **Abyssal Trench** (fishing level 70+).
- **1000 fish** across 7 rarity tiers (common → transcendent), each with flavor text,
  a procedurally-built 3D model, and dex records (times caught / longest / heaviest).
  Mythic+ fish glow with particle effects.
- **10 transcendent legends** — named world-boss fish (yes, including a legendary whale).
  Catch one and it surfaces holding a **hero's rod** with wild stats.
- **Fishing level 1–100** with 25 ability unlocks (sonar sense, double hook, cozy
  auto-reel mode, abyss license…), then **prestige to level 1000** — every level past
  100 keeps adding bite speed and rare luck.
- **Gear**: 12 craftable rod tiers, 26 buyable attachments (scopes, sonar pingers,
  magnets, dozing reels…), 14 baits, backpack upgrades, and a town bank vault.
- **Player-owned island**: anchor its portal at any of 8 spots via the Island Broker —
  your island's waters inherit the biome of wherever it's anchored. Build and upgrade a
  **Bait Farm**, **Workshop**, **Brewery**, and **Tide Shrine**.
- **Potions** brewed from the fish you catch, with cozy-witchy effects.
- **80 achievements** you turn in for coins and increasingly rare **titles** shown
  under your name.
- **16 townsfolk NPCs** who wander, gossip, hint at secrets, and run the shops.

## Multiplayer

Create a **public or private lobby** (code-based invites) with your own settings:
max players, message of the day, chat on/off, rare-catch announcements. Chat appears
over players' heads RuneScape-style. As host you can **mute, kick, or ban** anyone
from the lobby window (click the player-count pill).

## Project layout

```
client/            the game (plain ES modules, zero build step)
  index.html       shell + UI scaffolding
  styles.css       parchment/stone UI theme
  vendor/          three.js r185 (vendored — used for the 3D fish viewers)
  src/
    core/          state, save system, event bus, utils
    world/         procedural terrain math (heights, biomes, zones, paths)
    render2d/      Stardew-style renderer: tiles, pixel sprites, actors
    player/        movement, input
    fishing/       cast/bite/timing minigame, loot rolls
    npc/           wandering NPCs + dialogue
    ui/            HUD, windows, dex + catch-card 3D fish viewers, pixel icons
    net/           multiplayer client
    data/          gen-*.js — generated from content/ (do not edit by hand)
server/server.js   static file server + WebSocket lobby server (dep: ws)
content/           authored game content (JSON)
scripts/merge-content.js   content → client/src/data compiler
```

To tweak content (fish, achievements, NPCs, items, zone lore), edit the JSON in
`content/` and run `npm run merge`.

## Deploying

- **Anywhere Node runs** (Railway, Render, Fly.io, a VPS): `npm install && npm start`,
  expose `$PORT`. Full multiplayer.
- **Static hosting** (GitHub Pages): publish the `client/` folder. Single-player only —
  the multiplayer button will explain politely.
