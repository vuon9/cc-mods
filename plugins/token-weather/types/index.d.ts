export type ModelInUse = { id: string; effort?: string | number }

declare module 'claude-code' {
  interface PluginState {
    'token-weather': {
      history: number[]
      window: number
      isCompacted: boolean
      model: ModelInUse | null
    }
  }
}
