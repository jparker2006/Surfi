// Source engine movement constants in Hammer units. 1 world unit = 1 Hammer unit.
// All values are live-tunable from the debug panel, which mutates this object.

export const consts = {
  gravity: 800,
  airAccelerate: 150,
  // Tiny airborne wishspeed cap. This cap is the entire surf trick, do not raise it.
  airSpeedCap: 30,
  maxVelocity: 3500,
  friction: 4,
  stopSpeed: 100,
  groundAccelerate: 5.5,
  maxGroundSpeed: 250,
  // Source standard jump: sqrt(2 * 800 * 57), a 57 unit apex
  jumpImpulse: 301.993377,
  hullWidth: 32,
  hullHeight: 72,
  eyeHeight: 64,
  // Source style horizontal FOV at 4:3, converted to vertical for Three.js
  fov: 100,
  // Degrees of view rotation per mouse count, CS default feel
  sensitivity: 0.022,
  tickRate: 64,
}

export type Consts = typeof consts
