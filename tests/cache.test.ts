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
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const WARM_IDLE = 18 * 60_000 // 18 minutes: warm, cold in 42m
const COLD_IDLE = (3 * 24 + 9) * 3_600_000 // 3d 9h: cold

type Engine = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

/**
 * The engine around the band, with one main-thread turn that finished `idle` ms before NOW.
 * The cache is seeded the way a live session seeds it: the turn's end stamps the request time,
 * and the engine's own figures bring the context size and the model.
 */
async function finishedTurn($: Engine, on: On, { idle, rateLimits = WINDOWS }: { idle: number; rateLimits?: unknown[] }) {
  mock.store(on)
  let now = NOW - idle
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 770000 }, rateLimits } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.complete({ answer: 'done', durationMs: 1000 })
  now = NOW
}

test('a warm cache shows Robo, the WARM chip and the minutes left, folded', async ($, on) => {
  await finishedTurn($, on, { idle: WARM_IDLE })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // Drawings keep no key in the kit, so they are found by what they say.
  const alts = (await band.findAll({ type: 'Svg' })).map(s => s.props.alt)
  expect(alts).toEqual(['Robo, bobbing', 'WARM'])
  expect(await band.find({ text: ' 42m left' })).toBeDefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Show')

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeDefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Hide')
  await band.unmount()
})

test('a cold cache starts folded with the re-cache price, and Show opens the card', async ($, on) => {
  await finishedTurn($, on, { idle: COLD_IDLE })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect(await band.find({ text: ' 3d 9h' })).toBeDefined()
  // Opus 5.5: 770k tokens at the 1-hour write price, 2 x $4 per million.
  expect(await band.find({ text: '$6.16' })).toBeDefined()

  await band.press({ key: 'cache-fold' })
  const card = await band.find({ key: 'card' })
  expect(card).toBeDefined()
  expect(JSON.stringify(card)).toContain('Cache cold. Idle 3d 9h. Next message re-caches 770k tokens.')
  // The page's width: 80 columns is a 1020 px band.
  expect(JSON.stringify(card)).toContain('width=\\"1020\\"')
  await band.unmount()
})

test('a warm cache on the wide row shows the next-message price beside the minutes left', async ($, on) => {
  await finishedTurn($, on, { idle: WARM_IDLE })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: '42m left' })).toBeDefined()
  expect(await band.find({ text: '$0.15' })).toBeDefined()
  await band.unmount()
})

test('with no usage windows the band is the cache alone, with no USAGE label or waiting text', async ($, on) => {
  await finishedTurn($, on, { idle: WARM_IDLE, rateLimits: [] })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: '42m left' })).toBeDefined()
  expect(await band.find({ text: 'USAGE' })).toBeUndefined()
  expect(await band.find({ text: 'waiting for the first reply' })).toBeUndefined()
  await band.unmount()
})

test('squeezed, the folded cache stacks as a third block, then takes its own row', async ($, on) => {
  await finishedTurn($, on, { idle: WARM_IDLE })

  const half = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 53 } })
  expect(await half.find({ key: 'block' })).toBeDefined()
  expect(await half.find({ text: '42m left' })).toBeDefined()
  expect(await half.find({ text: '$0.15' })).toBeDefined()
  await half.unmount()

  const narrow = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 33 } })
  expect(await narrow.find({ key: 'cache' })).toBeDefined()
  await narrow.press({ key: 'cache-fold' })
  // Narrow's card is the compact one: 38 columns is a 456 px band.
  expect(JSON.stringify(await narrow.find({ key: 'card' }))).toContain('width=\\"456\\"')
  await narrow.unmount()
})

test('the terminal draws the cache as text, with no drawings and no fold button', async ($, on) => {
  await finishedTurn($, on, { idle: COLD_IDLE })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' COLD ' })).toBeDefined()
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ key: 'cache-fold' })).toBeUndefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  await band.unmount()
})

test('a cleared session drops the cache until the next reply', async ($, on) => {
  await finishedTurn($, on, { idle: COLD_IDLE })
  await $.session.end({ reason: 'clear', sessionId: 'one', resume: { id: 'one' } })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ text: ' 99% left' })).toBeDefined()
  await band.unmount()
})

test('a session resumed away from drops the cache until the next reply', async ($, on) => {
  await finishedTurn($, on, { idle: WARM_IDLE })
  await $.session.end({ reason: 'resume', sessionId: 'one', resume: { id: 'one' } })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ text: ' 99% left' })).toBeDefined()
  await band.unmount()
})

test('a session that ends any other way keeps its cache', async ($, on) => {
  await finishedTurn($, on, { idle: WARM_IDLE })
  await $.session.end({ reason: 'other', sessionId: 'one', resume: { id: 'one' } })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' 42m left' })).toBeDefined()
  await band.unmount()
})
