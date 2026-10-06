export function localJobScheduler({
  services,
  origin,
  transportKey,
  cronSecret,
  intervalMs = 60000,
  onFailure = () => {}
}) {
  const url = new URL(origin)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    Number(url.port) > 65535 ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    ![transportKey, cronSecret].every(
      (key) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)
    ) ||
    !Number.isInteger(intervalMs) ||
    intervalMs < 1
  )
    throw new Error('Invalid local scheduler configuration')
  let timer,
    active,
    controller,
    stopped = true
  const tick = () => {
    if (stopped || active) return
    const operation = new AbortController()
    controller = operation
    const timeout = setTimeout(() => operation.abort(), 20000)
    timeout.unref()
    active = (async () => {
      await services.psql(
        "SET lock_timeout='3s'; SET statement_timeout='5s'; INSERT INTO public.work_queue(job_type,job_class,payload,dedupe_key) VALUES('refresh-explore-snapshots','hook','{}','desktop-snapshot-refresh'),('refresh-local-achievements','hook','{}','desktop-achievement-refresh'),('export-local-profile-data','hook','{}','desktop-profile-export') ON CONFLICT(dedupe_key) WHERE status IN ('pending','processing') DO NOTHING;"
      )
      operation.signal.throwIfAborted()
      const response = await fetch(`${url.origin}/api/desktop/jobs`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${cronSecret}`,
          'x-desktop-transport': transportKey
        },
        signal: operation.signal
      })
      if (!response.ok)
        throw new Error('Local background refresh did not complete')
    })()
      .catch(() => {
        if (!stopped) {
          try {
            onFailure()
          } catch {}
        }
      })
      .finally(() => {
        clearTimeout(timeout)
        active = undefined
        controller = undefined
      })
  }
  return {
    start() {
      if (!stopped) return false
      stopped = false
      timer = setInterval(tick, intervalMs)
      timer.unref()
      tick()
      return true
    },
    async stop() {
      stopped = true
      clearInterval(timer)
      controller?.abort()
      await active
    }
  }
}
