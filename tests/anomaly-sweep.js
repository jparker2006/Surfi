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

const botRun = botSource()
const sloppyBotRun = sloppyBotSource()

// Scan the recorder's dumps from one run: tally per detector, and find the most
// negative backward-drift and the worst single-tick speed drop.
function scanDumps(r, seed, bot) {
  // eyeclip is a per-tick tally on the recorder, not a dump trigger
  const tally = { speeddrop: 0, backdrift: 0, multiplane: 0, startsolid: 0, eyeclip: r.counts.eyeclip }
  let worstBack = null
  let worstDrop = null
  for (const dump of r.dumps) {
    tally[dump.trigger]++
    if (dump.trigger === 'backdrift') {
      if (!worstBack || dump.alongVel < worstBack.alongVel) {
        worstBack = { seed, bot, alongVel: dump.alongVel, dist: dump.dist, atTickId: dump.atTickId, frames: dump.frames }
      }
    }
    if (dump.trigger === 'speeddrop') {
      const ratio = dump.horizAfter / Math.max(1, dump.horizBefore)
      if (!worstDrop || ratio < worstDrop.ratio) {
        worstDrop = { seed, bot, ratio, horizBefore: dump.horizBefore, horizAfter: dump.horizAfter, dist: dump.dist, atTickId: dump.atTickId, frames: dump.frames }
      }
    }
  }
  return { tally, worstBack, worstDrop }
}

function blankSide() {
  return {
    speeddrop: 0, backdrift: 0, multiplane: 0, startsolid: 0, eyeclip: 0,
    seedsWithBackdrift: [], seedsWithStuck: [], seedsWithEyeclip: [],
  }
}

export function runSweep(opts) {
  const r = window.__surfAnomaly
  if (!r) throw new Error('recorder missing, load with ?test=1')
  const seeds = opts.seeds ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const seconds = opts.seconds ?? 40

  const clean = blankSide()
  const sloppy = blankSide()
  const perSeed = []
  let worstBackdrift = null
  let worstSpeeddrop = null

  const accumulate = (side, scan, seed, surviveSecs) => {
    side.speeddrop += scan.tally.speeddrop
    side.backdrift += scan.tally.backdrift
    side.multiplane += scan.tally.multiplane
    side.startsolid += scan.tally.startsolid
    side.eyeclip += scan.tally.eyeclip
    if (scan.tally.backdrift > 0) side.seedsWithBackdrift.push(seed)
    if (scan.tally.speeddrop > 0) side.seedsWithStuck.push(seed)
    if (scan.tally.eyeclip > 0) side.seedsWithEyeclip.push(seed)
    if (scan.worstBack && (!worstBackdrift || scan.worstBack.alongVel < worstBackdrift.alongVel)) {
      worstBackdrift = scan.worstBack
    }
    if (scan.worstDrop && (!worstSpeeddrop || scan.worstDrop.ratio < worstSpeeddrop.ratio)) {
      worstSpeeddrop = scan.worstDrop
    }
  }

  for (const seed of seeds) {
    r.reset(seed); r.enabled = true
    const cleanRes = botRun({ seed, seconds })
    const cleanScan = scanDumps(r, seed, 'clean')
    accumulate(clean, cleanScan, seed, cleanRes.secs)

    r.reset(seed); r.enabled = true
    const sloppyRes = sloppyBotRun({ seed, seconds })
    const sloppyScan = scanDumps(r, seed, 'sloppy')
    accumulate(sloppy, sloppyScan, seed, sloppyRes.secs)

    perSeed.push({
      seed,
      clean: { died: cleanRes.died, dist: cleanRes.dist, secs: cleanRes.secs, ...cleanScan.tally },
      sloppy: { died: sloppyRes.died, dist: sloppyRes.dist, secs: sloppyRes.secs, ...sloppyScan.tally },
    })
  }

  r.enabled = false
  return {
    seedsRun: seeds.length,
    seconds,
    clean,
    sloppy,
    worstBackdrift,
    worstSpeeddrop,
    perSeed,
  }
}
