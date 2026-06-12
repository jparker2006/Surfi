// Deterministic regression for the surf trap. Two real traps were captured by
// the sloppy bot sweep (tests/anomaly-sweep.js) and reduced here to a fixed
// start state plus a recorded input sequence on a fixed seed. The geometry is
// deterministic from the seed, so replaying the inputs through controller.tick
// reproduces the trap every run, with no dependency on bot logic or timing.
//
// Run in a ?test=1 page:
//   const m = await import('/tests/trap-repro.js'); m.runTrapRepro()
//
// Root cause (confirmed from the captured plane configs): a Minkowski bevel
// plane is reported as the surface contact and clips off the player's forward
// velocity, even though the player is riding a real ramp face. Bevels exist
// only to tighten the swept-hull polytope at edges; they must never act as a
// wall that destroys surf speed.
//
//   CASE A (seed 36): a fast clean surf (alongVel 92 -> 283 u/s) collapses to
//   47 u/s in a single tick when the trace returns bevel normal [0, 0.37, 0.93]
//   (brush face is real [0.82, 0.56, 0.11]). |n.y| = 0.37 is just over the old
//   redirect's 0.35 ceiling, so the bevel was kept. This case starts from a
//   clean free fall onto the face, so it isolates the bevel wall locally: a
//   fixed start state plus a recorded input sequence reproduce it every run.
//   Signature: along-course speed collapses while horizontal speed is high.
//
//   CASE B (seed 39): backward drift. The player arrives slow and off line
//   (upstream bevel walls having robbed speed), falls into a pocket, climbs a
//   face under gravity, runs out of speed, and slides back down the course
//   (alongVel crosses zero to negative). It is emergent, not a local clip, so
//   it is reproduced end to end with the deterministic (seeded) sloppy bot:
//   buggy code drifts backward here, the fix keeps the player fast and out of
//   the pocket. Signature: zero backdrift detector events across the run.
//
//   CASE D (seed 38): the apex/steep-side stick humans hit and the clean and
//   sloppy bots miss (the climber bot in climber-bot.js finds it). A rider
//   surfing high near the ridge drops onto the crest from one airborne tick and
//   the trace returns the apex edge bevel [0, 0.37, 0.93] (the SAME bevel family
//   as CASE A) as a head-on wall, collapsing along-course speed 1355 -> 358 in
//   one tick. CASE A's free fall is caught by the old redirect because the hull
//   starts within 0.5u of the real face (faceMaxD1 <= 0.5); here the hull drops
//   from above so faceMaxD1 > 0.5 and the old guard let the bevel through. A
//   fixed start state plus the recorded inputs reproduce it every run.
//   Signature: along-course speed collapses while horizontal speed stays high.

import { sloppyBotSource } from './sloppy-bot.js'
import { botSource } from './bot.js'

const TICK = 1 / 64

// CASE A data: a fixed free-fall start and the recorded input sequence that
// lands on the face and surfs into the bevel wall on seed 36.
const CASE_A = {
  name: 'seed36-bevel-wall',
  seed: 36,
  trapDist: 8064,
  start: {
    pos: [1172.099775288847, -975.6544055687793, -7880.163243681971],
    vel: [43.148635710659946, -298.006623, -12.073492017534464],
  },
  inputs: [
    { r: 1, j: 1, y: -0.56435 }, { r: 1, j: 1, y: -0.56435 }, { r: 1, j: 1, y: -0.56435 },
    { r: 1, j: 1, y: -0.56435 }, { r: 1, j: 1, y: -0.56435 }, { r: 1, j: 1, y: -0.56435 },
    { l: 1, y: -1.6099 }, { l: 1, y: -1.45873 }, { l: 1, y: -1.32599 }, { l: 1, y: -1.21232 },
    { l: 1, y: -1.11601 }, { l: 1, y: -1.03447 }, { l: 1, y: -0.96506 }, { l: 1, y: -0.90761 },
    { l: 1, y: -0.85382 },
  ],
}

// CASE B: the seed that drifts backward end to end under the deterministic
// sloppy bot on buggy code.
const CASE_B_SEED = 39

// CASE D data: the captured pre-trap state (full precision) four ticks before
// the apex bevel hit on seed 38, plus the recorded inputs that ride into it.
const CASE_D = {
  name: 'seed38-apex-bevel-wall',
  seed: 38,
  trapDist: 7606,
  start: {
    pos: [186.5289135220334, -1249.8902607418145, -7627.741650242171],
    vel: [707.3912648559774, -307.5257269070761, -1147.9874285909266],
  },
  inputs: [
    { l: 1, y: -0.5522470746773309 },
    { l: 1, y: -0.54832107507576 },
    { l: 1, y: -0.5444278182763219 },
    { l: 1, y: -0.5223185974674989 },
  ],
}

function frameOf(inp) {
  return {
    forward: !!inp.f, back: !!inp.b, left: !!inp.l, right: !!inp.r,
    jump: !!inp.j, yaw: inp.y ?? 0, pitch: 0,
  }
}

// nearest spine index to a world position, to prime gen.progress's local search
function primeIndex(gen, pos) {
  const pts = gen.spine
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].pos.x - pos.x
    const dz = pts[i].pos.z - pos.z
    const d = dx * dx + dz * dz
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

function replay(c) {
  const { gen, controller } = window.__surfDebug
  gen.reset(c.seed)
  gen.ensure(c.trapDist + 1200)
  controller.recording = false
  controller.pos.set(c.start.pos[0], c.start.pos[1], c.start.pos[2])
  controller.vel.set(c.start.vel[0], c.start.vel[1], c.start.vel[2])

  let idx = primeIndex(gen, controller.pos)
  const trace = []
  for (const inp of c.inputs) {
    controller.tick(frameOf(inp), gen.collision, TICK)
    const prog = gen.progress(controller.pos, idx)
    idx = prog.index
    const dir = gen.spineDirAt(prog.index)
    const along = controller.vel.x * dir.x + controller.vel.z * dir.z
    const horiz = Math.hypot(controller.vel.x, controller.vel.z)
    trace.push({ horiz, along })
  }
  return trace
}

export function runTrapRepro() {
  const results = []

  // CASE A: a fixed replay. Along-course speed must not collapse while
  // horizontal speed is still high (the bevel wall stealing surf speed).
  const a = replay(CASE_A)
  const peakA = Math.max(...a.map((f) => f.along))
  const endA = a[a.length - 1].along
  const collapsedA = endA < 0.5 * peakA
  results.push({
    case: CASE_A.name,
    peakAlong: Math.round(peakA),
    endAlong: Math.round(endA),
    ratio: Math.round((endA / peakA) * 100) / 100,
    trapReproduced: collapsedA,
    pass: !collapsedA,
  })

  // CASE D: a fixed replay of the apex bevel landing. Same assertion as CASE A:
  // along-course speed must not collapse while horizontal speed is still high.
  const dd = replay(CASE_D)
  const peakD = Math.max(...dd.map((f) => f.along))
  const endD = dd[dd.length - 1].along
  const collapsedD = endD < 0.5 * peakD
  results.push({
    case: CASE_D.name,
    peakAlong: Math.round(peakD),
    endAlong: Math.round(endD),
    ratio: Math.round((endD / peakD) * 100) / 100,
    trapReproduced: collapsedD,
    pass: !collapsedD,
  })

  // CASE B: end to end. The deterministic sloppy bot on the trapping seed must
  // produce zero backward-drift detector events.
  const r = window.__surfAnomaly
  if (!r) throw new Error('recorder missing, load with ?test=1')
  // CASE A's replay disabled controller recording; the recorder only samples
  // while it is on, so re-enable it for the bot driven run
  window.__surfDebug.controller.recording = true
  const sloppyBotRun = sloppyBotSource()
  r.reset(CASE_B_SEED)
  r.enabled = true
  sloppyBotRun({ seed: CASE_B_SEED, seconds: 45 })
  r.enabled = false
  const backdrift = r.counts.backdrift
  results.push({
    case: `seed${CASE_B_SEED}-backward-drift`,
    backdriftEvents: backdrift,
    trapReproduced: backdrift > 0,
    pass: backdrift === 0,
  })

  // CASE C: the odometer is peak arc length and must never decrease on screen,
  // no matter how the player moves. Build real distance with the clean bot,
  // then physically place the player back down the course and confirm the
  // displayed distance holds at its peak.
  const { gen, game, controller } = window.__surfDebug
  const botRun = botSource()
  botRun({ seed: 8, seconds: 4 })
  game.forcePlaying()
  const peak = game.distance
  let monotonic = true
  let prev = game.distance
  for (let k = 1; k <= 80; k++) {
    const back = gen.spineAt(Math.max(0, peak - k * 40))
    if (back) controller.pos.set(back.x, back.y + 20, back.z)
    game.onTick()
    if (game.distance < prev - 1e-6) monotonic = false
    prev = game.distance
  }
  results.push({
    case: 'odometer-monotonic',
    peak: Math.round(peak),
    afterBackward: Math.round(game.distance),
    pass: monotonic && game.distance >= Math.floor(peak),
  })

  const pass = results.every((rr) => rr.pass)
  return { pass, results }
}
