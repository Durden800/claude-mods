import type { EngineInterface, Register } from 'claude-code'

// Ask-first rules: outward messages, calendar changes, deletes, sharing.
const GUARDED: Record<string, string> = {
  mcp__Gmail__send_message: 'send an email',
  mcp__Gmail__reply: 'send an email reply',
  mcp__Gmail__forward: 'forward an email',
  mcp__Gmail__trash_message: 'trash an email',
  mcp__Gmail__trash_thread: 'trash an email thread',
  mcp__Gmail__delete_label: 'delete a Gmail label',
  mcp__Google_Calendar__create_event: 'add a calendar event',
  mcp__Google_Calendar__update_event: 'change a calendar event',
  mcp__Google_Calendar__delete_event: 'delete a calendar event',
  mcp__Google_Calendar__respond_to_event: 'RSVP to an invite',
  mcp__Google_Drive__trash_file: 'trash a Drive file',
  mcp__Google_Drive__share_file: 'share a Drive file',
  mcp__Microsoft_365__outlook_send_mail: 'send an Outlook email',
  mcp__Microsoft_365__outlook_send_draft: 'send an Outlook draft',
}

const summarize = (input: Record<string, unknown>): string => {
  const pick = ['to', 'subject', 'summary', 'title', 'start', 'event_id', 'file_id']
  const parts = pick
    .filter(k => input[k] !== undefined)
    .map(k => `${k}: ${String(typeof input[k] === 'object' ? JSON.stringify(input[k]) : input[k]).slice(0, 60)}`)
  return parts.length ? ` (${parts.join(', ')})` : ''
}


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
  on('tool.call', async ($, e, next) => {
    const action = GUARDED[e.tool]
    if (!action) return next(e)
    if (await isSwitchedOff($, 'ask-first-guard')) return next(e)

    const detail = summarize(e as unknown as Record<string, unknown>)
    let answer: string
    try {
      answer = await $.ui.ask(`Claude wants to ${action}${detail}. Allow it?`, {
        options: ['Allow', 'Block'],
        header: 'Ask first',
      })
    } catch {
      // No one could be asked (dismissed, or a surface without the dialog).
      $.ui.log(`ask-first-guard: couldn't show the OK prompt for "${action}", so it was blocked.`)
      return { deny: `ask-first-guard: the OK prompt couldn't be shown, so "${action}" was blocked. Ask the user in chat.` }
    }

    if (answer !== 'Allow') {
      $.ui.toast(`Blocked: ${action}`)
      return { deny: `ask-first-guard: the user blocked "${action}".` }
    }
    $.ui.status(`Allowed: ${action}`)
    return next(e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'ask-first-guard: the guard failed, so this action was blocked.' },
  )
}
