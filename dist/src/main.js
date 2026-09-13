import { FirstPersonHand } from './held-items.js';
import { Multiplayer, applyEdits } from './network/multiplayer.js';
import { TNT } from './tnt.js';
import { Lighting } from './lighting.js';
import { U, EYE_HEIGHT, REACH, BLOCK_SIZE } from './scale.js';
import { Renderer, THREE } from './renderer.js';
import { World } from './world.js';
import { Player, overlapsBlock } from './physics.js';
import { raycast } from './raycast.js';
import { UI, $ } from './ui.js';
import { B, C, solid, names, isWater } from './blocks.js';
import { PRESETS } from './world-options.js';
import { Lava } from './lava.js';
import { Weather } from './weather.js';
import { Fluids } from './fluids.js';
import { Entities } from './entities.js';
import { Companion } from './companion.js';
import { Portals } from './portals.js';

function boot() {
  const renderer = new Renderer($('game')),
    ui = new UI(renderer),
    world = new World(renderer, (m) => ui.error(m)),
    player = new Player();
  const fluids = new Fluids(world),
    lava = new Lava(world),
    lighting = new Lighting(renderer, world, (m) => ui.error(m)),
    weather = new Weather(renderer, world),
    entities = new Entities(renderer, world),
    companion = new Companion(entities, world, player, (m) => ui.toast(m));
  const tnt = new TNT(renderer, world, player, entities, (m) => ui.toast(m));
  const firstPerson = new FirstPersonHand(renderer);
  let cameraY = null;
  let started = false,
    paused = true,
    ready = false,
    setup = false,
    travelPending = null,
    spawn = { x: 65.5, y: 60, z: -31.5 },
    target = null,
    mouseDown = false,
    breakProgress = 0,
    breakKey = '',
    attackCooldown = 0,
    accumulator = 0,
    last = performance.now(),
    tickCount = 0,
    fps = 0,
    frames = 0,
    statTime = 0,
    deathShown = false,
    regenerating = false;
  const keys = new Set(),
    direction = new THREE.Vector3(),
    view = new THREE.Vector3(),
    touch = matchMedia('(pointer: coarse)').matches;
  player.teleport(spawn.x, spawn.y, spawn.z);
  const portals = new Portals(world, player, travel, (m) => ui.toast(m));
  const net = new Multiplayer({
    renderer,
    world,
    player,
    entities,
    tnt,
    companion,
    portals,
    weather,
    notify: (m) => ui.toast(m),
    onLoad: loadRoom,
    onStatus: updateNetworkUI,
  });
  function loadRoom(snapshot, edits) {
    clearInput();
    paused = true;
    release();
    ready = false;
    setup = true;
    regenerating = true;
    travelPending = null;
    cameraY = null;
    world.regenerate(snapshot.seed, snapshot.options);
    applyEdits(world, edits);
    if (snapshot.dimension !== 'overworld') world.switchDimension(snapshot.dimension);
    fluids.reset();
    lava.reset();
    weather.reset();
    entities.clear();
    companion.entity = null;
    companion.jobs = [];
    portals.cooldown = 5;
    portals.charge = 0;
    tnt.reset();
    deathShown = false;
    $('death').close();
    spawn = { ...snapshot.spawn };
    player.teleport(spawn.x, spawn.y, spawn.z);
    player.life++;
    player.health = 20;
    player.hurtTime = 0;
    $('world-seed').value = String(snapshot.seed);
    $('world-relief').value = world.options.relief * 100;
    $('world-sea').value = world.options.seaLevel;
    $('world-trees').value = world.options.trees * 100;
    $('world-caves').checked = world.options.caves;
    $('seed-label').textContent = world.seed;
    $('world-title').textContent = PRESETS[world.options.preset].name + ' together';
    showPreset(world.options.preset, false);
    $('dimension-tag').textContent = world.dimension.toUpperCase();
    $('net-menu').close();
    $('travel').querySelector('h2').textContent = 'Joining your friend’s world…';
    $('travel').classList.remove('hidden');
  }
  function updateNetworkUI(message = '') {
    if (!net) return;
    $('net-status').textContent =
      message ||
      (!net.connected
        ? 'Solo'
        : `${net.host ? 'Hosting' : 'Joined'} · ${net.players.size + 1}/4 players${net.ping ? ' · ' + net.ping + ' ms' : ''}`);
    $('net-roster').replaceChildren();
    if (net.connected) {
      for (const name of [
        'You' + (net.host ? ' · host' : ''),
        ...[...net.players.values()].map((p) => p.name),
      ]) {
        const li = document.createElement('li');
        li.textContent = name;
        $('net-roster').append(li);
      }
    }
    $('net-host').disabled = $('net-join').disabled = net.connected || !!net.socket;
    $('net-leave').disabled = !net.connected && !net.socket;
    $('net-copy').disabled = !net.connected;
    $('net-invite').value = net.connected ? net.invite() : '';
    $('session-mode').textContent = net.connected ? 'MULTIPLAYER' : 'SOLO + AI';
    $('regenerate').disabled = net.guest;
    $('weather-mode').disabled = net.guest;
    $('net-hud').textContent = net.connected
      ? `${net.host ? 'HOST' : 'MULTIPLAYER'} · ${net.players.size + 1}/4${net.guest && net.hostPaused ? ' · host paused' : ''}`
      : 'SOLO';
  }
  function openNetwork() {
    paused = true;
    release();
    $('menu').close();
    $('net-menu').showModal();
    updateNetworkUI();
  }
  $('welcome-network').onclick = $('menu-network').onclick = openNetwork;
  $('close-network').onclick = () => {
    $('net-menu').close();
    if (started) resume();
  };
  $('net-menu').addEventListener('cancel', (e) => {
    e.preventDefault();
    $('close-network').onclick();
  });
  $('net-server').value = location.origin;
  const invite = new URLSearchParams(location.hash.slice(1));
  if (invite.has('room')) {
    $('net-room').value = invite.get('room');
    openNetwork();
  }
  function connectRoom(join) {
    if (!ready) return ui.toast('Wait for your world to finish loading.');
    try {
      let room = $('net-room').value.trim();
      if (room.includes('://')) {
        const url = new URL(room);
        room = new URLSearchParams(url.hash.slice(1)).get('room') || '';
        $('net-server').value = url.origin;
      }
      if (join && !room) return ui.toast('Paste the room code or invite link.');
      net.connect($('net-server').value, $('net-name').value, join ? room : null);
    } catch (e) {
      ui.toast(e.message);
      $('net-status').textContent = e.message;
    }
  }
  $('net-host').onclick = () => connectRoom(false);
  $('net-join').onclick = () => connectRoom(true);
  $('net-leave').onclick = () => {
    net.disconnect();
    ui.toast('Multiplayer left. This world is now solo.');
  };
  $('net-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('net-invite').value);
      ui.toast('Invite copied. Use your LAN/public server address when sharing.');
    } catch {
      $('net-invite').focus();
      $('net-invite').select();
      ui.toast('Select and copy the invite link.');
    }
  };
  function clearInput() {
    keys.clear();
    mouseDown = false;
    breakProgress = 0;
  }
  function release() {
    clearInput();
    document.exitPointerLock?.();
  }
  function pause() {
    if (!started) return;
    paused = true;
    release();
    if (
      !$('menu').open &&
      !$('companion-menu').open &&
      !$('death').open &&
      !$('world-menu').open &&
      !$('palette-menu').open &&
      !$('tnt-menu').open &&
      !$('net-menu').open
    )
      $('menu').showModal();
  }
  async function resume() {
    if (!ready) return;
    $('menu').close();
    $('companion-menu').close();
    $('world-menu').close();
    $('palette-menu').close();
    $('tnt-menu').close();
    $('net-menu').close();
    tnt.unlockAudio();
    if (!started) {
      started = true;
      ui.started();
      ui.toast('Pip is at your side. C for dog commands. Explore nearby cave entrances.');
      if (touch) $('touch-controls').classList.remove('hidden');
    }
    paused = false;
    if (!touch) {
      try {
        await $('game').requestPointerLock();
      } catch {
        ui.toast(
          'Mouse capture unavailable. Hold and drag to look, or open the game in its own tab.',
        );
      }
    }
  }
  $('play').onclick = resume;
  $('resume').onclick = resume;
  $('close-menu').onclick = () => (started ? resume() : $('menu').close());
  $('help').onclick = $('welcome-controls').onclick = () => {
    paused = true;
    release();
    $('menu').showModal();
  };
  $('pause').onclick = pause;
  $('menu').addEventListener('cancel', (e) => {
    e.preventDefault();
    started ? resume() : $('menu').close();
  });
  $('companion-menu').addEventListener('cancel', (e) => {
    e.preventDefault();
    resume();
  });
  $('close-companion').onclick = resume;
  function openOptions() {
    paused = true;
    release();
    $('menu').close();
    $('world-menu').showModal();
  }
  function closeOptions() {
    $('world-menu').close();
    if (started) $('menu').showModal();
  }
  $('welcome-world').onclick = $('menu-world').onclick = openOptions;
  $('close-world').onclick = closeOptions;
  $('world-menu').addEventListener('cancel', (e) => {
    e.preventDefault();
    closeOptions();
  });
  function openPalette() {
    if (!started || !ready) return;
    paused = true;
    release();
    $('menu').close();
    $('palette-hint').textContent = `Choose a block for hotbar slot ${ui.selected + 1}.`;
    for (const b of $('palette-grid').children)
      b.setAttribute('aria-pressed', String(+b.dataset.block === ui.block));
    $('palette-menu').showModal();
  }
  ui.buildPalette(() => {
    ui.toast(
      ui.block === B.TORCH
        ? 'Torch selected · Carry it for light, or right-click to place.'
        : names[ui.block] + ' selected',
    );
    resume();
  });
  $('menu-palette').onclick = $('touch-palette').onclick = openPalette;
  $('close-palette').onclick = resume;
  $('palette-menu').addEventListener('cancel', (e) => {
    e.preventDefault();
    resume();
  });
  function openTNT() {
    if (!started || !ready || travelPending) return;
    paused = true;
    release();
    $('menu').close();
    $('tnt-menu').showModal();
    $('tnt-status').textContent =
      tnt.pool.filter((b) => b.active).length +
      ' active charges · Creative mode prevents player damage.';
  }
  $('menu-tnt').onclick = $('touch-tnt').onclick = openTNT;
  $('close-tnt').onclick = $('tnt-resume').onclick = resume;
  $('tnt-menu').addEventListener('cancel', (e) => {
    e.preventDefault();
    resume();
  });
  for (const name of ['fuse', 'power', 'volume'])
    $('tnt-' + name).oninput = (e) => {
      const v = +e.target.value;
      tnt.options[name] = name === 'volume' ? v / 100 : v;
      $('tnt-' + name + '-value').textContent =
        name === 'fuse'
          ? v + ' seconds'
          : name === 'volume'
            ? v + '%'
            : v + (v === 4 ? ' · classic' : '');
    };
  for (const name of ['chain', 'damage', 'shake'])
    $('tnt-' + name).onchange = (e) => {
      tnt.options[name] = e.target.checked;
      if (name === 'shake' && !e.target.checked) tnt.shake = 0;
    };
  $('tnt-select').onclick = () => {
    ui.setBlock(B.TNT);
    ui.toast('TNT equipped · Right-click to place · F to ignite · T for playground');
    resume();
  };
  $('tnt-aimed').onclick = () => {
    tnt.ignite(target);
    resume();
  };
  $('tnt-nearby').onclick = () => {
    tnt.detonateNearby();
    resume();
  };
  $('tnt-defuse').onclick = () => {
    tnt.defuse();
    $('tnt-status').textContent = 'All active charges defused.';
  };
  $('tnt-place').onclick = () => {
    const p = target
      ? {
          x: target.x + target.normal.x,
          y: target.y + target.normal.y,
          z: target.z + target.normal.z,
        }
      : {
          x: player.position.x - Math.sin(player.yaw) * 8,
          y: player.position.y,
          z: player.position.z - Math.cos(player.yaw) * 8,
        };
    tnt.spawnPattern(
      p,
      $('tnt-pattern').value,
      +$('tnt-count').value || 1,
      +$('tnt-spacing').value,
    );
    resume();
  };
  $('flight-speed').oninput = (e) => {
    player.flySpeed = +e.target.value;
    $('flight-speed-value').textContent = player.flySpeed + ' m/s';
  };
  $('flight-handling').onchange = (e) => {
    player.flightResponse = +e.target.value;
  };
  const icons = ['✦', '❄', '≋', '☀', '♨', '▰'];
  function showPreset(p, defaults = true) {
    $('world-preset').value = p;
    for (const b of $('preset-grid').children)
      b.setAttribute('aria-pressed', String(b.dataset.preset === p));
    $('preset-description').textContent = PRESETS[p].description;
    if (defaults) {
      const o = PRESETS[p];
      $('world-relief').value = o.relief * 100;
      $('world-sea').value = o.seaLevel;
      $('world-trees').value = o.trees * 100;
      $('world-caves').checked = o.caves;
    }
    updateRanges();
  }
  function updateRanges() {
    $('relief-value').textContent = $('world-relief').value + '%';
    $('sea-value').textContent = $('world-sea').value;
    $('trees-value').textContent = $('world-trees').value + '%';
  }
  Object.entries(PRESETS).forEach(([id, p], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.preset = id;
    const icon = document.createElement('span');
    icon.className = 'preset-icon';
    icon.textContent = icons[i];
    b.append(icon, document.createTextNode(p.name));
    b.onclick = () => showPreset(id);
    $('preset-grid').append(b);
  });
  for (const id of ['world-relief', 'world-sea', 'world-trees']) $(id).oninput = updateRanges;
  showPreset('wilds');
  $('random-seed').onclick = () => {
    $('world-seed').value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
  };
  function flight() {
    if (player.mode !== 'creative') return ui.toast('Choose Creative in World options to fly.');
    player.toggleFlight();
    ui.toast(
      player.flying ? 'Flying · Space up · Ctrl down · Shift fast' : 'Flight off · G to fly again',
    );
  }
  $('touch-flight').onclick = flight;
  $('game-mode').onchange = (e) => {
    player.setMode(e.target.value);
    $('world-subtitle').textContent =
      (player.mode === 'creative' ? 'Creative flight' : 'Survival sandbox') + ' · Infinite terrain';
    ui.toast(
      player.mode === 'creative'
        ? 'Creative mode · You can fly.'
        : 'Survival mode · Gravity and damage enabled.',
    );
  };
  $('weather-mode').onchange = (e) => {
    weather.mode = e.target.value;
    weather.scan = 0;
  };
  $('world-form').onsubmit = (e) => {
    e.preventDefault();
    if (net.guest) return ui.toast('The host controls world regeneration.');
    net.beginTransition();
    clearInput();
    paused = true;
    release();
    world.regenerate($('world-seed').value, {
      preset: $('world-preset').value,
      relief: +$('world-relief').value / 100,
      seaLevel: +$('world-sea').value,
      trees: +$('world-trees').value / 100,
      caves: $('world-caves').checked,
    });
    tnt.reset();
    cameraY = null;
    fluids.reset();
    lava.reset();
    weather.reset();
    entities.clear();
    companion.entity = null;
    companion.mode = 'stay';
    companion.jobs = [];
    companion.timer = 0;
    portals.cooldown = 4;
    portals.charge = 0;
    travelPending = null;
    ready = false;
    setup = false;
    deathShown = false;
    regenerating = true;
    spawn = { x: 65.5, y: 80, z: -31.5 };
    player.teleport(spawn.x, spawn.y, spawn.z);
    player.life++;
    player.health = 20;
    player.hurtTime = 0;
    $('world-menu').close();
    $('menu').close();
    $('death').close();
    $('dimension-tag').textContent = 'OVERWORLD';
    $('world-title').textContent = PRESETS[world.options.preset].name + ' awaits';
    $('seed-label').textContent = world.seed;
    $('play').disabled = true;
    $('play-label').textContent = 'Growing your world…';
    $('load-status').textContent = 'Shaping ' + PRESETS[world.options.preset].name.toLowerCase();
    $('travel').querySelector('h2').textContent = 'Growing a new world…';
    $('travel').classList.remove('hidden');
    renderer.target.visible = false;
  };
  $('distance').oninput = (e) => {
    world.radius = Number(e.target.value);
    $('distance-value').textContent = world.radius + ' chunks';
  };
  $('respawn').onclick = () => {
    respawn();
    resume();
  };
  $('revive').onclick = () => {
    $('death').close();
    deathShown = false;
    respawn();
    resume();
  };
  function respawn() {
    player.life++;
    player.health = 20;
    player.hurtTime = 2;
    if (world.dimension !== 'overworld' && !net.guest) travel('overworld', spawn.x, spawn.z, true);
    else player.teleport(spawn.x, spawn.y, spawn.z);
  }
  function openCompanion() {
    if (!started || paused || travelPending) return;
    paused = true;
    release();
    $('companion-menu').showModal();
  }
  for (const button of document.querySelectorAll('[data-command]'))
    button.onclick = () => {
      if (net.guest) net.request('companion', { command: button.dataset.command, block: ui.block });
      else companion.command(button.dataset.command, target, ui.block);
      resume();
    };
  addEventListener('keydown', (e) => {
    if (e.target.matches?.('input,select,textarea')) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'F3'].includes(e.code)) e.preventDefault();
    if (e.code === 'Escape') {
      if (started && !paused) pause();
      return;
    }
    if (e.code === 'KeyM' && !e.repeat && !paused) {
      openNetwork();
      return;
    }
    if (e.code === 'KeyE' && !e.repeat && started && !paused) {
      e.preventDefault();
      openPalette();
      return;
    }
    if (e.code === 'KeyT' && !e.repeat && started && !paused) {
      openTNT();
      return;
    }
    if (e.code === 'KeyC' && !e.repeat) {
      openCompanion();
      return;
    }
    if (e.code === 'F3' && !e.repeat) {
      $('stats').classList.toggle('hidden');
      return;
    }
    if (paused || !started) return;
    keys.add(e.code);
    if (e.code === 'KeyG' && !e.repeat) flight();
    if (/^Digit[1-9]$/.test(e.code)) ui.select(Number(e.code.slice(-1)) - 1);
    if (e.code === 'KeyF' && !e.repeat) ignite();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => {
    if (started) pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && started) pause();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && started && !paused && !touch) {
      paused = true;
      clearInput();
      if (
        !$('menu').open &&
        !$('companion-menu').open &&
        !$('death').open &&
        !$('world-menu').open &&
        !$('palette-menu').open &&
        !$('tnt-menu').open &&
        !$('net-menu').open
      )
        $('menu').showModal();
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement && !paused) {
      player.yaw -= e.movementX * 0.0022;
      player.pitch = Math.max(-1.54, Math.min(1.54, player.pitch - e.movementY * 0.0022));
    }
  });
  let drag = null;
  $('game').addEventListener('pointerdown', (e) => {
    if (!started || paused) return;
    if (!document.pointerLockElement) {
      drag = { x: e.clientX, y: e.clientY };
      $('game').setPointerCapture(e.pointerId);
      if (touch) return;
    }
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) place();
  });
  $('game').addEventListener('pointermove', (e) => {
    if (!drag || paused || document.pointerLockElement) return;
    player.yaw -= (e.clientX - drag.x) * 0.005;
    player.pitch = Math.max(-1.54, Math.min(1.54, player.pitch - (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
  });
  addEventListener('pointerup', () => {
    mouseDown = false;
    drag = null;
    breakProgress = 0;
  });
  $('game').addEventListener('contextmenu', (e) => e.preventDefault());
  $('game').addEventListener(
    'wheel',
    (e) => {
      if (started && !paused) {
        e.preventDefault();
        ui.select(ui.selected + Math.sign(e.deltaY));
      }
    },
    { passive: false },
  );
  for (const button of document.querySelectorAll('[data-key]')) {
    button.onpointerdown = (e) => {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      keys.add(button.dataset.key);
    };
    button.onpointerup = button.onpointercancel = () => keys.delete(button.dataset.key);
  }
  $('touch-mine').onpointerdown = (e) => {
    e.preventDefault();
    mouseDown = true;
  };
  $('touch-mine').onpointerup = () => (mouseDown = false);
  $('touch-place').onclick = place;
  $('touch-pip').onclick = openCompanion;
  function ignite() {
    net.animate('use');
    if (net.guest) net.request('ignite', { options: tnt.options });
    else target?.block === B.TNT ? tnt.ignite(target) : portals.ignite(target);
  }
  $('touch-portal').onclick = ignite;
  function place() {
    if (!target || paused) return;
    const x = target.x + target.normal.x,
      y = target.y + target.normal.y,
      z = target.z + target.normal.z;
    if (!target.normal.x && !target.normal.y && !target.normal.z) return;
    if (
      overlapsBlock(player.position, x, y, z, player.width, player.height) ||
      net.overlaps(x, y, z)
    )
      return ui.toast('Step back a little to place that block.');
    if (
      entities.pool.some((e) => e.active && overlapsBlock(e.position, x, y, z, e.width, e.height))
    )
      return;
    net.animate('place');
    if (world.set(x, y, z, ui.block)) ui.toast(names[ui.block] + ' placed');
  }
  function travel(d, x, z, returning = false) {
    if (net.guest) return ui.toast('The host leads Nether travel for the party.');
    net.beginTransition();
    clearInput();
    travelPending = { d, x, z, returning };
    ready = false;
    world.switchDimension(d);
    tnt.reset();
    cameraY = null;
    fluids.reset();
    lava.reset();
    weather.reset();
    entities.clear();
    companion.entity = null;
    player.teleport(x, 75, z);
    $('travel').querySelector('h2').textContent = 'Crossing worlds…';
    $('travel').classList.remove('hidden');
    $('dimension-tag').textContent = d.toUpperCase();
  }
  function safeLanding(x, z, dimension) {
    const c = world.column(x, z),
      y = Math.max(dimension === 'nether' ? 28 : world.options.seaLevel + 2, c.height + 1);
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        world.set(
          Math.floor(x) + dx,
          y - 1,
          Math.floor(z) + dz,
          dimension === 'nether' || c.biome === 'volcanic'
            ? B.NETHERRACK
            : c.frozen
              ? B.SNOW
              : c.biome === 'desert'
                ? B.SAND
                : B.GRASS,
        );
        for (let dy = 0; dy < 6; dy++)
          world.set(Math.floor(x) + dx, y + dy, Math.floor(z) + dz, B.AIR);
      }
    return y;
  }
  function initialSetup() {
    const x = Math.floor(spawn.x),
      z = Math.floor(spawn.z),
      y = safeLanding(x, z, 'overworld');
    spawn = { x: x + 0.5, y: y + 0.01, z: z + 0.5 };
    player.teleport(spawn.x, spawn.y, spawn.z);
    // A complete, unlit frame gives players an optional first portal to discover.
    const px = x + 7,
      pz = z - 7,
      py = safeLanding(px, pz, 'overworld');
    portals.makeFrame(px - 1, py, pz, false);
    entities.spawn('sheep', x + 4, world.ground(x + 4, z + 4) + 0.1, z + 4);
    entities.spawn('sheep', x - 4, world.ground(x - 4, z + 8) + 0.1, z + 8);
    companion.command('follow', null, ui.block);
    setup = true;
  }
  function updateTarget() {
    renderer.camera.getWorldDirection(direction);
    target = raycast(
      world.get.bind(world),
      renderer.camera.position,
      direction,
      REACH,
      (b) => b !== B.AIR && b !== B.PORTAL,
    );
    renderer.target.visible = !!target && started && !paused;
    if (target) {
      renderer.target.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      $('target-name').textContent = names[target.block];
    } else $('target-name').textContent = '';
  }
  function actions(dt) {
    attackCooldown = Math.max(0, attackCooldown - dt);
    if (!mouseDown) {
      breakProgress = 0;
      return;
    }
    if (attackCooldown === 0) {
      const wall = raycast(
        world.get.bind(world),
        renderer.camera.position,
        direction,
        4 * U,
        solid,
      );
      if (net.performAttack(renderer.camera.position, direction, wall?.distance ?? 4 * U)) {
        attackCooldown = 0.35;
        breakProgress = 0;
        return;
      }
    }
    if (performance.now() / 1000 - (player.actionAt ?? -100) > 0.28) net.animate('mine');
    if (!target || target.block === B.BEDROCK) return;
    const k = `${target.x},${target.y},${target.z}`;
    if (k !== breakKey) {
      breakKey = k;
      breakProgress = 0;
    }
    const hardness =
      player.mode === 'creative'
        ? 0.06
        : target.block === B.OBSIDIAN
          ? 1.8
          : target.block === B.STONE || target.block === B.ORE
            ? 0.65
            : 0.28;
    breakProgress += dt / hardness;
    if (breakProgress >= 1) {
      world.set(target.x, target.y, target.z, B.AIR);
      breakProgress = 0;
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const time = net.sharedTime(now / 1000),
      daylight = 0.25 + 0.75 * Math.max(0, Math.sin(time / 120 + 0.9));
    player.heldBlock = ui.block;
    world.update(player.position.x, player.position.z);
    // Require the spawn and its neighbors so collision never starts in missing data.
    const nearbyLoaded = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [0, 0],
    ].every(([x, z]) => world.loaded(player.position.x + x * 16, player.position.z + z * 16));
    if (!setup && nearbyLoaded) initialSetup();
    if (!ready && !travelPending && setup && world.readyCount >= 9) {
      ready = true;
      $('play').disabled = false;
      $('play-label').textContent = 'Enter the wilds';
      $('load-status').textContent = 'Your world is ready';
      $('load-progress').style.width = '100%';
      if (regenerating) {
        regenerating = false;
        $('travel').classList.add('hidden');
        if (started) $('menu').showModal();
        ui.toast(PRESETS[world.options.preset].name + ' is ready.');
      }
    }
    if (!ready && !travelPending) {
      $('load-progress').style.width = Math.min(95, (world.readyCount / 9) * 100) + '%';
    }
    if (travelPending && nearbyLoaded && world.readyCount >= 9) {
      const t = travelPending,
        y = safeLanding(t.x, t.z, t.d);
      player.teleport(Math.floor(t.x) + 0.5, y + 0.01, Math.floor(t.z) + 0.5);
      if (!t.returning) portals.makeFrame(Math.floor(t.x) - 1, y, Math.floor(t.z) - 2, true);
      travelPending = null;
      ready = true;
      portals.cooldown = 4;
      $('travel').classList.add('hidden');
      ui.toast(
        t.d === 'nether' ? 'The Nether. Watch your step around lava.' : 'Back in the Overworld.',
      );
    }
    if (started && !paused && ready && !net.waiting && player.health > 0) {
      accumulator += dt;
      while (accumulator >= 1 / 60) {
        player.tick(world, keys, 1 / 60);
        if (!net.guest) {
          companion.tick(1 / 60);
          entities.tick(player, 1 / 60, daylight, net.actors());
          fluids.tick(1 / 60);
          lava.tick(1 / 60);
          tnt.tick(1 / 60);
        }
        portals.tick(1 / 60);
        accumulator -= 1 / 60;
        tickCount++;
        if (travelPending) break;
      }
      if (!net.guest) tnt.flush();
      const alpha = accumulator / (1 / 60);
      const desiredY =
        THREE.MathUtils.lerp(player.previous.y, player.position.y, alpha) + EYE_HEIGHT;
      // Only smooth small grounded rises (step-ups); free flight retains precise interpolation.
      if (
        cameraY === null ||
        Math.abs(desiredY - cameraY) > 3 ||
        player.flying ||
        player.inWater ||
        player.velocity.y > 1 ||
        desiredY < cameraY
      )
        cameraY = desiredY;
      else cameraY += (desiredY - cameraY) * (1 - Math.exp(-18 * dt));
      renderer.camera.position.set(
        THREE.MathUtils.lerp(player.previous.x, player.position.x, alpha),
        cameraY,
        THREE.MathUtils.lerp(player.previous.z, player.position.z, alpha),
      );
      renderer.camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
      const desiredFov =
        73 +
        (player.flying
          ? Math.min(1, Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z) / 24) *
            4
          : 0);
      if (Math.abs(renderer.camera.fov - desiredFov) > 0.01) {
        renderer.camera.fov += (desiredFov - renderer.camera.fov) * (1 - Math.exp(-6 * dt));
        renderer.camera.updateProjectionMatrix();
      }
      updateTarget();
      actions(dt);
    } else {
      accumulator = 0;
      if (!started) {
        const p = player.position;
        renderer.camera.position.set(
          p.x + 19 + Math.sin(time * 0.018) * 7,
          (setup ? spawn.y : 45) + 17,
          p.z + 27,
        );
        view.set(p.x - 12, (setup ? spawn.y : 45) + 1, p.z - 15);
        renderer.camera.lookAt(view);
        renderer.target.visible = false;
      }
    }
    if (started && paused) renderer.camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    net.update(dt, { ready, paused: paused || !started, time });
    if (net.guest) tnt.replicaTick(dt);
    const renderAlpha = net.guest
      ? net.replicaAlpha()
      : started && !paused && ready
        ? accumulator * 60
        : 1;
    entities.draw(time, player, renderAlpha);
    tnt.draw(renderAlpha);
    net.drawPlayers(time);
    if (started && !paused) {
      renderer.camera.rotation.x += Math.sin(time * 73) * tnt.shake * 0.014;
      renderer.camera.rotation.z = Math.sin(time * 57) * tnt.shake * 0.009;
    }
    weather.update(dt, time, renderer.camera.position, !net.guest && started && !paused && ready);
    ui.health(player.health, player.mode === 'creative');
    if (player.health <= 0 && !deathShown) {
      deathShown = true;
      paused = true;
      release();
      $('menu').close();
      $('death').showModal();
    }
    $('break-ring').style.opacity = breakProgress > 0 ? '1' : '0';
    $('break-ring').style.setProperty('--progress', Math.min(100, breakProgress * 100) + '%');
    $('damage').style.opacity = player.hurtTime > 0.3 ? '1' : '0';
    $('blast-flash').style.opacity = String(tnt.flash);
    $('portal-wash').style.opacity = String(portals.charge * 0.8);
    if (frames++ % 15 === 0) {
      const p = player.position,
        c = world.column(p.x, p.z);
      $('pip-status').textContent = companion.entity?.active
        ? `Pip · ${companion.guardTarget ? 'Defending you' : companion.mode === 'stay' ? 'Waiting' : 'At your side'} · ${Math.ceil(companion.entity.health)}/24`
        : 'Pip · Returning to you';
      $('mode-status').textContent =
        (player.mode === 'creative'
          ? player.flying
            ? 'Creative · Flying'
            : 'Creative · Walking'
          : 'Survival') + (weather.amount > 0.1 ? ' · Snowing' : ' · Clear');
      $('biome').textContent = c.biome.charAt(0).toUpperCase() + c.biome.slice(1);
      $('coordinates').textContent =
        `${(p.x * BLOCK_SIZE).toFixed(1)} / ${(p.y * BLOCK_SIZE).toFixed(1)} / ${(p.z * BLOCK_SIZE).toFixed(1)} m`;
      const cardinal = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];
      $('heading').textContent = cardinal[((Math.round(player.yaw / (Math.PI / 4)) % 8) + 8) % 8];
    }
    statTime += dt;
    if (statTime >= 1) {
      fps = Math.round(frames / statTime);
      frames = 0;
      statTime = 0;
      $('stats').textContent =
        `${fps} FPS · ${renderer.gl.info.render.calls} draw calls\n${world.readyCount} chunks · radius ${world.radius}\n${Math.round(renderer.gl.info.render.triangles / 1000)}k triangles · ${world.workers.length} workers\n${entities.pool.filter((e) => e.active).length} entities · 60 Hz physics\nSeed ${world.seed} · ${world.dimension}`;
    }
    if (started && player.health <= 0) {
      // A short third-person death view keeps your own falling body visible.
      const corpse = net.ownCorpse(),
        p = player.position;
      const anchor = new THREE.Vector3(
        corpse ? corpse.points[0] : p.x,
        corpse ? corpse.points[1] : p.y + 0.7,
        corpse ? corpse.points[2] : p.z,
      );
      const offset = new THREE.Vector3(
          Math.sin(player.yaw + 0.5) * 3,
          1.1,
          Math.cos(player.yaw + 0.5) * 3,
        ),
        length = offset.length();
      offset.normalize();
      const wall = raycast(world.get.bind(world), anchor, offset, length, solid);
      renderer.camera.position
        .copy(anchor)
        .addScaledVector(offset, Math.max(0.2, Math.min(length, (wall?.distance ?? length) - 0.2)));
      renderer.camera.lookAt(anchor);
    }
    firstPerson.update(
      dt,
      time,
      player,
      ui.block,
      started && ready && player.health > 0 && !travelPending,
    );
    lighting.update(dt, renderer.camera.position, started && ui.block === B.TORCH);
    renderer.setLight(daylight);
    renderer.draw(time, world);
  }
  requestAnimationFrame(frame);
  // Read-only diagnostics are useful for host hardware profiling, without a server.
  window.voxelWilds = {
    getStats: () => ({
      chunks: world.readyCount,
      workers: world.workers.length,
      dimension: world.dimension,
      fps,
      drawCalls: renderer.gl.info.render.calls,
      triangles: renderer.gl.info.render.triangles,
    }),
    version: '1.8.0',
  };
}
try {
  boot();
} catch (e) {
  $('fatal-message').textContent = e.message;
  $('fatal').classList.remove('hidden');
  console.error(e);
}
