// Launches Electron with a clean environment.
//
// Some host environments (VS Code's extension host, other Electron apps'
// integrated terminals) export ELECTRON_RUN_AS_NODE=1, which makes the Electron
// binary behave as a bare Node process — `require('electron')` then returns a
// path string instead of the app module and startup fails. We strip that (and a
// couple of related) vars before spawning.

const { spawn } = require('child_process')
const electronPath = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

if (!env.VITE_DEV_SERVER_URL && process.argv.includes('--dev')) {
  env.VITE_DEV_SERVER_URL = 'http://localhost:5173'
}

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env })
child.on('close', (code) => process.exit(code == null ? 0 : code))
child.on('error', (err) => {
  console.error('Failed to start Electron:', err)
  process.exit(1)
})
