import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir  = path.dirname(fileURLToPath(import.meta.url))
const log  = path.join(dir, '..', '.timelog')
const cmd  = process.argv[2]
const now  = new Date()
const iso  = now.toISOString()
const nice = now.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })

if (cmd === 'in') {
  fs.appendFileSync(log, `IN  ${iso}\n`)
  console.log(`⏱  Clocked in at ${nice}`)

} else if (cmd === 'out') {
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []

  // Find the last unmatched IN
  let lastIn = null
  for (const line of lines) {
    if (line.startsWith('IN  ')) lastIn = new Date(line.slice(4).trim())
    if (line.startsWith('OUT ')) lastIn = null
  }

  if (!lastIn) {
    console.log('No open clock-in found. Run npm run clock-in first.')
    process.exit(1)
  }

  const elapsed = now - lastIn
  const hrs  = Math.floor(elapsed / 3600000)
  const mins = Math.round((elapsed % 3600000) / 60000)
  const hrsLabel = hrs > 0 ? `${hrs}h ` : ''

  fs.appendFileSync(log, `OUT ${iso}\n`)
  console.log(`⏹  Clocked out at ${nice}`)
  console.log(`⏳  Session: ${hrsLabel}${mins}m`)

} else {
  console.log('Usage: npm run clock-in  |  npm run clock-out')
}
