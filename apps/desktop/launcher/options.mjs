export function launcherOptions(args) {
  const allowed = new Set(['--state', '--verify', '--backup', '--restore'])
  const options = new Map()
  const invalid = () => new Error('Invalid desktop launch options.')
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index],
      value = args[index + 1]
    if (
      !allowed.has(name) ||
      options.has(name) ||
      typeof value !== 'string' ||
      !value.length ||
      value.startsWith('--')
    )
      throw invalid()
    options.set(name, value)
  }
  if (
    (options.has('--backup') && options.has('--restore')) ||
    (options.has('--verify') &&
      (options.has('--backup') || options.has('--restore'))) ||
    (options.has('--restore') && !options.has('--state'))
  )
    throw invalid()
  return options
}
