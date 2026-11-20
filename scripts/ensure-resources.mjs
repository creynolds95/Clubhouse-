// CI helper: make sure the D1 database and R2 bucket exist, then write the D1 id into wrangler.jsonc.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const DB = 'clubhouse', BUCKET = 'clubhouse-media'
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const findDb = () => JSON.parse(sh('npx wrangler d1 list --json')).find((d) => d.name === DB)

let db = findDb()
if (!db) { console.log(`Creating D1 database ${DB}`); sh(`npx wrangler d1 create ${DB}`); db = findDb() }
if (!db) throw new Error('D1 database not found after create')

try { sh(`npx wrangler r2 bucket create ${BUCKET}`); console.log(`Created R2 bucket ${BUCKET}`) }
catch (e) {
  const out = String(e.stderr ?? '') + String(e.stdout ?? '')
  if (!/already exists|already own/i.test(out)) { console.error(out); throw new Error('R2 bucket create failed. Is R2 enabled on the account?') }
}

const cfg = readFileSync('wrangler.jsonc', 'utf8').replace(/"database_id":\s*"[^"]*"/, `"database_id": "${db.uuid}"`)
writeFileSync('wrangler.jsonc', cfg)
console.log(`D1 ${DB} = ${db.uuid}`)
