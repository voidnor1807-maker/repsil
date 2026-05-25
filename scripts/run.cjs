// Tiny launcher: deletes ELECTRON_RUN_AS_NODE from this process's env
// (cross-env can only SET to empty string, which Electron still treats as
// "run as Node"), then exec's the given command with the remaining args.
delete process.env.ELECTRON_RUN_AS_NODE

const { spawn } = require('node:child_process')

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error('scripts/run.cjs: missing command to run')
  process.exit(1)
}

const child = spawn(cmd, args, { stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('scripts/run.cjs: failed to spawn', cmd, err)
  process.exit(1)
})
