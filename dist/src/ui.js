import { hotbar, names, B } from './blocks.js';
export const $ = (id) => document.getElementById(id);
export class UI {
  constructor(renderer) {
    this.selected = 0;
    this.renderer = renderer;
    this.blocks = [...hotbar];
    this.toastTimer = null;
    this.slots = [];
    hotbar.forEach((id, i) => {
      const button = document.createElement('button');
      button.className = 'slot' + (i === 0 ? ' selected' : '');
      button.setAttribute('aria-label', `${i + 1}: ${names[id]}`);
      button.title = `${i + 1} · ${names[id]}`;
      const num = document.createElement('span');
      num.className = 'number';
      num.textContent = i + 1;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      canvas
        .getContext('2d')
        .drawImage(
          renderer.atlasCanvas,
          (id % 8) * 16,
          Math.floor(id / 8) * 16,
          16,
          16,
          0,
          0,
          16,
          16,
        );
      button.append(num, canvas);
      button.addEventListener('click', () => this.select(i));
      $('hotbar').append(button);
      this.slots.push(button);
    });
    this.lastHealth = -1;
  }
  select(i) {
    this.selected = (i + 9) % 9;
    this.slots.forEach((s, n) => {
      s.classList.toggle('selected', n === this.selected);
      s.setAttribute('aria-pressed', String(n === this.selected));
    });
    $('selected-name').textContent = names[this.block];
  }
  get block() {
    return this.blocks[this.selected];
  }
  setBlock(id) {
    this.blocks[this.selected] = id;
    const button = this.slots[this.selected],
      canvas = button.querySelector('canvas');
    canvas.getContext('2d').clearRect(0, 0, 16, 16);
    canvas
      .getContext('2d')
      .drawImage(
        this.renderer.atlasCanvas,
        (id % 8) * 16,
        Math.floor(id / 8) * 16,
        16,
        16,
        0,
        0,
        16,
        16,
      );
    button.title = names[id];
    button.setAttribute('aria-label', `${this.selected + 1}: ${names[id]}`);
    this.select(this.selected);
  }
  buildPalette(onSelect) {
    const blocks = [
      B.TORCH,
      B.TNT,
      B.GRASS,
      B.DIRT,
      B.STONE,
      B.SAND,
      B.WOOD,
      B.LEAVES,
      B.WATER,
      B.SNOW,
      B.SNOW_LAYER,
      B.OBSIDIAN,
      B.NETHERRACK,
      B.LAVA,
      B.CRIMSON,
      B.WARPED,
      B.ORE,
      B.PLANKS,
      B.BRICK,
    ];
    for (const id of blocks) {
      const button = document.createElement('button'),
        canvas = document.createElement('canvas'),
        label = document.createElement('span');
      canvas.width = canvas.height = 16;
      canvas
        .getContext('2d')
        .drawImage(
          this.renderer.atlasCanvas,
          (id % 8) * 16,
          Math.floor(id / 8) * 16,
          16,
          16,
          0,
          0,
          16,
          16,
        );
      label.textContent = names[id];
      button.dataset.block = id;
      button.append(canvas, label);
      button.onclick = () => {
        this.setBlock(id);
        onSelect();
      };
      $('palette-grid').append(button);
    }
  }
  toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4200);
  }
  health(n, creative = false) {
    const stamp = `${n}:${creative}`;
    if (stamp === this.lastHealth) return;
    this.lastHealth = stamp;
    $('hearts').classList.toggle('creative', creative);
    if (creative) {
      $('hearts').textContent = '∞ CREATIVE';
      $('hearts').setAttribute('aria-label', 'Creative mode: no damage');
      return;
    }
    $('hearts').replaceChildren();
    for (let i = 0; i < 10; i++) {
      const h = document.createElement('span');
      h.textContent = '♥';
      h.className = n <= i * 2 ? 'empty' : '';
      if (n === i * 2 + 1) h.style.opacity = '.55';
      $('hearts').append(h);
    }
    $('hearts').setAttribute('aria-label', `${n} of 20 health`);
  }
  started() {
    document.body.classList.add('playing');
    $('welcome').classList.add('hidden');
    $('scene-caption').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('compass').classList.remove('hidden');
  }
  error(msg) {
    $('fatal-message').textContent = msg;
    $('fatal').classList.remove('hidden');
  }
}
