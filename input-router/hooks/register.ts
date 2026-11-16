import type { EngineInterface, Register } from 'claude-code'

// Results bigger than this (about 2,000 tokens) go to Haiku first.
const MIN_CHARS = 8000
// Haiku gets at most this much of a result in one pass (about 100k tokens).
const MAX_CHARS = 400_000
const SAVE_DIR = '/tmp/input-router'

// Read-type tools worth routing. Finance tools (QuickBooks) are left out on
// purpose: accuracy matters more than tokens there.
const ROUTED = new Set([
  'Read',
  'mcp__Gmail__get_thread',
  'mcp__Gmail__get_message',
  'mcp__Gmail__search_threads',
  'mcp__Google_Drive__read_file_content',
  'mcp__Google_Drive__download_file_content',
  'mcp__Google_Drive__search_files',
  'mcp__Google_Calendar__list_events',
  'mcp__Google_Calendar__search_events',
  'mcp__Microsoft_365__outlook_email_search',
  'mcp__Microsoft_365__read_resource',
  'mcp__Microsoft_365__sharepoint_search',
])

// Words in the request that mean "read it in full": the router steps aside.
const EXACT = /\b(exact|verbatim|word for word|every line|full text|in full|tax|taxes|contract|lease|legal)\b/i

type Stats = { calls: number; savedTokens: number; files: { name: string; before: number; after: number }[] }
const STATS_KEY = 'stats'
const ON_KEY = 'enabled'

const tokens = (s: string) => Math.round(s.length / 4)


// The Switchboard mod keeps its off-list here; this mod checks it on each call.
async function isSwitchedOff($: EngineInterface, name: string): Promise<boolean> {
  try {
    const raw = await $.fs.read(`${(await $.env.get('HOME')) ?? '/tmp'}/.claude/switchboard.json`)
    const parsed = JSON.parse(raw) as { off?: unknown }
    return Array.isArray(parsed.off) && parsed.off.includes(name)
  } catch {
    return false
  }
}

export const register: Register = on => {
  let lastPrompt = ''

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'router', description: 'Input Router: on, off, or status', argumentHint: 'on | off | status' })
    await $.command.register({ name: 'savings', description: 'Tokens the Input Router has saved' })
    return r
  })

  on('prompt.submit', ($, e, next) => {
    // Project threads wrap the person's words in a <message> tag beside system
    // notes; keep only the person's words so the notes' wording can't trip EXACT.
    const m = [...e.text.matchAll(/<message\b[^>]*>([\s\S]*?)<\/message>/g)].pop()
    const said = (m?.[1] ?? e.text).trim()
    if (said) lastPrompt = said
    return next(e)
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await $.store.set(ON_KEY, arg === 'on')
      return { text: `Input Router is ${arg}.` }
    }
    const isOn = (await $.store.get(ON_KEY)) !== false
    return { text: `Input Router is ${isOn ? 'on' : 'off'}. Use /router on or /router off.` }
  })

  on('command.run', { command: 'savings' }, async $ => {
    const stats = (await $.store.get(STATS_KEY)) as Stats | undefined
    if (!stats || stats.calls === 0) return { text: 'Input Router has not stepped in yet.' }
    const rows = stats.files.map(f => `- ${f.name}: ${f.before.toLocaleString()} -> ${f.after.toLocaleString()} tokens`)
    return {
      text: [`Input Router: ${stats.calls} results pre-read, ~${stats.savedTokens.toLocaleString()} tokens saved.`, ...rows].join('\n'),
    }
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!ROUTED.has(e.tool) || r.deny !== undefined || r.isError) return r

    const input = e as unknown as Record<string, unknown>
    // A targeted Read (offset/limit) or a re-read of a saved full result passes through.
    if (e.tool === 'Read' && (input.offset !== undefined || input.limit !== undefined)) return r
    if (typeof input.file_path === 'string' && input.file_path.startsWith(SAVE_DIR)) return r

    const text = r.text ?? ''
    if (text.length < MIN_CHARS) return r
    if ((await $.store.get(ON_KEY)) === false) return r
    if (await isSwitchedOff($, 'input-router')) return r
    if (EXACT.test(lastPrompt)) return r

    const fullPath = `${SAVE_DIR}/${e.tool_use_id}.txt`
    await $.fs.write(fullPath, text)

    const ask = [
      'You pre-read a tool result for another AI assistant so it does not have to read the whole thing.',
      `The user's request: ${lastPrompt.slice(0, 2000) || '(not known)'}`,
      `The tool called: ${e.tool} with ${JSON.stringify(input).slice(0, 600)}`,
      'Write compact notes with everything from the result that this request needs: names, dates, amounts, ids, links and short exact quotes where wording matters.',
      'Keep ids (message, thread, event, file ids) exactly, since the assistant may need them for follow-up calls.',
      'List briefly what else the result contains that you left out, so the assistant knows whether to open the full copy.',
      '',
      '<tool_result>',
      text.slice(0, MAX_CHARS),
      '</tool_result>',
    ].join('\n')

    const done = await $.model.complete({ model: 'haiku', prompt: ask, maxTokens: 2000, timeoutMs: 60_000 })
    if (!done.isAnswered) return r

    const notes = done.text
    const before = tokens(text)
    const after = tokens(notes)
    if (after >= before * 0.7) return r

    const stats = ((await $.store.get(STATS_KEY)) as Stats | undefined) ?? { calls: 0, savedTokens: 0, files: [] }
    const name = typeof input.file_path === 'string' ? input.file_path.split('/').pop()! : e.tool.replace(/^mcp__/, '')
    stats.calls += 1
    stats.savedTokens += before - after
    stats.files = [{ name, before, after }, ...stats.files].slice(0, 20)
    await $.store.set(STATS_KEY, stats)
    $.ui.status(`Input Router saved ~${(stats.savedTokens / 1000).toFixed(1)}k tokens`)

    return {
      deny:
        `Input Router: the result was ${before.toLocaleString()} tokens, so Haiku pre-read it. ` +
        `Its notes are below (${after.toLocaleString()} tokens). The full result is saved at ${fullPath}; ` +
        `Read it (with offset/limit for a part) if the notes miss something.` +
        (truncatedNote(text)) +
        `\n\n${notes}`,
    }
  }).catch(($, e, next) => (next.called ? next(e) : next(e)))
}

const truncatedNote = (text: string) =>
  text.length > MAX_CHARS ? ` Haiku only saw the first ${MAX_CHARS.toLocaleString()} characters.` : ''
