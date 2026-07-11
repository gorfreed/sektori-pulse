// Runs inside a worker_thread (see ocr.cjs). Jimp preprocessing and the
// tesseract WASM are CPU-heavy; on Electron's main thread they freeze the
// whole app ("window not responding") for the duration of a 4-page capture.
const { parentPort } = require('node:worker_threads')
const { createWorker } = require('tesseract.js')
const { Jimp } = require('jimp')

let workerPromise = null

function getWorker() {
  if (!workerPromise) workerPromise = createWorker('eng')
  return workerPromise
}

async function resetWorker() {
  if (!workerPromise) return
  const staleWorkerPromise = workerPromise
  workerPromise = null
  try {
    const staleWorker = await staleWorkerPromise
    await staleWorker.terminate()
  } catch {
    // worker was already gone or never finished initializing; nothing to clean up
  }
}

// Fallback crop if panel detection fails; tuned for a 1295x757 window capture.
const STATS_PANEL = { left: 0.13, top: 0.16, width: 0.46, height: 0.76 }
const STATS_CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:.,-<>|() '
const OCR_TIMEOUT_MS = 20000
const TARGET_CROP_WIDTH = 2200
// The stats panel is a large near-black rectangle in the left-center of the
// results screen. Screen resolution, windowed vs fullscreen, and the window
// title bar all shift where it lands, so fixed crop percentages silently cut
// off rows/columns (metrics then just "go missing"). Detect the black box
// instead: find the longest run of mostly-dark rows, then of dark columns.
function detectPanel(image) {
  const { width, height, data } = image.bitmap
  const lum = (x, y) => {
    const idx = (y * width + x) * 4
    return (data[idx] + data[idx + 1] + data[idx + 2]) / 3
  }
  // Bright text lines inside the panel create short "gaps" in the darkness
  // profile; tolerate gaps up to 4% of the dimension so they don't split the
  // run, while genuinely bright bands (the GAME OVER title) still do.
  const darkRunBounds = (size, sampleCount, isDark) => {
    const maxGap = Math.round(size * 0.04)
    let best = null
    let runStart = -1
    let lastDark = -1
    for (let i = 0; i <= size; i += 1) {
      const dark = i < size && isDark(i, sampleCount)
      if (dark) {
        if (runStart < 0) runStart = i
        lastDark = i
      } else if (runStart >= 0 && (i - lastDark > maxGap || i === size)) {
        const length = lastDark - runStart + 1
        if (!best || length > best.length) best = { start: runStart, length }
        runStart = -1
      }
    }
    return best
  }
  const xSamples = 48
  const rowBand = darkRunBounds(height, xSamples, (y, count) => {
    let dark = 0
    for (let s = 0; s < count; s += 1) {
      const x = Math.round(width * (0.18 + (0.36 * s) / (count - 1)))
      if (lum(x, y) < 40) dark += 1
    }
    return dark / count > 0.8
  })
  if (!rowBand || rowBand.length < height * 0.3) return null
  const ySamples = 48
  const yTop = rowBand.start
  const yLen = rowBand.length
  const colBand = darkRunBounds(width, ySamples, (x, count) => {
    let dark = 0
    for (let s = 0; s < count; s += 1) {
      const y = Math.round(yTop + (yLen * (0.05 + (0.9 * s) / (count - 1))))
      if (lum(x, y) < 40) dark += 1
    }
    return dark / count > 0.8
  })
  if (!colBand || colBand.length < width * 0.2) return null
  const pad = Math.round(width * 0.005)
  return {
    x: Math.max(0, colBand.start - pad),
    y: Math.max(0, yTop - pad),
    w: Math.min(width - Math.max(0, colBand.start - pad), colBand.length + pad * 2),
    h: Math.min(height - Math.max(0, yTop - pad), yLen + pad * 2),
  }
}

// Crop to the detected stats panel, upscale toward a fixed target width
// (small window captures need 2-3x, fullscreen 1440p barely needs any),
// grayscale and invert (Tesseract prefers dark text on light background).
//
// Two variants are produced because no single preprocessing reads everything
// right: the hard-contrast variant reads the big glowing score digits
// reliably but closes the gap in the font's "6" (misread as "8"); the soft
// variant reads 6s correctly but sometimes garbles the glowing digits.
// The caller cross-checks both against the score-breakdown checksum.
async function preprocess(imagePath, { hardContrast }) {
  const image = await Jimp.read(imagePath)
  const { width, height } = image.bitmap
  const panel = detectPanel(image) || {
    x: Math.round(width * STATS_PANEL.left),
    y: Math.round(height * STATS_PANEL.top),
    w: Math.round(width * STATS_PANEL.width),
    h: Math.round(height * STATS_PANEL.height),
  }
  image.crop(panel)
  const scale = Math.min(3, Math.max(1, TARGET_CROP_WIDTH / image.bitmap.width))
  if (scale > 1.05) image.resize({ w: Math.round(image.bitmap.width * scale) })
  image.greyscale()
  image.invert()
  if (hardContrast) {
    image.contrast(0.9)
    image.normalize()
    image.threshold({ max: 162 })
  }
  return image.getBuffer('image/png')
}

// Returns { hard, soft }: the same panel OCR'd with both preprocessing
// variants, for checksum-based reconciliation by the caller. quick mode runs
// only the cheap soft pass — used for the "is this a results screen at all?"
// check, where speed matters more than digit accuracy.
async function recognizeStats(worker, imagePath, quick = false) {
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: STATS_CHAR_WHITELIST,
  })
  const result = { hard: '', soft: '' }
  const variants = quick ? [['soft', false]] : [['hard', true], ['soft', false]]
  for (const [name, hardContrast] of variants) {
    const input = await preprocess(imagePath, { hardContrast })
    try {
      const { data } = await recognizeWithTimeout(worker, input)
      result[name] = data.text || ''
    } catch {
      result[name] = ''
    }
  }
  return result
}

async function recognizeWithTimeout(worker, input) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      resetWorker().catch(() => {})
      reject(new Error('ocr-timeout'))
    }, OCR_TIMEOUT_MS)

    worker.recognize(input)
      .then((result) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(result)
      })
      .catch((error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      })
  })
}

async function recognize(imagePath, { cropToStatsPanel = false, quick = false } = {}) {
  const worker = await getWorker()
  if (cropToStatsPanel) return recognizeStats(worker, imagePath, quick)
  await worker.setParameters({ tessedit_pageseg_mode: '11' })
  const { data } = await recognizeWithTimeout(worker, imagePath)
  return data.text || ''
}

async function shutdown() {
  if (!workerPromise) return
  const worker = await workerPromise
  workerPromise = null
  await worker.terminate()
}

parentPort.on('message', async (message) => {
  if (message.type === 'recognize') {
    try {
      const text = await recognize(message.imagePath, message.options || {})
      parentPort.postMessage({ id: message.id, ok: true, text })
    } catch (error) {
      parentPort.postMessage({ id: message.id, ok: false, error: error.message })
    }
    return
  }
  if (message.type === 'shutdown') {
    try { await shutdown() } catch { /* nothing left to release */ }
    parentPort.postMessage({ id: message.id, ok: true })
  }
})
