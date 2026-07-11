import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { deriveRunEvents } = require('../electron/data.cjs')

describe('progress events', () => {
  it('does not turn the first observed save into a fake progress event', () => {
    const events = deriveRunEvents([
      { id: 'baseline', recordedAt: '2026-06-23T10:00:00Z', runs: 530, clears: 42, campaignRuns: 302, campaignClears: 39, enemies: 1109861, bosses: 649, shots: 8522197, boosts: 31506, scores: [{ score: 8717950 }] },
    ])

    expect(events).toEqual([])
  })

  it('labels a one-save delta with one new run as an individual run', () => {
    const events = deriveRunEvents([
      { id: 'a', recordedAt: '2026-06-23T10:00:00Z', runs: 10, clears: 2, campaignRuns: 8, campaignClears: 2, enemies: 1000, bosses: 5, shots: 7000, boosts: 700, scores: [{ score: 1000 }] },
      { id: 'b', recordedAt: '2026-06-23T10:30:00Z', runs: 11, clears: 3, campaignRuns: 9, campaignClears: 3, enemies: 1250, bosses: 6, shots: 8600, boosts: 835, scores: [{ score: 1500 }] },
    ])

    expect(events.at(-1)).toMatchObject({
      confidence: 'run',
      runs: 1,
      clears: 1,
      enemies: 250,
      scoreGain: 500,
      runScore: 1500,
      scoreSource: 'personal-best',
    })
  })

  it('marks non-personal-best run scores as not saved in save-only events', () => {
    const events = deriveRunEvents([
      { id: 'a', recordedAt: '2026-06-23T10:00:00Z', runs: 10, clears: 2, campaignRuns: 8, campaignClears: 2, enemies: 1000, bosses: 5, shots: 7000, boosts: 700, scores: [{ score: 1000 }] },
      { id: 'b', recordedAt: '2026-06-23T10:30:00Z', runs: 11, clears: 2, campaignRuns: 9, campaignClears: 2, enemies: 1250, bosses: 5, shots: 8600, boosts: 835, scores: [{ score: 1000 }] },
    ])

    expect(events.at(-1)).toMatchObject({
      runScore: null,
      scoreSource: 'not-saved',
    })
  })

  it('labels multiple missed runs as a session batch instead of inventing individual runs', () => {
    const events = deriveRunEvents([
      { id: 'a', recordedAt: '2026-06-23T10:00:00Z', runs: 10, clears: 2, campaignRuns: 8, campaignClears: 2, enemies: 1000, bosses: 5, shots: 7000, boosts: 700, scores: [{ score: 1000 }] },
      { id: 'b', recordedAt: '2026-06-23T11:00:00Z', runs: 14, clears: 3, campaignRuns: 12, campaignClears: 3, enemies: 1800, bosses: 8, shots: 12800, boosts: 1160, scores: [{ score: 1000 }] },
    ])

    expect(events.at(-1)).toMatchObject({
      confidence: 'session',
      runs: 4,
      clears: 1,
    })
  })

  it('ignores hash-only save writes with unchanged counters', () => {
    const events = deriveRunEvents([
      { id: 'a', recordedAt: '2026-06-23T10:00:00Z', runs: 10, clears: 2, campaignRuns: 8, campaignClears: 2, enemies: 1000, bosses: 5, shots: 7000, boosts: 700, scores: [{ score: 1000 }] },
      { id: 'b', recordedAt: '2026-06-23T10:01:00Z', runs: 10, clears: 2, campaignRuns: 8, campaignClears: 2, enemies: 1000, bosses: 5, shots: 7000, boosts: 700, scores: [{ score: 1000 }] },
    ])

    expect(events).toEqual([])
  })
})
