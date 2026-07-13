// Hours support quarter-hour precision (e.g. "6.25hrs" via SMS), but every report/PDF/CSV
// was displaying them with toFixed(1) — silently rounding .25/.75 fractions to one decimal
// (23.75 -> "23.8"). This shows up to 2 decimals, trimming a trailing zero so whole numbers
// and half-hours still read clean ("8", "8.5", "23.75").
export function fmtHours(n) {
  const num = Number(n) || 0
  const rounded = Math.round(num * 100) / 100
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
