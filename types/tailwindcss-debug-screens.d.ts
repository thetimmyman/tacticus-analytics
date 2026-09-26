// The package ships no types and tailwind.config.ts is typechecked (TS7016).
declare module 'tailwindcss-debug-screens' {
  import type { PluginCreator } from 'tailwindcss/types/config'

  const plugin: PluginCreator
  export default plugin
}
