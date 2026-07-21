import { useEffect, useState } from 'react'
import { Database, FolderOpen, ShieldCheck, Zap } from 'lucide-react'
import { CompositionChart, FormPanel, LatestRunPanel, PageTitle, RunCaptureFeed, ScoreChart, Section, Topbar, TrendChart } from './components.jsx'
import { demoData } from './demoData.js'
import { normalizeCapture, runAnalytics, SHIPS, windowFilter } from './runData.js'
import { duration, number } from './lib.js'

function useRunCaptures() {
  const [captures, setCaptures] = useState([])
  const [freshId, setFreshId] = useState(null)
  useEffect(() => {
    if (!window.pulse) return undefined
    window.pulse.getRunCaptures().then(setCaptures).catch(() => {})
    let fadeTimer
    const off = window.pulse.onRunCaptured((record) => {
      setCaptures((current) => [record, ...current])
      setFreshId(record.id)
      clearTimeout(fadeTimer)
      fadeTimer = setTimeout(() => setFreshId(null), 4000)
    })
    return () => { off(); clearTimeout(fadeTimer) }
  }, [])
  const deleteRun = async (id) => {
    if (!window.pulse) return
    const updated = await window.pulse.deleteRun(id)
    setCaptures(updated)
  }
  const setDecks = async (id, decks) => {
    if (!window.pulse) return []
    const updated = await window.pulse.updateRunDecks(id, decks)
    setCaptures(updated)
    return updated
  }
  return { captures, freshId, deleteRun, setDecks }
}

// Tracks whether a capture is mid-flight (screenshots taken, background OCR
// still running) so the dashboard can flag its own numbers as stale instead
// of silently showing last run's data while a new one is being processed.
const PENDING_PHASES = new Set(['checking', 'capturing', 'processing'])

function useCaptureProgress() {
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!window.pulse?.onCaptureProgress) return undefined
    return window.pulse.onCaptureProgress((event) => setPending(PENDING_PHASES.has(event.phase)))
  }, [])
  return pending
}

function useGameStatus() {
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!window.pulse) return undefined
    // Pull the current status once on mount — the main process only pushes
    // on change, and its first poll can fire before this listener is
    // attached, so relying on the push alone can leave this stuck at the
    // default value even while the game is already running.
    window.pulse.getGameStatus?.().then((event) => setRunning(Boolean(event.running))).catch(() => {})
    return window.pulse.onGameStatus((event) => setRunning(Boolean(event.running)))
  }, [])
  return running
}

function useDashboard() {
  const [data, setData] = useState(demoData)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const isDesktop = Boolean(window.pulse)
  useEffect(() => {
    if (!window.pulse) return undefined
    window.pulse.getDashboard().then(setData).catch((reason) => setError(reason.message))
    const offUpdate = window.pulse.onUpdate(setData)
    // A finished capture also implies fresh save data — refresh the dashboard
    // so overview stats update without the user touching anything.
    const offCaptured = window.pulse.onRunCaptured(() => {
      window.pulse.getDashboard().then(setData).catch(() => {})
    })
    return () => { offUpdate(); offCaptured() }
  }, [])
  const refresh = async () => {
    setRefreshing(true); setError('')
    try { if (window.pulse) setData(await window.pulse.refresh()); else await new Promise((resolve) => setTimeout(resolve, 450)) } catch (reason) { setError(reason.message) }
    finally { setRefreshing(false) }
  }
  const chooseSave = async () => { const next = await window.pulse?.chooseSave(); if (next) setData(next) }
  return { data, refreshing, refresh, chooseSave, error, isDesktop }
}

export default function App() {
  const [page, setPage] = useState('Campaign')
  const [inspected, setInspected] = useState(null)
  const [shipFilter, setShipFilter] = useState(SHIPS[0])
  const { data, refreshing, refresh, chooseSave, error, isDesktop } = useDashboard()
  const { captures: allCaptures, freshId, deleteRun, setDecks } = useRunCaptures()
  const capturePending = useCaptureProgress()
  const gameRunning = useGameStatus()
  // The ship filter is global: every panel on the dashboard — best/average/
  // latest score, the run feed, the charts — reads from this scoped list, not
  // the raw capture history. No "ALL" option — ships play too differently to
  // share a personal best, and it would make the best-run hover/click links
  // ambiguous (which ship's record would clicking it jump to?).
  const captures = allCaptures.filter((capture) => normalizeCapture(capture).ship === shipFilter)
  const exportData = () => window.pulse?.exportData()
  // Clicking a run dot on any chart (Campaign or Trends) jumps to the
  // Campaign page with that run open in the side panel — lifted to App level
  // so it survives the page switch instead of living inside Campaign's state.
  const onSelectRun = (id) => {
    const capture = allCaptures.find((item) => item.id === id)
    if (!capture) return
    setInspected(capture)
    setPage('Campaign')
  }
  return <div className="app-shell">
    <Topbar page={page} setPage={setPage} isDesktop={isDesktop} gameRunning={gameRunning} refreshing={refreshing} onRefresh={refresh} onExport={exportData} shipFilter={shipFilter} setShipFilter={setShipFilter} capturePending={capturePending} />
    <main>{error ? <div className="error-bar">SAVE LINK LOST — {error} <button onClick={chooseSave}>LOCATE SAVE</button></div> : null}
      <Page page={page} data={data} captures={captures} shipFilter={shipFilter} freshId={freshId} deleteRun={deleteRun} setDecks={setDecks} chooseSave={chooseSave} isDesktop={isDesktop} inspected={inspected} setInspected={setInspected} onSelectRun={onSelectRun} />
    </main>
  </div>
}

function Page({ page, ...props }) {
  if (page === 'Campaign') return <Campaign {...props} />
  if (page === 'Trends') return <Trends {...props} />
  return <SettingsPage {...props} />
}

function Campaign({ data, captures, freshId, deleteRun, setDecks, inspected, setInspected, onSelectRun, shipFilter }) {
  // Keeps the panel showing this run's freshly saved decks immediately,
  // instead of the stale pre-save object `inspected` still points at.
  const onSetDecks = async (id, decks) => {
    const updated = await setDecks(id, decks)
    if (inspected?.id === id) setInspected(updated.find((item) => item.id === id) || null)
  }
  return <div className="ocr-overview-grid">
    <FormPanel captures={captures} shipFilter={shipFilter} onSelectRun={onSelectRun} />
    <ScoreChart history={data.history} captures={captures} onSelectRun={onSelectRun} />
    <RunCaptureFeed captures={captures} onSelect={setInspected} freshId={freshId} selectedId={(inspected || captures[0])?.id ?? null} compactRows />
    <LatestRunPanel captures={captures} inspected={inspected} freshId={freshId} onClear={() => setInspected(null)} onDelete={async (id) => { await deleteRun(id); setInspected(null) }} onSelectRun={onSelectRun} onSetDecks={onSetDecks} />
  </div>
}

function Trends({ data, captures, shipFilter, onSelectRun }) {
  // Shared with the score chart's own zoom slider so every panel on this page
  // reacts to the same time window instead of always showing full history.
  const [zoom, setZoom] = useState(0)
  const analytics = runAnalytics(captures)
  const windowed = windowFilter(analytics, zoom)
  const points = (key) => windowed.map((run) => ({ date: run.date, value: run[key], ship: run.ship, difficulty: run.difficulty, score: run.score, id: run.id }))
  return <><PageTitle title="PERFORMANCE TRENDS"><div className="status-note"><Zap /> {windowed.length} RUNS IN WINDOW · {shipFilter.toUpperCase()}</div></PageTitle>
    <div className="trend-grid">
      <ScoreChart history={data.history} captures={captures} zoom={zoom} onZoomChange={setZoom} onSelectRun={onSelectRun} />
      <TrendChart title="PACE · SCORE PER MINUTE" points={points('scorePerMin')} color="#ffdc2e" onSelectRun={onSelectRun} />
      <TrendChart title="AGGRESSION · KILLS PER MINUTE" points={points('killsPerMin')} color="#ff3154" format={(v) => v.toFixed(1)} onSelectRun={onSelectRun} />
      <TrendChart title="SURVIVAL · RUN LENGTH" points={points('survivalSec')} color="#2ce7ef" format={(v) => duration(v)} onSelectRun={onSelectRun} />
      <TrendChart title="ECONOMY · GLIMMER PER MINUTE" points={points('glimmerPerMin')} color="#72f35a" format={(v) => number.format(Math.round(v))} onSelectRun={onSelectRun} />
      <CompositionChart analytics={windowed} />
    </div></>
}

function SettingsPage({ data, chooseSave, isDesktop }) {
  return <><PageTitle title="SETTINGS"><div className="status-note"><ShieldCheck /> LOCAL-FIRST · NO UPLOADS</div></PageTitle><div className="settings-layout"><Section title="DATA SOURCE" className="settings-panel"><div className="path-field"><Database /><div><span>SEKTORI SAVE FILE</span><strong>{data.source.path}</strong></div></div><button className="primary" onClick={chooseSave} disabled={!isDesktop}><FolderOpen /> LOCATE SAVE FILE</button><p>Pulse reads the save without modifying it. Run performance is recorded from result-screen captures stored in the local application data folder.</p></Section><Section title="TRACKING" className="settings-panel"><SettingRow title="Run captures" body="Record the Game Over result pages when a run ends." enabled /><SettingRow title="Save context" body="Use the save only for lifetime context and achievements." enabled /><SettingRow title="External telemetry" body="Pulse never sends your data anywhere." enabled={false} /></Section></div></>
}
function SettingRow({ title, body, enabled }) { return <div className="setting-row"><div><strong>{title}</strong><span>{body}</span></div><i className={enabled ? 'on' : ''}><b /></i></div> }
