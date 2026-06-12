// Milestone 1 automated gate. Run against a dev server with ?test=1, by
// evaluating this function in the page (e.g. via the Playwright MCP
// browser_evaluate tool, or paste into devtools).
//
// Asserts:
//   1. strafe-into-ramp gains more than 200 u/s over 2 seconds
//   2. speed is non-decreasing within a 5 u/s epsilon between samples
//   3. passive fall onto the ramp slides (speed grows with no input)
//   4. tick batching does not change the trajectory (framerate independence)
//
// Also check separately: zero console errors, screenshots look right.

export async function m1Gate() {
  const s = window.__surf
  const inp = window.__surfInput
  if (!s || !inp) throw new Error('test api missing, load with ?test=1')

  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const results = {}

  // 1 + 2: strafe into the left face of the main test ramp
  inp.set({ right: true, yaw: 15 * Math.PI / 180, pitch: 0, forward: false, back: false, left: false, jump: false })
  s.teleport(-250, -140, -600)
  s.setVelocity(0, 0, -300)
  await wait(200) // settle onto the face
  const speeds = []
  for (let i = 0; i < 21; i++) {
    speeds.push(s.speed)
    await wait(100)
  }
  results.gain = speeds[speeds.length - 1] - speeds[0]
  results.gainPass = results.gain > 200
  results.monotonic = speeds.every((v, i) => i === 0 || v >= speeds[i - 1] - 5)

  // 3: passive slide
  inp.set({ right: false, yaw: 0, pitch: 0, forward: false, back: false, left: false, jump: false })
  s.teleport(-250, -140, -600)
  s.setVelocity(0, 0, 0)
  await wait(1200)
  results.passiveSlideSpeed = s.speed
  results.passiveSlidePass = s.speed > 100

  // 4: determinism across tick batching (synchronous, render loop cannot interleave)
  inp.set({ right: true, yaw: 15 * Math.PI / 180, pitch: 0, forward: false, back: false, left: false, jump: false })
  const run = (batch) => {
    s.teleport(-250, -140, -600)
    s.setVelocity(0, 0, -300)
    let n = 256
    while (n > 0) {
      const k = Math.min(batch, n)
      s.stepTicks(k)
      n -= k
    }
    return [s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z]
  }
  const a = run(256)
  const b = run(1)
  const c = run(7)
  results.deterministic = a.every((x, i) => x === b[i] && x === c[i])

  inp.clear()
  s.teleport(0, 36.1, 40)

  results.pass = results.gainPass && results.monotonic && results.passiveSlidePass && results.deterministic
  return results
}
