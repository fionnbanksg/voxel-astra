# Voxel Wilds

Version 1.8.2 — smoother remote players: position, yaw and head pitch share a 100 ms interpolation buffer with shortest-arc turns and teleport/respawn resets. Keeps the 1.8.1 connection fixes: shared simulation continues through host menus/death, upload bursts are paced, and disconnect reasons stay visible. Includes first-person hands and held blocks, synchronized player swings/look poses, voxel-colliding ragdoll deaths and an underground rapid-mining mesh fix. This is the same solo/multiplayer game, with normal one-metre blocks and all previous systems retained. Full replacement source; restart the Node server and refresh all clients after updating. See [MULTIPLAYER.md](MULTIPLAYER.md).

A playable Minecraft-style voxel vertical slice in vanilla JavaScript and Three.js r180 (WebGL2). All rendering, collision, world generation, AI, and meshing code is local. Solo requires no external game engine, backend, account integration, or runtime JavaScript CDN. Multiplayer optionally uses the included Node WebSocket relay. The optional Google Fonts stylesheet has system-font fallbacks.

## Project structure

```text
voxel-wilds/
├── package.json                  # Native ES modules; test and local-server commands
├── README.md                     # This implementation guide
├── MULTIPLAYER.md                # Local, LAN and internet multiplayer setup
├── package-lock.json             # Pinned ws server dependency
├── server/index.js               # HTTP(S) static server + room WebSocket relay
├── dist/                         # Deployable static application
│   ├── index.html
│   ├── style.css
│   ├── favicon.svg
│   ├── voxel-wilds-source.zip     # Downloadable source, excluding itself
│   ├── vendor/three/             # Pinned Three.js r180 + MIT license
│   │   ├── three.module.js
│   │   ├── three.core.js
│   │   └── LICENSE
│   └── src/
│       ├── main.js               # Composition, controls, fixed-step loop
│       ├── held-items.js         # Atlas items, first-person arm and camera sway
│       ├── character-motion.js   # Shared action clocks and limb poses
│       ├── ragdolls.js           # Pooled joint solver, voxel contact and snapshots
│       ├── network/
│       │   ├── interpolation.js  # Bounded visual pose history, yaw/pitch interpolation
│       │   ├── protocol.js       # Versioned messages, validation, invite URLs
│       │   └── multiplayer.js    # Optional host/guest client and interpolation
│       ├── tnt.js                # Pooled primed TNT, fuse animation, explosions and sound
│       ├── blast.js              # Resistance-aware blast rays and placement patterns
│       ├── water-view.js         # Refraction render targets and per-pixel waterline
│       ├── lighting.js           # Moving local light volume and worker lifecycle
│       ├── block-light.js        # Bounded colored light propagation
│       ├── renderer.js           # WebGL2, atlas, fog, sky, water shader
│       ├── textures.js           # Original pixel palettes, material patterns and log caps
│       ├── blocks.js             # Stable IDs, names, shared constants
│       ├── noise.js              # Seeded gradient noise and fBm
│       ├── scale.js              # Normal 1 m blocks and shared actor dimensions
│       ├── caves.js              # Region tunnel graph, rooms and entrance ramps
│       ├── world-options.js      # Six presets, bounded options and text seed hashing
│       ├── weather.js            # Pooled snowflakes, exposed-roof checks, dusting
│       ├── lava.js               # Slow lava flow, falling and water reactions
│       ├── character-models.js   # Detailed instanced creature/character parts
│       ├── terrain.js            # Biomes, caves, resources, cross-chunk trees
│       ├── chunk.js              # Section geometry lifecycle and GPU uploads
│       ├── world.js              # Streaming, worker scheduling, voxel edits
│       ├── mesh.js               # Exposed-face meshing and corner AO
│       ├── workers/
│       │   ├── light-worker.js   # Asynchronous colored voxel light flooding
│       │   └── chunk-worker.js   # Worker-local generation/mesh execution
│       ├── physics.js            # AABB collision, player motion, swimming
│       ├── raycast.js            # Amanatides–Woo voxel traversal
│       ├── fluids.js             # Scheduled natural/source/flowing water
│       ├── water-mesh.js         # Level-aware corner heights and flow vectors
│       ├── shaders/
│       │   ├── block-light.js   # Shared 3D light-volume sampling
│       │   ├── atmosphere.js    # Shared atmosphere, cloud noise, fog
│       │   ├── sky.js           # Sun, moon, stars and procedural clouds
│       │   ├── terrain.js       # Dynamic sun, sky ambient and leaf cutouts
│       │   ├── water.js         # Flowing ripples and Fresnel sky reflection
│       │   ├── snow.js          # Soft depth-tested snowflake point sprites
│       │   └── effects.js       # Emissive lava/portal shaders
│       ├── entities.js           # Pooled actors, steering, instanced models
│       ├── companion.js          # Pip's follow/stay/mine/path commands
│       ├── portals.js            # Obsidian frame validation and travel
│       ├── combat.js             # Ray/AABB hit detection and attacks
│       └── ui.js                 # Inventory, health, feedback
└── tests/
    ├── animation-ragdoll.test.js # Hand atlas/poses, ragdoll physics and mesh collision gates
    ├── multiplayer.test.js      # Real sockets, game clients, rooms, TNT, PvP and resets
    ├── aquifer-textures.test.js  # Flooded cave generation and upright texture mapping
    ├── playground.test.js       # Flight easing, TNT lifecycle, blast and water-mask data
    ├── lighting.test.js        # Falloff, walls, moving sources and torch geometry
    ├── dog-caves-scale.test.js   # Guard combat, walls, cave clearance and scale
    ├── expansion.test.js        # Presets, creative, lava, snow and model limits
    ├── core.test.js              # Terrain, AO, physics, DDA, fluids, combat
    ├── water-regression.test.js # Lake holes, dams, levels, falls, source renewal
    ├── visual-data.test.js      # Cutouts, mesh attributes, nearby biome variety
    ├── world.test.js             # Real worker streaming/edit/dimension test
    └── worker-adapter.js         # Runs browser worker code in Node worker_threads
```

## Run

For multiplayer, install Node.js 22 or newer, then run in this folder:

```sh
npm ci
npm run server
```

Open the address printed by the server. **Multiplayer → Host current world** turns your current session into a room. The same server also supports ordinary solo play. Read [MULTIPLAYER.md](MULTIPLAYER.md) before sharing a LAN or internet invite.

The original solo-only command still works with Python 3 and needs no npm installation:

```sh
python3 -m http.server 8080 --directory dist
# Or: npm start
```

Use a different port if both servers are running. `npm ci` followed by `npm test` runs all checks, including the new WebSocket tests. There is no compilation step. Opening index.html as a `file://` URL will not work because module workers require HTTP(S). WebGL2 and hardware acceleration are required. Desktop keyboard/mouse is the primary input; touch controls remain available.

## Controls and first loop

Click **Enter the wilds**, use WASD and mouse to move/look, Space to jump or swim up, and Shift to sprint. Hold left click to mine; left click also attacks a creature within four metres when unobstructed. Right click places the selected block. Use 1–9 or the wheel to select. Escape opens the menu and releases the mouse (solo pauses; multiplayer continues); F3 displays measured FPS, draw calls, triangles, chunk count, and worker count.

Press C to summon **Pip** and issue follow, stay, mine-the-target, or build-a-five-metre-path commands. A small unlit obsidian frame is near spawn. Aim at its frame and press F, then stand in the portal for one second. You can also build your own complete 4-wide × 5-high frame, including corners, with a clear 2 × 3 opening. The Nether has lava, crimson/warped vegetation, hostile ember creatures, a ceiling, and dark fog. A return portal and landing platform are prepared at the destination.

The pause menu includes view distance (4–10 chunks), return to spawn, and a source download. View distance defaults to **8 chunks**.

## Hands, animation, ragdolls and rapid mining (1.8)

**First person:** a blocky sleeve, hand and the selected textured block are visible in the lower-right view. Mining, melee, placement and ignition animate the arm; movement adds a small bob, turning adds damped sway, and changing hotbar items briefly lowers the hand. The viewmodel renders in its own layer after opaque terrain, preserving depth for water compositing and the existing partial underwater mask. Atlas faces include correct log ends, grass sides and TNT caps. Placed/held-light shading is reused.

**Multiplayer poses:** remote players hold their selected block, swing their arm for attacks/mining/placement, turn their head with camera pitch, and flash on damage. Action sequence numbers plus bounded action age avoid restarting an animation every time a position snapshot arrives. Player skins are derived consistently from the connection ID. These actions supplement the existing walking and mob attack animations. No new tools or finite inventory are introduced; the selected block is the held item.

**Ragdolls:** players, rivals, ember creatures, sheep and Pip become articulated blocky bodies on death. Eleven Verlet nodes, a braced torso and distance constraints create a neck, shoulders and hips; limbs remain rigid rather than having individual elbow/knee joints. Small sphere/voxel contacts, gravity, damping and explosion impulses determine the fall. This is a lightweight position-based ragdoll, not a full rigid-body engine: parts may slightly intersect complex corners and there is no corpse-to-corpse collision. Sixteen bodies are pooled, retained for nine seconds, then shrink away. Their geometry is instanced in one batch. Bodies do not block players and cannot be looted.

The host simulates ragdolls at 120 Hz and sends their joint positions with the 10 Hz simulation frame. Guests interpolate those exact poses, including on late join. Life counters prevent stale healthy poses from reviving a dead model, duplicate death bodies, and old-life damage hitting a respawned player. A short third-person death view lets the victim watch their own ragdoll; body simulation continues while the host's death dialog is shown. Regeneration and dimension travel clear corpses.

**Rapid mining fix:** voxel collision used to open immediately while exposed faces were still being built by a worker. Fast movement could enter old, internally culled geometry and see the sky through it. Newly opened cells now keep a collision barrier until their own and face-neighbor sections have uploaded the required geometry revisions. Existing empty space remains traversable. Section-specific revisions let a useful mesh finish even if a different height section changes, and neighbor AO/face invalidations reject obsolete results. Stale results from an unloaded/recreated chunk are rejected by chunk identity. There can be a brief wait before stepping into a freshly mined hole while its faces finish; this favors closed, correct terrain over entering a rendering gap. All generation and face meshing still run in workers.

**Verification:** four new physics/render-data/mesh tests and a real-socket multiplayer regression cover floor/wall contact, attached limbs, pooling/expiry, late joins, held items, swings, death deduplication, life-aware respawn and section-boundary collision gates. Eleven shader programs compile/link in a native GLES 3 context, including the new textured hand material. Interactive browser visual QA and a multiplayer FPS benchmark have not been performed here.

## Flooded caves and block textures (1.6)

**Fixed:** the generator previously carved underground space to air, then only filled water above the surface heightmap. Roofed caves under oceans therefore started dry, and ordinary seven-block surface flow could not fill their whole volume. Overworld cave space at or below the selected sea level now generates water sources immediately, independently of chunk arrival order. Higher caves remain dry. This also creates flooded deep inland caves: a shared sea-level groundwater table is the explicit generation assumption, rather than Minecraft's more complex regional aquifers. Existing surface-flow rules still govern subsequent block edits; this is not a pressure-fluid solver. Volcanic and Nether liquid generation are unchanged. Reloading starts a new world with the corrected generation.

**Textures:** material-specific 16×16 pixel patterns replace per-pixel brightness noise: clustered stone and dirt, fine sand, grass fringes, vertical bark, distinct log-end rings, staggered oak planks and bricks, grouped copper flecks, and cutout foliage. Texture UV axes are corrected on +X and −Z walls so rims and grain stay upright. Biome-tinted grass/leaves have green inventory previews. Atlas dimensions and nearest-neighbor filtering are retained, as are leaf cutouts. All pixel art is original. The lava shader, water shader and lighting settings are unchanged in this release.

## Waterline and explosion polish (1.5.1)

The partial underwater mask now uses the same triangle split and displaced corner positions as the visible water mesh. This removes the mismatch produced by bilinear interpolation on sloping streams. Heights are still quantized to roughly 4 mm in the small near-camera texture.

TNT smoke and debris interpolate between physics ticks; recycled particles reset their previous position to avoid streaking from old explosions. Up to four pooled warm flash lights briefly illuminate terrain, water and characters over a 10-block radius. These short-lived lights are unshadowed, so they can illuminate through thin walls; placed torch/lava light retains its voxel occlusion. Blast lighting clears on dimension changes and fades after 0.38 seconds. Camera shake clears when paused. Terrain edit preparation now also stops after roughly 2.5 ms per frame, in addition to the 120-block cap, to bound work during dense chains.

## Flight, water and TNT playground (1.5)

**Controls:** select Creative in World options; G toggles flight, WASD steers, Space rises, Ctrl descends and Shift boosts. Flight now accelerates toward a target velocity, eases through turns and brakes after release. Diagonal ascent is normalized. Adjust base speed from 4–24 m/s and choose Responsive, Balanced or Floaty handling in World options. Walking and swimming also ease their horizontal velocity; creature positions interpolate between fixed ticks. Small step-ups ease the camera vertically. Boost adds a small eased FOV change. Chunk geometry uploads are capped at four sections and roughly three milliseconds of preparation per frame; obsolete revisions are rejected.

**Water:** a separate opaque color/depth target supplies screen-space refraction. Animated normals, Fresnel sky reflections, a sharper sun glint, depth-dependent color absorption and subtle shallow-water foam replace flat transparency. The nearest water surface writes depth in a separate composite target. Tone mapping happens once in the final pass. The blue overlay and global underwater fog switch are removed: each pixel checks its own near-plane position against the actual local fluid corner heights, so a camera crossing the surface can show wet and dry portions simultaneously. A tiny 4³ texture updates every frame for the waterline; coarse depth integration uses water occupancy in the asynchronous 64³ lighting volume.

**TNT:** E includes TNT; right-click places an unlit solid block. Aim at it and press F to prime it. T opens the TNT playground; it is also available in the pause menu and touch controls. Original atlas art gives TNT red bundled stripes, a white TNT label, and a fuse on top. Primed TNT pops upward, falls, bounces, emits fuse smoke, flashes progressively faster, swells just before detonation, and then produces an explosion with block debris, smoke, a flash, distance-attenuated sound and optional camera shake. Blast rays lose energy through resistant material; bedrock, obsidian and liquid barriers survive. A submerged blast suppresses terrain destruction. Exposed nearby actors take damage and knockback; Creative players remain invulnerable. Chain reactions prime neighboring TNT with a short randomized fuse.

The playground sets fuse length (1–10 seconds), blast power (2–8; default 4), chain reactions, creature/player damage, camera shake and volume. It can equip TNT, place 1–64 charges in a line/ring/cube/tower at the aimed face, light the aimed charge, light unlit charges within 32 blocks, or defuse active charges. Placement respects loaded terrain and actor AABBs. Solo menus pause fuses; multiplayer menus and host death do not pause the shared world. Current settings are captured when a charge is primed. Effects use pools of 64 charges and 640 particles; blasts apply at most one ray-cast explosion and 120 voxel changes per rendered frame. Regeneration and dimension travel cancel active charges and pending effects.

**Assumptions and limits:** TNT is an original Minecraft-inspired implementation, with no copied assets or exact blast-parity claim. No redstone, fire spread, TNT drops, blast undo, or persistent armed charges. Unlit TNT survives chunk reloads and dimension travel as a normal voxel edit. Defusing removes primed charges; it does not restore terrain already destroyed. Large chains may queue, and craters become visible as worker meshes arrive. Particles use bounded pools, so dense chains recycle older debris. Reflections show the procedural sky rather than mirrored terrain; refraction sees only geometry already visible in the opaque target. Underwater distance is approximated with 24 samples over at most 24 m and the lighting worker cadence, while the immediate waterline updates every frame. Far-edge fluid surfaces and transparent overlap are approximations. Native shader compilation and logic checks do not establish browser visual quality or a measured 60 fps result.

## Dynamic local lighting (1.4)

Press **E**, choose **Torch**, then carry it in the selected slot or right-click to place it. Torches emit warm amber light, all lava states emit orange light, and portals emit violet light. Removing a torch/source clears its illumination. A carried torch moves the light source with the camera. Water and lava can wash away torches. Torches are non-colliding, narrow upright models with animated emissive tips; wall-mounted orientation and support removal are not simulated.

A separate Web Worker rebuilds a 64 × 64 × 64 local colored light volume around the camera. Three bounded breadth-first floods propagate source intensity through open cells, attenuate with distance, and stop at opaque blocks. Doorways let light spread into the next space. Leaves pass light; solid walls stop the flood. The volume refreshes on edits, chunk loads, camera movement and held-torch changes, at most ten times per second. Worker results carry the world epoch, preventing old-dimension illumination from reappearing after travel or regeneration.

The main thread copies contiguous voxel rows from loaded chunks; unloaded regions block propagation. The worker transfers a 1 MiB RGBA field back to a fixed-size WebGL2 3D texture. Terrain, foliage, water and instanced creature shaders sample that same volume. Adding/removing lights does not remesh chunks, add per-source draw calls, or create a point-light object per lava block. Surface sampling is shifted into open space; trilinear filtering softens transitions. Torchlight has subtle shader flicker.

**Limits:** illumination is local to that moving volume and fades at its boundary, so distant sources remain visibly emissive without lighting their surroundings until approached. Sources reach 12–15 cells through Manhattan-distance propagation. This is colored voxel lighting, not ray-traced global illumination or geometric point-light shadow maps; interpolation can soften/leak slightly across thin boundaries. Characters receive local light but do not cast moving shadows. Direct sunlight still uses the earlier skylight/AO approximation. Camera-carried lighting updates at voxel granularity and worker cadence. Browser visual and target-hardware FPS testing remain unperformed.

## Guard dog, caves, and restored block size (1.3.1)

**Pip now defends you automatically.** He appears near the starting player, follows by default, and selects nearby visible rivals/ember creatures. He approaches and bites for 5 damage on a 0.65-second cooldown. His sight and bite checks reject walls. Enemies bitten by Pip may turn to attack him. Guarding temporarily interrupts his current command and resumes it after the threat passes. Stay mode guards a smaller area around his waiting position. Pip has 24 health, slowly heals outside combat, and returns near you after defeat when a safe location is available. He catches up to a distant player at a checked, loaded, solid-ground location. The HUD shows his health and defending/waiting status. His dog model has four animated legs, upright ears, a muzzle, nose, eyes, collar, paws and a wagging tail. The existing dig/path commands remain available through C. Local steering may still need help with complex obstacles; this is not full A* navigation.

**Caves are connected passages with actual surface entrances.** A deterministic graph joins underground chambers with capsule-shaped tunnels. Sloping branches intersect dry land surfaces, and the default world has an entrance near `(43, -32)` in X/Z, west of the starting point. Main tunnels are 7 blocks across (7 m); chambers are wider. Tests sample full player-AABB clearance along the starter entrance ramp. The cave toggle disables the Overworld tunnel graph, including the starter entrance. Nether terrain retains its separate cave/noise generation. Passages below sea level generate filled with water; entrances are omitted at submerged anchor locations. Caves do not add loot, torches or new structures.

**Original block scale is restored.** Blocks are again 1 × 1 × 1 m. Player height, eye height, collision width, movement, reach and character models use the original proportions. Trees, terrain heights, sea levels, 128-block vertical chunks, one-block step-up and 4 × 5 portal frames are restored. Radius 8 again spans about 128 m horizontally. Pip's new dog model and guard behavior remain, as do the connected cave graph and surface entrances. The cave tunnel radius and depth are adjusted to the restored terrain.

## World options, creative mode, weather, and characters (1.2, retained)

Open **World options** on the welcome screen, or **World & game options** in the pause menu. Mode and weather apply immediately; terrain options apply when you press **Generate this world**.

| Preset | Landscape |
| --- | --- |
| Wilds | Mixed forests, mountains, rivers, coasts and deserts |
| Alpine | Snow-covered highlands and conifer forests |
| Islands | Small green landmasses surrounded by ocean |
| Dunes | Dry sandy hills with no trees by default |
| Volcanic | Netherrack peaks, lava basins and crimson vegetation |
| Flat | Level grass for building, no trees or caves by default |

Seed, terrain relief, sea/lava level, tree density, and cave carving are adjustable. Flat intentionally stays level when relief changes; its height follows sea level plus four blocks. Presets are deterministic for the same seed and settings. **Regeneration removes all session builds and simulated edits in both dimensions**, cancels old worker results using epochs, disposes geometry, resets creatures/companion jobs/fluids/portals/weather, and prepares a safe new spawn. Mode, weather choice, hotbar selection and view distance are retained. There is no undo or durable save.

**Creative:** selecting Creative starts flight. G toggles flying/walking; WASD moves, Space rises, Ctrl descends, and Shift doubles the selected flight speed (default 12 or 24 metres/second). Flight still collides with solid blocks and unloaded columns; it is not noclip. Flight height is capped at 180 blocks, above the 128-block terrain ceiling. Creative has instant-style mining (0.06 s), unlimited material selection, no damage, and non-aggressive rivals. Switching back to Survival restores gravity and damage. Touch controls include Fly and Down. E opens the material palette and replaces the currently selected hotbar slot; snow, snow dusting and lava sources are available in both modes.

**Snow:** Alpine terrain, taiga and high summits have snow surfaces; cold tree crowns receive a thin layer. Weather choices are Auto, Clear, Flurries and Snowstorm. Auto follows cold regions; manual snow works anywhere in the Overworld. Snow stops in the Nether. A fixed pool of 1,600 depth-tested point sprites drifts around the camera, with roof exposure checks and a soft snow shader. Storms gradually mute the sky and sun and shorten visibility. Exposed supported surfaces slowly receive one 1/8-block snow dusting during active play, including tree canopies. The dusting is non-colliding, mineable and replaceable by water/lava. Snow does not build unlimited stacks, melt, freeze water, or implement vanilla snow-layer collision. Clear weather stops snowfall but leaves deposited snow.

**Lava:** placed and naturally generated sources spread on scheduled 1.5-second updates in the Overworld, reaching three horizontal blocks. In the Nether, updates take 0.5 seconds and reach seven blocks. Downward flow has priority; falling lava restarts horizontal reach on landing. Removed sources drain their dependent flow. Sources never regenerate from neighbors. The nearest-drop search is two blocks in Overworld/four in Nether. Water beside or above a lava source makes obsidian; water touching a flowing lava cell makes stone, and lava falling onto water makes stone. This slice uses existing stone instead of adding cobblestone. Lava has level-dependent surface height, animated emissive color and survival damage. It does not spread fire, burn wood, support buckets, or replicate all Minecraft tick-order rules.

**Characters:** sheep have wool, ears, eyes, muzzles, tails and four animated legs. Pip is now a four-legged dog with a muzzle, ears, paws, a teal collar and a wagging tail. Rivals have varied skin/clothing, chest armor and a sword; ember creatures have horns and a glowing-colored chest seam. Models have pivoted arm/leg animation, idle breathing, blinking, nearby-player head tracking, attack swings and hit flashes. Up to 28 actors share one instanced unit-cube mesh, capped at 48 parts each. AI remains lightweight local steering. Snow and model visuals have shader/data verification, but have not received browser visual or target-hardware FPS testing.

## Explicit design assumptions

- **Hybrid survival sandbox:** health, combat, fall/lava damage, and respawn; unlimited building materials. No crafting/economy was needed for this core loop.
- **Chunk shape:** 16 × 16 × 128, split into eight 16-high mesh sections. Each block represents 1 m. Vertical range is finite; horizontal generation is demand-driven and practically limited by JavaScript/float precision at very large coordinates.
- **Block IDs:** stable byte values in `blocks.js`; air = 0. Water sources remain ID 7; IDs 32–38 encode horizontal levels 1–7 and ID 39 denotes falling water. Snow dusting uses ID 20; torch = 21; TNT = 22 (atlas tile 23 is its top); lava source = 11, flows = 40–46, falling = 47. Dense chunk storage uses `Uint8Array`, indexed `x + 16 * (z + 16 * y)`.
- **Noise:** deterministic seeded gradient/Perlin-family noise with fBm, the requested “simplex-noise or similar” option. Seed 73191 is the default. World options accept signed integer seeds or text, deterministically hashed to 32 bits.
- **Networking:** entirely single-player. AI-controlled rivals provide the requested single-player PvP analogue. There is no WebSocket or WebRTC stub pretending to be multiplayer.
- **Both AI meanings implemented:** scripted creature/rival behavior and a separate commandable companion. Pip is a deterministic game bot, not an LLM service.
- **Persistence:** changes survive chunk unloading and dimension travel for the running page. Reloading starts over. There is no durable save format implemented. A future versioned save should store seed, generator version, dimension, chunk coordinates, sparse ID edits, and fluid source records.
- **Portal scaling:** Overworld to Nether multiplies X/Z by 1/8; return multiplies by 8. Coordinates are floored, Y is replaced with safe terrain height. This is direct coordinate scaling, not vanilla's portal-search/linking algorithm; rounding and stepping to another portal position can change the precise return point.
- **Performance target:** 60 fps, radius 8–10. The architecture supports this setting, but no target-hardware browser/GPU benchmark has been performed. Do not treat the target as a measured result.

## 1. Renderer, chunk system, noise terrain

**Implemented:** WebGL2 through pinned Three.js, perspective first-person camera, height-aware fog, a procedural sky dome with sun/moon/stars, shader clouds, a generated 8 × 4 texture atlas, nearest-neighbor filtering, radius-based generation/unloading, near-first worker jobs, 2–4 workers, typed-array transfers, capped geometry uploads, section-level frustum bounds, and disposal of unloaded geometry. Terrain includes layered heights, 3D caves, copper-like ore, a bedrock floor, and deterministic cross-boundary tree crowns.

Worker owners retain voxel arrays. The main thread keeps voxel mirrors for fast collision and targeting and supplies neighboring chunk snapshots for meshing. All terrain generation, exposed-face/AO mesh construction, vertical skylight sampling, and fluid surface geometry happen in workers. The main thread handles simulation/UI and uploads finished geometry; bounds use the known section extents rather than rescanning vertices.

**Limits:** no terrain LOD, occlusion culling, worker persistence, or world-origin rebasing. The worker pool copies voxel snapshots for remesh requests. Sections arriving while neighbors are still loading may temporarily show boundary faces; the neighbor arrival schedules correction. Distant chunks continue streaming after the spawn is ready.

## 2. Meshing and ambient occlusion

**Implemented:** indexed, culled exposed-face quads per section; separate opaque, alpha-tested foliage, water, and emissive effects batches; no individual cube objects for terrain. Leaves have pixel cutouts, depth-writing double-sided faces, internal canopy layers, and subtle vertex sway. Trunks remain visible through the leaf holes. Each face corner samples the two outward side neighbors and their diagonal. AO follows `both sides ? 0 : 3 - sideA - sideB - corner`. Vertex color combines climate tint and AO; the terrain shader supplies moving directional sunlight, hemisphere ambient light, canopy/cave skylight attenuation, and projected cloud shade; the triangle diagonal changes to reduce AO interpolation artifacts. One atlas supplies all block textures.

**Limits:** this is culled meshing, not greedy quad merging. Adjacent coplanar quads remain separate. Draw calls are per visible nonempty section/material, not one for the entire world. Lighting combines local AO and a vertical skylight column with dynamic shaders. There is no directional terrain shadow map. Cloud shadows are procedural, not a full shadow pass.

## 3. Physics and collision

**Implemented:** 60 Hz fixed-step simulation with interpolated player camera, substepped per-axis AABB resolution, gravity, jumping, 45 m/s terminal velocity, one-block automatic step-up with headroom checks, level-aware water immersion, water drag/buoyancy and flow currents, fall damage, lava damage, health, and respawn. Unloaded columns act as collision barriers, preventing a player from falling through unfinished terrain. Travel frames clamp accumulated time.

**Limits:** no ladders, crouching, moving platforms, entity-to-entity body collision, or generalized swept convex collision. Step-up collision is discrete with eased camera motion; the collision substep may leave a gap smaller than 0.2 blocks before a surface.

## 4. Building and DDA targeting

**Implemented:** exact voxel-grid traversal with negative-coordinate, parallel-axis, reach, and tied-crossing handling; face highlight; hardness/progress for mining; placement on the adjacent face; exclusion of the player's and creatures' AABBs; a nine-slot hotbar. Edits change voxel storage immediately. Only touched 16-high sections and adjacent influence sections are remeshed; the influence box also covers diagonal neighbor AO and vertical section boundaries. Sparse block and fluid-state edits replay when chunks reload. Changes that affect skylight also invalidate the sections below the edited column.

**Limits:** a section rebuild is incremental relative to the chunk/world, not an in-place GPU face insertion. No tool tiers, durability, crafting, drops, finite inventory, or undo. In-flight geometry may show the previous mesh briefly while physics already sees the edit.

## 5. Biomes and water

**Terrain implemented:** domain-warped climate maps select plains, forest, desert, taiga, mountains, ocean, swamp, beach, and river regions. Nearby climate transitions are now roughly 80–180 blocks across. Ridged highlands, rolling plains, river cuts, coastlines, sandy dunes, snowy summits, and connected cave tunnels produce more visible relief. Oak, tall conifer, and hanging willow canopies differ by biome. Climate tint blends continuously and terrain height quantizes at the 1 m block grid. Domain-warped hills and nearby biome variation remain.

**Water implemented:** every natural ocean/lake/river block and manually placed source participates in the same scheduled simulation. Breaking a bank or floor wakes neighboring water; excavated holes fill. Source blocks feed seven progressively shallower horizontal levels. Downward flow has priority and restarts horizontal reach on landing. The slope search selects the nearest available drop within four horizontal steps. Supported cells with two neighboring sources regenerate into sources, including renewable 2 × 2 pools. Disconnected flows recede after a source is removed. Water evaporates in the Nether, and water beside/above a source lava block turns that lava into obsidian.

Updates run every 0.25 seconds (five ticks at 20 Hz). A per-update work budget postpones work without discarding its frontier; player edits are prioritized over background chunk activation. Loading adjacent chunks wakes boundary flows. Simulation changes are preserved alongside ordinary edits through unloading and dimension travel.

**Water rendering:** source/flow/falling states drive shared corner heights, so neighboring top surfaces join without vertical steps between identical corners. Shallow streams are visibly thinner. Immersion reads fluid depth, and currents influence player movement. A dedicated water shader adds flowing ripples, view-angle-dependent sky reflection, depth tint, sun highlights, and distance fog. Terrain/foliage render first into the opaque target; water composites into a separate target and writes nearest-surface depth.

**Parity limits:** this is a Java-style implementation of the core water-block rules, not a verified engine-identical reproduction of every Minecraft edition/version. This game has no waterloggable slabs/stairs, buckets, sponges, plants washed away by water, bubble columns, ice, piston interactions, or Minecraft redstone/update-order quirks. Falling levels are represented by a single state. Work can be deferred under load; exact tick ordering is not reproduced. Lava uses its own slower scheduled flow, described below. Reflections use the procedural sky, not reflected scene geometry, while refraction uses the opaque scene color/depth target. Other transparent effects still sort per section. Biome surface IDs change at borders while height/tint blend smoothly.

The source regeneration behavior is described by [Mojang's water article](https://www.minecraft.net/en-us/article/block-week-water); liquid state metadata is also documented in [Microsoft's intrinsic block states](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/intrinsicblockstateslist?view=minecraft-bedrock-stable). The implementation is original JavaScript, not copied Minecraft engine code.

## 6. Mobs and both kinds of AI

**Implemented:** pooled base entities with position, velocity, AABB, health, damage, and instanced block-model rendering. Sheep wander and flee when hit. Rivals and Nether ember creatures detect the player, steer toward them, jump when blocked, and attack with cooldown, range and wall checks. Spawn choices depend on dimension, biome, and the day/night light approximation. Active entity count is bounded.

**Pip:** a separate friendly commandable actor that follows, waits, mines the aimed block, or places a five-metre path using the selected material. Commands run through a job queue and preserve player collision exclusion.

**Limits:** local steering, not A*. Actors may get stuck behind complex walls/cliffs. No navigation mesh, drops, breeding, LLM, or arbitrary natural-language command parsing. Day/night light is a global approximation; spawning does not yet sample the local light volume. Mob positions are not saved. Snow uses a fixed particle pool; entities, instance transforms, and model descriptions are pooled/reused.

## 7. Nether and portals

**Implemented:** separate deterministic chunk generation and edit namespace, netherrack floor/ceiling, carved pockets, lava seas, crimson/warped analogues, fog/no sky, exclusive ember mobs, lava hazards, player-buildable and lightable frames, charge-up travel, 8:1 scaling, and a safe landing/return frame. Worker epochs prevent results from the old dimension leaking into the new one.

**Limits:** no vanilla portal search, portal linking persistence, fortress structures, dedicated Nether inventory, or dimension-specific gravity. Arrival clears a small landing area and creates a return frame. Portal blocks remain visible if a lit frame is broken, but travel revalidates the frame and refuses to activate until it is repaired.

## 8. PvP and optional multiplayer (1.7)

**Implemented:** the Multiplayer menu (M) can host the current world, join a friend's room, copy an invite and leave to continue solo. The Node process serves this same frontend and a WebSocket endpoint. Rooms support one host plus three guests. Late joins receive the seed, generator options and canonical sparse edits for both dimensions. Ordered edit batches include fluid and explosion changes; worker completion replays deltas received during generation. Players render as interpolated instanced characters with name tags. Guests have their own movement, creative settings, inventory selection, sound and camera effects.

The host's browser runs the existing mobs, Pip, fluids, weather dusting and fused TNT. Guests request edits, attacks, TNT actions and Pip commands; the host checks targeting, reach, occlusion and player overlap. Human melee uses the existing ray/AABB combat system and sends damage/knockback to the victim. Mob spawns and pursuit consider nearby players. Small extra simulation neighborhoods follow distant guests. Host-controlled regeneration and Nether travel update the whole party. Both dimensions' edits survive travel. Last command selects which player Pip follows/guards.

**Design assumptions and limits:** this is a trusted-friends listen server: movement and environmental damage remain client-authoritative; host-browser decisions are relayed by Node. It does not implement authoritative server physics or reconciliation, competitive anti-cheat, accounts, persistent saves, host migration, or simultaneous dimensions. Four players, eight rooms and 200,000 distinct edited voxels per room are explicit caps. The room ends if its host disconnects. Other clients retain their mirrored world for solo play in that tab; reloading still starts fresh. Host menus and death do not pause shared simulation. The host's own movement pauses while menus are open. Background browser throttling and network latency can delay shared simulation. Full setup and protocol details are in [MULTIPLAYER.md](MULTIPLAYER.md).

## Verification and practical limits

Sixty-three automated checks pass using Node's built-in runner. Alongside the original collision, DDA, AO, frame and real-worker checks, regressions cover natural lake refilling, holes in lake floors, broken dams, seven flowing levels, waterfall reach reset, source removal, source regeneration/support, shortest drop selection, deferred work, chunk boundaries, immersion, corner continuity, Nether evaporation, and source-lava contact. Data-level checks verify leaf cutout coverage, visible interior trunk faces, shader attributes, and nearby biome/elevation diversity. The worker test replays fluid state through a dimension round trip, then regenerates while workers are active and checks that the old edits and terrain disappear. Expansion checks exercise six deterministic presets, seed handling, creative flight/collision/damage, lava timing/reach/draining/contact reactions, snow mesh height/roof invalidation, and character instance budgets.

Eleven shader programs (sky, terrain/foliage, water, emissive effects, snow, color/depth copy, partial underwater, lit characters, textured held items/hands, primed TNT, and blast particles) compiled and linked in a native OpenGL ES 3 context with Three.js tone-mapping and color-space chunks expanded. This checks shader syntax and stage interfaces; it is not an end-to-end browser or visual test.

For the earlier 1.1 release, a CPU-only radius-8 integration check completed all 197 chunks and settled their initial fluid queue in about 10.6 seconds here, with 1,261 section meshes and 1,165,106 triangles before frustum culling. Its accelerated test loop is not a browser frame-rate benchmark. Spawn readiness occurs before all distant chunks finish.

Multiplayer checks use real localhost WebSocket connections and actual client/world-edit, fluid, entity and TNT modules. They cover room isolation, late joins, permissions, malformed data, four-player limits, combat, creative immunity, explosion replication, dimension resets and solo fallback. The real-worker test checks a network edit arriving after generation dispatch. Public tunnel connectivity and an interactive two-browser session remain unverified.

JavaScript syntax, local imports/assets, and the source archive are checked before delivery. Browser visual QA, pointer lock/mobile interaction, and a mid-range-machine 60-fps benchmark remain unverified. F3 and `window.voxelWilds.getStats()` expose runtime counters for profiling.

Three.js is distributed under the included MIT license. No Minecraft assets or Mojang code are used. Reference: [official Three.js documentation](https://threejs.org/docs/).
