// Simulation and mesh coordinates use integer voxels. One voxel is one metre;
// actors and physical speeds are converted to this grid, never camera-scaled.
export const BLOCK_SIZE = 1;
export const U = 1 / BLOCK_SIZE;
export const PLAYER_WIDTH = 0.6 * U;
export const PLAYER_HEIGHT = 1.8 * U;
export const EYE_HEIGHT = 1.62 * U;
export const REACH = 7 * U;
