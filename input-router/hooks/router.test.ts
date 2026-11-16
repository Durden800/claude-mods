import { expect, test } from 'claude-code/testing'

const BIG = 'Meeting notes line about the cleaner schedule.\n'.repeat(400) // ~20k chars

const engine = (on: any, opts: { enabled?: boolean } = {}) => {
  const store = new Map<string, unknown>()
  if (opts.enabled === false) store.set('enabled', false)
  const seen = { modelCalls: 0, writes: [] as string[] }
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('fs.write', (_: unknown, e: any) => { seen.writes.push(e.path); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('model.complete', () => {
    seen.modelCalls++
    return { value: { isAnswered: true, text: 'NOTES: cleaner comes Fridays.', usage: { input_tokens: 5000, output_tokens: 20 } } }
  })
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('tool.call', (_: unknown, e: any) => ({ result: {}, text: e.file_path === '/small.txt' ? 'tiny' : BIG }))
  return seen
}

test('a big file read is replaced with Haiku notes', async ($, on) => {
  const seen = engine(on)
  await $.prompt.submit({ text: 'When does the cleaner come?' } as never).catch(() => {})
  const r = await $.tool.call({ tool: 'Read', file_path: '/notes.txt' } as never)
  expect(seen.modelCalls).toBe(1)
  expect(r.deny).toContain('NOTES: cleaner comes Fridays.')
  expect(r.deny).toContain('/tmp/input-router/')
  expect(seen.writes.filter(p => !p.includes('diag-')).length).toBe(1)
})

test('a small read passes through untouched', async ($, on) => {
  const seen = engine(on)
  const r = await $.tool.call({ tool: 'Read', file_path: '/small.txt' } as never)
  expect(seen.modelCalls).toBe(0)
  expect(r.deny).toBeUndefined()
})

test('a targeted read with offset passes through', async ($, on) => {
  const seen = engine(on)
  const r = await $.tool.call({ tool: 'Read', file_path: '/notes.txt', offset: 10, limit: 50 } as never)
  expect(seen.modelCalls).toBe(0)
  expect(r.deny).toBeUndefined()
})

test('switched off with /router off, it steps aside', async ($, on) => {
  const seen = engine(on, { enabled: false })
  const r = await $.tool.call({ tool: 'Read', file_path: '/notes.txt' } as never)
  expect(seen.modelCalls).toBe(0)
  expect(r.deny).toBeUndefined()
})

test('tools not on the list (QuickBooks) are never routed', async ($, on) => {
  const seen = engine(on)
  const r = await $.tool.call({ tool: 'mcp__Intuit_QuickBooks_Labs__reports_run' } as never)
  expect(seen.modelCalls).toBe(0)
  expect(r.deny).toBeUndefined()
})

test('system notes around a thread message do not switch it off', async ($, on) => {
  const seen = engine(on)
  await $.prompt.submit({ text: '<wake><message id="x">is it working?</message></wake><system-note>The message text above is complete and verbatim</system-note>' } as never).catch(() => {})
  const r = await $.tool.call({ tool: 'Read', file_path: '/notes.txt' } as never)
  expect(seen.modelCalls).toBe(1)
  expect(r.deny).toContain('NOTES')
})

test('the person asking for exact wording switches it off', async ($, on) => {
  const seen = engine(on)
  await $.prompt.submit({ text: '<message id="x">give me the exact wording</message>' } as never).catch(() => {})
  const r = await $.tool.call({ tool: 'Read', file_path: '/notes.txt' } as never)
  expect(seen.modelCalls).toBe(0)
  expect(r.deny).toBeUndefined()
})

test('switched off in the Switchboard, it steps aside', async ($, on) => {
  const seen = engine(on)
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', () => ({ value: JSON.stringify({ off: ['input-router'] }) }))
  const r = await $.tool.call({ tool: 'Read', file_path: '/notes.txt' } as never)
  expect(seen.modelCalls).toBe(0)
  expect(r.deny).toBeUndefined()
})
