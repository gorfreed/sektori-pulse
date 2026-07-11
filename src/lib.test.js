import { describe, expect, it } from 'vitest'
import { duration, percent, score } from './lib.js'
import { dateTime } from './lib.js'

describe('performance formatting', () => {
  it('formats run durations in the game style', () => expect(duration(2271.002)).toBe('37m 51s'))
  it('formats scores for scanability', () => expect(score(8717950)).toBe('8,717,950'))
  it('formats rates to one decimal', () => expect(percent(12.9139)).toBe('12.9%'))
  it('does not crash on missing timestamps', () => expect(dateTime(undefined)).toBe('—'))
})
