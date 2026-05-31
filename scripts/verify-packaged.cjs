// Headless smoke test for the PACKAGED app. Run via the packaged Electron as a
// Node interpreter so native modules are exercised against Electron's real ABI:
//   ELECTRON_RUN_AS_NODE=1 release/win-unpacked/Repsil.exe scripts/verify-packaged.cjs
const path = require('node:path')
const fs = require('node:fs')

// Require via the app.asar VIRTUAL path (how the real app loads): Electron's
// asar layer resolves deps like `bindings` inside the asar and transparently
// pulls the native .node from app.asar.unpacked.
const unpacked = path.join(
  __dirname,
  '..',
  'release',
  'win-unpacked',
  'resources',
  'app.asar',
  'node_modules'
)

function ok(msg) { console.log('  OK  ' + msg) }
function fail(msg, err) { console.log('FAIL  ' + msg + (err ? ' :: ' + err.message : '')); process.exitCode = 1 }

console.log('node/electron version:', process.versions.electron ? 'electron ' + process.versions.electron : 'node ' + process.version)

// 1. better-sqlite3 loads against this ABI
try {
  const Database = require(path.join(unpacked, 'better-sqlite3'))
  const db = new Database(':memory:')
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
  db.prepare('INSERT INTO t(v) VALUES (?)').run('hello')
  const row = db.prepare('SELECT v FROM t WHERE id = 1').get()
  if (row && row.v === 'hello') ok('better-sqlite3 load + CRUD') ; else fail('better-sqlite3 round-trip mismatch')
  // 2. FTS5 — the app's search depends on it
  db.exec("CREATE VIRTUAL TABLE fts USING fts5(body)")
  db.prepare('INSERT INTO fts(body) VALUES (?)').run('the quick brown fox')
  const hit = db.prepare("SELECT body FROM fts WHERE fts MATCH 'brown'").get()
  if (hit) ok('FTS5 virtual table + MATCH') ; else fail('FTS5 query returned nothing')
  db.close()
} catch (e) { fail('better-sqlite3 / FTS5', e) }

// 3. @napi-rs/canvas (N-API, used in extraction) loads
try {
  const canvas = require(path.join(unpacked, '@napi-rs', 'canvas'))
  const c = canvas.createCanvas(10, 10)
  if (c && typeof c.getContext === 'function') ok('@napi-rs/canvas load') ; else fail('@napi-rs/canvas unexpected shape')
} catch (e) { fail('@napi-rs/canvas', e) }

// 4. tessdata shipped alongside the app
try {
  const tess = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'tessdata')
  const eng = fs.existsSync(path.join(tess, 'eng.traineddata'))
  const ara = fs.existsSync(path.join(tess, 'ara.traineddata'))
  if (eng && ara) ok('tessdata eng + ara present') ; else fail('tessdata missing (eng=' + eng + ' ara=' + ara + ')')
} catch (e) { fail('tessdata check', e) }

console.log(process.exitCode ? '\nRESULT: FAILURES ABOVE' : '\nRESULT: ALL PASSED')
