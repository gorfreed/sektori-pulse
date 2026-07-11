const { BrowserWindow, screen } = require('electron')
const path = require('node:path')

let overlayWindow = null

const STATE_TEXT = {
  idle: 'PULSE · WATCHING',
  checking: 'PULSE · CHECKING SAVE…',
  capturing: 'PULSE · CAPTURING — STAY ON RESULTS',
  processing: 'PULSE · GOT IT — CONTINUE PLAYING',
  captured: 'PULSE · RUN SAVED',
  error: 'PULSE · CAPTURE ERROR',
  hidden: '',
}

const OVERLAY_WIDTH = 320
const OVERLAY_HEIGHT = 30

// Anchor the overlay to the game window's own top-right corner rather than
// the primary display, so it tracks the game across multi-monitor setups
// and windowed-mode moves instead of sitting wherever the primary monitor
// happens to be.
function fallbackPosition() {
  const display = screen.getPrimaryDisplay()
  return { x: display.workArea.x + display.workArea.width - OVERLAY_WIDTH - 16, y: display.workArea.y + 10 }
}

// Windows reports a minimized window's rect as an off-screen placeholder
// (coordinates around -32000, near-zero size) rather than its real position —
// detect that and hold the overlay's last known position instead of jumping
// it off-screen.
function isMinimizedRect(rect) {
  return rect.left < -10000 || rect.top < -10000 || (rect.right - rect.left) < 10 || (rect.bottom - rect.top) < 10
}

function positionForRect(rect) {
  if (!rect || isMinimizedRect(rect)) return null
  // Top-right corner of the game window: top-center sits inside the OCR crop
  // region of the results screen and bleeds garbage text into captures.
  return { x: Math.round(rect.right - OVERLAY_WIDTH - 16), y: Math.round(rect.top + 10) }
}

function createOverlay() {
  if (overlayWindow) return overlayWindow
  const { x, y } = fallbackPosition()
  overlayWindow = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setIgnoreMouseEvents(true)
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'))
  overlayWindow.on('closed', () => { overlayWindow = null })
  return overlayWindow
}

let visible = false
let captureFadeTimer = null

function sendOverlayState(payload) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (!overlayWindow.webContents || overlayWindow.webContents.isDestroyed()) return
  overlayWindow.webContents.send('overlay:state', payload)
}

function setPhase(phase, extra = {}) {
  if (!overlayWindow) return
  let text = STATE_TEXT[phase] || phase
  if (phase === 'capturing' && extra.page && extra.total) text = `PULSE · CAPTURING ${extra.page}/${extra.total} — STAY ON RESULTS`
  if (phase === 'captured' && extra.fieldCount != null) text = `PULSE · DONE — RUN SAVED (${extra.fieldCount} FIELDS)`
  if (phase === 'error') text = `PULSE · CAPTURE ERROR`
  sendOverlayState({ phase, text })
  clearTimeout(captureFadeTimer)
  if (phase === 'captured' || phase === 'error') {
    captureFadeTimer = setTimeout(() => setPhase('idle'), 4000)
  }
}

function setGameRunning(running, rect, minimized) {
  const win = createOverlay()
  const shouldShow = running && !minimized
  if (shouldShow) {
    const position = positionForRect(rect)
    if (position) win.setPosition(position.x, position.y)
    if (!visible) {
      win.showInactive()
      visible = true
      setPhase('idle')
    }
  } else if (visible) {
    win.hide()
    visible = false
  }
}

function destroy() {
  clearTimeout(captureFadeTimer)
  overlayWindow?.close()
  overlayWindow = null
}

module.exports = { setGameRunning, setPhase, destroy }
