export function electronDisplay(
  platform = process.platform,
  env = process.env
) {
  if (platform === 'darwin' || platform === 'win32')
    return { args: [], environment: {} }
  if (platform !== 'linux')
    throw new Error('Unsupported desktop operating system')
  if (env.WAYLAND_DISPLAY && env.XDG_RUNTIME_DIR)
    return {
      args: ['--ozone-platform=wayland'],
      environment: {
        XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR,
        WAYLAND_DISPLAY: env.WAYLAND_DISPLAY
      }
    }
  if (env.DISPLAY)
    return {
      args: ['--ozone-platform=x11'],
      environment: {
        DISPLAY: env.DISPLAY,
        XAUTHORITY: env.XAUTHORITY,
        XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR
      }
    }
  throw Object.assign(new Error('A graphical desktop session is required'), {
    code: 'EDISPLAY'
  })
}
