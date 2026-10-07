export type Mood = 'upbeat' | 'neutral' | 'curious' | 'confused' | 'frustrated'

declare module 'claude-code' {
  interface PluginState {
    'token-weather': {
      history: number[]
      window: number
      mood: Mood | null
      prompts: string[]
      isCompacted: boolean
    }
  }
}
