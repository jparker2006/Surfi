// Headless trap sweep. Drives the clean pursuit bot (bot.js) and the sloppy bot
// (sloppy-bot.js) across many seeds with the anomaly recorder enabled, harvests
// window.__surfAnomaly after each run, and aggregates detector counts plus the
// worst backward-drift dump (full 120 tick window) for building the regression.
//
// Runs entirely in a ?test=1 page via a single dynamic import, no node deps:
//   const m = await import('/tests/anomaly-sweep.js')
//   const report = m.runSweep({ seeds: [1,2,...,50], seconds: 40 })
//
// Gate reading: report.clean and report.sloppy must show backdrift === 0 and
// (stuck) speeddrop === 0 after the fix. multiplane/startsolid are context.

import { botSource } from './bot.js'
import { sloppyBotSource } from './sloppy-bot.js'
import { climberBotSource } from './climber-bot.js'

const botRun = botSource()
const sloppyBotRun = sloppyBotSource()
const climberBotRun = climberBotSource()

// Scan the recorder after one run: tally per detector and capture the worst
// dump per trap family (full 120 tick window) for building the regressions.
// stuckhigh/stuckonsteep (e/f) and eyeclip are per-tick tallies on the
// recorder; speeddrop/backdrift/multiplane/startsolid are counted from dumps.
function scanDumps(r, seed, bot) {
  const tally = {
    speeddrop: 0, backdrift: 0, multiplane: 0, startsolid: 0,
    stuckhigh: r.counts.stuckhigh, stuckonsteep: r.counts.stuckonsteep,
    eyeclip: r.counts.eyeclip,
  }
  let worstBack = null
  let worstDrop = null
  let worstStuckHigh = null
  let worstStuckSteep = null
  const worse = (cur, dump) => {
    const ratio = dump.horizAfter / Math.max(1, dump.horizBefore)
    if (cur && cur.ratio <= ratio) return cur
    return { seed, bot, ratio, alongVel: dump.alongVel, horizBefore: dump.horizBefore, horizAfter: dump.horizAfter, dist: dump.dist, atTickId: dump.atTickId, frames: dump.frames }
  }
  for (const dump of r.dumps) {
    if (dump.trigger in tally && dump.trigger !== 'stuckhigh' && dump.trigger !== 'stuckonsteep') tally[dump.trigger]++
    if (dump.trigger === 'backdrift') {
      if (!worstBack || dump.alongVel < worstBack.alongVel) {
        worstBack = { seed, bot, alongVel: dump.alongVel, dist: dump.dist, atTickId: dump.atTickId, frames: dump.frames }
      }
    }
    if (dump.trigger === 'speeddrop') worstDrop = worse(worstDrop, dump)
    if (dump.trigger === 'stuckhigh') worstStuckHigh = worse(worstStuckHigh, dump)
    if (dump.trigger === 'stuckonsteep') worstStuckSteep = worse(worstStuckSteep, dump)
  }
  return { tally, worstBack, worstDrop, worstStuckHigh, worstStuckSteep }
}

function blankSide() {
  return {
    speeddrop: 0, backdrift: 0, multiplane: 0, startsolid: 0,
    stuckhigh: 0, stuckonsteep: 0, eyeclip: 0,
    seedsWithBackdrift: [], seedsWithStuck: [], seedsWithEyeclip: [],
    seedsWithStuckHigh: [], seedsWithStuckSteep: [],
  }
}

export function runSweep(opts) {
  const r = window.__surfAnomaly
  if (!r) throw new Error('recorder missing, load with ?test=1')
  const seeds = opts.seeds ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const seconds = opts.seconds ?? 40

  const clean = blankSide()
  const sloppy = blankSide()
  const climber = blankSide()
  const perSeed = []
  let worstBackdrift = null
  let worstSpeeddrop = null
  let worstStuckHigh = null
  let worstStuckSteep = null

  const accumulate = (side, scan, seed) => {
    side.speeddrop += scan.tally.speeddrop
    side.backdrift += scan.tally.backdrift
    side.multiplane += scan.tally.multiplane
    side.startsolid += scan.tally.startsolid
    side.stuckhigh += scan.tally.stuckhigh
    side.stuckonsteep += scan.tally.stuckonsteep
    side.eyeclip += scan.tally.eyeclip
    if (scan.tally.backdrift > 0) side.seedsWithBackdrift.push(seed)
    if (scan.tally.speeddrop > 0) side.seedsWithStuck.push(seed)
    if (scan.tally.eyeclip > 0) side.seedsWithEyeclip.push(seed)
    if (scan.tally.stuckhigh > 0) side.seedsWithStuckHigh.push(seed)
    if (scan.tally.stuckonsteep > 0) side.seedsWithStuckSteep.push(seed)
    if (scan.worstBack && (!worstBackdrift || scan.worstBack.alongVel < worstBackdrift.alongVel)) worstBackdrift = scan.worstBack
    if (scan.worstDrop && (!worstSpeeddrop || scan.worstDrop.ratio < worstSpeeddrop.ratio)) worstSpeeddrop = scan.worstDrop
    if (scan.worstStuckHigh && (!worstStuckHigh || scan.worstStuckHigh.ratio < worstStuckHigh.ratio)) worstStuckHigh = scan.worstStuckHigh
    if (scan.worstStuckSteep && (!worstStuckSteep || scan.worstStuckSteep.ratio < worstStuckSteep.ratio)) worstStuckSteep = scan.worstStuckSteep
  }

  const slim = (t) => ({ speeddrop: t.speeddrop, backdrift: t.backdrift, stuckhigh: t.stuckhigh, stuckonsteep: t.stuckonsteep, eyeclip: t.eyeclip })

  for (const seed of seeds) {
    r.reset(seed); r.enabled = true
    const cleanRes = botRun({ seed, seconds })
    const cleanScan = scanDumps(r, seed, 'clean')
    accumulate(clean, cleanScan, seed)

    r.reset(seed); r.enabled = true
    const sloppyRes = sloppyBotRun({ seed, seconds })
    const sloppyScan = scanDumps(r, seed, 'sloppy')
    accumulate(sloppy, sloppyScan, seed)

    r.reset(seed); r.enabled = true
    const climberRes = climberBotRun({ seed, seconds })
    const climberScan = scanDumps(r, seed, 'climber')
    accumulate(climber, climberScan, seed)

    perSeed.push({
      seed,
      clean: { died: cleanRes.died, dist: cleanRes.dist, secs: cleanRes.secs, ...slim(cleanScan.tally) },
      sloppy: { died: sloppyRes.died, dist: sloppyRes.dist, secs: sloppyRes.secs, ...slim(sloppyScan.tally) },
      climber: { died: climberRes.died, dist: climberRes.dist, secs: climberRes.secs, ...slim(climberScan.tally) },
    })
  }

  r.enabled = false
  return {
    seedsRun: seeds.length,
    seconds,
    clean,
    sloppy,
    climber,
    worstBackdrift,
    worstSpeeddrop,
    worstStuckHigh,
    worstStuckSteep,
    perSeed,
  }
}
