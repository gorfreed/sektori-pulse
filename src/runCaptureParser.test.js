import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parsePages } = require('../electron/parseRunScreens.cjs')

describe('result screen OCR parser', () => {
  it('keeps real result-screen fields even when OCR adds leading noise', () => {
    const parsed = parsePages([
      { index: 1, text: 'CAMPAIGN CHALLENGE\nScore 2h00\nTime @m17s /\nWorld/Sequence 1/1 |' },
      { index: 4, text: 'SCORE BREAKDOWN Z\n- Score 2500 ~\n— Enemies 2480 A\nLL Bosses 8 Ea\nScore Tokens 0\nChain B\nPads @ -\nOther 100 pr,' },
    ])

    expect(parsed.fields).toMatchObject({
      score: 2500,
      enemies: 2480,
      bosses: 8,
      scoreTokens: 0,
      chain: 0,
      pads: 0,
      other: 100,
      time: 17,
      worldSequence: '1/1 |',
    })
  })
})
