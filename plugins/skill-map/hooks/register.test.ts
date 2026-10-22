import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { skillOfRow, skillsIn } from './register'

const MEDIUM = 'm'.repeat(12_000)
const SMALL = 's'.repeat(2_000)

function engineBeneath(on: On, bodies: Record<string, string>, openPanes: string[] = [], opens: string[] = [], closes: string[] = []) {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: 30_000, percent: 15 }, rateLimits: [] } }))
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['weather'] }))
  on('ui.close', (_, e) => {
    closes.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: openPanes.map(id => ({ id, title: 'Skills', isShown: true, isFocused: false, isPlaced: true })) }))
  on('tool.call', { tool: 'Read' }, (_, e) => {
    const text = bodies[e.file_path.split('/').at(-2) ?? '']
    return { result: { type: 'text', file: { filePath: e.file_path, content: text, numLines: 1, startLine: 1, totalLines: 1 } }, text }
  })
}

const readSkill = ($: Engine, skill: string) => $.tool.call({ tool: 'Read', file_path: `/skills/${skill}/SKILL.md` })

const surfaces = [
  { surface: 'terminal' as const, rowWidth: 39 },
  { surface: 'desktop' as const, rowWidth: 40 },
]

for (const row of surfaces) {
  test(`${row.surface}: each skill shows its size, reloads, context positions and turn, padded right on the terminal only`, async ($, on) => {
    engineBeneath(on, { vmode: SMALL, big: MEDIUM })
    await readSkill($, 'vmode')
    await readSkill($, 'vmode')
    await readSkill($, 'big')
    const pane = await $.ui.mount({ plugin: 'skill-map', surface: row.surface, component: 'Pane', props: { title: 'Skills', isFocused: false, placement: 'dock' as const, bodyColumns: 40 }, requestId: 'skill-map' })
    const rows = await Promise.all(['skill-vmode', 'skill-big'].map(key => pane.find({ key })))
    expect(rows.map(one => [one?.props.width, one?.text])).toEqual([
      [row.rowWidth, '■ vmode [+1] 0.5k 15→15% t0'],
      [row.rowWidth, '■ big 3.0k 15% t0'],
    ])
  })
}

// `■ big [+1] 3.0k 15→15% t0` is 25 cells, and the terminal keeps the body's last column as padding.
const widths = [
  { id: 'docked at its opening width: details on a second line', placement: 'dock' as const, bodyColumns: 17, want: [16, 'column', '■ big [+1] 3.0k 15→15% t0'] },
  { id: 'docked just wide enough: details on the same line', placement: 'dock' as const, bodyColumns: 26, want: [25, 'row', '■ big [+1] 3.0k 15→15% t0'] },
  { id: 'inline across a wide terminal: stays narrow', placement: 'inline' as const, bodyColumns: 120, want: [16, 'column', '■ big [+1] 3.0k 15→15% t0'] },
]

for (const row of widths) {
  test(`width: ${row.id}`, async ($, on) => {
    engineBeneath(on, { big: MEDIUM })
    await readSkill($, 'big')
    await readSkill($, 'big')
    const pane = await $.ui.mount({
      plugin: 'skill-map',
      surface: 'terminal',
      component: 'Pane',
      props: { title: 'Skills', isFocused: false, placement: row.placement, bodyColumns: row.bodyColumns },
      requestId: 'skill-map',
      viewport: { columns: 120, rows: 40 },
    })
    const big = await pane.find({ key: 'skill-big' })
    expect([big?.props.width, big?.props.flexDirection, big?.text]).toEqual(row.want)
  })
}

// Fonts like Iosevka draw ■ two cells wide, so each square needs a space after it, and 16 cells fit the opening width.
test('legend: a space after each square, on one line at the opening width', async ($, on) => {
  engineBeneath(on, {})
  const pane = await $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false, placement: 'dock' as const, bodyColumns: 17 }, requestId: 'skill-map' })
  expect((await pane.find({ type: 'Text', text: /6k\+/ }))?.text).toBe('■ <2 ■ 2-6 ■ 6k+')
})

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
    const pane = await $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false, placement: 'dock' as const, bodyColumns: 17 }, requestId: 'skill-map' })
    expect((await pane.find({ key: 'skill-tiny' })) !== undefined).toBe(row.isCounted)
  })
}

test('partial Read does not count', async ($, on) => {
  engineBeneath(on, { tiny: SMALL })
  await $.tool.call({ tool: 'Read', file_path: '/skills/tiny/SKILL.md', limit: 10 })
  const pane = await $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false, placement: 'dock' as const, bodyColumns: 17 }, requestId: 'skill-map' })
  expect(await pane.find({ key: 'skill-tiny' })).toBe(undefined)
})

test('/skill-map reset clears every line', async ($, on) => {
  engineBeneath(on, { tiny: SMALL })
  await readSkill($, 'tiny')
  await $.command.run({ command: 'skill-map', args: 'reset' })
  const pane = await $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false, placement: 'dock' as const, bodyColumns: 17 }, requestId: 'skill-map' })
  expect(await pane.find({ key: 'skill-tiny' })).toBe(undefined)
})

const toggles = [
  { id: 'pane already closed by the person: opens', openPanes: [], text: 'Skill map opened.' },
  { id: 'pane up: closes', openPanes: ['skill-map'], text: 'Skill map closed.' },
]

for (const row of toggles) {
  test(`/skill-map: ${row.id}`, async ($, on) => {
    engineBeneath(on, {}, row.openPanes)
    expect((await $.command.run({ command: 'skill-map', args: '', presentation: { isFullscreen: true, columns: 200 } })).text).toBe(row.text)
  })
}

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false, placement: 'dock' as const, bodyColumns: 17 }, requestId: 'skill-map' })
const mountBand = ($: Engine) =>
  $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100 } })

test('minimized: a [+] chip beside the prompt row, and the chip brings the pane back', async ($, on) => {
  const opens: string[] = []
  engineBeneath(on, { vmode: SMALL }, [], opens)
  await readSkill($, 'vmode')
  await $.command.run({ command: 'skill-map', args: 'minimize', presentation: { isFullscreen: true, columns: 200 } })
  await readSkill($, 'vmode')
  const band = await mountBand($)
  expect([opens.length, (await band.find({ key: 'skill-map-expand' }))?.text, (await band.find({ text: 'weather' })) !== undefined]).toEqual([
    1,
    '[+] skills 1 · 0%',
    true,
  ])
  await band.press({ key: 'skill-map-expand' })
  expect([opens.length, await (await mountBand($)).find({ key: 'skill-map-expand' })]).toEqual([2, undefined])
})

test('/skill-map while minimized opens the pane and drops the chip', async ($, on) => {
  const opens: string[] = []
  engineBeneath(on, {}, [], opens)
  await $.command.run({ command: 'skill-map', args: 'minimize', presentation: { isFullscreen: true, columns: 200 } })
  expect((await $.command.run({ command: 'skill-map', args: '', presentation: { isFullscreen: true, columns: 200 } })).text).toBe('Skill map opened.')
  expect([opens, await (await mountBand($)).find({ key: 'skill-map-expand' })]).toEqual([['skill-map'], undefined])
})

const seats = [
  { id: 'docked: drawn', placement: 'dock' as const, isFullscreen: true, want: { isDrawn: true, closes: [], opens: [] } },
  {
    id: 'inline over a narrow fullscreen terminal: handed back to wait for a dock',
    placement: 'inline' as const,
    isFullscreen: true,
    want: { isDrawn: false, closes: ['skill-map'], opens: ['skill-map'] },
  },
  { id: 'inline on the main screen, which has no dock: drawn', placement: 'inline' as const, isFullscreen: false, want: { isDrawn: true, closes: [], opens: [] } },
]

for (const row of seats) {
  test(`seat: ${row.id}`, async ($, on) => {
    const opens: string[] = []
    const closes: string[] = []
    engineBeneath(on, {}, [], opens, closes)
    const clock = mock.clock(on)
    const pane = await $.ui.mount({
      plugin: 'skill-map',
      surface: 'terminal',
      component: 'Pane',
      props: { title: 'Skills', isFocused: false, placement: row.placement, bodyColumns: 90 },
      requestId: 'skill-map',
      viewport: { columns: 90, rows: 40, isFullscreen: row.isFullscreen },
    })
    await clock.advance(1)
    const isDrawn = (await pane.find({ text: 'No skills yet.' })) !== undefined
    expect({ isDrawn, closes, opens }).toEqual(row.want)
  })
}

test('/skill-map on a narrow fullscreen terminal says when the pane will show', async ($, on) => {
  engineBeneath(on, {})
  const reply = await $.command.run({ command: 'skill-map', args: '', presentation: { isFullscreen: true, columns: 90 } })
  expect(reply.text).toBe('Skill map shows beside the transcript once the terminal is 110 columns wide.')
})

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
  const pane = await $.ui.mount({ plugin: 'skill-map', surface: 'terminal', component: 'Pane', props: { title: 'Skills', isFocused: false, placement: 'dock' as const, bodyColumns: 17 }, requestId: 'skill-map' })
  expect(JSON.stringify(await pane.find({ key: 'skill-tiny' }))).toContain('"strikethrough":true')
})
