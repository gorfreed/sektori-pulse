import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, ChevronLeft, ChevronRight, Crosshair, Download, Layers, Loader2, Orbit, RefreshCw, Settings } from 'lucide-react'
import { dateTime, duration, number, score } from './lib.js'
import { bestRunForMetric, captureScoreSeries, captureSummary, COMPOSITION_SERIES, DECK_COUNT, DECKS, newBestMetrics, normalizeCapture, RUN_METRICS, runAnalytics, SHIPS, zoomToWindowMs } from './runData.js'

function useMeasure(fallback = { width: 300, height: 120 }) {
  const ref = useRef(null)
  const [size, setSize] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      if (rect.width > 10 && rect.height > 10) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

// A 3rd element marks a nav item as a not-yet-built placeholder: it renders
// grayed out, isn't clickable, and shows this text on hover instead.
export const NAV_ITEMS = [
  ['Campaign', Crosshair], ['Trends', BarChart3], ['Classic', Layers, 'COMING SOON'], ['Settings', Settings],
]

export function RunCaptureFeed({ captures, onSelect, freshId = null, selectedId = null, compactRows = false }) {
  const rowRefs = useRef({})
  // Highlighting the selected row isn't enough if it's scrolled out of view
  // (e.g. jumping here from a chart click or a stat's best-run link) — bring
  // it into view too. 'nearest' means already-visible rows don't jump around.
  useEffect(() => {
    if (selectedId == null) return
    rowRefs.current[selectedId]?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  if (!captures.length) {
    return <Section title="RECENT RUNS" className="capture-feed">
      <EmptyState title="No runs yet" body="Finish a Sektori run on the Game Over screen and Pulse will capture the four result pages here." />
    </Section>
  }
  return <Section title={`${captures.length} RUN${captures.length === 1 ? '' : 'S'}`} className={compactRows ? 'recent-runs' : 'capture-feed'}>
    <div className="run-row head"><span>DATE</span><span>DIFFICULTY</span><span>SHIP</span><span>TIME</span><span>WORLD</span><span>ENEMIES</span><span>BOSSES</span><span>TOKENS</span><span>CHAIN</span><span>PADS</span><span>OTHER</span><span>SCORE</span><span /></div>
    <div className="run-rows-scroll">
      {captures.map((capture) => <RunRow capture={capture} key={capture.id} onSelect={onSelect} fresh={capture.id === freshId} selected={capture.id === selectedId} rowRef={(el) => { rowRefs.current[capture.id] = el }} />)}
    </div>
  </Section>
}

const runCell = (value) => typeof value === 'number' ? number.format(value) : '—'

export function DifficultyTag({ value }) {
  if (!value) return <span>—</span>
  return <span className={`difficulty-tag ${value.toLowerCase()}`}>{value}</span>
}

// ▲ Redeemer · ◆ Defier · ⬢ Sentinel — the ships' rough silhouettes.
const SHIP_GLYPHS = { Redeemer: '▲', Defier: '◆', Sentinel: '⬢' }

export function ShipTag({ value }) {
  if (!value) return <span>—</span>
  return <span className={`ship-tag ${value.toLowerCase()}`}><i>{SHIP_GLYPHS[value] || ''}</i>{value}</span>
}

function RunRow({ capture, onSelect, fresh = false, selected = false, rowRef }) {
  const run = normalizeCapture(capture)
  return <button ref={rowRef} className={`run-row${fresh ? ' fresh' : ''}${selected ? ' selected' : ''}${run.completed ? ' completed' : ''}`} onClick={() => onSelect?.(capture)}>
    <span>{dateTime(run.capturedAt)}</span>
    <DifficultyTag value={run.difficulty} />
    <ShipTag value={run.ship} />
    <span>{run.time ? duration(run.time) : '—'}</span>
    <span>{run.worldSequence || '—'}</span>
    <span>{runCell(run.enemies)}</span>
    <span>{runCell(run.bosses)}</span>
    <span>{runCell(run.scoreTokens)}</span>
    <span>{runCell(run.chain)}</span>
    <span>{runCell(run.pads)}</span>
    <span>{runCell(run.other)}</span>
    <strong>{run.score ? score(run.score) : '—'}</strong>
    <b>›</b>
  </button>
}

// Two-step delete: first click arms it, second click within 3s confirms.
export function DeleteRunButton({ onDelete, compact = false }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return <button className={`delete-run${armed ? ' armed' : ''}${compact ? ' compact' : ''}`} onClick={() => { if (armed) { setArmed(false); onDelete() } else setArmed(true) }}>
    {armed ? 'CONFIRM DELETE?' : 'DELETE RUN'}
  </button>
}

export function LatestRunPanel({ captures, inspected, freshId = null, onClear, onDelete, onSelectRun, onSetDecks }) {
  const [tip, tipHandlers] = useChartTooltip()
  const [editingDecks, setEditingDecks] = useState(false)
  const capture = inspected || captures[0]
  // Close the deck editor when the displayed run changes, without an effect
  // (which would cause an extra render) — bail out during render instead.
  const lastCaptureIdRef = useRef(capture?.id)
  if (lastCaptureIdRef.current !== capture?.id) {
    lastCaptureIdRef.current = capture?.id
    if (editingDecks) setEditingDecks(false)
  }
  if (!capture) {
    return <Section title="LATEST RUN" className="latest-run">
      <EmptyState title="No runs yet" body="Finish a Sektori run and its full result breakdown will appear here the moment it is captured." />
    </Section>
  }
  const isInspecting = Boolean(inspected) && inspected.id !== captures[0]?.id
  const run = normalizeCapture(capture)
  const bests = newBestMetrics(capture, captures)
  const statsMetrics = RUN_METRICS.filter((metric) => metric.key !== 'score' && metric.group !== 'breakdown')
  const breakdownMetrics = RUN_METRICS.filter((metric) => metric.group === 'breakdown')
  const isFresh = capture.id === freshId && !isInspecting
  const metricRow = (metric, rowIndex) => {
    const text = formatCaptureValue(run[metric.key], metric.kind)
    // Hovering any stat shows the run that actually holds the best value for
    // it (same ship, could be a different run entirely) — clicking jumps to it.
    const bestRun = bestRunForMetric(captures, metric.key, run.ship, metric.lowerIsBetter)
    const hoverable = Boolean(bestRun && onSelectRun)
    return <div key={metric.key} style={isFresh ? { animationDelay: `${(rowIndex + 1) * 45}ms` } : undefined}
      className={hoverable ? 'stat-hoverable' : undefined}
      onMouseMove={bestRun ? (event) => tipHandlers.show(event, <>
        <strong><em className="best-badge">BEST</em> {formatCaptureValue(bestRun[metric.key], metric.kind)}</strong>
        <span>{bestRun.ship || 'Unknown ship'} · {bestRun.difficulty || 'Unknown difficulty'}</span>
        <span>{dateTime(bestRun.capturedAt)}</span>
      </>) : undefined}
      onMouseLeave={bestRun ? tipHandlers.hide : undefined}
      onClick={hoverable ? () => onSelectRun(bestRun.id) : undefined}>
      <span>{metric.label}</span>
      <strong className={String(text).length > 9 ? 'dense' : ''}>{text}</strong>
      {bests.has(metric.key) ? <em className="best-badge">BEST</em> : null}
    </div>
  }
  return <Section title={isInspecting ? 'RUN DETAIL' : 'LATEST RUN'} action={<div className="latest-run-actions">{onDelete ? <DeleteRunButton compact onDelete={() => onDelete(capture.id)} /> : null}{isInspecting ? <button className="text-button" onClick={onClear}>‹ LATEST</button> : null}</div>} className={`latest-run${isFresh ? ' fresh' : ''}`}>
    <div className="latest-run-hero">
      <span>{dateTime(run.capturedAt)} · WORLD {run.worldSequence || '—'} {run.difficulty ? <DifficultyTag value={run.difficulty} /> : null} {run.ship ? <ShipTag value={run.ship} /> : null}</span>
      <strong>{run.completed ? <i className="completed-star" title="Campaign completed">★</i> : null}{score(run.score || 0)}</strong>
      {bests.has('score') ? <em className="best-badge">NEW BEST</em> : null}
    </div>
    <div className="latest-run-rows">
      {statsMetrics.map((metric, index) => metricRow(metric, index))}
      <div className="latest-run-subhead"><span>SCORE BREAKDOWN</span><i /></div>
      {breakdownMetrics.map((metric, index) => metricRow(metric, statsMetrics.length + 1 + index))}
      <div className="latest-run-total">
        <span>= SCORE</span>
        <strong>{score(run.score || 0)}</strong>
      </div>
      <div className="latest-run-subhead"><span>DECKS PLAYED</span><i /></div>
      {onSetDecks ? (run.decks.length
        ? <button className="deck-summary" onClick={() => setEditingDecks(true)}>
          <div className="deck-chips">{run.decks.map((deck) => <span className="deck-chip" key={deck}>{deck}</span>)}</div>
        </button>
        : <button className="deck-summary deck-summary-empty" onClick={() => setEditingDecks(true)}>+ ADD DECKS PLAYED</button>) : null}
    </div>
    <ChartTooltip tip={tip} />
    {editingDecks ? <DeckPicker initial={run.decks} onCancel={() => setEditingDecks(false)} onSave={(decks) => { onSetDecks(capture.id, decks); setEditingDecks(false) }} /> : null}
  </Section>
}

const DECK_PAGE_SIZE = 8

// The game never records which 8 of the 16 decks a run used, so the player
// tags it manually after the fact. Mirrors the game's own deck-select screen:
// portrait cards, paginated 4x2 (8 per page) rather than all 16 crammed into
// one grid, no card descriptions (titles only).
function DeckPicker({ initial, onSave, onCancel }) {
  const [selected, setSelected] = useState(() => new Set(initial))
  const [page, setPage] = useState(0)
  const [triedIncomplete, setTriedIncomplete] = useState(false)
  const pageCount = Math.ceil(DECKS.length / DECK_PAGE_SIZE)
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const toggle = (deck) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(deck)) next.delete(deck)
    else next.add(deck)
    return next
  })
  const count = selected.size
  const complete = count === DECK_COUNT
  // The save button always responds to a click (a disabled button reads as
  // broken/missing) — an incomplete selection shows why it didn't save
  // instead of just not doing anything.
  const submit = () => { if (complete) onSave([...selected]); else setTriedIncomplete(true) }
  const visible = DECKS.slice(page * DECK_PAGE_SIZE, page * DECK_PAGE_SIZE + DECK_PAGE_SIZE)
  return <div className="deck-picker-backdrop" onClick={onCancel}>
    <div className="deck-picker" onClick={(event) => event.stopPropagation()}>
      <div className="deck-picker-title">DECKS PLAYED</div>
      <div className="deck-picker-grid">
        {visible.map((deck) => <button key={deck} className={`deck-toggle${selected.has(deck) ? ' active' : ''}`} onClick={() => { toggle(deck); setTriedIncomplete(false) }}>{deck}</button>)}
      </div>
      <div className="deck-picker-pager">
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}><ChevronLeft /></button>
        <span>{page + 1} / {pageCount}</span>
        <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page === pageCount - 1}><ChevronRight /></button>
      </div>
      <div className="deck-picker-actions">
        <span className={complete ? '' : 'deck-count-off'}>{count} / {DECK_COUNT} selected{triedIncomplete && !complete ? ' — pick exactly 8 to save' : ''}</span>
        <button className="text-button" onClick={onCancel}>CANCEL</button>
        <button className="deck-save" onClick={submit}>SAVE</button>
      </div>
    </div>
  </div>
}

function formatCaptureValue(value, kind) {
  if (value === null || value === undefined || value === '') return '—'
  if (kind === 'score') return score(value)
  if (kind === 'duration' && typeof value === 'number') return duration(value)
  if (typeof value === 'number') return number.format(value)
  return value
}

// Prominent, high-contrast segmented control — this is the dashboard's
// primary scope selector, so it reads louder than the nav or the actions.
export function ShipSelector({ shipFilter, setShipFilter }) {
  // No "ALL" option — ships play too differently to share bests, and the
  // best-run hover/click links throughout the dashboard only make sense
  // scoped to one ship at a time.
  return <div className="ship-selector">
    {SHIPS.map((ship) => <button key={ship} className={`${shipFilter === ship ? 'active ' : ''}${ship.toLowerCase()}`} onClick={() => setShipFilter(ship)}>{ship}</button>)}
  </div>
}

export function Topbar({ page, setPage, isDesktop, gameRunning, refreshing, onRefresh, onExport, shipFilter, setShipFilter, capturePending }) {
  const label = !isDesktop ? 'DEMO' : gameRunning ? 'LIVE' : 'IDLE'
  return <header className="topbar">
    <div className="brand"><span>SEKTORI</span><i>//</i><strong>PULSE</strong></div>
    <nav>{NAV_ITEMS.map(([navLabel, Icon, comingSoon]) => comingSoon
      ? <NavComingSoon key={navLabel} label={navLabel} Icon={Icon} hint={comingSoon} />
      : <button className={page === navLabel ? 'active' : ''} onClick={() => setPage(navLabel)} key={navLabel}><Icon /><span>{navLabel}</span></button>)}</nav>
    <ShipSelector shipFilter={shipFilter} setShipFilter={setShipFilter} />
    {capturePending ? <div className="capture-pending"><Loader2 className="spin" /> PROCESSING NEW RUN…</div> : null}
    <div className={`live${isDesktop && gameRunning ? '' : ' idle'}`}><span /> {label}</div>
    <div className="top-actions"><button onClick={onExport}><Download /> EXPORT</button><button onClick={onRefresh} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} /> REFRESH</button></div>
  </header>
}

// Not a real `disabled` button — disabled elements suppress hover events in
// Chromium, which would kill the "coming soon" tooltip. Instead it just does
// nothing on click and is styled to look inactive.
function NavComingSoon({ label, Icon, hint }) {
  const [tip, tipHandlers] = useChartTooltip()
  return <button className="nav-disabled"
    onMouseMove={(event) => tipHandlers.show(event, <strong>{hint}</strong>)}
    onMouseLeave={tipHandlers.hide}>
    <Icon /><span>{label}</span>
    <ChartTooltip tip={tip} />
  </button>
}

export function Section({ title, action, children, className = '' }) {
  return <section className={`section ${className}`}><div className="section-title"><span className="tri" />{title}{action ? <div>{action}</div> : null}</div>{children}</section>
}

// Evenly spaced tick timestamps across the domain, with a label format that
// adapts to the span in view — HH:mm when zoomed into a session, date+time
// for a multi-day window, bare date once you're looking at weeks/months.
function timeTicks(domainStart, domainEnd, count = 5) {
  const span = domainEnd - domainStart
  if (span <= 0) return [domainStart]
  return Array.from({ length: count }, (_, i) => domainStart + (span * i) / (count - 1))
}

function formatTick(t, spanMs) {
  const date = new Date(t)
  if (spanMs <= 26 * 3600 * 1000) return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(date)
  if (spanMs <= 21 * 86400000) return new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
  return new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit' }).format(date)
}

function humanWindow(ms) {
  const minutes = ms / 60000
  if (minutes < 90) return `${Math.round(minutes)} MIN`
  const hours = minutes / 60
  if (hours < 48) return `${Math.round(hours)} H`
  const days = hours / 24
  if (days < 14) return `${Math.round(days)} D`
  return `${Math.round(days / 7)} W`
}
const SCORE_CHART_SHIPS = [
  { label: 'Redeemer', match: 'Redeemer', color: '#ff7a5c' },
  { label: 'Defier', match: 'Defier', color: '#dc5bff' },
  { label: 'Sentinel', match: 'Sentinel', color: '#72f35a' },
  { label: 'Unknown ship', match: null, color: '#5b6e79' },
]
const DIFFICULTY_DOTS = [['Experience', '#2ce7ef'], ['Challenge', '#ffdc2e'], ['Revolution', '#ff3154']]
const difficultyColor = (difficulty) => DIFFICULTY_DOTS.find(([label]) => label === difficulty)?.[1] || '#8b95a0'

// Native SVG <title> tooltips need a long, precise hover on a tiny dot to
// appear — not reliable for chart points. This renders our own styled box
// instead, following the cursor, triggered from a larger invisible hit area
// around each dot.
function useChartTooltip() {
  const [tip, setTip] = useState(null)
  const show = (event, content) => setTip({ x: event.clientX, y: event.clientY, content })
  const move = (event) => setTip((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current)
  const hide = () => setTip(null)
  return [tip, { show, move, hide }]
}

function ChartTooltip({ tip }) {
  if (!tip) return null
  return <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div>
}

export function ScoreChart({ captures = [], zoom: zoomProp, onZoomChange, onSelectRun }) {
  // 0–100 log-scaled zoom: 0 = tightest window (6h), 100 = full history (14d).
  // The window is anchored to the most recent run, so zooming in always shows
  // the latest sessions in increasing detail rather than empty recent time.
  // Defaults to 6h (zoom 0); can be controlled externally so other panels
  // (e.g. the Trends page's mini-charts) can share the same time window.
  const [zoomState, setZoomState] = useState(0)
  const zoom = zoomProp !== undefined ? zoomProp : zoomState
  const setZoom = onZoomChange || setZoomState
  const bodyRef = useRef(null)
  const [size, setSize] = useState({ width: 600, height: 195 })
  const [tip, tipHandlers] = useChartTooltip()
  const hoveredRef = useRef(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return undefined
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      if (rect.width > 10 && rect.height > 10) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const capturedScores = useMemo(() => captureScoreSeries(captures), [captures])
  const allTimes = capturedScores.map((item) => new Date(item.capturedAt).getTime())
  const newest = allTimes.length ? Math.max(...allTimes) : 0
  const windowMs = zoomToWindowMs(zoom)
  const source = capturedScores.filter((item) => new Date(item.capturedAt).getTime() >= newest - windowMs)
  const hasRunScores = source.length > 0

  const { width, height } = size
  const pad = { left: 10, right: 22, top: 14, bottom: 20 }
  const innerW = Math.max(1, width - pad.left - pad.right)
  const innerH = Math.max(1, height - pad.top - pad.bottom)
  const times = source.map((item) => new Date(item.capturedAt).getTime())
  const domainStart = newest - windowMs
  const domainEnd = newest
  const domainSpan = Math.max(1, domainEnd - domainStart)
  const maxScore = Math.max(...source.map((item) => item.score), 1)
  const points = source.map((item, index) => ({
    x: pad.left + (domainSpan === 1 ? innerW / 2 : ((times[index] - domainStart) / domainSpan) * innerW),
    y: pad.top + innerH - (item.score / maxScore) * innerH,
    value: item.score,
    date: item.capturedAt,
    ship: item.ship || null,
    difficulty: item.difficulty || null,
    id: item.id,
  }))
  // Line identity = ship, dot color = difficulty (two independent encodings
  // on separate marks). Dots wear a surface ring so they read against lines.
  //
  // The line is an exponential moving average of the ship's scores, not a
  // raw point-to-point connection: a single early death produces a near-zero
  // score that would yank a raw line to the floor and back, turning the
  // whole chart into meaningless zigzag. The EMA (~5-run memory) absorbs
  // one-off fails into a gentle dip while sustained improvement still moves
  // it clearly — the raw dots keep every individual result visible.
  const EMA_ALPHA = 2 / (5 + 1)
  const shipSeries = SCORE_CHART_SHIPS
    .map((shipDef) => {
      const shipPoints = points.filter((point) => (point.ship || null) === shipDef.match)
      let ema = null
      const trend = shipPoints.map((point) => {
        ema = ema === null ? point.value : EMA_ALPHA * point.value + (1 - EMA_ALPHA) * ema
        return { x: point.x, y: pad.top + innerH - (ema / maxScore) * innerH }
      })
      return { ...shipDef, points: shipPoints, trend }
    })
    .filter((series) => series.points.length > 0)

  return <Section title={hasRunScores ? 'RUN SCORE PROGRESSION' : 'WAITING FOR RUN SCORES'} action={<div className="zoom-slider"><span>WINDOW</span><input type="range" min="0" max="100" step="1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><strong>{humanWindow(windowMs)}</strong></div>} className="score-chart">
    <div className="chart-series-legend">
      <span className="legend-group">{shipSeries.map((series) => <span key={series.label}><i className="line-swatch" style={{ background: series.color }} />{series.label}</span>)}</span>
      <span className="legend-group">{DIFFICULTY_DOTS.map(([label, color]) => <span key={label}><i className="dot-swatch" style={{ background: color }} />{label}</span>)}</span>
    </div>
    <div className="chart-body" ref={bodyRef}>
      <svg width={width} height={height} role="img" aria-label={hasRunScores ? 'Run score progression by ship' : 'No run scores yet'}>
        {[0.25, 0.5, 0.75, 1].map((fraction) => <line key={fraction} x1={pad.left} x2={width - pad.right} y1={pad.top + innerH * (1 - fraction)} y2={pad.top + innerH * (1 - fraction)} className="gridline" />)}
        {timeTicks(domainStart, domainEnd).map((t, index, all) => {
          const x = pad.left + ((t - domainStart) / domainSpan) * innerW
          const anchor = index === 0 ? 'start' : index === all.length - 1 ? 'end' : 'middle'
          return <g key={t}>
            <line x1={x} x2={x} y1={pad.top} y2={pad.top + innerH + 3} className="gridline" />
            <text x={x} y={height - 4} textAnchor={anchor} className="chart-tick">{formatTick(t, domainSpan)}</text>
          </g>
        })}
        {hasRunScores ? <>
          {shipSeries.map((series) => series.trend.length > 1 ? <polyline key={series.label} points={series.trend.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')} fill="none" stroke={series.color} strokeWidth="2" pointerEvents="none" /> : null)}
          {points.map((point, index) => <g key={`${point.date}-${index}`} pointerEvents="none">
            <circle cx={point.x} cy={point.y} r="4.5" fill={difficultyColor(point.difficulty)} stroke="#071019" strokeWidth="2" />
            {index === points.length - 1 ? <circle cx={point.x} cy={point.y} r="8" className="pulse-point" /> : null}
          </g>)}
          {/* One large invisible hover surface instead of tiny per-dot hit
              targets — finds the nearest point by x on mousemove, so the
              whole plot area is a hit zone without inflating the dots themselves. */}
          <rect x={pad.left} y={pad.top} width={innerW} height={innerH} fill="transparent" pointerEvents="all"
            style={onSelectRun ? { cursor: 'pointer' } : undefined}
            onMouseMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              const targetX = pad.left + (event.clientX - bounds.left)
              const nearest = points.reduce((best, point) => Math.abs(point.x - targetX) < Math.abs(best.x - targetX) ? point : best, points[0])
              hoveredRef.current = nearest
              tipHandlers.show(event, <>
                <strong>{score(nearest.value)}</strong>
                <span>{nearest.ship || 'Unknown ship'} · {nearest.difficulty || 'Unknown difficulty'}</span>
                <span>{dateTime(nearest.date)}</span>
              </>)
            }}
            onMouseLeave={() => { hoveredRef.current = null; tipHandlers.hide() }}
            onClick={() => { if (hoveredRef.current) onSelectRun?.(hoveredRef.current.id) }} />
        </> : <text x={width / 2} y={height / 2} className="chart-empty">NO RUNS IN THIS RANGE</text>}
      </svg>
    </div>
    <div className="chart-axis"><span>WINDOW: LAST {humanWindow(windowMs)}</span><span>BEST IN VIEW: {hasRunScores ? score(maxScore) : '—'}</span></div>
    <ChartTooltip tip={tip} />
  </Section>
}

// Small-multiple line chart: one derived metric across runs (index-based x —
// each run is one step). Crisp pixel rendering, last value direct-labeled.
export function TrendChart({ title, points, color = '#ff3154', format = (v) => number.format(Math.round(v)), onSelectRun }) {
  const [ref, { width, height }] = useMeasure({ width: 300, height: 110 })
  const [tip, tipHandlers] = useChartTooltip()
  const hoveredRef = useRef(null)
  const usable = points.filter((point) => typeof point.value === 'number')
  const pad = { left: 8, right: 12, top: 14, bottom: 8 }
  const innerW = Math.max(1, width - pad.left - pad.right)
  const innerH = Math.max(1, height - pad.top - pad.bottom)
  const max = Math.max(...usable.map((point) => point.value), 1)
  const xy = usable.map((point, index) => ({
    x: pad.left + (usable.length === 1 ? innerW / 2 : (index / (usable.length - 1)) * innerW),
    y: pad.top + innerH - (point.value / max) * innerH,
    ...point,
  }))
  const last = xy[xy.length - 1]
  return <Section title={title} action={last ? <span className="trend-last" style={{ color }}>{format(last.value)}</span> : null} className="trend-mini">
    <div className="chart-body" ref={ref}>
      <svg width={width} height={height}>
        {[0.5, 1].map((fraction) => <line key={fraction} x1={pad.left} x2={width - pad.right} y1={pad.top + innerH * (1 - fraction)} y2={pad.top + innerH * (1 - fraction)} className="gridline" />)}
        {xy.length ? <>
          <polyline points={xy.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth="2" pointerEvents="none" />
          {xy.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === xy.length - 1 ? 4 : 2.5} fill={color} pointerEvents="none" />)}
          <rect x={pad.left} y={pad.top} width={innerW} height={innerH} fill="transparent" pointerEvents="all"
            style={onSelectRun ? { cursor: 'pointer' } : undefined}
            onMouseMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              const targetX = pad.left + (event.clientX - bounds.left)
              const nearest = xy.reduce((best, point) => Math.abs(point.x - targetX) < Math.abs(best.x - targetX) ? point : best, xy[0])
              hoveredRef.current = nearest
              tipHandlers.show(event, <>
                <strong>{format(nearest.value)}</strong>
                <span>{nearest.ship || 'Unknown ship'} · {nearest.difficulty || 'Unknown difficulty'}</span>
                <span>Score {score(nearest.score || 0)} · {dateTime(nearest.date)}</span>
              </>)
            }}
            onMouseLeave={() => { hoveredRef.current = null; tipHandlers.hide() }}
            onClick={() => { if (hoveredRef.current) onSelectRun?.(hoveredRef.current.id) }} />
        </> : <text x={width / 2} y={height / 2} className="chart-empty">NEEDS RUNS WITH A PARSED TIME</text>}
      </svg>
    </div>
    <ChartTooltip tip={tip} />
  </Section>
}

// 100%-stacked horizontal bars: where each run's points came from.
export function CompositionChart({ analytics }) {
  const runs = analytics.filter((run) => run.composition).slice(-10).toReversed()
  return <Section title="SCORE COMPOSITION BY RUN" action={<div className="comp-legend">{COMPOSITION_SERIES.map((series) => <span key={series.key}><i style={{ background: series.color }} />{series.label}</span>)}</div>} className="composition-chart">
    {runs.length ? <div className="comp-rows">
      {runs.map((run) => <div className="comp-row" key={run.id}>
        <span>{dateTime(run.date)}</span>
        <div className="comp-bar">
          {run.composition.filter((part) => part.value > 0).map((part) => <i key={part.key} style={{ width: `${(part.value / run.compositionTotal) * 100}%`, background: part.color }} title={`${part.label}: ${number.format(part.value)} (${Math.round((part.value / run.compositionTotal) * 100)}%)`} />)}
        </div>
        <strong>{score(run.score)}</strong>
      </div>)}
    </div> : <EmptyState title="No composition data" body="Runs with a full score breakdown will appear here." />}
  </Section>
}

// Ships play too differently to share one "personal best" — the active ship
// filter is global (set from the topbar's own selector) and scopes every
// panel on the dashboard, including this one — `captures` arrives pre-filtered.
export function FormPanel({ captures, shipFilter }) {
  const analytics = runAnalytics(captures)
  const summary = captureSummary(captures)
  const bestRun = summary.runs.find((run) => run.score === summary.bestScore && run.score > 0)
  const rows = [
    { label: 'SCORE / MIN', metricKey: 'scorePerMin', color: '#ffdc2e', format: (v) => number.format(Math.round(v)), hint: 'Score ÷ run length in minutes, per run.' },
    { label: 'KILLS / MIN', metricKey: 'killsPerMin', color: '#ff3154', format: (v) => v.toFixed(1), hint: 'Enemies destroyed ÷ run length in minutes, per run.' },
    { label: 'SURVIVAL', metricKey: 'survivalSec', color: '#2ce7ef', format: (v) => duration(v), hint: 'Run length, from the captured results-screen time.' },
  ]
  return <Section title="FORM" className="form-panel">
    <div className="form-best"><span>{shipFilter.toUpperCase()} BEST</span><strong>{score(summary.bestScore)}</strong><em>{bestRun ? `${dateTime(bestRun.capturedAt)} · W ${bestRun.worldSequence || '—'}` : 'NO RUNS YET'}</em></div>
    {rows.map((row) => <FormRow key={row.metricKey} analytics={analytics} {...row} />)}
  </Section>
}

function FormRow({ analytics, label, metricKey, color, format, hint }) {
  const [tip, tipHandlers] = useChartTooltip()
  const series = analytics.map((run) => run[metricKey]).filter((value) => typeof value === 'number')
  if (!series.length) return <div className="form-row"><span>{label}</span><strong>—</strong></div>
  const latest = series[series.length - 1]
  const prior = series.slice(0, -1)
  const priorAvg = prior.length ? prior.reduce((total, value) => total + value, 0) / prior.length : null
  const delta = priorAvg ? ((latest - priorAvg) / priorAvg) * 100 : null
  const w = 72, h = 20
  const max = Math.max(...series, 1)
  const line = series.map((value, index) => `${(series.length === 1 ? w / 2 : (index / (series.length - 1)) * w).toFixed(1)},${(h - 3 - (value / max) * (h - 6)).toFixed(1)}`).join(' ')
  return <div className="form-row"
    onMouseMove={(event) => tipHandlers.show(event, <>
      <strong>{label}</strong>
      <span>{hint}</span>
      <span>Last {series.length} run{series.length === 1 ? '' : 's'}{priorAvg !== null ? ` · avg ${format(priorAvg)}` : ''}</span>
    </>)}
    onMouseLeave={tipHandlers.hide}>
    <span>{label}</span>
    <svg width={w} height={h}><polyline points={line} fill="none" stroke={color} strokeWidth="1.5" /></svg>
    <strong>{format(latest)}</strong>
    {delta !== null ? <em className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%</em> : <em>—</em>}
    <ChartTooltip tip={tip} />
  </div>
}

export function PageTitle({ title, children }) { return <div className="page-heading"><h1>{title}</h1><div className="heading-controls">{children}</div></div> }

export function EmptyState({ title, body }) { return <div className="empty"><Orbit /><h2>{title}</h2><p>{body}</p></div> }
