import { jsPDF } from 'jspdf'
import { fmtHours } from './format'
import { CAVEAT_REGULAR_BASE64 } from './caveatFont'

// Recreates the Cores Worldwide paper "Daily Time Sheet" form, filled in with
// whatever we have on file. Fields the app doesn't track (safety check answers,
// extras/non-compliance) are left blank for hand sign-off. employeeSignature/
// supervisorSignature are optional {name, subtitle} objects — when present,
// the name prints in a cursive font in place of the blank "Approved by:" line,
// sourced from real confirmation data (see AdminDashboard.printTimesheetFor).
export function generateDailyTimesheetPDF({ employeeName, workDate, timeIn, timeOut, lunchMinutes, totalHours, perDiem = 0, jobLines, supplyLines = [], employeeSignature = null, supervisorSignature = null }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  doc.addFileToVFS('Caveat-Regular.ttf', CAVEAT_REGULAR_BASE64)
  doc.addFont('Caveat-Regular.ttf', 'Caveat', 'normal')
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 40
  const contentW = pageW - margin * 2
  let y = margin

  // Starts a new page when the next block wouldn't fit in the remaining
  // vertical space, so long entries push content onto page 2+ instead of
  // running off the bottom of a single page.
  const ensureSpace = (neededH) => {
    if (y + neededH > pageH - margin) {
      doc.addPage()
      y = margin
    }
  }

  const fmtTime = t => {
    if (!t) return ''
    const [h, m] = t.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${String(m).padStart(2, '0')} ${period}`
  }
  const fmtDate = d => {
    if (!d) return ''
    const [yy, mm, dd] = d.split('-')
    return `${mm}/${dd}/${yy}`
  }

  // ── Header ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('Cores Worldwide Inc.', margin, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text('674 Hwy 214, Belnan, NS B2S 2N2 CANADA', margin, y + 11)
  doc.text('Tel: +1 (902) 883 1611   Fax: +1 (902) 883 9690   Email: info@coresworldwide.com', margin, y + 22)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text('Time Sheet', pageW - margin, y + 8, { align: 'right' })
  doc.setFont('helvetica', 'italic'); doc.setFontSize(10)
  doc.text('Daily', pageW - margin, y + 22, { align: 'right' })

  y += 40
  doc.setDrawColor(0); doc.setLineWidth(1)
  doc.line(margin, y, pageW - margin, y)
  y += 20

  // ── Employee / Date / Time In / Time Out / Lunch / Total Hrs ──
  const fieldRow = (label1, val1, label2, val2) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text(label1, margin, y)
    doc.setFont('helvetica', 'normal')
    doc.text(String(val1 ?? ''), margin + 75, y)
    doc.line(margin + 70, y + 3, margin + contentW / 2 - 10, y + 3)

    doc.setFont('helvetica', 'bold')
    doc.text(label2, margin + contentW / 2, y)
    doc.setFont('helvetica', 'normal')
    doc.text(String(val2 ?? ''), margin + contentW / 2 + 75, y)
    doc.line(margin + contentW / 2 + 70, y + 3, pageW - margin, y + 3)
    y += 22
  }

  fieldRow('Employee:', employeeName, 'Date:', fmtDate(workDate))
  fieldRow('Time In:', fmtTime(timeIn), 'Time Out:', fmtTime(timeOut))
  fieldRow('Lunch:', lunchMinutes != null ? `${lunchMinutes} min` : '', 'Total Hrs:', totalHours != null ? fmtHours(totalHours) : '')

  // Per diem is a count (×N), not dollars — same convention as the app
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Per Diem:', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.text(perDiem > 0 ? `×${Number(perDiem)}` : 'None', margin + 75, y)
  doc.line(margin + 70, y + 3, margin + contentW / 2 - 10, y + 3)
  y += 22

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Comments:', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.line(margin + 65, y + 3, pageW - margin, y + 3)
  y += 26

  // ── Daily Safety Check ──
  // Deliberately pre-checked "Yes" (Jim, 2026-07-09): techs flag safety issues
  // directly if there are any, so the default assumption on the printed form
  // is all-clear. Do not change to blank without asking.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Daily Safety Check:', margin, y)
  y += 16
  const safetyQuestions = [
    'Have I identified all hazards?',
    'Are the resources available (PPE, tools, etc)?',
    'Is everything the same since I last did my tasks (unaltered)?',
    'I am aware of Emergency devices, locations and I know what to do?',
    'My work area is safe, clean, and tidy?',
  ]
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const boxSize = 8
  const yesX = margin + contentW - 70, noX = margin + contentW - 25
  doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  doc.text('Yes', yesX, y - 4); doc.text('No', noX, y - 4)
  y += 12
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  safetyQuestions.forEach(q => {
    doc.text(q, margin, y)
    doc.rect(yesX - boxSize / 2, y - boxSize + 1, boxSize, boxSize)
    doc.rect(noX - boxSize / 2, y - boxSize + 1, boxSize, boxSize)
    doc.setFont('helvetica', 'bold')
    doc.text('X', yesX - boxSize / 2 + 1.5, y - 1)
    doc.setFont('helvetica', 'normal')
    y += 15
  })
  y += 10

  // ── Job # / Hrs / Description of Work table ──
  const col1W = 55, col2W = 45
  const col3X = margin + col1W + col2W

  const drawTableHeader = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text('Job #', margin + 4, y)
    doc.text('Hrs', margin + col1W + 4, y)
    doc.text('Description of Work', col3X + 4, y)
    y += 4
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5)
    doc.text('Record: Make, Model, and Serial # or equipment/engine you are working on', col3X + 4, y + 8)
    y += 14
  }
  drawTableHeader()

  // Rows grow with wrapped description text so long entries don't overlap
  // the next row
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const descMaxW = pageW - margin - col3X - 8
  const lineH = 11
  const minRowH = 16
  const rowData = jobLines.map(line => {
    const wrapped = doc.splitTextToSize(String(line.description || ''), descMaxW)
    return { ...line, wrapped }
  })
  while (rowData.length < 3) rowData.push({ jobNumber: '', hours: null, wrapped: [] })

  let tableTop = y
  let rowY = tableTop
  doc.setLineWidth(0.5)
  doc.line(margin, tableTop, pageW - margin, tableTop)

  const closeTableBorders = (top, bottom) => {
    doc.line(margin, top, margin, bottom)
    doc.line(margin + col1W, top, margin + col1W, bottom)
    doc.line(col3X, top, col3X, bottom)
    doc.line(pageW - margin, top, pageW - margin, bottom)
  }
  const startTablePage = () => {
    doc.addPage()
    y = margin
    drawTableHeader()
    tableTop = y
    rowY = tableTop
    doc.setLineWidth(0.5)
    doc.line(margin, tableTop, pageW - margin, tableTop)
  }

  // Each row is drawn in chunks of wrapped lines that fit in the space left
  // on the current page — a description long enough to fill (or exceed) a
  // whole page spills its remaining lines onto a fresh page instead of
  // running off the bottom of this one.
  rowData.forEach(r => {
    let remaining = r.wrapped.slice()
    let firstChunk = true
    let rowDone = false
    while (!rowDone) {
      const availH = pageH - margin - rowY
      const maxLines = Math.max(0, Math.floor((availH - 5) / lineH))
      let chunk = null
      let chunkH = 0

      if (remaining.length === 0) {
        if (availH >= minRowH) { chunk = []; chunkH = minRowH; rowDone = true }
      } else if (remaining.length * lineH + 5 <= availH) {
        chunk = remaining; chunkH = remaining.length * lineH + 5; remaining = []; rowDone = true
      } else if (maxLines >= 1 && availH >= minRowH) {
        chunk = remaining.slice(0, maxLines)
        remaining = remaining.slice(maxLines)
        chunkH = chunk.length * lineH + 5
      }

      if (chunk === null) {
        closeTableBorders(tableTop, rowY)
        startTablePage()
        continue
      }

      if (firstChunk) {
        doc.text(String(r.jobNumber || ''), margin + 4, rowY + 11)
        doc.text(r.hours != null && r.hours !== '' ? fmtHours(r.hours) : '', margin + col1W + 4, rowY + 11)
      }
      chunk.forEach((ln, i) => doc.text(ln, col3X + 4, rowY + 11 + i * lineH))
      rowY += chunkH
      doc.line(margin, rowY, pageW - margin, rowY)
      firstChunk = false
    }
  })
  const tableBottom = rowY
  closeTableBorders(tableTop, tableBottom)

  y = tableBottom + 20

  // ── Extra's / Shop Supplies / Non Compliance Log (blank sections) ──
  const blankSection = (label) => {
    ensureSpace(30)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text('Job #', margin + 4, y + 12)
    doc.text(label, margin + col1W + col2W + 4, y + 12)
    doc.rect(margin, y, col1W, 24)
    doc.rect(margin + col1W, y, col2W, 24)
    doc.rect(margin + col1W + col2W, y, contentW - col1W - col2W, 24)
    y += 30
  }
  blankSection("Extra's")

  // ── Shop Supplies (filled from job_supplies) ──
  // Customers may see this PDF, and supplies used are billed to them, so the
  // description Tracy attaches to a supply line has to actually be on it —
  // otherwise a billed item can show up on the invoice with nothing backing
  // it up on the timesheet the customer's holding. Name and description are
  // combined into one wrapped cell (row height grows with wrapped line
  // count) rather than a fixed one-line row, so a real description doesn't
  // get clipped or overlap the row below it.
  const supDescMaxW = pageW - margin - (margin + col1W + col2W) - 8
  const supLineH = 11
  const supMinRowH = 16
  const supRowData = (supplyLines.length > 0 ? supplyLines : [{ jobNumber: '', quantity: null, supplyName: '', description: '' }])
    .map(s => {
      const label = s.description ? `${s.supplyName || ''} — ${s.description}` : String(s.supplyName || '')
      return { ...s, wrapped: doc.splitTextToSize(label, supDescMaxW) }
    })
  const supRowHeights = supRowData.map(r => Math.max(supMinRowH, r.wrapped.length * supLineH + 5))
  const supTotalH = supRowHeights.reduce((a, b) => a + b, 0)
  ensureSpace(16 + supTotalH)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('Job #', margin + 4, y + 12)
  doc.text('Qty', margin + col1W + 4, y + 12)
  doc.text('Shop Supplies', margin + col1W + col2W + 4, y + 12)
  y += 16
  const supTop = y
  let supRowY = supTop
  supRowData.forEach((s, i) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text(String(s.jobNumber || ''), margin + 4, supRowY + 11)
    doc.text(s.quantity != null ? String(Number(s.quantity)) : '', margin + col1W + 4, supRowY + 11)
    s.wrapped.forEach((ln, li) => doc.text(ln, margin + col1W + col2W + 4, supRowY + 11 + li * supLineH))
    supRowY += supRowHeights[i]
  })
  const supBottom = supRowY
  doc.setLineWidth(0.5)
  let supLineY = supTop
  doc.line(margin, supLineY, pageW - margin, supLineY)
  supRowHeights.forEach(h => { supLineY += h; doc.line(margin, supLineY, pageW - margin, supLineY) })
  doc.line(margin, supTop, margin, supBottom)
  doc.line(margin + col1W, supTop, margin + col1W, supBottom)
  doc.line(margin + col1W + col2W, supTop, margin + col1W + col2W, supBottom)
  doc.line(pageW - margin, supTop, pageW - margin, supBottom)
  y = supBottom + 10

  blankSection('Non Compliance Log')
  y += 15

  // ── Signatures ──
  // A blank line means "not yet electronically confirmed" — hand sign-off
  // still applies. A cursive name means the row below (subtitle) states
  // exactly what confirmed it and when, so this never reads as more certain
  // than the data backing it.
  const drawSignatureRow = (label, sig) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text(label, margin, y)
    if (sig) {
      doc.setFont('Caveat', 'normal'); doc.setFontSize(16)
      doc.text(sig.name, margin + 115, y + 3)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
      doc.text(sig.subtitle, margin + 115, y + 13, { maxWidth: 180 })
    } else {
      doc.line(margin + 110, y + 3, margin + 280, y + 3)
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text('Date:', margin + 300, y)
    doc.line(margin + 330, y + 3, pageW - margin, y + 3)
    y += 26
  }

  ensureSpace(100)
  drawSignatureRow('Employee Signature:', employeeSignature)
  drawSignatureRow('Approved by:', supervisorSignature)

  const filename = `${(employeeName || 'timesheet').replace(/\s+/g, '_')}_${workDate}.pdf`
  doc.save(filename)
}
