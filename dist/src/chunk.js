import { H, S } from './blocks.js';
import { THREE } from './renderer.js';
export class Chunk {
  constructor(cx, cz, owner) {
    this.cx = cx;
    this.cz = cz;
    this.owner = owner;
    this.data = null;
    this.columns = [];
    this.dirty = new Set();
    this.urgentSections = new Set();
    this.sections = new Map();
    this.revision = 0;
    this.sectionRevisions = new Uint32Array(H / S);
    this.appliedRevisions = new Int32Array(H / S).fill(-1);
    this.visibleSolids = new Map();
    this.pendingOpen = new Map();
    this.meshing = false;
    this.ready = false;
  }
  apply(result, renderer, ready = true) {
    for (const s of result) {
      const old = this.sections.get(s.sy);
      if (old)
        for (const m of old) {
          renderer.scene.remove(m);
          m.geometry.dispose();
        }
      const meshes = [];
      for (const kind of ['opaque', 'cutout', 'water', 'effects']) {
        const g = s[kind];
        if (!g.index.length) continue;
        const geometry = new THREE.BufferGeometry();
        for (const attr of ['position', 'normal', 'color', 'uv', 'flow', 'kind', 'sky'])
          geometry.setAttribute(
            attr,
            new THREE.BufferAttribute(
              g[attr],
              attr === 'uv' || attr === 'flow' ? 2 : attr === 'kind' || attr === 'sky' ? 1 : 3,
            ),
          );
        geometry.setIndex(new THREE.BufferAttribute(g.index, 1));
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, s.sy * 16 + 8, 8), 14.1);
        const mesh = new THREE.Mesh(geometry, renderer[kind] || renderer.opaque);
        mesh.position.set(this.cx * 16, 0, this.cz * 16);
        if (kind === 'water') mesh.layers.set(1);
        mesh.renderOrder = kind === 'water' || kind === 'effects' ? 1 : 0;
        renderer.scene.add(mesh);
        meshes.push(mesh);
      }
      this.sections.set(s.sy, meshes);
      this.appliedRevisions[s.sy] = s.revision ?? 0;
      this.urgentSections.delete(s.sy);
      if (s.collision) this.visibleSolids.set(s.sy, s.collision);
    }
    this.ready = this.sections.size === H / S;
  }
  dispose(renderer) {
    for (const ms of this.sections.values())
      for (const m of ms) {
        renderer.scene.remove(m);
        m.geometry.dispose();
      }
    this.sections.clear();
    this.visibleSolids.clear();
    this.pendingOpen.clear();
    this.data = null;
  }
}
