// Scripted surf bot used by the milestone gates. Runs the simulation
// synchronously through __surf.stepTicks for determinism and speed.
//
// Technique: pure pursuit. Yaw tracks the velocity heading so the strafe
// wishdir stays perpendicular to velocity (full 30 u/s per tick of redirect,
// the airstrafe trick); the strafe key is chosen by the sign of the angle
// to a pursuit point 0.42s ahead on the chosen face, 90u off the ridge.
//
// Usage (in a ?test=1 page):
//   botRun({ seed: 8, seconds: 35 }) -> { died, dist, peak, secs }

export function botSource() {
  return function botRun(opts) {
    const s = window.__surf
    const inp = window.__surfInput
    const { gen, game, controller } = window.__surfDebug
    const seconds = opts.seconds ?? 35
    const norm = (a) => {
      while (a > Math.PI) a -= 2 * Math.PI
      while (a < -Math.PI) a += 2 * Math.PI
      return a
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
    const simTicks = Math.round(64 * seconds)
    for (let t = 0; t < simTicks; t++) {
      const d = Math.max(0, game.distance)
      if (t <= 84) {
        // walk off the spawn platform
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
          const vh = speed > 60 ? Math.atan2(-s.vel.x, -s.vel.z) : cur.heading
          const rx = Math.cos(look.heading)
          const rz = -Math.sin(look.heading)
          const dh = Math.atan2(-(look.x + rx * 90 * face - s.pos.x), -(look.z + rz * 90 * face - s.pos.z))
          const dyaw = norm(dh - vh)
          if (slowTicks > 40) {
            // wedged: pure lateral strafe away from the ridge
            inp.set({ forward: false, back: false, left: face < 0, right: face > 0, jump: true, yaw: cur.heading, pitch: 0 })
          } else {
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
