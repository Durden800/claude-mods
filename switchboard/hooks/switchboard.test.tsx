import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'switchboard',
  component: 'Pane',
  requestId: 'switchboard',
  props: { title: 'Switchboard', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const engine = (on: any) => {
  const files = new Map<string, string>()
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_: unknown, e: any) => {
    return files.has(e.path) ? { value: files.get(e.path) } : { deny: 'ENOENT' }
  })
  on('fs.write', (_: unknown, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('fs.list', () => ({ value: [{ name: 'input-router', kind: 'dir' }, { name: 'switchboard', kind: 'dir' }] }))
  on('fs.exists', () => ({ value: true }))
  on('settings.read', () => ({ value: {} }))
  on('plugin.register', () => ({ allow: true }))
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  return files
}

test('the panel lists mods and a switch turns one off and back on', async ($, on) => {
  const files = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: 'input-router' }))?.text).toBe('input-router')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 't-input-router' })
  expect(JSON.parse(files.get('/home/t/.claude/switchboard.json')!).off).toEqual(['input-router'])
  await ui.press({ key: 't-input-router' })
  expect(JSON.parse(files.get('/home/t/.claude/switchboard.json')!).off).toEqual([])
  await ui.unmount()
})
