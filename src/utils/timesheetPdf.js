import { jsPDF } from 'jspdf'

// Recreates the Cores Worldwide paper "Daily Time Sheet" form, filled in with
// whatever we have on file. Fields the app doesn't track (safety check answers,
// signatures, extras/non-compliance) are left blank for hand sign-off.
export function generateDailyTimesheetPDF({ employeeName, workDate, timeIn, timeOut, lunchMinutes, totalHours, jobLines, supplyLines = [] }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 40
  const contentW = pageW - margin * 2
  let y = margin

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
  fieldRow('Lunch:', lunchMinutes != null ? `${lunchMinutes} min` : '', 'Total Hrs:', totalHours != null ? totalHours.toFixed(1) : '')

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
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('Job #', margin + 4, y)
  doc.text('Hrs', margin + col1W + 4, y)
  doc.text('Description of Work', col3X + 4, y)
  y += 4
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5)
  doc.text('Record: Make, Model, and Serial # or equipment/engine you are working on', col3X + 4, y + 8)
  y += 14

  // Rows grow with wrapped description text so long entries don't overlap
  // the next row
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const descMaxW = pageW - margin - col3X - 8
  const lineH = 11
  const minRowH = 16
  const rowData = jobLines.map(line => {
    const wrapped = doc.splitTextToSize(String(line.description || ''), descMaxW)
    return { ...line, wrapped, h: Math.max(minRowH, wrapped.length * lineH + 5) }
  })
  while (rowData.length < 3) rowData.push({ jobNumber: '', hours: null, wrapped: [], h: minRowH })

  const tableTop = y
  let rowY = tableTop
  doc.setLineWidth(0.5)
  doc.line(margin, tableTop, pageW - margin, tableTop)
  rowData.forEach(r => {
    doc.text(String(r.jobNumber || ''), margin + 4, rowY + 11)
    doc.text(r.hours != null && r.hours !== '' ? Number(r.hours).toFixed(1) : '', margin + col1W + 4, rowY + 11)
    r.wrapped.forEach((ln, i) => doc.text(ln, col3X + 4, rowY + 11 + i * lineH))
    rowY += r.h
    doc.line(margin, rowY, pageW - margin, rowY)
  })
  const tableBottom = rowY
  doc.line(margin, tableTop, margin, tableBottom)
  doc.line(margin + col1W, tableTop, margin + col1W, tableBottom)
  doc.line(col3X, tableTop, col3X, tableBottom)
  doc.line(pageW - margin, tableTop, pageW - margin, tableBottom)

  y = tableBottom + 20

  // ── Extra's / Shop Supplies / Non Compliance Log (blank sections) ──
  const blankSection = (label) => {
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
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('Job #', margin + 4, y + 12)
  doc.text('Qty', margin + col1W + 4, y + 12)
  doc.text('Shop Supplies', margin + col1W + col2W + 4, y + 12)
  y += 16
  const supTop = y
  const supRowH = 16
  const supRowCount = Math.max(supplyLines.length, 1)
  const supBottom = supTop + supRowH * supRowCount
  supplyLines.forEach((s, i) => {
    const rowY = supTop + i * supRowH
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text(String(s.jobNumber || ''), margin + 4, rowY + supRowH - 5)
    doc.text(s.quantity != null ? String(Number(s.quantity)) : '', margin + col1W + 4, rowY + supRowH - 5)
    doc.text(String(s.supplyName || ''), margin + col1W + col2W + 4, rowY + supRowH - 5, { maxWidth: pageW - margin - (margin + col1W + col2W) - 8 })
  })
  doc.setLineWidth(0.5)
  for (let i = 0; i <= supRowCount; i++) {
    doc.line(margin, supTop + i * supRowH, pageW - margin, supTop + i * supRowH)
  }
  doc.line(margin, supTop, margin, supBottom)
  doc.line(margin + col1W, supTop, margin + col1W, supBottom)
  doc.line(margin + col1W + col2W, supTop, margin + col1W + col2W, supBottom)
  doc.line(pageW - margin, supTop, pageW - margin, supBottom)
  y = supBottom + 10

  blankSection('Non Compliance Log')
  y += 15

  // ── Signatures ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Employee Signature:', margin, y)
  doc.line(margin + 110, y + 3, margin + 280, y + 3)
  doc.text('Date:', margin + 300, y)
  doc.line(margin + 330, y + 3, pageW - margin, y + 3)
  y += 22

  doc.text('Supervisor Signature:', margin, y)
  doc.line(margin + 110, y + 3, margin + 280, y + 3)
  doc.text('Date:', margin + 300, y)
  doc.line(margin + 330, y + 3, pageW - margin, y + 3)
  y += 22

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text('*Company/Supervisor Name (Print) :', margin, y)
  y += 18

  doc.setFontSize(7)
  doc.text('All time sheets must be submitted to the office and must have a supervisor’s signature.', margin, y)
  y += 9
  doc.text('*If Cores supervisor is not available the time sheets must have the Customer’s supervisor signature.', margin, y)

  const filename = `${(employeeName || 'timesheet').replace(/\s+/g, '_')}_${workDate}.pdf`
  doc.save(filename)
}
