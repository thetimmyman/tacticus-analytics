export function startupMessage(code) {
  if (code === 'ETRANSFER')
    return 'Workspace transfer failed. Your original workspace was preserved. Any partial new backup or restored copy was retained for diagnosis.'
  const messages = {
    EDISPLAY:
      'Open Tacticus Analytics from a graphical desktop session. A Wayland or X11 display is required on Linux. Your workspace has not been changed.',
    EEXIST:
      'This workspace is already open or has an unrecognized startup lock. Close its other application window and retry. If the problem continues, preserve the workspace and contact support; do not delete its database or lock files.',
    ENOSPC:
      'There is not enough free space to prepare a database upgrade checkpoint. Free disk space outside this workspace and retry. Your existing database has not been replaced.',
    ESCHEMA:
      'This application cannot safely open the workspace schema or its upgrade checkpoint. Keep the workspace and use the matching application version or a verified checkpoint in a separate workspace. Do not overwrite your current data.',
    EACCES:
      'The application cannot write to its private workspace. Check the folder permissions and available storage, then retry. Keep the existing workspace data.'
  }
  return (
    messages[code] ||
    'The local services could not start. Keep the workspace data and retry. If the problem continues, contact support for recovery help.'
  )
}
