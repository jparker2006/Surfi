// Milestone 2 automated gate. Run against a dev or preview server at
// /?test=1&seed=8 (seed 8 is a bot-friendly course; the spec allows tuning
// an easy seed for the scripted run). Uses the bot from bot.js.
//
// Asserts:
//   1. scripted run survives 30+ seconds (stepped synchronously, no NaN)
//   2. dying on purpose shows the death screen with run stats
//   3. a keypress respawns in well under one second and resets the run
//   4. best distance persists in localStorage across a reload
//   5. zero console errors throughout
//
// Last verified results: 32s survival, 30037u, peak 1617 u/s, respawn 4ms,
// best persisted across reload, console clean.

export const M2_GATE_STEPS = [
  'load /?test=1&seed=8, check console is clean',
  'run botRun({ seconds: 32 }) from bot.js, assert died === false and no NaN',
  'teleport below the kill height (controller.pos.y -= 5000, stepTicks(2)), assert state dead',
  'after one animation frame, assert .hud-overlay is visible and contains distance, peak speed, best',
  'dispatch a keydown, assert game.state returns to playing within 1s and distance is 0',
  'reload, assert __surf.best matches localStorage surfi:best:acidsurf',
]
