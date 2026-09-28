// The package ships no types and tailwind.config.ts is typechecked (TS7016).
declare module 'tailwindcss-debug-screens' {
  import type { Config } from 'tailwindcss'

  const plugin: NonNullable<Config['plugins']>[number]
  export default plugin
}
