# SURFI

A browser recreation of CS:GO surf. First person, desktop only, one endless
procedurally generated psychedelic level: **acidsurf**. Survive by distance:
ride the ramps until you fall.

## The physics

The point of this project is the movement, not the visuals. Source engine
surf works because of two pieces of math, and both are ported here exactly,
with no physics library:

1. **Air acceleration with a tiny wishspeed cap.** While airborne, holding a
   strafe key adds velocity along the wish direction, but the projection of
   your velocity onto that direction is capped at 30 u/s. The cap is the
   entire trick: it means a wish direction perpendicular to your velocity can
   always add speed, so steering into a ramp face while strafing gains speed
   continuously. `sv_airaccelerate` is 150, the surf server standard.

2. **Velocity clipping on contact (ClipVelocity, overbounce 1.0).** Hitting a
   plane removes only the velocity component into the plane. On a steep ramp
   face (normal y below 0.7, never walkable) this converts gravity into speed
   along the face. Falling onto a ramp makes you slide; strafing into it
   makes you fast.

Movement integration is a port of Source `TryPlayerMove`: swept AABB traces
against convex brushes (Minkowski plane expansion with Quake style bevel
planes), up to four clip iterations per tick, crease handling, and a fix for
the classic Source rampbug at brush seams. Fixed 64 tick simulation with
render interpolation; physics is framerate independent.

Units are Hammer units: gravity 800, max ground speed 250, hull 32x32x72,
eye height 64, jump impulse 301.99, FOV 100 (Source style horizontal).

## Controls

- WASD plus pointer lock mouse. Strafe into the ramp face to gain speed.
- Space: jump. R: instant respawn. M: mute the drone.
- Backtick or F3: debug panel with live physics constants, fly mode, and
  collision wireframes.

## Development

```
npm install
npm run dev       # dev server
npm run build     # typecheck + production build to dist/
npm run preview   # serve the production build
```

### Test instrumentation

Load any build with `?test=1` to expose deterministic hooks (pointer lock is
bypassed):

- `window.__surf`: live physics state (speed, pos, vel, airborne,
  onSurfPlane, distance, tick), plus `teleport`, `setVelocity`, `respawn`,
  `stepTicks(n)` for synchronous deterministic stepping, and `spineAt(d)`
  for course queries.
- `window.__surfInput.set({forward, back, left, right, jump, yaw, pitch})`:
  programmatic input injection.
- `?seed=N` forces a generation seed.

The milestone gates live in `tests/`: `m1-gate.js` (speed gain, passive
slide, tick determinism), `m2-gate.js` (scripted survival, death, respawn,
persistence), and `bot.js` (the pure pursuit surf bot used to drive runs).

## Architecture

A level is a plain config module (`src/levels/acidsurf.ts`): generation
weights and difficulty curves, palette and postprocessing parameters, audio
drone parameters, optional physics overrides. Engine code (physics, player,
loop, HUD, generation, fx) is level agnostic; adding a second level means
writing one new config file.

## Deploy

Static Vite build, deployed on Vercel:

```
vercel deploy --prod
```
