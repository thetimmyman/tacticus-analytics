import { beforeEach, afterEach, vi } from 'vitest'

// Restoring every spy globally also wiped unit specs' module-level spies, so the
// reset is limited to the integration specs that rely on it.
function isIntegrationSpec(context: {
  task?: { file?: { filepath?: string } }
}) {
  return (context?.task?.file?.filepath ?? '').includes('/tests/integration/')
}

beforeEach((context) => {
  if (isIntegrationSpec(context)) vi.restoreAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})
