export type ModRow = { name: string; source: string }

declare module 'claude-code' {
  interface PluginState {
    switchboard: { mods: Shaped<ModRow[]>; off: Shaped<string[]> }
  }
}
