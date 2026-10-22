import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { SkillLoad } from '../types'

const PANE = 'skill-map'
// The dock adds 2 cells, so 19 at a ~7.6px cell stays under a 150px cap.
const COLUMNS = 17
// Fullscreen docks a pane beside the transcript from this width.
const DOCK_FROM = 110
const loads = atom({ plugin: 'skill-map', key: 'loads' } as const, [])
const used = atom({ plugin: 'skill-map', key: 'used' } as const, 0)
const turn = atom({ plugin: 'skill-map', key: 'turn' } as const, 0)
const minimized = atom({ plugin: 'skill-map', key: 'minimized' } as const, false)

const SMALL_MAX = 2000
const MEDIUM_MAX = 6000
const TIER_COLOR = { small: '#4caf50', medium: '#e0a030', large: '#e05050' }

type Tier = keyof typeof TIER_COLOR

const tierOf = (tokens: number): Tier =>
  tokens < SMALL_MAX ? 'small' : tokens < MEDIUM_MAX ? 'medium' : 'large'

const estimate = (text: string) => Math.ceil(text.length / 4)
const kilo = (tokens: number) => `${(tokens / 1000).toFixed(1)}k`

const stats = (one: SkillLoad) =>
  `${kilo(one.tokens)} ${one.reloads > 0 ? `${one.firstPercent}→${one.lastPercent}%` : `${one.lastPercent}%`} t${one.turn}`

const reloadTag = (one: SkillLoad) => (one.reloads > 0 ? ` [+${one.reloads}]` : '')

const blockText = (block: { type: string; [field: string]: unknown }): string => {
  if (block.type === 'text') return String(block.text)
  if (block.type !== 'tool_result') return ''
  if (typeof block.content === 'string') return block.content
  return Array.isArray(block.content) ? block.content.map(blockText).join('\n') : ''
}

// Only whole-file reads count: `head`, `wc`, `grep` or a piped `cat` would log a skill that never entered context.
const WHOLE_CAT = /(?:^|[;&]\s*)cat\s+(['"]?)(\S+\/SKILL\.md)\1\s*(?:$|[;&])/

const skillFile = (e: { tool: string; [field: string]: unknown }): string | undefined => {
  if (e.tool === 'Read' && e.offset === undefined && e.limit === undefined && String(e.file_path).endsWith('/SKILL.md')) {
    return String(e.file_path)
  }
  if (e.tool === 'Bash') return WHOLE_CAT.exec(String(e.command))?.[2]
  return undefined
}

// Every skill load, typed or through the Skill tool, lands as a meta row with this header; skill.prompt does not fire for typed skills on every build.
const SKILL_ROW = /^Base directory for this skill: (.+)\n/

const KEPT_SKILL = /^(?:Base directory for this skill: .*\/([^/\n]+)|name: ([\w:-]+))$/gm

export const skillsIn = (messages: readonly SessionMessage[]) =>
  new Set(
    messages
      .flatMap(one => [one.text, ...(one.toolResults ?? []).map(result => result.text)])
      .flatMap(text => [...text.matchAll(KEPT_SKILL)].map(match => match[1] ?? match[2])),
  )

export const skillOfRow = (text: string) => {
  const dir = SKILL_ROW.exec(text)?.[1]
  return dir === undefined ? undefined : { skill: dir.split('/').at(-1) ?? dir, tokens: estimate(text) }
}

async function isPaneUp($: EngineInterface) {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Skills', columns: COLUMNS })

async function expand($: EngineInterface) {
  await update($, minimized, () => false)
  await open($)
}

async function record($: EngineInterface, skill: string, tokens: number) {
  const { context } = await $.session.usage()
  const percent = context.percent ?? 0
  const now = await read($, turn)
  await update($, loads, list => {
    const old = list.find(one => one.skill === skill)
    const entry: SkillLoad = {
      skill,
      tokens,
      firstPercent: old?.firstPercent ?? percent,
      lastPercent: percent,
      turn: now,
      reloads: old === undefined ? 0 : old.reloads + 1,
      isCompacted: false,
    }
    return old === undefined ? [...list, entry] : list.map(one => (one === old ? entry : one))
  })
  if (!(await read($, minimized)) && !(await isPaneUp($))) void open($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skill-map',
      description: 'Toggle the pane of skills loaded into this conversation; `/skill-map minimize` folds it above the prompt, `/skill-map reset` clears it',
    })
    return next(e)
  })

  on('command.run', { command: 'skill-map' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      await update($, loads, () => [])
      return { text: 'Skill map cleared.' }
    }
    if (e.args.trim() === 'minimize') {
      await update($, minimized, () => true)
      await $.ui.close({ id: PANE })
      return { text: 'Skill map minimized to [+] above the prompt.' }
    }
    const wasOpen = await isPaneUp($)
    await update($, minimized, () => false)
    if (wasOpen) await $.ui.close({ id: PANE })
    else await open($)
    if (wasOpen) return { text: 'Skill map closed.' }
    const isNarrow = e.presentation.isFullscreen && e.presentation.columns < DOCK_FROM
    return { text: isNarrow ? `Skill map shows beside the transcript once the terminal is ${DOCK_FROM} columns wide.` : 'Skill map opened.' }
  })

  // The ✕ is the engine's; a person's close minimizes to the band, `/skill-map` closes for good.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    if (e.origin.kind === 'person') await update($, minimized, () => true)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, minimized))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, loads)
    const fill = await read($, used)
    return (
      <Box>
        {await next(e)}
        <Box marginLeft={2}>
          <Button plain key="skill-map-expand" onPress={() => expand($)}>
            [+] <Text dimColor>skills {list.length} · {fill}%</Text>
          </Button>
        </Box>
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turn, n => n + 1)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await update($, used, () => e.context.percent ?? 0)
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const loaded = e.message.isMeta ? skillOfRow(e.message.content.map(blockText).join('\n')) : undefined
    if (loaded !== undefined) await record($, loaded.skill, loaded.tokens)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || result.skip !== undefined) return result
    const kept = skillsIn(result.messages)
    await update($, loads, list => list.map(one => ({ ...one, isCompacted: !kept.has(one.skill) })))
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const path = e.agentId === undefined ? skillFile(e) : undefined
    if (path === undefined) return next(e)
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && ran.text) {
      await record($, path.split('/').at(-2) ?? path, estimate(ran.text))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    // A sidebar only: seated inline over a narrow fullscreen terminal, reopen it from a timer. That open is
    // unasked, so the engine holds the pane undrawn until the terminal is wide enough to dock it again.
    if (e.props.placement === 'inline' && e.viewport?.isFullscreen === true) {
      $.clock.after(0, () => void $.ui.close({ id: PANE }).then(() => open($)))
      return <Box />
    }
    const list = await read($, loads)
    const fill = await read($, used)
    // Docked, fill the dock so dragging it wider shows long names whole; inline spans the terminal, so stay narrow.
    const width = e.props.placement === 'dock' ? e.props.bodyColumns : Math.min(COLUMNS, e.viewport?.columns ?? COLUMNS)
    // The terminal draws text right up to the dock's edge; one cell keeps it off.
    const padding = e.surface === 'terminal' ? 1 : 0
    const inner = width - padding
    const barWidth = inner - 5
    const cells = Array.from({ length: barWidth }, (_, i) => {
      const at = list.findLast(one => Math.min(barWidth - 1, Math.floor((one.lastPercent / 100) * barWidth)) === i)
      if (at !== undefined) return { glyph: '▮', color: TIER_COLOR[tierOf(at.tokens)] }
      return { glyph: i < Math.round((fill / 100) * barWidth) ? '█' : '░', color: undefined }
    })

    return (
      <Box flexDirection="column" width={width} paddingRight={padding}>
        <Text>
          {cells.map(cell => (
            <Text color={cell.color} dimColor={cell.color === undefined}>
              {cell.glyph}
            </Text>
          ))}
          <Text dimColor> {fill}%</Text>
        </Text>
        <Text dimColor>
          <Text color={TIER_COLOR.small}>■</Text>&lt;2k <Text color={TIER_COLOR.medium}>■</Text>2-6k{' '}
          <Text color={TIER_COLOR.large}>■</Text>6k+
        </Text>
        <Text> </Text>
        {list.length === 0 && <Text dimColor>No skills yet.</Text>}
        {list.map(one => {
          const isOneLine = `■ ${one.skill}${reloadTag(one)} ${stats(one)}`.length <= inner
          return (
            <Box key={`skill-${one.skill}`} flexDirection={isOneLine ? 'row' : 'column'} width={inner}>
              <Box flexGrow={1} flexShrink={1}>
                <Text dimColor={one.isCompacted} strikethrough={one.isCompacted} wrap="truncate-end">
                  <Text color={TIER_COLOR[tierOf(one.tokens)]}>■ </Text>
                  {one.skill}
                  {one.reloads > 0 && <Text bold>{reloadTag(one)}</Text>}
                </Text>
              </Box>
              <Box flexShrink={0} paddingLeft={isOneLine ? 0 : 1}>
                <Text dimColor> {stats(one)}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
