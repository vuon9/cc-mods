import type { Engine, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { cardLines, skillOfRow, skillsIn } from './register'

const MEDIUM = 'm'.repeat(12_000)
const SMALL = 's'.repeat(2_000)

function engineBeneath(on: On, bodies: Record<string, string>, openPanes: string[] = []) {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: 30_000, percent: 15 }, rateLimits: [] } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: openPanes.map(id => ({ id, title: 'Skills', isShown: true, isFocused: false, isPlaced: true })) }))
  on('tool.call', { tool: 'Read' }, (_, e) => {
    const text = bodies[e.file_path.split('/').at(-2) ?? '']
    return { result: { type: 'text', file: { filePath: e.file_path, content: text, numLines: 1, startLine: 1, totalLines: 1 } }, text }
  })
}

const readSkill = ($: Engine, skill: string) => $.tool.call({ tool: 'Read', file_path: `/skills/${skill}/SKILL.md` })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: one line per skill with name and size, the rest in a card shown on hover`, async ($, on) => {
    engineBeneath(on, { vmode: SMALL, big: MEDIUM })
    await readSkill($, 'vmode')
    await readSkill($, 'vmode')
    await readSkill($, 'big')
    const pane = await $.ui.mount({ plugin: 'skill-map', surface, component: 'Pane', props: { title: 'Skills', isFocused: false }, requestId: 'skill-map' })
    const rows = await Promise.all(['skill-vmode', 'skill-big'].map(key => pane.find({ key })))
    expect(rows.map(row => [row?.text, row?.props.width])).toEqual([
      [`■ vmode 0.5k${'vmode [+1]'.padEnd(17)}${'0.5k 15→15% t0'.padEnd(17)}`, 17],
      [`■ big 3.0k${'big'.padEnd(17)}${'3.0k 15% t0'.padEnd(17)}`, 17],
    ])
    const cards = (await pane.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')
    expect(cards.map(card => [card.props.display, card.props.top])).toEqual([
      ['none', -2],
      ['none', -2],
    ])
    expect(JSON.stringify(await pane.drawn()).match(/"display":"none"\},"hover":\{"display":"flex"\}/g)).toHaveLength(2)
  })
}

const load = { skill: 'big', tokens: 3_000, firstPercent: 4, lastPercent: 15, turn: 2, reloads: 0, isCompacted: false }

const cards = [
  { id: 'short name', one: load, want: ['big', '3.0k 15% t2'] },
  { id: 'reloaded', one: { ...load, reloads: 2 }, want: ['big [+2]', '3.0k 4→15% t2'] },
  {
    id: 'long name wraps at the width',
    one: { ...load, skill: 'cowork-plugin-management:cowork-plugin-customizer' },
    want: ['cowork-plugin-man', 'agement:cowork-pl', 'ugin-customizer', '3.0k 15% t2'],
  },
]

for (const row of cards) {
  test(`card: ${row.id}`, () => {
    expect(cardLines(row.one, 17)).toEqual(row.want.map(line => line.padEnd(17)))
  })
}

const commands = [
  { id: 'cat alone counts', command: 'cat /skills/tiny/SKILL.md', isCounted: true },
  { id: 'cat then another command counts', command: 'cat "/skills/tiny/SKILL.md"; ls /skills/tiny', isCounted: true },
  { id: 'head does not count', command: 'head -8 /skills/tiny/SKILL.md', isCounted: false },
  { id: 'wc does not count', command: 'wc -c /skills/tiny/SKILL.md', isCounted: false },
  { id: 'piped cat does not count', command: 'cat /skills/tiny/SKILL.md | head -5', isCounted: false },
]

for (const row of commands) {
  test(`shell: ${row.id}`, async ($, on) => {
    engineBeneath(on, {})
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: SMALL, stderr: '', interrupted: false }, text: SMALL }))
    await $.tool.call({ tool: 'Bash', command: row.command })
    const pane = await $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false }, requestId: 'skill-map' })
    expect((await pane.find({ key: 'skill-tiny' })) !== undefined).toBe(row.isCounted)
  })
}

test('partial Read does not count', async ($, on) => {
  engineBeneath(on, { tiny: SMALL })
  await $.tool.call({ tool: 'Read', file_path: '/skills/tiny/SKILL.md', limit: 10 })
  const pane = await $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false }, requestId: 'skill-map' })
  expect(await pane.find({ key: 'skill-tiny' })).toBe(undefined)
})

test('/skill-map reset clears every line', async ($, on) => {
  engineBeneath(on, { tiny: SMALL })
  await readSkill($, 'tiny')
  await $.command.run({ command: 'skill-map', args: 'reset' })
  const pane = await $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false }, requestId: 'skill-map' })
  expect(await pane.find({ key: 'skill-tiny' })).toBe(undefined)
})

const toggles = [
  { id: 'pane already closed by the person: opens', openPanes: [], text: 'Skill map opened.' },
  { id: 'pane up: closes', openPanes: ['skill-map'], text: 'Skill map closed.' },
]

for (const row of toggles) {
  test(`/skill-map: ${row.id}`, async ($, on) => {
    engineBeneath(on, {}, row.openPanes)
    expect((await $.command.run({ command: 'skill-map', args: '' })).text).toBe(row.text)
  })
}

const rows = [
  { id: 'typed /bro row', text: `Base directory for this skill: /Users/me/.claude/skills/bro\n\n${SMALL}`, want: { skill: 'bro', tokens: 516 } },
  { id: 'plugin skill row', text: 'Base directory for this skill: /p/plugins/kit/skills/deploy\n\nx', want: { skill: 'deploy', tokens: 16 } },
  { id: 'header mid-text is not a load', text: `quoting it: Base directory for this skill: /a/b\n`, want: undefined },
  { id: 'ordinary meta row', text: '<system-reminder>\nhi', want: undefined },
]

for (const row of rows) {
  test(`skill row: ${row.id}`, () => {
    expect(skillOfRow(row.text)).toEqual(row.want)
  })
}

const compactions = [
  { id: 'every skill text summarized away', kept: [{ role: 'user' as const, text: 'Summary of the chat.', toolUses: [] }], want: [] },
  {
    id: 'typed skill row kept verbatim',
    kept: [{ role: 'user' as const, text: 'Base directory for this skill: /s/.claude/skills/bro\n\nRestate.', toolUses: [] }],
    want: ['bro'],
  },
  {
    id: 'SKILL.md read kept in a tool result',
    kept: [{ role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 't', text: '---\nname: vmode\n---\nbody', isError: false }] }],
    want: ['vmode'],
  },
]

for (const row of compactions) {
  test(`compaction: ${row.id}`, () => {
    expect([...skillsIn(row.kept)]).toEqual(row.want)
  })
}

test('compaction greys out a skill whose text is gone', async ($, on) => {
  engineBeneath(on, { tiny: SMALL })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'Summary.', toolUses: [] }] }))
  await readSkill($, 'tiny')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
  const pane = await $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false }, requestId: 'skill-map' })
  expect(JSON.stringify(await pane.find({ key: 'skill-tiny' }))).toContain('"strikethrough":true')
})
