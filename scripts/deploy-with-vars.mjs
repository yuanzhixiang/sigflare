import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

function parseEnvFile(envFilePath) {
  const content = readFileSync(envFilePath, 'utf8')
  const entries = []

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }

    let value = line.slice(separatorIndex + 1).trim()
    const hasDoubleQuotes = value.startsWith('"') && value.endsWith('"')
    const hasSingleQuotes = value.startsWith("'") && value.endsWith("'")
    if ((hasDoubleQuotes || hasSingleQuotes) && value.length >= 2) {
      value = value.slice(1, -1)
    }

    entries.push([key, value])
  }

  return entries
}

const [, , envFilePath = '.env.main', ...extraArgs] = process.argv
const envEntries = parseEnvFile(envFilePath)

if (envEntries.length === 0) {
  console.error(`[deploy-with-vars] no env vars found in ${envFilePath}`)
  process.exit(1)
}

const wranglerArgs = ['dlx', 'wrangler', 'deploy']

for (const [key, value] of envEntries) {
  wranglerArgs.push('--var', `${key}:${value}`)
}

if (extraArgs.length > 0) {
  wranglerArgs.push(...extraArgs)
}

const result = spawnSync('pnpm', wranglerArgs, {
  stdio: 'inherit',
})

if (typeof result.status === 'number') {
  process.exit(result.status)
}

console.error('[deploy-with-vars] wrangler deploy failed to start')
process.exit(1)
