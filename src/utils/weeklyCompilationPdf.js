import { jsPDF } from 'jspdf'

// Recreates the Cores Worldwide paper "Weekly Compilation / Daily Work Hours" form
// (Document# CW-OAD-F002 rev.0) — one employee's Thu–Wed pay week, reg/OT/per diem
// per day. "Posted" isn't tracked by the app (a payroll-side stamp) — left blank for
// hand-fill, same convention as the untracked sections on the daily time sheet PDF.
function fmtShortDate(ymd) {
  const d = new Date(ymd + 'T12:00:00')
  const mon = d.toLocaleDateString('en-US', { month: 'short' })
  return `${String(d.getDate()).padStart(2, '0')}-${mon}`
}
function fmtHeaderDate(ymd) {
  const d = new Date(ymd + 'T12:00:00')
  const mon = d.toLocaleDateString('en-US', { month: 'short' })
  const yy = String(d.getFullYear()).slice(-2)
  return `${d.getDate()}-${mon}-${yy}`
}
function dayName(ymd) {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
}
function isWeekend(ymd) {
  const dow = new Date(ymd + 'T12:00:00').getDay()
  return dow === 0 || dow === 6
}
const fmtHrs = (n) => (n ? Number(n).toFixed(1) : '')

// days: array of 7 { date: 'YYYY-MM-DD', regHours, otHours, perDiems }, Thursday first
export function generateWeeklyCompilationPDF({ employeeName, days }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 50
  const contentW = pageW - margin * 2
  let y = margin

  // ── Header ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('CORES', margin, y)
  doc.setFontSize(7)
  doc.text('WORLDWIDE', margin, y + 11)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
  doc.text('WEEKLY COMPILATION', pageW / 2 + 20, y, { align: 'center' })
  doc.text('DAILY WORK HOURS', pageW / 2 + 20, y + 22, { align: 'center' })

  y += 55

  // ── Name / From-To ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('NAME:', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.text(employeeName || '', margin + 55, y)
  doc.line(margin + 50, y + 3, margin + 280, y + 3)

  const ftX = margin + 330
  doc.setFont('helvetica', 'bold')
  doc.text('From', ftX, y - 10)
  doc.text('To', ftX, y + 8)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtHeaderDate(days[0].date), ftX + 45, y - 10)
  doc.text(fmtHeaderDate(days[6].date), ftX + 45, y + 8)
  doc.line(ftX + 40, y - 7, pageW - margin, y - 7)
  doc.line(ftX + 40, y + 11, pageW - margin, y + 11)

  y += 30

  // ── Table ──
  const colW = {
    day: contentW * 0.24,
    date: contentW * 0.14,
    reg: contentW * 0.15,
    ot: contentW * 0.15,
    pd: contentW * 0.15,
    posted: contentW * 0.17,
  }
  const colX = {}
  let cx = margin
  Object.entries(colW).forEach(([k, w]) => { colX[k] = cx; cx += w })
  const tableRight = margin + contentW

  const headH = 34
  const rowH = 20
  const blankRowH = 14

  const headerTop = y
  doc.setLineWidth(1.2)
  doc.rect(margin, headerTop, contentW, headH)
  doc.setLineWidth(0.75)
  Object.values(colX).slice(1).forEach(x => doc.line(x, headerTop, x, headerTop + headH))

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('DAY', colX.day + 6, headerTop + headH / 2 + 3)
  doc.text('DATE', colX.date + 6, headerTop + headH / 2 + 3)
  doc.text('REG', colX.reg + 6, headerTop + 13); doc.text('HOURS', colX.reg + 6, headerTop + 25)
  doc.text('O/T', colX.ot + 6, headerTop + 13); doc.text('HOURS', colX.ot + 6, headerTop + 25)
  doc.text('PER', colX.pd + 6, headerTop + 13); doc.text('DIEMS', colX.pd + 6, headerTop + 25)
  doc.text('POSTED', colX.posted + 6, headerTop + headH / 2 + 3)

  y = headerTop + headH

  let totalReg = 0, totalOT = 0, totalPD = 0

  days.forEach(day => {
    const rowTop = y
    const weekend = isWeekend(day.date)
    totalReg += Number(day.regHours || 0)
    totalOT += Number(day.otHours || 0)
    totalPD += Number(day.perDiems || 0)

    // O/T cell gets a light shade on weekends, matching the printed form's highlight
    // that Sat/Sun hours land in OT, not Reg
    if (weekend) {
      doc.setFillColor(225, 225, 225)
      doc.rect(colX.ot, rowTop, colW.ot, rowH + blankRowH, 'F')
    }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
    doc.text(dayName(day.date), colX.day + 6, rowTop + 14)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.text(fmtShortDate(day.date), colX.date + 6, rowTop + 14)

    if (weekend) {
      // Weekends never carry regular hours — cross out the Reg Hours cell, same as
      // the blank paper form, regardless of whether OT was actually worked that day.
      doc.setLineWidth(0.75)
      doc.line(colX.reg + 4, rowTop + 3, colX.reg + colW.reg - 4, rowTop + rowH - 3)
      doc.line(colX.reg + colW.reg - 4, rowTop + 3, colX.reg + 4, rowTop + rowH - 3)
    } else {
      doc.text(fmtHrs(day.regHours), colX.reg + 6, rowTop + 14)
    }
    doc.text(fmtHrs(day.otHours), colX.ot + 6, rowTop + 14)
    doc.text(day.perDiems ? String(day.perDiems) : '', colX.pd + 6, rowTop + 14)

    y += rowH + blankRowH

    doc.setLineWidth(0.75)
    doc.line(margin, y, tableRight, y)
  })

  const totalRowTop = y
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('TOTAL', colX.day + 6, totalRowTop + rowH - 6)
  doc.text(fmtHrs(totalReg), colX.reg + 6, totalRowTop + rowH - 6)
  doc.text(fmtHrs(totalOT), colX.ot + 6, totalRowTop + rowH - 6)
  doc.text(totalPD ? String(totalPD) : '', colX.pd + 6, totalRowTop + rowH - 6)
  y += rowH

  // ── Outer borders + column lines for the whole table ──
  doc.setLineWidth(1.2)
  doc.rect(margin, headerTop, contentW, y - headerTop)
  doc.setLineWidth(0.75)
  Object.values(colX).slice(1).forEach(x => doc.line(x, headerTop, x, y))

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text('Document# CW-OAD-F002 rev.0', margin, doc.internal.pageSize.getHeight() - 30)

  const weekLabel = `${fmtHeaderDate(days[0].date)}_to_${fmtHeaderDate(days[6].date)}`
  const filename = `${(employeeName || 'weekly').replace(/\s+/g, '_')}_${weekLabel}.pdf`
  doc.save(filename)
}
