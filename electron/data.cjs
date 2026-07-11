const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MARKER = '###***### +++ ###***###'
const MODE_NAMES = { 1: 'Tutorial', 4: 'Campaign', 5: 'Boss Rush', 10: 'Classic', 20: 'Surge', 30: 'Gates', 40: 'Crash', 50: 'Assault', 100: 'Boss Rush', 200: 'Mode 200' }
const SHIP_NAMES = { 0: 'Redeemer', 1: 'Defier', 2: 'Sentinel' }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function parseSave(savePath) {
  const raw = fs.readFileSync(savePath, 'utf8')
  const segments = raw.split(MARKER)
  if (segments.length < 3) throw new Error('Sektori save format was not recognized.')
  const data = JSON.parse(segments[2])
  const stat = fs.statSync(savePath)
  return { data, stat, hash: crypto.createHash('sha1').update(raw).digest('hex') }
}

function loadAchievements(steamPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(steamPath, 'utf8'))
    const entry = parsed.find(([name]) => name === 'achievements')
    if (!entry) return null
    const block = entry[1].data
    return {
      total: block.nTotal,
      achieved: block.nAchieved,
      items: [...block.vecHighlight, ...block.vecUnachieved].map((item) => ({
        id: item.strID,
        name: item.strName,
        description: item.strDescription,
        achieved: Boolean(item.bAchieved),
        unlockedAt: item.rtUnlocked ? new Date(item.rtUnlocked * 1000).toISOString() : null,
        globalPercent: item.flAchieved || 0,
        image: item.strImage,
      })),
    }
  } catch { return null }
}

function summarize(parsed, achievements, history) {
  const { data, stat } = parsed
  const stats = data.Stats
  const modes = stats.ModeStats.map((mode) => ({
    id: mode.Mode,
    name: MODE_NAMES[mode.Mode] || `Mode ${mode.Mode}`,
    started: mode.CountStarted,
    completed: mode.CountCompleted,
    withMutators: mode.CountStartedWithMutators,
    ships: {
      Redeemer: mode.CountCompletedRedeemer,
      Defier: mode.CountCompletedDefier,
      Sentinel: mode.CountCompletedSentinel,
    },
  }))
  const runs = modes.reduce((total, mode) => total + mode.started, 0)
  const clears = modes.reduce((total, mode) => total + mode.completed, 0)
  const campaign = modes.find((mode) => mode.id === 4)
  const shotsPerEnemy = stats.CampaignStatEnemiesDestroyed ? stats.CampaignStatShotsFiredCount / stats.CampaignStatEnemiesDestroyed : 0
  const campaignRuns = campaign?.started || 0
  const boostsPerCampaignRun = campaignRuns ? stats.CampaignStatBoostCount / campaignRuns : 0
  const aggression = clamp(Math.round((boostsPerCampaignRun / 125) * 100), 0, 100)
  const accuracy = clamp(Math.round(100 - (shotsPerEnemy - 3) * 6), 20, 100)
  const runEvents = deriveRunEvents(history)
  const scores = data.Score.Scores.filter((score) => score.score > 0).map((score, index) => ({
    id: `${score.category}-${score.game_mode}-${score.ship_id}`,
    rank: index + 1,
    category: score.category,
    modeId: score.game_mode,
    mode: MODE_NAMES[score.game_mode] || `Category ${score.category}`,
    shipId: score.ship_id,
    ship: SHIP_NAMES[score.ship_id] || `Ship ${score.ship_id}`,
    score: score.score,
    duration: score.time,
    completed: score.run_completed,
    recordedAt: stat.mtime.toISOString(),
  })).sort((a, b) => b.score - a.score)

  return {
    source: { path: parsed.savePath, modifiedAt: stat.mtime.toISOString(), live: true },
    summary: {
      runs, clears, clearRate: campaign?.started ? (campaign.completed / campaign.started) * 100 : 0,
      enemies: stats.CampaignStatEnemiesDestroyed,
      bosses: stats.CampaignStatBossKillCount,
      minibosses: stats.CampaignStatMinibossesDestroyed,
      shots: stats.CampaignStatShotsFiredCount,
      shotsPerEnemy,
      boosts: stats.CampaignStatBoostCount,
      boostsPerCampaignRun,
      pads: stats.CampaignStatPadUseCount,
      glimmer: stats.CampaignStatGlimmerCollected,
      tokens: stats.CampaignStatTokensCollected,
      rainbow: stats.CampaignStatRainbowModeCount,
    },
    scores, modes,
    worldCompletions: stats.CampaignWorldCompletionCount,
    fingerprint: {
      aggression,
      accuracy,
      dodging: Math.min(100, 45 + stats.OneRunMaxAllModes.MaxSecondsWithoutShield / 9),
      efficiency: Math.min(100, 35 + stats.OneRunMaxAllModes.MaxBoostComboReached * 3),
      routing: Math.min(100, 40 + stats.OneRunMaxAllModes.EnemyGatesDestroyed / 3),
      consistency: Math.min(100, 45 + (clears / Math.max(1, runs)) * 180),
    },
    metricNotes: {
      aggression: {
        label: 'Aggression',
        value: aggression,
        formula: 'boosts per campaign start / 125 × 100',
        evidence: `${boostsPerCampaignRun.toFixed(1)} boosts per campaign start`,
      },
      accuracy: {
        label: 'Accuracy proxy',
        value: accuracy,
        formula: '100 - (shots per enemy - 3) × 6, clamped to 20-100',
        evidence: `${shotsPerEnemy.toFixed(2)} shots fired per enemy destroyed`,
        caveat: 'Sektori does not expose hit/miss counts, so this is fire discipline rather than true weapon accuracy.',
      },
    },
    bests: stats.OneRunMaxAllModes,
    achievements: achievements || { achieved: 0, total: 0, items: [] },
    history,
    runEvents,
  }
}

function getBestScore(snapshot) {
  return Math.max(0, ...(snapshot.scores || []).map((entry) => entry.score || 0))
}

function hasNumber(snapshot, key) {
  return typeof snapshot?.[key] === 'number' && Number.isFinite(snapshot[key])
}

function materialKey(snapshot) {
  return JSON.stringify({
    runs: snapshot.runs || 0,
    clears: snapshot.clears || 0,
    campaignRuns: snapshot.campaignRuns || null,
    campaignClears: snapshot.campaignClears || null,
    enemies: snapshot.enemies || 0,
    bosses: snapshot.bosses || 0,
    shots: snapshot.shots || 0,
    boosts: snapshot.boosts || null,
    bestScore: getBestScore(snapshot),
  })
}

function hasMaterialProgress(previous, item) {
  if (!previous) return false
  return materialKey(previous) !== materialKey(item)
}

function deriveRunEvents(history) {
  return history.map((item, index) => {
    const previous = history[index - 1]
    if (!hasMaterialProgress(previous, item)) return null
    const delta = (key) => previous && hasNumber(previous, key) && hasNumber(item, key) ? Math.max(0, item[key] - previous[key]) : 0
    const maybeDelta = (key) => previous && hasNumber(previous, key) && hasNumber(item, key) ? Math.max(0, item[key] - previous[key]) : null
    const priorBest = previous ? getBestScore(previous) : 0
    const bestScore = getBestScore(item)
    const runs = delta('runs')
    const campaignRuns = maybeDelta('campaignRuns')
    const enemies = delta('enemies')
    const shots = delta('shots')
    const boosts = maybeDelta('boosts')
    const scoreGain = Math.max(0, bestScore - priorBest)
    return {
      id: item.id,
      recordedAt: item.recordedAt,
      kind: runs === 1 ? 'single-run' : runs > 1 ? 'multi-run-session' : 'save-update',
      runs,
      campaignRuns: campaignRuns || 0,
      clears: delta('clears'),
      campaignClears: delta('campaignClears'),
      enemies,
      bosses: delta('bosses'),
      shots,
      boosts: boosts || 0,
      bestScore,
      scoreGain,
      runScore: hasNumber(item, 'runScore') ? item.runScore : bestScore > priorBest ? bestScore : null,
      scoreSource: hasNumber(item, 'runScore') ? 'manual' : bestScore > priorBest ? 'personal-best' : 'not-saved',
      confidence: runs === 1 ? 'run' : runs > 1 ? 'session' : 'snapshot',
    }
  }).filter((event) => event && (event.runs > 0 || event.scoreGain > 0)).slice(-500)
}

function createStore({ savePath, historyPath, steamAchievementsPath }) {
  let watcher
  let timer
  let lastHash = ''
  const listeners = new Set()

  function readHistory() {
    try { return JSON.parse(fs.readFileSync(historyPath, 'utf8')) } catch { return [] }
  }

  function writeHistory(history) {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true })
    fs.writeFileSync(historyPath, JSON.stringify(history.slice(-1000), null, 2))
  }

  function record(parsed) {
    const history = readHistory()
    const data = parsed.data
    const summary = data.Stats
    const snapshot = {
      id: parsed.hash.slice(0, 12), hash: parsed.hash, recordedAt: parsed.stat.mtime.toISOString(),
      runs: summary.ModeStats.reduce((n, mode) => n + mode.CountStarted, 0),
      clears: summary.ModeStats.reduce((n, mode) => n + mode.CountCompleted, 0),
      campaignRuns: summary.ModeStats.find((mode) => mode.Mode === 4)?.CountStarted || 0,
      campaignClears: summary.ModeStats.find((mode) => mode.Mode === 4)?.CountCompleted || 0,
      enemies: summary.CampaignStatEnemiesDestroyed,
      bosses: summary.CampaignStatBossKillCount,
      shots: summary.CampaignStatShotsFiredCount,
      boosts: summary.CampaignStatBoostCount,
      scores: data.Score.Scores.filter((score) => score.score > 0).map((score) => ({ category: score.category, score: score.score, modeId: score.game_mode, shipId: score.ship_id })),
    }
    const existingIndex = history.findIndex((item) => item.hash === parsed.hash)
    if (existingIndex >= 0) {
      history[existingIndex] = { ...snapshot, ...history[existingIndex], ...snapshot }
      writeHistory(history)
      lastHash = parsed.hash
      return history
    }
    if (parsed.hash === lastHash) return history
    const previous = history.at(-1)
    if (previous && !hasMaterialProgress(previous, snapshot)) {
      lastHash = parsed.hash
      return history
    }
    history.push(snapshot)
    writeHistory(history)
    lastHash = parsed.hash
    return history
  }

  function load() {
    const parsed = parseSave(savePath)
    parsed.savePath = savePath
    const history = record(parsed)
    return summarize(parsed, loadAchievements(steamAchievementsPath), history)
  }

  function emit() {
    try { const dashboard = load(); listeners.forEach((listener) => listener(dashboard)) } catch { return }
  }

  function watch() {
    if (watcher) watcher.close()
    if (!fs.existsSync(path.dirname(savePath))) return
    watcher = fs.watch(path.dirname(savePath), (_event, filename) => {
      if (filename?.toLowerCase() !== path.basename(savePath).toLowerCase()) return
      clearTimeout(timer)
      timer = setTimeout(emit, 350)
    })
  }

  return {
    load, watch,
    onUpdate(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    close() { watcher?.close(); clearTimeout(timer) },
    setSavePath(nextPath) { savePath = nextPath; lastHash = ''; watch() },
    exportPayload() { return { exportedAt: new Date().toISOString(), ...load() } },
  }
}

module.exports = { createStore, deriveRunEvents, MODE_NAMES, SHIP_NAMES }
