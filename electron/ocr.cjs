// Thin proxy around ocrWorker.cjs, which runs in a worker_thread so the Jimp
// preprocessing and tesseract WASM never execute on Electron's main thread —
// running them there freezes the entire app for the duration of a capture.
const { Worker } = require('node:worker_threads')
const path = require('node:path')

const WORKER_CALL_TIMEOUT_MS = 30000

let worker = null
let nextId = 1
const pending = new Map()

function rejectAllPending(reason) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer)
    reject(new Error(reason))
  }
  pending.clear()
}

function getWorker() {
  if (worker) return worker
  worker = new Worker(path.join(__dirname, 'ocrWorker.cjs'))
  worker.on('message', (message) => {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.ok) entry.resolve(message.text)
    else entry.reject(new Error(message.error || 'ocr-worker-error'))
  })
  worker.on('error', (error) => {
    console.error('[sektori-pulse] OCR worker crashed:', error.message)
    rejectAllPending(`ocr-worker-crashed: ${error.message}`)
    worker = null
  })
  worker.on('exit', (code) => {
    if (code !== 0) rejectAllPending(`ocr-worker-exited: ${code}`)
    worker = null
  })
  return worker
}

function call(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('ocr-worker-timeout'))
    }, WORKER_CALL_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    getWorker().postMessage({ id, type, ...payload })
  })
}

function recognize(imagePath, options = {}) {
  return call('recognize', { imagePath, options })
}

async function shutdown() {
  if (!worker) return
  try { await call('shutdown') } catch { /* worker already gone */ }
  const stale = worker
  worker = null
  await stale.terminate()
}

module.exports = { recognize, shutdown }
