# Play Voxel Wilds with a mate

Multiplayer is an optional extension to this same game. You can play solo, host your current world, or join a friend. There is no second game build. Up to four people share a room.

## Updating an existing copy to 1.8

1. Stop the old Node server with Ctrl+C. Existing rooms are session-only and will close.
2. Extract the new full source ZIP. Replace the contents of `dist/`, `server/`, and `tests/`, plus the root `package.json`, `package-lock.json`, README and this guide. Keep your own repository's `.git` directory and any hosting configuration you manage separately; the ZIP contains no Git history or credentials.
3. In your project folder, run `npm ci`, then `npm run server`. The terminal should report **Voxel Wilds 1.8.0**.
4. If cloudflared is still running against port 8080, it can keep using the same tunnel. If you restart it, use the new printed address.
5. Everyone refreshes the game (on Mac: Cmd+Shift+R). Create a new room and copy a fresh invite.

Both frontend and server must be updated together: this release uses **protocol 2** for held items, action poses, ragdoll snapshots and respawn life counters. Old 1.7 clients are rejected with a version message. Solo's original Python launch remains available. Commit the replacement project files to your own Git repository as usual; do not commit `node_modules`.

## Start the server

Install **Node.js 22 or newer**, extract the source ZIP, then open a terminal in the extracted `voxel-wilds` folder (the one containing `package.json`):

```sh
npm ci
npm run server
```

The terminal prints a local address and any detected LAN addresses. The server serves the game and multiplayer on the same port, normally 8080. Keep that terminal running. Ctrl+C stops it.

### On the same Wi-Fi / home network

1. Open the **LAN address** printed by the server on your own computer, such as `http://192.168.1.20:8080`. This is an example; use your actual address.
2. Enter the game and build/explore as usual. Press **M**, enter your name, and choose **Host current world**. Your existing terrain and edits become the shared world.
3. Copy the invite link and send it to your mate.
4. Your mate opens the link, waits for the initial loading to finish, enters their name and clicks **Join friend**, then **Enter the wilds**.
5. Close your multiplayer menu and resume playing. You both see each other and can build, use TNT and fight.

The invite must contain your LAN address, not `localhost` or `127.0.0.1`: those names point to your mate's own computer. If your operating system asks, allow Node on your private network. Guest Wi-Fi isolation can prevent LAN connections. Mouse capture may be restricted by the browser; drag-look remains available.

## A temporary internet link

For a quick playtest on different networks, you can use Cloudflare's Quick Tunnel. Install [cloudflared from Cloudflare's instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). On a Mac with Homebrew, the documented installation command is `brew install cloudflared`.

Keep `npm run server` running. In a **second terminal**, run:

```sh
cloudflared tunnel --url http://localhost:8080
```

Cloudflare prints a temporary public HTTPS address. It proxies your local server, including WebSocket traffic. Quick Tunnels are intended for testing and have no uptime guarantee. [Quick Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), [WebSocket support](https://developers.cloudflare.com/network/websockets/).

1. Open the printed **HTTPS address yourself**.
2. In that game, press **M → Host current world**.
3. Copy the resulting invite and send that to your mate. It includes both the public address and the room code.
4. Your mate opens it and chooses **Join friend**. They need only a browser.

Keep both terminals and your host game open. If the tunnel restarts, its address changes; use a fresh link. This exposes the game server at a public URL. Room links grant access to a room, so share them with people you intend to play with.

**Already playing a world locally or on the original hosted page?** Keep that tab open. Start the server and tunnel, then put the tunnel's HTTPS address in that tab's Multiplayer **Server address** field before choosing **Host current world**. This shares the world already in that tab. Opening a separate game tab instead starts a separate fresh solo world.

No multiplayer backend has been provisioned on the original hosted game URL. The downloadable server is what hosts rooms. The original hosted page can connect to your reachable HTTPS/WSS server; an HTTPS page cannot connect to a plain WS server. For LAN-only HTTP play, open the game served by Node directly.

## Keep solo play

You can ignore the Multiplayer menu and play solo through `npm run server`.

The original static-only launch also remains available with Python 3, without installing Node dependencies:

```sh
python3 -m http.server 8080 --directory dist
```

`npm start` remains an alias for that Python command. Do not run both servers on the same port. Opening `dist/index.html` directly as a file does not support module workers.

**Leave → continue solo** retains the mirrored world in the current tab and restores local simulation. If the host leaves, the room closes and guests receive the same solo fallback. Joining replaces your current session world; there is no hidden backup. As in the previous solo version, refreshing/closing the tab loses its session world. Neither the relay nor the client saves to disk.

## What is shared

| System | Multiplayer behavior |
| --- | --- |
| World | Same seed/settings, sparse voxel edits, and both dimension histories |
| Building | Host checks guest reach, aimed face, bedrock and actor overlap; accepted edits broadcast |
| Water/lava | Host runs the original simulation; flow levels and reactions mirror to guests |
| TNT | Host runs fuses, chains, blasts and terrain damage; clients render flashes, smoke and debris |
| Mobs | Shared host simulation, with spawn/pursuit near players |
| Pip | One shared dog; last command chooses the owner to follow/guard or the job to do |
| Combat | Human melee, visible swings/hit reactions, shared ragdoll deaths and life-aware respawns; creative players remain immune |
| Held items | Your selected block is visible in your hand and in other players’ hands |
| Weather | Host selects shared weather and snow deposition; particles render locally |
| Nether | Host moves the whole party; the original 8:1 scale and return portals remain |
| Regeneration | Host changes seed/options and replaces the party's world |
| Personal controls | Each player keeps their own movement, creative mode, flight handling, view distance, hotbar and sound |

Host menus/death pause creatures, fluids and TNT. Ragdolls continue while the host watches their own death view. Guests can still move and submit build actions, but creatures, fluids and TNT fuses wait for the host to resume. Background tabs can throttle the host; keep the game visible. Human players do not physically push each other's bodies. Held-torch lighting is personal; placed torches are shared voxel edits.

## Running on your own permanent server

Use a machine/service that supports a continuously running Node process and WebSocket upgrades. Copy this project, run `npm ci --omit=dev`, and use `npm run server` as the start command. No GPU is needed for the Node relay; rendering and simulation run in browsers. The host browser must still be connected to keep its room alive.

For a public domain, terminate HTTPS in your reverse proxy and forward both ordinary HTTP and the `/multiplayer` WebSocket upgrade to port 8080. Set its idle timeout longer than the 30-second heartbeat. Keep one relay process for this version: room state is in memory and is not shared across multiple replicas. Health checks can use `GET /health`.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP/WebSocket listen port |
| `HOST` | `0.0.0.0` | Listen interface; use `127.0.0.1` behind a local-only proxy |
| `TLS_CERT`, `TLS_KEY` | unset | Paths to PEM certificate/key for direct HTTPS/WSS; supply both |
| `ALLOWED_ORIGINS` | unset | Optional comma-separated browser origins, e.g. `https://game.example.com`; exact matches, no trailing slash |

macOS/Linux example:

```sh
PORT=3000 npm run server
```

Windows PowerShell example:

```powershell
$env:PORT = "3000"
npm run server
```

Environment variables are read from the process. `.env` files are not automatically loaded. No cloud provider, paid instance, domain or tunnel is automatically created by the game.

## Design and limits

This is a **host-browser-authoritative listen server for trusted friends**. Node enforces room membership, host-only world state, message bounds and edit ordering. It relays guest intents to the host, which runs the existing gameplay systems. Positions, movement and environmental damage remain client-authoritative. This preserves responsive local controls and reuses the current game; it is not competitive anti-cheat or a fully authoritative dedicated game server.

`dist/src/network/protocol.js` defines the versioned wire format. `multiplayer.js` wraps edit/TNT entry points only when connected. Browsers use native WebSocket; Node uses the pinned [`ws` package](https://github.com/websockets/ws). Player poses send at 20 Hz, mob/TNT snapshots at 10 Hz, and remote models interpolate between snapshots. Block batches have monotonic sequence numbers and world epochs; late joins replay canonical edits, including changes received while chunk workers are generating. Gaps trigger a disconnect rather than silently accepting a divergent world.

Explicit bounds: **4 players per room, 8 rooms per relay, 200,000 distinct edited cells per room across both dimensions**, 28 mobs, 64 primed TNT entities and 16 ragdolls lasting nine seconds. Heavy fluids and explosions consume edit history too. Crossing the edit cap closes the room and leaves clients in solo; a fresh/regenerated world can host again. Host simulation loads an extra 5 × 5 chunk neighborhood around each guest; shared effects farther away wait until the host has that area loaded.

There is no persistent room storage, account system, host migration, automatic reconnect, chat, simultaneous Overworld/Nether parties, or server-side movement reconciliation. Normal one-metre blocks, original textures, sky/shaders, caves, aquifers, snow, creative controls, Pip and TNT menus remain in solo and multiplayer.

## Troubleshooting and checks

- **Cannot reach server:** check `npm run server` is running and visit its `/health` URL. The Python static server alone does not provide multiplayer.
- **Room not found:** host disconnected, server restarted, or code is wrong. Ask for a fresh invite.
- **Game/server versions differ:** extract the latest source, run `npm ci`, restart Node and reload both clients.
- **Edits do not appear:** check the connection/HOST status. Guest edits wait for host acceptance and loaded terrain. The host's pause state is shown in the guest HUD.
- **Internet invite says localhost:** use the tunnel/public address in the Server address field before hosting, or replace only the invite's origin with the reachable server origin, preserving `#room=…`.
- **Origin denied:** if you set `ALLOWED_ORIGINS`, include the actual game page origin. Leave it unset for the basic LAN/tunnel setup.

Run `npm test` for all 63 tests, or `npm run test:multiplayer` for the socket/client suite. Tests cover real localhost sockets, room isolation, late-join edits, host-only authority, malformed input, limits, game-client mining/placing, fluids, PvP, creative immunity, TNT replication, epoch resets and solo fallback. Real worker tests cover in-flight edits. An interactive two-browser session, public tunnel connection and multiplayer frame-rate benchmark have not been verified in this environment.
