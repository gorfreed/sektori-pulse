const KNOWN_HEADERS = ['SCORE BREAKDOWN', 'STATISTICS', 'CAMPAIGN CHALLENGE', 'CAMPAIGN EXPERIENCE', 'CAMPAIGN REVOLUTION']
const KNOWN_LABELS = [
  'Artifact Chains Completed', 'Bonus Waves Completed', 'Minibosses Destroyed',
  'World/Sequence', 'Glimmer Collected', 'Tokens Collected', 'Letters Collected',
  'Max Strike Combo', 'Travel Distance', 'Enemies Destroyed', 'Score Tokens',
  'Stack Upgrades', 'Strike Attacks', 'Rainbow Modes', 'Shields Lost',
  'Max Chain', 'Pads Used', 'Evolutions', 'Enemies', 'Bosses', 'Chain',
  'Pads', 'Other', 'Score', 'Time',
]

function slugify(label) {
  const words = label.trim().replace(/[^A-Za-z0-9/ ]/g, '').split(/[\s/]+/).filter(Boolean)
  if (!words.length) return ''
  return words.map((word, index) => index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()).join('')
}

function cleanValue(raw) {
  return raw
    .replace(/[~]/g, '')
    .replace(/\b[Bb](?=m\s*\d)/g, '0')
    .replace(/\bOm\b/i, '0m')
    .replace(/\s+/g, ' ')
    .trim()
}

function toNumber(raw) {
  const trimmed = cleanValue(raw)
  // OCR mangles the seconds unit of "39m 4s" in several ways: dropping the
  // "s" entirely, or inserting junk before it ("39m 4bs"). Once "<digits>m"
  // has matched, a following number is unambiguously the seconds, so don't
  // require the unit at all — demanding it made "39m 4bs" fall through to the
  // bare-number branch and silently record a 39-second run instead of 39m04s.
  const durationMatch = trimmed.match(/^(\d+)\s*m\s*(\d+(?:\.\d+)?)/i)
  if (durationMatch) return Number(durationMatch[1]) * 60 + Number(durationMatch[2])
  const fractionMatch = trimmed.match(/\d+\s*\/\s*\d+/)
  if (fractionMatch) return null
  const numericPrefix = trimmed.match(/^-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/)
  if (!numericPrefix) return null
  const cleaned = numericPrefix[0].replace(/,/g, '')
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned)
  return null
}

function findHeader(lines) {
  for (const line of lines) {
    const upper = line.toUpperCase().trim()
    const match = KNOWN_HEADERS.find((header) => upper.includes(header))
    if (match) return match
  }
  return null
}

function findPageIndicator(text) {
  const matches = [...text.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
  if (!matches.length) return null
  const last = matches[matches.length - 1]
  return { current: Number(last[1]), total: Number(last[2]) }
}

function normalizeLine(line) {
  return line
    .replace(/[@©Ø]/g, '0')
    .replace(/\b[Bb](?=m\s*\d)/g, '0')
    .replace(/(\s)B$/, '$10')
    .replace(/\s+/g, ' ')
    .trim()
}

function findKnownLabelRow(line) {
  const upper = line.toUpperCase()
  for (const label of KNOWN_LABELS) {
    const index = upper.indexOf(label.toUpperCase())
    if (index < 0) continue
    const value = cleanValue(line.slice(index + label.length).replace(/^[^0-9-]+/, ''))
    if (!value) continue
    return { label, value }
  }
  return null
}

function parsePageText(text) {
  const lines = text.split('\n').map((line) => normalizeLine(line.trim())).filter(Boolean)
  const header = findHeader(lines)
  const fields = {}
  const raw = {}
  const lineRegex = /^([A-Za-z][A-Za-z/ ]*?)[\s:|]+([0-9-][\w.,:/ ]*?)$/
  for (const line of lines) {
    const knownRow = findKnownLabelRow(line)
    const match = knownRow ? null : line.match(lineRegex)
    if (!knownRow && !match) continue
    const labelPart = knownRow?.label || match[1]
    const valuePart = knownRow?.value || match[2]
    const slug = slugify(labelPart)
    if (!slug) continue
    const value = cleanValue(valuePart)
    raw[slug] = value
    const numeric = toNumber(value)
    fields[slug] = numeric !== null ? numeric : value
  }
  return { header, fields, raw, indicator: findPageIndicator(text) }
}

// The campaign difficulty is the word after "CAMPAIGN" in the page-1 header.
const DIFFICULTIES = ['Experience', 'Challenge', 'Revolution']

function findDifficulty(text) {
  const upper = (text || '').toUpperCase()
  for (const difficulty of DIFFICULTIES) {
    if (upper.includes(difficulty.toUpperCase())) return difficulty
  }
  return null
}

function parsePages(pages) {
  const fields = {}
  const raw = {}
  const sections = []
  for (const page of pages) {
    const parsed = parsePageText(page.text)
    if (parsed.header) sections.push({ page: page.index, header: parsed.header })
    Object.assign(fields, parsed.fields)
    Object.assign(raw, parsed.raw)
    const difficulty = findDifficulty(page.text)
    if (difficulty && !fields.difficulty) fields.difficulty = difficulty
  }
  return {
    fields,
    raw,
    sections,
    pages: pages.map((page) => ({ index: page.index, image: page.image, text: page.text })),
  }
}

const BREAKDOWN_KEYS = ['enemies', 'bosses', 'scoreTokens', 'chain', 'pads', 'other']

// Largest score gap we'll still explain as real continue/redemption penalties
// (-1,000,000 each) rather than as an OCR misread of the score. Set this to
// the most continues a single run can actually accumulate; anything past that
// and the six-component breakdown sum is trusted over the score reading.
const MAX_CONTINUE_PENALTY = 3000000

function breakdownSum(fields) {
  if (!BREAKDOWN_KEYS.every((key) => typeof fields[key] === 'number')) return null
  return BREAKDOWN_KEYS.reduce((total, key) => total + fields[key], 0)
}

// Search every combination of the two variants' component readings (≤2 options
// per component, ≤64 combos) for one that sums exactly to either variant's
// score reading. A match means every chosen digit is confirmed by arithmetic.
function reconcileBreakdown(hard, soft) {
  const options = BREAKDOWN_KEYS.map((key) => {
    const values = []
    if (typeof hard.fields[key] === 'number') values.push(hard.fields[key])
    if (typeof soft.fields[key] === 'number' && !values.includes(soft.fields[key])) values.push(soft.fields[key])
    return values
  })
  if (options.some((values) => !values.length)) return null
  const targets = [...new Set([hard.fields.score, soft.fields.score].filter((v) => typeof v === 'number' && v > 0))]
  if (!targets.length) return null
  // The breakdown can legitimately sum to MORE than the displayed score: the
  // game applies a flat -1,000,000 penalty per redemption/continue that has no
  // breakdown row (observed on a real run: components 8,369,320, score
  // 7,369,320). The displayed score is authoritative; a match is a sum equal
  // to a score candidate plus a small whole number of millions.
  //
  // Danger: a misread of the score's LEADING digit is arithmetically
  // identical to a stack of continue-penalties. Reading 8,042,480 as
  // 1,042,480 leaves a difference of exactly 7,000,000 — a clean multiple of
  // a million, same digit count, identical trailing digits — so no amount of
  // arithmetic can tell it apart from "7 continues". Two guards, since the
  // six-component sum (six readings that must agree) is far more trustworthy
  // than the one reading of the big glowing score:
  //   1. Prefer the interpretation needing the SMALLEST penalty, so an exact
  //      zero-penalty match always beats a penalised one.
  //   2. Refuse penalties beyond what a real run can accumulate; past that,
  //      a misread is the likelier explanation, and we fall back to the sum.
  const matchesTarget = (sum) => {
    let best = null
    for (const target of targets) {
      const penalty = sum - target
      if (penalty < 0 || penalty % 1000000 !== 0 || penalty > MAX_CONTINUE_PENALTY) continue
      if (String(sum).length - String(target).length > 1) continue
      if (best === null || penalty < best.penalty) best = { target, penalty }
    }
    return best
  }
  const combo = []
  let bestMatch = null
  const search = (index, sum) => {
    if (index === BREAKDOWN_KEYS.length) {
      const match = matchesTarget(sum)
      if (match && (bestMatch === null || match.penalty < bestMatch.penalty)) {
        bestMatch = { score: match.target, penalty: match.penalty, values: [...combo] }
      }
      return null
    }
    for (const value of options[index]) {
      combo[index] = value
      search(index + 1, sum + value)
    }
    return null
  }
  search(0, 0)
  return bestMatch === null ? null : { values: bestMatch.values, score: bestMatch.score }
}

// Reconcile the hard-contrast parse (reliable glowing score digits, misreads
// 6 as 8) with the soft parse (correct 6s, occasionally garbled score digits).
// The six breakdown components must sum exactly to the score, which gives a
// checksum to decide which variant to trust.
function mergeParsedVariants(hard, soft) {
  const fields = { ...soft.fields, ...hard.fields }
  const raw = { ...soft.raw, ...hard.raw }
  // World/Sequence is where the 6→8 misread bites; prefer the soft read.
  if (typeof soft.fields.worldSequence === 'string' && /\d+\s*\/\s*\d+/.test(soft.fields.worldSequence)) {
    fields.worldSequence = soft.fields.worldSequence
  }
  let scoreChecksum = 'unverified'
  const reconciled = reconcileBreakdown(hard, soft)
  if (reconciled) {
    BREAKDOWN_KEYS.forEach((key, index) => { fields[key] = reconciled.values[index] })
    fields.score = reconciled.score
    scoreChecksum = 'verified'
  } else {
    const hardSum = breakdownSum(hard.fields)
    if (hardSum !== null) {
      // No exact match anywhere: the additive sum of six independently read
      // values is statistically safer than one read of the big glowing number.
      fields.score = hardSum
      scoreChecksum = 'sum-of-breakdown'
    }
  }
  return {
    fields,
    raw,
    sections: hard.sections.length ? hard.sections : soft.sections,
    scoreChecksum,
  }
}

module.exports = { parsePages, parsePageText, findPageIndicator, slugify, mergeParsedVariants }
