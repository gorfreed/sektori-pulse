const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ocr = require('./ocr.cjs')
const { parsePages, mergeParsedVariants } = require('./parseRunScreens.cjs')

const gamepad = require('./gamepad.cjs')
const psSession = require('./psSession.cjs')

const RESULT_PAGE_COUNT = 4
const PAGE_RENDER_DELAY_MS = 500
// "GAME OVER" is styled/glowing text that Tesseract often garbles; the section
// headers below are plain text and read reliably, so any one of them is enough
// confirmation that this is a results screen. Page 1's header is "CAMPAIGN"
// plus whichever difficulty the run used (Experience/Challenge/Revolution) —
// missing the other two here silently rejected real results screens.
const RESULT_SCREEN_MARKERS = /GAME\s*OVER|CAMPAIGN\s*(CHALLENGE|EXPERIENCE|REVOLUTION)|SCORE\s*BREAKDOWN|STATISTICS|REDEMPTION\s*DENIED/i

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Both go through the persistent PS session (psSession.cjs) rather than
// spawning a fresh PowerShell process per call — that used to cost ~600ms
// just recompiling the C# interop layer on every single check/screenshot.
const screenshot = (outFile, processName) => psSession.send({ action: 'screenshot', processName, outFile })
const checkGameStatus = (processName = 'Sektori') => psSession.send({ action: 'check', processName })

async function isGameForeground(processName) {
  const status = await checkGameStatus(processName)
  return Boolean(status.ok && status.running && status.foreground)
}

function recordsPath(userDataDir) {
  return path.join(userDataDir, 'runCaptures.jsonl')
}

function capturesDir(userDataDir) {
  return path.join(userDataDir, 'captures')
}

function appendRecord(userDataDir, record) {
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.appendFileSync(recordsPath(userDataDir), `${JSON.stringify(record)}\n`)
}

function listRecords(userDataDir) {
  try {
    const raw = fs.readFileSync(recordsPath(userDataDir), 'utf8')
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)).reverse()
  } catch {
    return []
  }
}

// Remove a run record and its captured page images.
function deleteRecord(userDataDir, id) {
  const records = listRecords(userDataDir).reverse() // back to chronological file order
  const remaining = records.filter((record) => record.id !== id)
  if (remaining.length === records.length) return listRecords(userDataDir)
  fs.writeFileSync(recordsPath(userDataDir), remaining.map((record) => JSON.stringify(record)).join('\n') + (remaining.length ? '\n' : ''))
  try {
    fs.rmSync(path.join(capturesDir(userDataDir), id), { recursive: true, force: true })
  } catch (error) {
    console.log('[sektori-pulse] could not remove capture images for', id, error.message)
  }
  console.log('[sektori-pulse] deleted run', id)
  return listRecords(userDataDir)
}

// OCR every page with both preprocessing variants, parse each variant's text
// set, and reconcile them via the score-breakdown checksum.
async function ocrAndParsePages(pages) {
  const hardPages = []
  const softPages = []
  for (const page of pages) {
    let texts = { hard: '', soft: '' }
    try {
      texts = await ocr.recognize(page.image, { cropToStatsPanel: true })
    } catch (error) {
      console.log(`[sektori-pulse] OCR failed for page ${page.index}:`, error.message)
    }
    hardPages.push({ index: page.index, image: page.image, text: texts.hard || '' })
    softPages.push({ index: page.index, image: page.image, text: texts.soft || '' })
  }
  const merged = mergeParsedVariants(parsePages(hardPages), parsePages(softPages))
  return { ...merged, pages: hardPages }
}

async function tryCapture({ userDataDir, processName = 'Sektori', ship = null, onProgress = () => {} }) {
  const dir = capturesDir(userDataDir)
  fs.mkdirSync(dir, { recursive: true })
  const scanFile = path.join(dir, `_scan-${Date.now()}.png`)
  console.log('[sektori-pulse] save write detected, attempting capture...')
  onProgress({ phase: 'checking' })
  const shot = await screenshot(scanFile, processName)
  if (!shot.ok) {
    console.log('[sektori-pulse] capture skipped:', shot.reason || 'unknown')
    fs.rmSync(scanFile, { force: true })
    onProgress({ phase: 'idle' })
    return null
  }

  // Quick single-variant cropped OCR: this check gates the whole capture and
  // runs on every save write, so it must be fast — the full-resolution
  // full-screenshot OCR it replaces delayed the capture start by many seconds.
  let firstText
  try {
    const texts = await ocr.recognize(scanFile, { cropToStatsPanel: true, quick: true })
    firstText = texts.soft || texts.hard || ''
  } catch (error) {
    fs.rmSync(scanFile, { force: true })
    onProgress({ phase: 'error', message: error.message })
    throw error
  }

  if (!RESULT_SCREEN_MARKERS.test(firstText)) {
    console.log('[sektori-pulse] capture skipped: no result-screen marker found. OCR read:', JSON.stringify(firstText.slice(0, 200)))
    fs.rmSync(scanFile, { force: true })
    onProgress({ phase: 'idle' })
    return null
  }

  const runId = crypto.randomUUID()
  const runDir = path.join(dir, runId)
  fs.mkdirSync(runDir, { recursive: true })
  const page1Path = path.join(runDir, 'page-1.png')
  fs.renameSync(scanFile, page1Path)

  console.log(`[sektori-pulse] result screen confirmed, paging via virtual gamepad`)
  onProgress({ phase: 'capturing', page: 1, total: RESULT_PAGE_COUNT })

  const padStatus = gamepad.ensureConnected()
  if (!padStatus.ok) {
    console.log('[sektori-pulse] gamepad unavailable, capturing page 1 only:', padStatus.reason)
  } else {
    if (!(await isGameForeground(processName))) {
      console.log('[sektori-pulse] game lost foreground before paging; stopping at page 1')
      onProgress({ phase: 'idle' })
      const parsed = await ocrAndParsePages([{ index: 1, image: page1Path }])
      if (ship) parsed.fields.ship = ship
      const record = { id: runId, capturedAt: new Date().toISOString(), pageCount: 1, ...parsed }
      appendRecord(userDataDir, record)
      onProgress({ phase: 'captured', fieldCount: Object.keys(parsed.fields).length })
      return record
    }
    if (!padStatus.alreadyConnected) await sleep(4000) // let the game detect the hot-plugged pad
    // First pad input switches the game's active device to gamepad and is
    // consumed without any action; RB page-turns only register after it.
    await gamepad.tapDpadToActivate()
    await sleep(600)
  }

  // Re-OCR page 1 with the stats-panel crop: firstText came from the full
  // screenshot (needed for the GAME OVER confirmation) and is too noisy to
  // parse values from.
  const pages = [{ index: 1, image: page1Path, text: '' }]
  let reached = 1
  if (padStatus.ok) {
    for (let n = 2; n <= RESULT_PAGE_COUNT; n += 1) {
      if (!(await isGameForeground(processName))) {
        console.log(`[sektori-pulse] game lost foreground before page ${n}; stopping paging`)
        break
      }
      await gamepad.nextPage()
      await sleep(PAGE_RENDER_DELAY_MS)
      const pagePath = path.join(runDir, `page-${n}.png`)
      const pageShot = await screenshot(pagePath, processName)
      if (!pageShot.ok) {
        console.log(`[sektori-pulse] screenshot failed at page ${n}, stopping (reason: ${pageShot.reason || 'unknown'})`)
        break
      }
      pages.push({ index: n, image: pagePath, text: '' })
      reached = n
      onProgress({ phase: 'capturing', page: n, total: RESULT_PAGE_COUNT })
    }
    for (let n = reached; n > 1; n -= 1) {
      if (!(await isGameForeground(processName))) break
      await gamepad.previousPage()
      await sleep(200)
    }
  }
  console.log(`[sektori-pulse] captured ${pages.length} page(s) total`)

  // All screenshots exist — the player can leave the results screen now; only
  // offline OCR work remains.
  onProgress({ phase: 'processing' })
  const parsed = await ocrAndParsePages(pages)
  if (ship) parsed.fields.ship = ship
  console.log(`[sektori-pulse] score checksum: ${parsed.scoreChecksum}, ship: ${ship || 'unknown'}`)
  const record = {
    id: runId,
    capturedAt: new Date().toISOString(),
    pageCount: pages.length,
    ...parsed,
  }
  appendRecord(userDataDir, record)
  onProgress({ phase: 'captured', fieldCount: Object.keys(parsed.fields).length })
  return record
}

module.exports = { tryCapture, listRecords, deleteRecord, capturesDir, recordsPath, checkGameStatus }
