export type SkillLoad = {
  skill: string
  tokens: number
  firstPercent: number
  lastPercent: number
  turn: number
  reloads: number
  isCompacted: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'skill-map': { loads: SkillLoad[]; used: number; turn: number }
  }
}
