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

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const MOOD_ROWS = [
  { id: 'one reading', words: ['Confused.'], mood: '🤔\u{FE0F} Confused' },
  { id: 'the latest reading wins', words: ['frustrated', 'upbeat'], mood: '😊\u{FE0F} Upbeat' },
  { id: 'an unknown word is skipped', words: ['curious', 'sleepy'], mood: '🧐\u{FE0F} Curious' },
]

for (const row of MOOD_ROWS) {
  test(`mood: ${row.id}`, async ($, on) => {
    const asked: string[] = []
    const replies = [...row.words]
    on('turn.complete', () => ({ text: '' }))
    on('prompt.submit', () => ({ text: '' }) as never)
    on('ui.render', () => ({ type: 'Box' }))
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits: [], context: { tokens: 40_000, window: 200_000 } },
    }))
    on('model.complete', ($, e) => {
      asked.push(e.prompt)
      return { value: { isAnswered: true, text: replies.shift()!, usage: USAGE } } as never
    })

    for (const [i] of row.words.entries()) {
      await $.prompt.submit({ text: `prompt ${i}` } as never)
      await $.turn.complete({
        answer: `reply ${i}`,
        durationMs: 1,
        isAborted: false,
        turnId: `t${i}`,
        reason: 'completed',
      } as never)
    }

    expect(asked[0]).toContain('Developer: prompt 0')
    expect(asked[0]).toContain("Assistant's last reply: reply 0")

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-weather', surface, ...BAND })
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())
      expect([surface, texts.slice(texts.indexOf('│') + 1)]).toEqual([surface, [row.mood]])
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
