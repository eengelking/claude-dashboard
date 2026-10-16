/** The name and token a session reports as, taken once at its start (#226). */
export type HeldIdentity = { userName: string; token: string }

declare module 'claude-code' {
  interface PluginState {
    'podium-reporter': { identity: HeldIdentity | null }
  }
}
