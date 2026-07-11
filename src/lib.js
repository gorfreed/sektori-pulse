export const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
export const number = new Intl.NumberFormat('en')
export const score = (value) => number.format(Math.round(value || 0))
// Same format the game uses on its results screens: "38m 18s" (total
// minutes, no hour rollover).
export const duration = (seconds = 0) => `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
export const dateTime = (value) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(parsed)
}
export const percent = (value) => `${Number(value || 0).toFixed(1)}%`
