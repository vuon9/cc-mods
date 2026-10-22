import { expect, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120 },
} as const

test('the band forecasts each turn from the live context window', async ($, on) => {
  let tokens = 0
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens, window: 200_000 } },
  }))
  on('ui.render', () => ({ type: 'Box' }))

  const rows = [
    {
      id: 'clear',
      tokens: 36_100,
      forecast: '☀\u{FE0F} Clear',
      line: /18% · 36.1k \/ 200k/,
      delta: undefined,
    },
    {
      id: 'cloudy',
      tokens: 60_000,
      forecast: '☁\u{FE0F} Cloudy',
      line: /30% · 60k \/ 200k/,
      delta: '▲ +23.9k last turn',
    },
    {
      id: 'showers',
      tokens: 120_000,
      forecast: '☂\u{FE0F} Showers',
      line: /60%/,
      delta: '▲ +60k last turn',
    },
    { id: 'storm', tokens: 170_000, forecast: '☇ Storm', line: /85%/, delta: '▲ +50k last turn' },
    {
      id: 'compact',
      tokens: 190_000,
      forecast: '↯ Compact soon',
      line: /95% · 190k \/ 200k/,
      delta: '▲ +20k last turn',
    },
    {
      id: 'compacted',
      tokens: 30_000,
      forecast: '☀\u{FE0F} Clear',
      line: /15%/,
      delta: '▼ -160k last turn',
    },
  ]

  for (const [i, row] of rows.entries()) {
    tokens = row.tokens
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: `t${i}`,
      reason: 'completed',
    } as never)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-weather', surface, ...BAND })
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())
      expect([row.id, surface, texts[0]]).toEqual([row.id, surface, row.forecast])
      expect(texts[1]).toMatch(row.line)
      expect(texts[2]).toHaveLength(i + 1)
      expect([row.id, texts[3]]).toEqual([row.id, row.delta])
      await ui.unmount()
    }
  }
})

test('the chart keeps the last 12 turns', async ($, on) => {
  let tokens = 0
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens, window: 200_000 } },
  }))
  on('ui.render', () => ({ type: 'Box' }))

  for (let i = 1; i <= 15; i++) {
    tokens = i * 1000
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: `t${i}`,
      reason: 'completed',
    } as never)
  }

  const ui = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...BAND })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())
  expect(texts[2]).toBe('▃▃▄▄▅▅▆▆▇▇██')
})

const OPUS_HIGH = { model: 'claude-opus-5-5[1m]', effort: 'high' }

const MODEL_ROWS = [
  { id: 'model and effort', steps: [OPUS_HIGH], shown: ['│', 'Opus 5.5', '(high)'] },
  {
    id: 'the latest request wins after a /model switch',
    steps: [OPUS_HIGH, { model: 'claude-sonnet-5-5', effort: 'max' }],
    shown: ['│', 'Sonnet 5.5', '(max)'],
  },
  {
    id: "a subagent's request does not count",
    steps: [OPUS_HIGH, { model: 'claude-haiku-4-5', effort: 'low', agentId: 'a1' }],
    shown: ['│', 'Opus 5.5', '(high)'],
  },
  { id: 'no request yet', steps: [], shown: [] },
  {
    id: 'a model without effort',
    steps: [{ model: 'claude-fable-5-1' }],
    shown: ['│', 'Fable 5.1'],
  },
  {
    id: 'a dated id',
    steps: [{ model: 'claude-haiku-4-5-20251001', effort: 'low' }],
    shown: ['│', 'Haiku 4.5', '(low)'],
  },
  {
    id: 'a dated id with no minor version',
    steps: [{ model: 'claude-opus-4-20250514' }],
    shown: ['│', 'Opus 4'],
  },
  {
    id: 'a provider id',
    steps: [{ model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', effort: 'medium' }],
    shown: ['│', 'Sonnet 4.5', '(medium)'],
  },
  {
    id: 'an id it cannot read is shown as is',
    steps: [{ model: 'opusplan' }],
    shown: ['│', 'opusplan'],
  },
]

for (const row of MODEL_ROWS) {
  test(`model: ${row.id}`, async ($, on) => {
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', () => ({ type: 'Box' }))
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits: [], context: { tokens: 40_000, window: 200_000 } },
    }))
    on('turn.step', async function* (_, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn',
        usage: null,
      } as never
    })

    for (const [i, step] of row.steps.entries()) {
      for await (const _ of $.turn.step({
        turnId: 't0',
        index: i,
        messageCount: 1,
        ...step,
      } as never)) {
      }
    }
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't0',
      reason: 'completed',
    } as never)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-weather', surface, ...BAND })
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())
      expect([row.id, surface, texts.slice(3)]).toEqual([row.id, surface, row.shown])
      await ui.unmount()
    }
  })
}

test('a compaction shows at once, and the next turn shows the real drop', async ($, on) => {
  let tokens = 140_000
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box' }))
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens, window: 200_000 } },
  }))
  const SUMMARY = [{ role: 'user', text: 'summary', toolUses: [] }] as never
  on('session.compact', () => ({ messages: SUMMARY, tokensAfter: 4_000 }))

  const band = async () => {
    const ui = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...BAND })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())
    await ui.unmount()
    return texts
  }
  const turn = (id: string) =>
    $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: id,
      reason: 'completed',
    } as never)

  await turn('t1')
  expect((await band())[0]).toBe('☂\u{FE0F} Showers')

  await $.session.compact({ trigger: 'precompute', messages: SUMMARY } as never)
  await $.session.compact({ trigger: 'auto', agentId: 'sub', messages: SUMMARY } as never)
  expect((await band())[0]).toBe('☂\u{FE0F} Showers')

  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  expect((await band()).slice(0, 2)).toEqual(['↺ Compacted', 'new size after your next message'])

  tokens = 30_000
  await turn('t2')
  const after = await band()
  expect([after[0], after.at(-1)]).toEqual(['☀\u{FE0F} Clear', '▼ -110k last turn'])
})
