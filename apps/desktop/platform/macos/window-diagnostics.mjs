// Classification only: child messages, paths, tokens and workspace data never
// cross the diagnostic boundary. This is used only by synthetic qualification.
export function windowDiagnostics() {
  const categories = new Set()
  let tail = ''
  const patterns = [
    [/code signature|code signing|CODESIGNING/i, 'code-signature'],
    [/Library not loaded|dyld\[/i, 'dynamic-loader'],
    [/WindowServer|CGSConnection|_RegisterApplication/i, 'window-server'],
    [/Cannot find module|MODULE_NOT_FOUND/i, 'module-loading'],
    [/sandbox.*(?:denied|failed)|Operation not permitted/i, 'os-permission'],
    [/Native coordinator channel unavailable/i, 'native-ipc'],
    [/ERR_CONNECTION|ERR_FAILED|Failed to load URL/i, 'loopback-load'],
    [/NODE_CHANNEL_FD|NODE_OPTIONS/i, 'node-environment']
  ]
  return {
    observe(chunk) {
      tail = (tail + chunk.toString('utf8')).slice(-8192)
      for (const [pattern, category] of patterns)
        if (pattern.test(tail)) categories.add(category)
    },
    exit(code, signal) {
      return {
        synthetic: true,
        exitCode: Number.isSafeInteger(code) ? code : null,
        signal: /^SIG[A-Z]+$/.test(signal ?? '') ? signal : null,
        categories: [...categories].sort()
      }
    }
  }
}
