const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron')

// This is a single-purpose companion app, not a document editor — the default
// File/Edit/View/Window menu bar (and its Ctrl+R reload, Ctrl+Shift+I devtools,
// etc. shortcuts) doesn't belong here.
Menu.setApplicationMenu(null)
const path = require('node:path')
const fs = require('node:fs')
const { createStore } = require('./data.cjs')
const runCapture = require('./runCapture.cjs')
const overlay = require('./overlay.cjs')
const gamepad = require('./gamepad.cjs')
const psSession = require('./psSession.cjs')

const GAME_PROCESS_NAME = 'Sektori'
const GAME_POLL_INTERVAL_MS = 4000
const SHIP_NAMES = { 0: 'Redeemer', 1: 'Defier', 2: 'Sentinel' }
const SAVE_MARKER = '###***### +++ ###***###'

// Without this, two dev-mode launches can both bind the gamepad and fight over
// the game window's foreground, and both try to write runCaptures.jsonl.
if (!app.requestSingleInstanceLock()) app.quit()

let window
let store
let captureBusy = false
let gamePollTimer
let pendingCaptureOnFocus = false
let currentSavePath = ''

// game_mode / Stats.ModeStats[].Mode codes for the campaign difficulties
// (Easy/Standard/Revolution) — everything else (Classic, Surge, Gates,
// Crash, Assault, Boss Rush, ...) isn't tracked yet.
const CAMPAIGN_MODES = new Set([1, 4, 5])
let lastModeStarts = null
let lastStartedMode = null

function sendToDashboard(channel, payload) {
  if (!window || window.isDestroyed()) return
  if (!window.webContents || window.webContents.isDestroyed()) return
  window.webContents.send(channel, payload)
}

function defaultPaths() {
  const home = app.getPath('home')
  const steamUserdata = 'C:\\Program Files (x86)\\Steam\\userdata'
  let achievements = ''
  try {
    for (const user of fs.readdirSync(steamUserdata)) {
      const candidate = path.join(steamUserdata, user, 'config', 'librarycache', '2105620.json')
      if (fs.existsSync(candidate)) { achievements = candidate; break }
    }
  } catch { achievements = '' }
  return {
    save: path.join(home, 'AppData', 'LocalLow', 'Kimmo Factor Oy', 'Sektori', 'savegame.json'),
    achievements,
    history: path.join(app.getPath('userData'), 'history.json'),
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1080, minHeight: 680,
    backgroundColor: '#050a10', title: 'Sektori // Pulse',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  })
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL)
  else if (!app.isPackaged) window.loadURL('http://127.0.0.1:5173')
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  const paths = defaultPaths()
  currentSavePath = paths.save
  store = createStore({ savePath: paths.save, historyPath: paths.history, steamAchievementsPath: paths.achievements })
  store.watch()
  store.onUpdate(async (payload) => {
    sendToDashboard('pulse:update', payload)
    updateLastStartedMode()
    // Not a campaign run (or nothing recognizable yet) — don't OCR a results
    // screen for it at all, so other modes never get captured as garbage
    // campaign data.
    if (lastStartedMode !== null && !CAMPAIGN_MODES.has(lastStartedMode)) return
    const status = await runCapture.checkGameStatus(GAME_PROCESS_NAME)
    if (status.ok && status.running && status.foreground) attemptRunCapture()
    else queueCaptureUntilForeground()
  })

  ipcMain.handle('pulse:get-dashboard', () => store.load())
  ipcMain.handle('pulse:refresh', () => store.load())
  ipcMain.handle('pulse:get-run-captures', () => runCapture.listRecords(app.getPath('userData')))
  ipcMain.handle('pulse:get-game-status', () => ({ running: gameRunning }))
  ipcMain.handle('pulse:delete-run', (_event, id) => runCapture.deleteRecord(app.getPath('userData'), id))
  ipcMain.handle('pulse:update-run-decks', (_event, id, decks) => runCapture.updateRecord(app.getPath('userData'), id, { decks }))
  ipcMain.handle('pulse:choose-save', async () => {
    const choice = await dialog.showOpenDialog(window, { title: 'Locate Sektori savegame.json', properties: ['openFile'], filters: [{ name: 'Sektori save', extensions: ['json'] }] })
    if (choice.canceled || !choice.filePaths[0]) return null
    currentSavePath = choice.filePaths[0]
    store.setSavePath(choice.filePaths[0])
    return store.load()
  })
  ipcMain.handle('pulse:export-data', async () => {
    const choice = await dialog.showSaveDialog(window, { title: 'Export performance data', defaultPath: 'sektori-pulse-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (choice.canceled || !choice.filePath) return false
    fs.writeFileSync(choice.filePath, JSON.stringify(store.exportPayload(), null, 2))
    return true
  })
  createWindow()
  gamePollTimer = setInterval(pollGameStatus, GAME_POLL_INTERVAL_MS)
  pollGameStatus()
})

// The results screen never names the ship, but the save (written at run end)
// records which ship was selected — read it there instead of via OCR.
function readSelectedShip() {
  try {
    const raw = fs.readFileSync(currentSavePath, 'utf8')
    const data = JSON.parse(raw.split(SAVE_MARKER)[2])
    return SHIP_NAMES[data.SetupCampaign?.SelectedShip] || null
  } catch {
    return null
  }
}

// Stats.ModeStats[].CountStarted increments the moment a run of that mode
// starts — well before the results-screen save write we react to. Tracking
// which mode's counter last ticked up (since the previous save write) tells
// us which mode is actually in progress, since the save itself has no
// explicit "current mode" field.
function readModeStarts() {
  try {
    const raw = fs.readFileSync(currentSavePath, 'utf8')
    const data = JSON.parse(raw.split(SAVE_MARKER)[2])
    const stats = data.Stats?.ModeStats || []
    return new Map(stats.map((entry) => [entry.Mode, entry.CountStarted]))
  } catch {
    return null
  }
}

function updateLastStartedMode() {
  const current = readModeStarts()
  if (!current) return
  if (lastModeStarts) {
    for (const [mode, count] of current) {
      if (count > (lastModeStarts.get(mode) || 0)) { lastStartedMode = mode; break }
    }
  }
  lastModeStarts = current
}

function attemptRunCapture() {
  if (captureBusy) return
  captureBusy = true
  pendingCaptureOnFocus = false
  runCapture.tryCapture({
    userDataDir: app.getPath('userData'),
    processName: GAME_PROCESS_NAME,
    ship: readSelectedShip(),
    onProgress: (event) => {
      overlay.setPhase(event.phase, event)
      // The dashboard still shows the previous run's numbers while this runs
      // (screenshots done, background OCR in progress) — the pending
      // indicator is how it says "don't trust what you're looking at yet."
      sendToDashboard('pulse:capture-progress', event)
    },
  })
    .then((record) => { if (record) sendToDashboard('pulse:run-captured', record) })
    .catch((error) => {
      console.error('[sektori-pulse] run capture failed', error)
      overlay.setPhase('error')
      sendToDashboard('pulse:capture-progress', { phase: 'error' })
    })
    .finally(() => { captureBusy = false })
}

function queueCaptureUntilForeground() {
  pendingCaptureOnFocus = true
  overlay.setPhase('idle')
}

let gameRunning = false
async function pollGameStatus() {
  const status = await runCapture.checkGameStatus(GAME_PROCESS_NAME)
  const running = Boolean(status.ok && status.running)
  overlay.setGameRunning(running, status.rect, status.minimized)
  if (running !== gameRunning) {
    gameRunning = running
    sendToDashboard('pulse:game-status', { running })
  }
  if (running && status.foreground && pendingCaptureOnFocus && !captureBusy) attemptRunCapture()
  // Keep the virtual pad plugged in for the whole game session so the game
  // shows its "controller connected" toast once at launch, not on every capture.
  if (running && !gamepad.isConnected()) gamepad.ensureConnected()
  else if (!running && gamepad.isConnected()) gamepad.disconnect()
}

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  clearInterval(gamePollTimer)
  overlay.destroy()
  gamepad.disconnect()
  psSession.shutdown()
  store?.close()
}

app.on('window-all-closed', () => {
  cleanup()
  if (process.platform !== 'darwin') app.quit()
})

// Safety net for quit paths that don't go through window-all-closed (e.g.
// Windows session logoff/shutdown, app.quit() called elsewhere) — without
// this, the persistent PowerShell process or the virtual gamepad connection
// could be left running after the window disappears.
app.on('will-quit', cleanup)
