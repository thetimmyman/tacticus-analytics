// Handlers register in register-{hooks,batch}-handlers.ts, imported for side effects (no dynamic require).

import type { JobHandler } from './types'

const registry = new Map<string, JobHandler>()

export function registerJobHandler(jobType: string, handler: JobHandler): void {
  if (registry.has(jobType)) {
    throw new Error(
      `[work_queue] Duplicate handler registration for job_type=${jobType}`
    )
  }
  registry.set(jobType, handler)
}

export function getJobHandler(jobType: string): JobHandler | undefined {
  return registry.get(jobType)
}

export function listRegisteredJobTypes(): string[] {
  return Array.from(registry.keys()).sort()
}
