// Amanatides–Woo traversal. Tied plane crossings advance all tied axes, so
// exact edge/corner rays do not hit cells touched only at a zero-area boundary.
export function raycast(get, origin, direction, maxDistance = 7, predicate = (b) => b !== 0) {
  let x = Math.floor(origin.x),
    y = Math.floor(origin.y),
    z = Math.floor(origin.z),
    t = 0,
    normal = { x: 0, y: 0, z: 0 };
  const step = {},
    delta = {},
    next = {};
  for (const a of ['x', 'y', 'z']) {
    step[a] = Math.sign(direction[a]);
    delta[a] = direction[a] === 0 ? Infinity : Math.abs(1 / direction[a]);
    const cell = Math.floor(origin[a]);
    next[a] =
      direction[a] === 0
        ? Infinity
        : ((direction[a] > 0 ? cell + 1 : cell) - origin[a]) / direction[a];
  }
  while (t <= maxDistance) {
    const block = get(x, y, z);
    if (predicate(block)) return { x, y, z, block, normal: { ...normal }, distance: t };
    const min = Math.min(next.x, next.y, next.z);
    if (!Number.isFinite(min)) break;
    t = min;
    normal = { x: 0, y: 0, z: 0 };
    for (const a of ['x', 'y', 'z'])
      if (Math.abs(next[a] - min) < 1e-9) {
        if (a === 'x') x += step.x;
        if (a === 'y') y += step.y;
        if (a === 'z') z += step.z;
        next[a] += delta[a];
        if (!normal.x && !normal.y && !normal.z) normal[a] = -step[a];
      }
  }
  return null;
}
