// Sloppy surf bot. The clean pursuit bot in bot.js avoids the trap by staying
// low on the face and aiming at a smooth pursuit point well off the ridge. This
// variant deliberately courts the trap: it rides HIGH near the apex (where seam
// caps and the two-face ridge live), approaches seams at shallow angles, and
// periodically over-steers across the ridge into the opposite face. The jitter
// is driven by a per-seed PRNG so any trap it finds is reproducible.
//
// Same synchronous stepTicks(1) drive as bot.js. Run inside a ?test=1 page with
// the anomaly recorder enabled:
//   sloppyBotRun({ seed: 8, seconds: 40 }) -> { died, dist, peak, secs }

export function sloppyBotSource() {
  return function sloppyBotRun(opts) {
    const s = window.__surf
    const inp = window.__surfInput
    const { gen, game, controller } = window.__surfDebug
    const seconds = opts.seconds ?? 40
    const norm = (a) => {
      while (a > Math.PI) a -= 2 * Math.PI
      while (a < -Math.PI) a += 2 * Math.PI
      return a
    }
    // small deterministic PRNG so each seed's sloppiness is repeatable
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
    // sloppiness state: a lurch is a brief burst of over-steer toward the ridge
    let lurchLeft = 0
    let lurchDir = 1
    let offRidge = 34
    const simTicks = Math.round(64 * seconds)
    for (let t = 0; t < simTicks; t++) {
      const d = Math.max(0, game.distance)
      if (t <= 84) {
        inp.set({ forward: true, back: false, left: false, right: false, jump: false, yaw: 0, pitch: 0 })
      } else {
        const cur = gen.spineAt(d)
        const look = gen.spineAt(d + Math.max(160, s.speed * 0.34))
        if (cur && look) {
          const dx = s.pos.x - cur.x
          const dz = s.pos.z - cur.z
          const off = dx * Math.cos(cur.heading) - dz * Math.sin(cur.heading)
          if (Math.abs(off) > 50) face = Math.sign(off)
          const speed = s.speed
          if (speed > peak) peak = speed
          if (speed < 80) slowTicks++
          else slowTicks = 0

          // start a lurch every so often: ride up over the apex onto the far
          // face, the shallow-angle ridge crossing that triggers the trap
          if (lurchLeft <= 0 && rnd() < 0.03) {
            lurchLeft = 8 + Math.floor(rnd() * 14)
            lurchDir = rnd() < 0.5 ? 1 : -1
          }
          // drift the ride height: sometimes hug the apex (small offRidge),
          // sometimes sit lower, so seams are crossed at varied heights
          if (rnd() < 0.05) offRidge = 14 + rnd() * 50

          let aimOff = offRidge
          if (lurchLeft > 0) {
            lurchLeft--
            // aim ACROSS the ridge: negative offset pulls toward and over the apex
            aimOff = -20 * lurchDir
            face = lurchDir
          }

          const vh = speed > 60 ? Math.atan2(-s.vel.x, -s.vel.z) : cur.heading
          const rx = Math.cos(look.heading)
          const rz = -Math.sin(look.heading)
          const dh = Math.atan2(
            -(look.x + rx * aimOff * face - s.pos.x),
            -(look.z + rz * aimOff * face - s.pos.z),
          )
          const dyaw = norm(dh - vh)

          if (slowTicks > 40) {
            // wedged: try to escape laterally away from the ridge
            inp.set({ forward: false, back: false, left: face < 0, right: face > 0, jump: true, yaw: cur.heading, pitch: 0 })
          } else {
            // shallow approach: aim yaw nearly along velocity, weak correction
            inp.set({ forward: false, back: false, left: dyaw > 0.01, right: dyaw < -0.01, jump: false, yaw: vh, pitch: 0 })
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
