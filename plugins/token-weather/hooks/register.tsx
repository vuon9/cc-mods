import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const history = atom({ plugin: 'token-weather', key: 'history' } as const, [])
const contextWindow = atom({ plugin: 'token-weather', key: 'window' } as const, 0)
const isCompacted = atom({ plugin: 'token-weather', key: 'isCompacted' } as const, false)
const modelInUse = atom({ plugin: 'token-weather', key: 'model' } as const, null)

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

// Reads 'claude-opus-4-5-20251101' and provider ids like 'us.anthropic.claude-opus-4-5-20251101-v1:0'
// as 'Opus 4.5'. A [1m] tag is dropped since the band already shows the window. Anything else stays as is.
function modelName(id: string) {
  return id.replace(
    /^.*claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d).*$/,
    (_, family: string, major: string, minor?: string) =>
      `${family.charAt(0).toUpperCase()}${family.slice(1)} ${minor ? `${major}.${minor}` : major}`,
  )
}

async function sample($: EngineInterface) {
  const { context } = await $.session.usage()
  if (context.tokens === undefined) return
  await update($, contextWindow, () => context.window)
  await update($, history, h => [...h, context.tokens!].slice(-SPAN))
  await update($, isCompacted, () => false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if ((await read($, history)).length === 0) await sample($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await sample($)
    return result
  })

  // A step is one model request, sent with the model and effort in force after any fallback or downgrade.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined)
      await update($, modelInUse, () => ({ id: e.model, effort: e.effort }))
    return yield* next(e)
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
    const inUse = await read($, modelInUse)
    const compacted = await read($, isCompacted)
    if (e.props.hasSurvey || samples.length === 0 || window === 0) return next(e)

    const tokens = samples[samples.length - 1]
    const percent = Math.round((tokens / window) * 100)
    const forecast = FORECASTS.find(f => percent < f.below)!
    const delta = samples.length > 1 ? tokens - samples[samples.length - 2] : undefined
    const { Box, Text } = $.ui.resolve(e)

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
        {inUse && (
          <Box>
            <Text dimColor>{'  │  '}</Text>
            <Text bold>{modelName(inUse.id)}</Text>
            {inUse.effort !== undefined && <Text> ({inUse.effort})</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
