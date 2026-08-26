// Loose "is this probably the same consumable" check. The same physical item
// routinely gets described differently depending on who typed it and where —
// a texted-in report vs a note on a gear photo — so an exact-string match
// would catch almost nothing (see: "Brake clean" / "brake cleaner" /
// "Brake Cleanxxx" all describing the same can, in real data). This only
// judges the text itself; callers are responsible for scoping the comparison
// to the same employee/day/job before calling it, so two techs using the
// same generic item on different jobs don't get flagged against each other.
function normalizeSupplyName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function looksLikeSameSupply(a, b) {
  const na = normalizeSupplyName(a)
  const nb = normalizeSupplyName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  // Word-overlap fallback for names that share a core word but aren't a
  // straight substring of each other (e.g. "brake clean" / "clean brake").
  const wordsA = new Set(na.split(' ').filter(w => w.length >= 4))
  return nb.split(' ').filter(w => w.length >= 4).some(w => wordsA.has(w))
}
