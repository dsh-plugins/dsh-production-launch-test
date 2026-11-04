import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'

it('imports every runtime library using native Node TypeScript support', async () => {
  const directory = new URL('../scripts/lib/', import.meta.url)
  const modules = (await readdir(directory)).filter(name => name.endsWith('.mts'))
  assert.equal(modules.length, 13)
  for (const name of modules) await import(new URL(name, directory).href)
})

it('the action entrypoint retains missing-input failure behavior', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/main.mts', import.meta.url))], {
    encoding: 'utf8',
    env: { ...process.env, INPUT_DSH_VERSION: '' },
  })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /缺少必填输入 dsh-version/u)
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION/u)
})

it('action and matrix workflow invoke the migrated entrypoints', async () => {
  const action = await readFile(new URL('../action.yml', import.meta.url), 'utf8')
  const workflow = await readFile(new URL('../.github/workflows/all-plugins-all-versions.yml', import.meta.url), 'utf8')
  assert.match(action, /\/scripts\/main\.mts/u)
  assert.match(workflow, /node scripts\/resolve-matrix\.mts/u)
})
