import { propagateLight } from '../block-light.js';
self.onmessage = ({ data: m }) => {
  const data = propagateLight(new Uint8Array(m.voxels), m.size, m.held);
  self.postMessage({ data, origin: m.origin, epoch: m.epoch }, [data.buffer]);
};
