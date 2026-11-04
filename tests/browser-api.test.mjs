import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { installBrowserApi } from '../scripts/lib/browser-api.mts'

async function withSendMessage({ buttonCount = 1, buttonError, composerError } = {}, verify) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-api-'))
  const calls = []
  const exposed = new Map()
  const composer = {
    last() { return this },
    async click() { if (composerError) throw composerError },
    async fill(text) { calls.push(['fill', text]) },
    async press(key) { calls.push(['press', key]) },
  }
  const button = {
    last() { return this },
    async count() { return buttonCount },
    async click(options) {
      calls.push(['click-send', options.timeout])
      if (buttonError) throw buttonError
    },
  }
  const page = {
    async exposeFunction(name, callback) { exposed.set(name, callback) },
    locator() { return composer },
    getByRole(role, { name }) {
      assert.equal(role, 'button')
      assert.ok(name.test('发送消息'))
      assert.ok(name.test('Send message'))
      assert.equal(name.test('停止'), false)
      return button
    },
    async evaluate(_callback, text) {
      calls.push(['rpc', text])
      return 'session-test'
    },
  }
  try {
    await installBrowserApi(page, { screenshotsDir: directory })
    await verify(exposed.get('sendMessage'), calls)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it('sendMessage clicks the named send button instead of racing Enter after fill', async () => {
  await withSendMessage({}, async (send, calls) => {
    assert.equal(await send('测试'), true)
    assert.deepEqual(calls, [['fill', '测试'], ['click-send', 10_000]])
  })
})

it('sendMessage retains Enter submission for older unnamed controls', async () => {
  await withSendMessage({ buttonCount: 0 }, async (send, calls) => {
    await send('legacy')
    assert.deepEqual(calls, [['fill', 'legacy'], ['press', 'Enter']])
  })
})

it('sendMessage retains RPC fallback when the UI composer is unavailable', async () => {
  await withSendMessage({ composerError: new Error('no composer') }, async (send, calls) => {
    await send('fallback')
    assert.deepEqual(calls, [['rpc', 'fallback']])
  })
})

it('sendMessage rejects non-string input before interacting with the page', async () => {
  await withSendMessage({}, async (send, calls) => {
    await assert.rejects(send(null), /需要字符串/u)
    assert.deepEqual(calls, [])
  })
})

async function withSelectModel({ pickerVisible = true, submenu = false, selectionError } = {}, verify) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-model-api-'))
  const calls = []
  const exposed = new Map()
  let selector
  const picker = {
    last() { return this },
    async waitFor() { if (!pickerVisible) throw new Error('legacy UI') },
    async click() { calls.push('open-picker') },
    locator(value) {
      assert.equal(value, '[data-provider-id="sim-openai-completions"][data-model-id="test-model"]')
      return { async waitFor() { calls.push('confirm-selection') } }
    },
  }
  const option = {
    async isVisible() { return !submenu },
    async click() {
      calls.push('select-option')
      if (selectionError) throw selectionError
    },
  }
  const modelMenu = {
    first() { return this },
    async count() { return submenu ? 1 : 0 },
    async click() { calls.push('open-model-submenu') },
  }
  const page = {
    async exposeFunction(name, callback) { exposed.set(name, callback) },
    getByRole(role) { return role === 'button' ? picker : modelMenu },
    locator(value) { selector = value; return option },
    async evaluate(_callback, selection) {
      calls.push(['legacy-rpc', selection])
      return { value: selection }
    },
  }
  try {
    await installBrowserApi(page, { screenshotsDir: directory })
    await verify(exposed.get('selectModel'), calls, () => selector)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it('selectModel targets the visible conversation and waits for its selected model', async () => {
  await withSelectModel({}, async (select, calls, selector) => {
    await select('sim-openai-completions/test-model')
    assert.deepEqual(calls, ['open-picker', 'select-option', 'confirm-selection'])
    assert.equal(selector(), '[role="menuitemradio"]:has([data-provider-id="sim-openai-completions"][data-model-id="test-model"])')
  })
})

it('selectModel opens the model submenu when a model was previously selected', async () => {
  await withSelectModel({ submenu: true }, async (select, calls) => {
    await select('sim-openai-completions/test-model')
    assert.deepEqual(calls, ['open-picker', 'open-model-submenu', 'select-option', 'confirm-selection'])
  })
})

it('selectModel retains RPC support only when the visible picker is absent', async () => {
  await withSelectModel({ pickerVisible: false }, async (select, calls) => {
    await select('sim-openai-completions/test-model')
    assert.deepEqual(calls, [['legacy-rpc', { provider: 'sim-openai-completions', model: 'test-model' }]])
  })
})

it('selectModel does not silently select another session when UI selection fails', async () => {
  await withSelectModel({ selectionError: new Error('model unavailable') }, async (select, calls) => {
    await assert.rejects(select('sim-openai-completions/test-model'), /model unavailable/u)
    assert.deepEqual(calls, ['open-picker', 'select-option'])
  })
})
