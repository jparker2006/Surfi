// Climber surf bot. The clean pursuit bot (bot.js) rides a smooth line 90u off
// the ridge and the sloppy bot lurches but still stays mostly low. Neither ever
// rides up near the apex, which is why the gates miss the apex/steep-side stick
// humans hit. This bot is a competent surfer (it keeps speed and survives, so it
// actually traverses the course) that deliberately rides HIGH: it pursues a
// point only a few units off the ridge, periodically pushes right up to the
// crest, and air-strafes into the ridge. That is the human play that pins the
// hull against the apex. The jitter is a per-seed PRNG so traps are reproducible.
//
// Same synchronous stepTicks(1) drive as bot.js. Run inside a ?test=1 page with
// the anomaly recorder enabled:
//   climberBotRun({ seed: 8, seconds: 40 }) -> { died, dist, peak, secs }

export function climberBotSource() {
  return function climberBotRun(opts) {
    const s = window.__surf
    const inp = window.__surfInput
    const { gen, game, controller } = window.__surfDebug
    const seconds = opts.seconds ?? 40
    const norm = (a) => {
      while (a > Math.PI) a -= 2 * Math.PI
      while (a < -Math.PI) a += 2 * Math.PI
      return a
    }
    let rs = (opts.seed ?? 1) >>> 0
    const rnd = () => {
      rs = (rs + 0x6d2b79f5) >>> 0
      let t = rs
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    game.startRun()
    if (opts.seed !== undefined) {
      gen.reset(opts.seed)
      game.distance = 0
      game.spineIndex = 0
      game.peakSpeed = 0
      controller.pos.set(0, 36.1, 40)
      controller.vel.set(0, 0, 0)
    }

    let face = 1
    let slowTicks = 0
    let peak = 0
    // ride height: how far off the ridge the pursuit point sits. Clean bot uses
    // 90; the climber sits much closer and periodically hugs the crest.
    let offRidge = 34
    let crestLeft = 0
    const simTicks = Math.round(64 * seconds)
    for (let t = 0; t < simTicks; t++) {
      const d = Math.max(0, game.distance)
      if (t <= 84) {
        inp.set({ forward: true, back: false, left: false, right: false, jump: false, yaw: 0, pitch: 0 })
      } else {
        const cur = gen.spineAt(d)
        const look = gen.spineAt(d + Math.max(200, s.speed * 0.42))
        if (cur && look) {
          const dx = s.pos.x - cur.x
          const dz = s.pos.z - cur.z
          const off = dx * Math.cos(cur.heading) - dz * Math.sin(cur.heading)
          if (Math.abs(off) > 50) face = Math.sign(off)
          const speed = s.speed
          if (speed > peak) peak = speed
          if (speed < 80) slowTicks++
          else slowTicks = 0

          // periodically hug the crest hard for a burst: pursue only a few units
          // off the ridge so the hull rides up to straddle the apex
          if (crestLeft <= 0 && rnd() < 0.04) crestLeft = 18 + Math.floor(rnd() * 30)
          // otherwise drift the base ride height, staying higher than the clean bot
          if (crestLeft <= 0 && rnd() < 0.05) offRidge = 18 + rnd() * 34

          let aimOff = offRidge
          if (crestLeft > 0) { crestLeft--; aimOff = 4 + rnd() * 8 }

          const vh = speed > 60 ? Math.atan2(-s.vel.x, -s.vel.z) : cur.heading
          const rx = Math.cos(look.heading)
          const rz = -Math.sin(look.heading)
          const dh = Math.atan2(
            -(look.x + rx * aimOff * face - s.pos.x),
            -(look.z + rz * aimOff * face - s.pos.z),
          )
          const dyaw = norm(dh - vh)
          if (slowTicks > 40) {
            // wedged: pure lateral strafe away from the ridge to recover
            inp.set({ forward: false, back: false, left: face < 0, right: face > 0, jump: true, yaw: cur.heading, pitch: 0 })
          } else {
            // air-strafe along velocity toward the high pursuit point
            inp.set({ forward: false, back: false, left: dyaw > 0.015, right: dyaw < -0.015, jump: false, yaw: vh, pitch: 0 })
          }
        }
      }
      s.stepTicks(1)
      if (game.state === 'dead') {
        inp.clear()
        return { died: true, dist: Math.round(game.distance), peak: Math.round(peak), secs: Math.round((t / 64) * 10) / 10 }
      }
    }
    inp.clear()
    return { died: false, dist: Math.round(game.distance), peak: Math.round(peak), secs: seconds }
  }
}
