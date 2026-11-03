import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const

test('the band shows what the session has cost so far, and follows it as it grows', async ($, on) => {
  mock.store(on)
  let now = NOW - 60_000
  let usd = 1.234
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000000, tokens: 770000 }, rateLimits: WINDOWS, cost: { usd } },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  now = NOW

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'ribbon', surface, component: 'AbovePrompt', props: PROPS })
    expect(await band.find({ text: '$1.23' })).toBeDefined()
    await band.unmount()
  }

  usd = 2.5
  await $.session.measure({
    context: { window: 1000000, tokens: 770000 },
    rateLimits: WINDOWS,
    cost: { usd },
    changed: ['cost'],
  })
  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: '$2.50' })).toBeDefined()
  expect(await band.find({ text: ' total' })).toBeDefined()
  await band.unmount()
})

test('a session that has cost nothing shows no total', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS, cost: { usd: 0 } },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ key: 'spent' })).toBeUndefined()
  await band.unmount()
})
