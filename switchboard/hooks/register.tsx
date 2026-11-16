import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModRow } from '../types'

const PANE = 'switchboard'
const SELF = 'switchboard'
// Mods that read the shared off-list themselves, so their switch works at once.
const LIVE = new Set(['input-router', 'ask-first-guard'])

const mods = atom({ plugin: 'switchboard', key: 'mods' } as const, [] as ModRow[], { shape: 'mods-1' })
const off = atom({ plugin: 'switchboard', key: 'off' } as const, [] as string[], { shape: 'off-1' })

// The off-list lives in a file so the other mods (and later sessions) can read it.
const listPath = async ($: EngineInterface) =>
  `${(await $.env.get('HOME')) ?? '/tmp'}/.claude/switchboard.json`

const loadOff = async ($: EngineInterface) => {
  try {
    const raw = await $.fs.read(await listPath($))
    const parsed = JSON.parse(raw) as { off?: unknown }
    return Array.isArray(parsed.off) ? parsed.off.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const status = async ($: EngineInterface) => {
  const list = await read($, mods)
  const offList = await read($, off)
  const isOff = (n: string) => offList.includes(n)
  const count = list.filter(m => m.name !== SELF).length
  const offCount = list.filter(m => m.name !== SELF && isOff(m.name)).length
  $.ui.status(count ? `Mods: ${count - offCount} on${offCount ? `, ${offCount} off` : ''}` : undefined)
}

const remember = async ($: EngineInterface, row: ModRow) =>
  update($, mods, list => (list.some(m => m.name === row.name) ? list : [...list, row].sort((a, b) => a.name.localeCompare(b.name))))


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'mods', description: 'Switchboard: see every mod and turn each on or off' })
    await update($, off, () => [])
    const saved = await loadOff($)
    await update($, off, () => saved)
    await remember($, { name: SELF, source: 'this mod' })
    // Mods loaded before the switchboard: the dev mods folder beside it.
    try {
      const parent = $.plugin.root.split('/').slice(0, -1).join('/')
      for (const entry of await $.fs.list(parent)) {
        if (entry.kind === 'dir' && (await $.fs.exists(`${parent}/${entry.name}/.claude-plugin/plugin.json`))) {
          await remember($, { name: entry.name, source: 'built in Claude' })
        }
      }
    } catch {}
    // Installed plugins, from settings.
    try {
      const enabled = (await $.settings.read({ key: 'enabledPlugins' })) as Record<string, unknown> | undefined
      for (const id of Object.keys(enabled ?? {})) await remember($, { name: id.split('@')[0]!, source: id })
    } catch {}
    await status($)
    // Open the panel on start too, so surfaces where /mods can't be typed
    // (project threads in the app) still get it if they seat panes.
    void $.ui.open({ id: PANE, title: 'Switchboard' })
    return r
  })

  // Every mod that loads or reloads after the switchboard passes through here.
  on('plugin.register', async ($, e, next) => {
    await remember($, { name: e.name, source: e.provenance })
    const offList = await read($, off)
    if (e.name !== SELF && !LIVE.has(e.name) && offList.includes(e.name)) {
      return { refuse: 'switched off in the Switchboard' }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mods' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Switchboard' })
    return { text: 'Switchboard opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, mods)
    const offList = await read($, off)

    const toggle = async (name: string) => {
      const next = await update($, off, l => (l.includes(name) ? l.filter(n => n !== name) : [...l, name]))
      await $.fs.write(await listPath($), JSON.stringify({ off: next }, null, 2))
      await status($)
      const isNowOff = next.includes(name)
      $.ui.toast(
        LIVE.has(name)
          ? `${name} is ${isNowOff ? 'off' : 'on'}.`
          : `${name} will be ${isNowOff ? 'off' : 'on'} after /reload-plugins or a restart.`,
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {list.length === 0 && <Text dimColor>No mods found yet.</Text>}
        {list.map(m => {
          const isOff = offList.includes(m.name)
          return (
            <Box key={`row-${m.name}`} flexDirection="row" gap={1}>
              {m.name === SELF ? (
                <Text dimColor>always on</Text>
              ) : (
                <Button key={`t-${m.name}`} label={isOff ? 'Off' : 'On'} onPress={() => void toggle(m.name)} />
              )}
              <Text dimColor={isOff}>{m.name}</Text>
              <Text dimColor>{m.source}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
