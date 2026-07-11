// Virtual Xbox 360 pad via ViGEmBus. Keyboard/mouse injection (SendInput) is
// ignored by this game (Unity 6 GameInput filters injected events), but a
// ViGEm pad registers as real hardware, which the game accepts.
let ViGEmClient
try {
  ViGEmClient = require('vigemclient')
} catch (error) {
  console.error('[sektori-pulse] vigemclient module unavailable:', error.message)
}

let client = null
let pad = null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function available() {
  return Boolean(ViGEmClient)
}

function isConnected() {
  return Boolean(pad)
}

function ensureConnected() {
  if (!ViGEmClient) return { ok: false, reason: 'module-unavailable' }
  if (pad) return { ok: true, alreadyConnected: true }
  try {
    if (!client) {
      client = new ViGEmClient()
      const err = client.connect()
      if (err) {
        client = null
        return { ok: false, reason: `driver-connect-failed: ${err.message}` }
      }
    }
    const candidate = client.createX360Controller()
    const err = candidate.connect()
    if (err) return { ok: false, reason: `pad-connect-failed: ${err.message}` }
    pad = candidate
    console.log('[sektori-pulse] virtual gamepad connected')
    return { ok: true, alreadyConnected: false }
  } catch (error) {
    return { ok: false, reason: error.message }
  }
}

function disconnect() {
  if (!pad) return
  try { pad.disconnect() } catch { /* already gone */ }
  pad = null
  console.log('[sektori-pulse] virtual gamepad disconnected')
}

async function pressButton(name, holdMs = 150) {
  if (!pad) return false
  pad.button[name].setValue(true)
  await sleep(holdMs)
  pad.button[name].setValue(false)
  return true
}

// A d-pad tap switches the game's active input device to the gamepad; the game
// consumes that first input without acting on it, so it is safe to send even on
// the results screen (verified: it does not change the page or trigger actions).
async function tapDpadToActivate() {
  if (!pad) return false
  pad.axis.dpadHorz.setValue(1)
  await sleep(120)
  pad.axis.dpadHorz.setValue(0)
  return true
}

const nextPage = () => pressButton('RIGHT_SHOULDER')
const previousPage = () => pressButton('LEFT_SHOULDER')

module.exports = { available, isConnected, ensureConnected, disconnect, tapDpadToActivate, nextPage, previousPage }
