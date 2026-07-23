export function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

export function firstField(fields, keys) {
  for (const key of keys) {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== '') return fields[key]
  }
  return null
}

// OCR often appends stray characters after the "N/M" value (e.g. the game's
// "[Completed]" tag or background noise); keep only the N/M part.
function cleanWorldSequence(raw) {
  if (raw === null || raw === undefined) return null
  const match = String(raw).match(/(\d+)\s*\/\s*(\d+)/)
  return match ? `${match[1]}/${match[2]}` : raw
}

// A run that made it to world 6/1 finished the campaign — the game's own
// "[Completed]" tag next to World/Sequence is OCR-unreliable, but the world
// number itself is verified, so reaching world 6 is the completion signal.
function isCompletedRun(worldSequence) {
  const match = String(worldSequence || '').match(/^(\d+)\s*\//)
  return match ? Number(match[1]) >= 6 : false
}

// A real per-continue penalty knocks the displayed score down from the
// breakdown sum by a clean number of millions without changing its digit
// count. OCR dropping the score's leading digit group (e.g. reading
// "5,034,170" as "34,170") looks arithmetically identical — "sum minus a
// clean number of millions" — but sheds whole digits. Only trust the OCR
// score as-is if it isn't that kind of truncation.
// Largest gap still explainable as real continue penalties; keep in sync with
// MAX_CONTINUE_PENALTY in electron/parseRunScreens.cjs.
const MAX_CONTINUE_PENALTY = 3000000

function scoreLooksTruncated(ocrScore, breakdownScore) {
  if (breakdownScore <= 0) return false
  const penalty = breakdownScore - ocrScore
  if (penalty <= 0 || penalty % 1000000 !== 0) return false
  // Two misread signatures, both indistinguishable from continue penalties by
  // arithmetic alone: losing whole leading digits ("5,034,170" as "34,170"),
  // or a single leading digit read wrong ("8,042,480" as "1,042,480", a clean
  // 7,000,000 gap at the same digit count). Beyond a few continues' worth,
  // the six-component sum is the more trustworthy reading.
  return String(breakdownScore).length - String(ocrScore).length > 1 || penalty > MAX_CONTINUE_PENALTY
}

export function normalizeCapture(capture) {
  const fields = capture.fields || {}
  const breakdown = {
    enemies: numeric(firstField(fields, ['enemies'])),
    bosses: numeric(firstField(fields, ['bosses', 'llBosses'])),
    scoreTokens: numeric(firstField(fields, ['scoreTokens'])),
    chain: numeric(firstField(fields, ['chain'])),
    pads: numeric(firstField(fields, ['pads'])),
    other: numeric(firstField(fields, ['other'])),
  }
  const ocrScore = numeric(firstField(fields, ['score']))
  const breakdownScore = Object.values(breakdown).reduce((total, value) => total + (value || 0), 0)
  const useBreakdownScore = breakdownScore > (ocrScore || 0)
    && ((ocrScore || 0) < 1000 || scoreLooksTruncated(ocrScore || 0, breakdownScore))
  return {
    id: capture.id,
    capturedAt: capture.capturedAt,
    pageCount: capture.pageCount || 0,
    sections: capture.sections || [],
    pages: capture.pages || [],
    decks: capture.decks || [],
    fields,
    score: useBreakdownScore ? breakdownScore : (ocrScore || 0),
    scoreSource: useBreakdownScore ? 'breakdown-minimum' : 'ocr',
    time: firstField(fields, ['time']),
    difficulty: firstField(fields, ['difficulty']),
    ship: firstField(fields, ['ship']),
    worldSequence: cleanWorldSequence(firstField(fields, ['worldSequence'])),
    completed: isCompletedRun(cleanWorldSequence(firstField(fields, ['worldSequence']))),
    glimmerCollected: numeric(firstField(fields, ['glimmerCollected'])),
    stackUpgrades: numeric(firstField(fields, ['stackUpgrades'])),
    evolutions: numeric(firstField(fields, ['evolutions'])),
    enemiesDestroyed: numeric(firstField(fields, ['enemiesDestroyed'])),
    minibossesDestroyed: numeric(firstField(fields, ['minibossesDestroyed'])),
    bonusWavesCompleted: numeric(firstField(fields, ['bonusWavesCompleted'])),
    artifactChainsCompleted: numeric(firstField(fields, ['artifactChainsCompleted'])),
    travelDistance: numeric(firstField(fields, ['travelDistance'])),
    shieldsLost: numeric(firstField(fields, ['shieldsLost'])),
    tokensCollected: numeric(firstField(fields, ['tokensCollected'])),
    strikeAttacks: numeric(firstField(fields, ['strikeAttacks'])),
    padsUsed: numeric(firstField(fields, ['padsUsed', 'pads'])),
    lettersCollected: numeric(firstField(fields, ['lettersCollected'])),
    rainbowModes: numeric(firstField(fields, ['rainbowModes'])),
    maxChain: numeric(firstField(fields, ['maxChain', 'chain'])),
    maxStrikeCombo: numeric(firstField(fields, ['maxStrikeCombo'])),
    enemies: breakdown.enemies,
    bosses: breakdown.bosses,
    scoreTokens: breakdown.scoreTokens,
    chain: breakdown.chain,
    pads: breakdown.pads,
    other: breakdown.other,
  }
}

// One entry per tracked run metric; lowerIsBetter flips the "new best"
// comparison (losing fewer shields is the achievement).
export const RUN_METRICS = [
  { key: 'score', label: 'Score', kind: 'score' },
  { key: 'time', label: 'Time', kind: 'duration' },
  { key: 'glimmerCollected', label: 'Glimmer Collected' },
  { key: 'stackUpgrades', label: 'Stack Upgrades' },
  { key: 'evolutions', label: 'Evolutions' },
  { key: 'enemiesDestroyed', label: 'Enemies Destroyed' },
  { key: 'minibossesDestroyed', label: 'Minibosses Destroyed' },
  { key: 'bonusWavesCompleted', label: 'Bonus Waves Completed' },
  { key: 'artifactChainsCompleted', label: 'Artifact Chains Completed' },
  { key: 'travelDistance', label: 'Travel Distance' },
  { key: 'shieldsLost', label: 'Shields Lost', lowerIsBetter: true },
  { key: 'tokensCollected', label: 'Tokens Collected' },
  { key: 'strikeAttacks', label: 'Strike Attacks' },
  { key: 'padsUsed', label: 'Pads Used' },
  { key: 'lettersCollected', label: 'Letters Collected' },
  { key: 'rainbowModes', label: 'Rainbow Modes' },
  { key: 'maxChain', label: 'Max Chain' },
  { key: 'maxStrikeCombo', label: 'Max Strike Combo' },
  { key: 'enemies', label: 'Enemies', group: 'breakdown' },
  { key: 'bosses', label: 'Bosses', group: 'breakdown' },
  { key: 'scoreTokens', label: 'Score Tokens', group: 'breakdown' },
  { key: 'chain', label: 'Chain', group: 'breakdown' },
  { key: 'pads', label: 'Pads', group: 'breakdown' },
  { key: 'other', label: 'Other', group: 'breakdown' },
]

export const SHIPS = ['Redeemer', 'Defier', 'Sentinel']

// The pre-run deck picker (8 of these 16, chosen before every run) never
// shows up on the results screen or anywhere in the save file, so there's no
// way to capture it automatically. Pulse just lets the player tag a run with
// what they picked, after the fact.
export const DECKS = [
  'Blaster', 'Striker', 'Drones', 'Formations',
  'Missile', 'Movement', 'Protector', 'Collector',
  'Exotic', 'Gambler', 'Spammer', 'Time',
  'Wild', 'Blight', 'Manipulator', 'Chaos',
]
export const DECK_COUNT = 8

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// How many recent same-ship runs form the baseline a run is judged against,
// the minimum needed before an arrow is meaningful, and the ±band around the
// baseline that counts as "flat" (no arrow).
const TENDENCY_WINDOW = 10
const TENDENCY_MIN = 3
const TENDENCY_DEADBAND = 0.05

// Per-metric tendency for a run entry: an up/down arrow saying whether this
// run was above or below the player's recent form for that metric. The
// baseline is the MEDIAN of the last few same-ship runs before this one —
// median (not best or mean) so a couple of fail runs in the window barely
// move it. Strictly backward-looking, so an entry's arrows never shift as
// later runs arrive; and because this is recomputed live from the current
// capture list every render, deleting a run drops it out of every later
// entry's baseline and the arrows recalculate automatically.
export function metricTendencies(capture, captures) {
  const run = normalizeCapture(capture)
  const asOf = new Date(capture.capturedAt).getTime()
  const priorSameShip = captures
    .map(normalizeCapture)
    .filter((item) => item.ship === run.ship && new Date(item.capturedAt).getTime() < asOf)
    .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
  const tendencies = new Map()
  for (const metric of RUN_METRICS) {
    const value = run[metric.key]
    if (typeof value !== 'number') continue
    const window = []
    for (const item of priorSameShip) {
      const v = item[metric.key]
      if (typeof v === 'number') window.push(v)
      if (window.length === TENDENCY_WINDOW) break
    }
    if (window.length < TENDENCY_MIN) continue
    const baseline = median(window)
    const scale = Math.abs(baseline) || 1
    if (Math.abs(value - baseline) / scale < TENDENCY_DEADBAND) continue
    const better = metric.lowerIsBetter ? value < baseline : value > baseline
    tendencies.set(metric.key, better ? 'up' : 'down')
  }
  return tendencies
}

// Which of this run's metrics are the CURRENT record — compared against every
// other run, not just earlier ones, so a badge disappears the moment a later
// run beats it instead of staying stuck on a run that's no longer the best.
// Ships play too differently to share a leaderboard, so comparison is scoped
// to runs flown on the same ship (unknown-ship runs only compare against
// each other). A run with no rivals for a metric gets no badge for it.
export function newBestMetrics(capture, captures) {
  const run = normalizeCapture(capture)
  const rivals = captures
    .filter((item) => item.id !== capture.id)
    .map(normalizeCapture)
    .filter((item) => item.ship === run.ship)
  const bests = new Set()
  for (const metric of RUN_METRICS) {
    const value = run[metric.key]
    if (typeof value !== 'number') continue
    const rivalValues = rivals.map((item) => item[metric.key]).filter((item) => typeof item === 'number')
    if (!rivalValues.length) continue
    const beat = metric.lowerIsBetter ? value < Math.min(...rivalValues) : value > Math.max(...rivalValues)
    if (beat) bests.add(metric.key)
  }
  return bests
}

// Score-breakdown components in stack order, with a CVD-validated categorical
// palette (dark surface #071019; validated with the dataviz six-checks script).
export const COMPOSITION_SERIES = [
  { key: 'enemies', label: 'Enemies', color: '#e83a5c' },
  { key: 'bosses', label: 'Bosses', color: '#a855f7' },
  { key: 'scoreTokens', label: 'Tokens', color: '#0e9aa7' },
  { key: 'chain', label: 'Chain', color: '#a8862a' },
  { key: 'pads', label: 'Pads', color: '#3d9a4e' },
  { key: 'other', label: 'Other', color: '#7a6fd0' },
]

// Per-run derived performance metrics, oldest → newest. Rate metrics need a
// parsed run duration; runs without one carry nulls and are skipped per-chart.
export function runAnalytics(captures) {
  return captures
    .map(normalizeCapture)
    .filter((run) => run.score > 0)
    .toReversed()
    .map((run) => {
      const minutes = typeof run.time === 'number' && run.time > 30 ? run.time / 60 : null
      const composition = COMPOSITION_SERIES.map((series) => ({ ...series, value: typeof run[series.key] === 'number' ? run[series.key] : 0 }))
      const compositionTotal = composition.reduce((total, part) => total + part.value, 0)
      return {
        id: run.id,
        date: run.capturedAt,
        score: run.score,
        ship: run.ship,
        difficulty: run.difficulty,
        scorePerMin: minutes ? run.score / minutes : null,
        killsPerMin: minutes && typeof run.enemiesDestroyed === 'number' ? run.enemiesDestroyed / minutes : null,
        glimmerPerMin: minutes && typeof run.glimmerCollected === 'number' ? run.glimmerCollected / minutes : null,
        survivalSec: typeof run.time === 'number' && run.time > 0 ? run.time : null,
        composition: compositionTotal > 0 ? composition : null,
        compositionTotal,
      }
    })
}

// 0–100 log-scaled zoom: 0 = tightest window (6h), 100 = full history (14d).
const MIN_WINDOW_MS = 6 * 60 * 60 * 1000
const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export function zoomToWindowMs(zoom) {
  return Math.exp(Math.log(MIN_WINDOW_MS) + (zoom / 100) * (Math.log(MAX_WINDOW_MS) - Math.log(MIN_WINDOW_MS)))
}

// Keeps only items within `zoom`'s window of the most recent item, anchored
// to the newest timestamp so zooming in always shows the latest activity.
export function windowFilter(items, zoom, dateKey = 'date') {
  if (!items.length) return items
  const times = items.map((item) => new Date(item[dateKey]).getTime())
  const newest = Math.max(...times)
  const windowMs = zoomToWindowMs(zoom)
  return items.filter((item, index) => times[index] >= newest - windowMs)
}

export function captureScoreSeries(captures) {
  return captures.map(normalizeCapture).filter((item) => item.score > 0).toReversed()
}

export function captureSummary(captures) {
  const runs = captures.map(normalizeCapture)
  const scores = runs.map((run) => run.score).filter((value) => value > 0)
  const bestScore = Math.max(0, ...scores)
  const latest = runs[0] || null
  const averageScore = scores.length ? scores.reduce((total, value) => total + value, 0) / scores.length : 0
  const totalEnemies = runs.reduce((total, run) => total + (run.enemiesDestroyed || 0), 0)
  const totalBosses = runs.reduce((total, run) => total + (run.bosses || 0), 0)
  return { runs, latest, runCount: runs.length, bestScore, averageScore, totalEnemies, totalBosses }
}

// The run that holds the best value for one metric — scoped to the same ship
// as `ship` when given, since ships play too differently to share a record.
export function bestRunForMetric(captures, metricKey, ship, lowerIsBetter = false) {
  const candidates = captures
    .map(normalizeCapture)
    .filter((run) => typeof run[metricKey] === 'number' && (!ship || run.ship === ship))
  if (!candidates.length) return null
  return candidates.reduce((best, run) => {
    if (!best) return run
    const better = lowerIsBetter ? run[metricKey] < best[metricKey] : run[metricKey] > best[metricKey]
    return better ? run : best
  }, null)
}

// Per-ship personal bests — each ship plays differently enough that a shared
// "best score" is meaningless across them.
export function shipSummaries(captures) {
  const runs = captures.map(normalizeCapture)
  return SHIPS.map((ship) => {
    const shipRuns = runs.filter((run) => run.ship === ship && run.score > 0)
    const bestScore = Math.max(0, ...shipRuns.map((run) => run.score))
    const bestRun = shipRuns.find((run) => run.score === bestScore) || null
    const averageScore = shipRuns.length ? shipRuns.reduce((total, run) => total + run.score, 0) / shipRuns.length : 0
    return { ship, runCount: shipRuns.length, bestScore, bestRun, averageScore }
  })
}
