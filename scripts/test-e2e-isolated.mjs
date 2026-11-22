import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sourceDb = path.resolve('data/catalog.db')
if (!existsSync(sourceDb)) {
  console.error(`Banco base não encontrado: ${sourceDb}`)
  process.exit(1)
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'savano-cine-e2e-'))
const tempDb = path.join(tempDir, 'catalog.db')
copyFileSync(sourceDb, tempDb)

const apiPort = process.env.E2E_API_PORT || '4184'
const webPort = process.env.E2E_WEB_PORT || '4183'

const apiProc = spawn(process.execPath, ['scripts/api-server.mjs'], {
  env: { ...process.env, PORT: apiPort, CINE_DB_PATH: tempDb },
  stdio: 'inherit',
  windowsHide: true,
})

const webProc = spawn('npx.cmd', ['vite', 'preview', '--host', '127.0.0.1', '--port', webPort], {
  env: { ...process.env, VITE_API_PORT: apiPort },
  stdio: 'inherit',
  shell: true,
  windowsHide: true,
})

async function waitForUrl(url, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Timeout aguardando ${url}`)
}

let exitCode = 1
try {
  await Promise.all([
    waitForUrl(`http://127.0.0.1:${apiPort}/api/health`),
    waitForUrl(`http://127.0.0.1:${webPort}/`),
  ])
  const res = spawnSync('npx.cmd', ['playwright', 'test'], {
    env: { ...process.env, PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}` },
    stdio: 'inherit',
    shell: true,
    windowsHide: true,
  })
  exitCode = res.status ?? 1
} finally {
  apiProc.kill('SIGTERM')
  webProc.kill('SIGTERM')
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors on Windows file lock
  }
}

process.exit(exitCode)
