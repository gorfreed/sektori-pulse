// Keeps ONE PowerShell process alive for the app's lifetime instead of
// spawning + recompiling the C# interop layer on every single check/
// screenshot call (that recompile alone cost ~600ms per call — see
// capture-window.ps1's "serve" mode). Requests are line-delimited JSON over
// stdin/stdout and strictly serialized: PowerShell handles one at a time, so
// interleaving a capture's screenshots with the 4-second poll-loop's status
// checks would otherwise mismatch responses to requests.
const { spawn } = require('node:child_process')
const readline = require('node:readline')
const path = require('node:path')

const SCRIPT = path.join(__dirname, 'scripts', 'capture-window.ps1')

let proc = null
let rl = null
let pendingResolvers = []
let queue = Promise.resolve()

function rejectAllPending(reason) {
  const resolvers = pendingResolvers
  pendingResolvers = []
  for (const resolve of resolvers) resolve({ ok: false, reason })
}

function ensureProcess() {
  if (proc && !proc.killed) return
  proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Action', 'serve'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  rl = readline.createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    const resolve = pendingResolvers.shift()
    if (!resolve) return
    try { resolve(JSON.parse(line)) } catch { resolve({ ok: false, reason: 'bad-json', raw: line }) }
  })
  proc.on('exit', () => {
    proc = null
    rl?.close()
    rl = null
    rejectAllPending('ps-session-exited')
  })
  proc.stderr.on('data', () => {}) // surfaced as ok:false responses, not needed here
}

function sendRaw(cmd) {
  return new Promise((resolve) => {
    ensureProcess()
    pendingResolvers.push(resolve)
    proc.stdin.write(`${JSON.stringify(cmd)}\n`)
  })
}

// Chains every call through one promise so requests never interleave.
function send(cmd) {
  const result = queue.then(() => sendRaw(cmd))
  queue = result.then(() => {}, () => {})
  return result
}

function shutdown() {
  if (!proc) return
  try { proc.stdin.end() } catch { /* already closing */ }
  try { proc.kill() } catch { /* already gone */ }
  proc = null
  rl?.close()
  rl = null
}

module.exports = { send, shutdown }
