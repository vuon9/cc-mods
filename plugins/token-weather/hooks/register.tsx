import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mood } from '../types'

const history = atom({ plugin: 'token-weather', key: 'history' } as const, [])
const contextWindow = atom({ plugin: 'token-weather', key: 'window' } as const, 0)
const mood = atom({ plugin: 'token-weather', key: 'mood' } as const, null)
const prompts = atom({ plugin: 'token-weather', key: 'prompts' } as const, [])
const isCompacted = atom({ plugin: 'token-weather', key: 'isCompacted' } as const, false)

const BARS = '▁▂▃▄▅▆▇█'
const SPAN = 12

// U+FE0F asks for the color emoji form. Without it a terminal draws some of these from the text font
// and borrows the rest from the emoji font, so they come out at different sizes and widths.
const EMOJI = '\u{FE0F}'

const FORECASTS = [
  { below: 25, icon: `☀${EMOJI}`, word: 'Clear', color: '#FFA500' },
  { below: 50, icon: `☁${EMOJI}`, word: 'Cloudy', color: 'cyan' },
  { below: 75, icon: `☂${EMOJI}`, word: 'Showers', color: 'blue' },
  { below: 90, icon: '☇', word: 'Storm', color: 'magenta' },
  { below: Infinity, icon: '↯', word: 'Compact soon', color: 'red' },
]

const MOODS: Record<Mood, { icon: string; word: string; color: string }> = {
  upbeat: { icon: `😊${EMOJI}`, word: 'Upbeat', color: 'green' },
  curious: { icon: `🧐${EMOJI}`, word: 'Curious', color: 'cyan' },
  neutral: { icon: `😐${EMOJI}`, word: 'Neutral', color: 'gray' },
  confused: { icon: `🤔${EMOJI}`, word: 'Confused', color: '#FFA500' },
  frustrated: { icon: `😤${EMOJI}`, word: 'Frustrated', color: 'red' },
}

const RECENT_PROMPTS = 6

const MOOD_SYSTEM = `You read the latest exchanges between a developer and their coding assistant and judge how the developer feels about how the collaboration is going.
Answer with exactly one word: upbeat, neutral, curious, confused or frustrated.
- upbeat: pleased, thanking, excited, things are landing.
- neutral: plainly directing work, no strong signal.
- curious: exploring ideas, asking open questions, wanting to learn.
- confused: unsure what happened, asking for clarification, contradicting themselves.
- frustrated: repeating or correcting the same thing, terse, annoyed, the assistant missed the point.`

function short(n: number) {
  const [value, unit] = n >= 1e6 ? [n / 1e6, 'M'] : [n / 1e3, 'k']
  return `${value.toFixed(1).replace(/\.0$/, '')}${unit}`
}

function sparkline(samples: number[]) {
  const top = Math.max(...samples)
  return samples
    .map(n => BARS[top === 0 ? 0 : Math.min(BARS.length - 1, Math.floor((n / top) * BARS.length))])
    .join('')
}

async function sample($: EngineInterface) {
  const { context } = await $.session.usage()
  if (context.tokens === undefined) return
  await update($, contextWindow, () => context.window)
  await update($, history, h => [...h, context.tokens!].slice(-SPAN))
  await update($, isCompacted, () => false)
}

async function readMood($: EngineInterface, prompts: string[], answer: string) {
  const transcript = prompts.map(p => `Developer: ${p.slice(0, 600)}`).join('\n\n')
  const r = await $.model.complete({
    model: 'haiku',
    system: MOOD_SYSTEM,
    prompt: `${transcript}\n\nAssistant's last reply: ${answer.slice(0, 800)}`,
    maxTokens: 10,
    effort: 'low',
    timeoutMs: 8_000,
  })
  if (!r.isAnswered) return
  const word = r.text
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  if (word in MOODS) await update($, mood, () => word as Mood)
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    await update($, prompts, p => [...p, e.text].slice(-RECENT_PROMPTS))
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if ((await read($, history)).length === 0) await sample($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await sample($)
    const recent = await read($, prompts)
    if (recent.length > 0) await readMood($, recent, e.answer)
    return result
  })

  // Right after a compaction the engine has no real context size until the next API response.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.messages) {
      await update($, isCompacted, () => true)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const samples = await read($, history)
    const window = await read($, contextWindow)
    const reading = await read($, mood)
    const compacted = await read($, isCompacted)
    if (e.props.hasSurvey || samples.length === 0 || window === 0) return next(e)

    const tokens = samples[samples.length - 1]
    const percent = Math.round((tokens / window) * 100)
    const forecast = FORECASTS.find(f => percent < f.below)!
    const delta = samples.length > 1 ? tokens - samples[samples.length - 2] : undefined
    const { Box, Text } = $.ui.resolve(e)

    const feeling = reading && MOODS[reading]

    return (
      <Box>
        {compacted ? (
          <Box>
            <Text color="green" bold>
              ↺ Compacted
            </Text>
            <Text dimColor>{'  new size after your next message  '}</Text>
          </Box>
        ) : (
          <Box>
            <Text color={forecast.color} bold>
              {forecast.icon} {forecast.word}
            </Text>
            <Text>
              {'  '}
              {percent}% · {short(tokens)} / {short(window)}
              {'  '}
            </Text>
          </Box>
        )}
        <Text color={compacted ? 'gray' : forecast.color}>{sparkline(samples)}</Text>
        {!compacted && delta !== undefined && (
          <Text dimColor>
            {'  '}
            {delta >= 0 ? '▲ +' : '▼ -'}
            {short(Math.abs(delta))} last turn
          </Text>
        )}
        {feeling && (
          <Box>
            <Text dimColor>{'  │  '}</Text>
            <Text color={feeling.color} bold>
              {feeling.icon} {feeling.word}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
