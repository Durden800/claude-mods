import { expect, test } from 'claude-code/testing'

const send = { tool: 'mcp__Gmail__send_message', to: 'a@b.c', subject: 'Hi' } as never

// Stands for the engine: answers the OK prompt (AskUserQuestion) with `pick`,
// or fails it, and answers every other tool with a plain result.
const engine = (on: any, pick: string | null, seen: { asked: boolean }) => {
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      seen.asked = true
      if (pick === null) return { deny: 'dismissed' }
      const q = e.questions[0]
      return { result: { questions: e.questions, answers: { [q.question]: pick } } }
    }
    return { result: { ok: true } }
  })
}

test('a guarded call the user blocks is denied', async ($, on) => {
  const seen = { asked: false }
  engine(on, 'Block', seen)
  const r = await $.tool.call(send)
  expect(seen.asked).toBe(true)
  expect(r.deny).toContain('ask-first-guard')
})

test('a guarded call the user allows goes through', async ($, on) => {
  const seen = { asked: false }
  engine(on, 'Allow', seen)
  const r = await $.tool.call(send)
  expect(seen.asked).toBe(true)
  expect(r.deny).toBeUndefined()
})

test('when no one can be asked, the call is blocked', async ($, on) => {
  const seen = { asked: false }
  engine(on, null, seen)
  const r = await $.tool.call(send)
  expect(r.deny).toContain('ask-first-guard')
})

test('an unguarded call is untouched', async ($, on) => {
  const seen = { asked: false }
  engine(on, 'Block', seen)
  const r = await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  expect(r.deny).toBeUndefined()
  expect(seen.asked).toBe(false)
})
