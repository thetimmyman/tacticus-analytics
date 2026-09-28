import { describe, expect, it } from 'vitest'
import {
  buildWorkerId,
  resolvePodIdentity
} from '@/app/lib/jobs/worker-identity'

describe('resolvePodIdentity', () => {
  it('prefers POD_NAME (downward API) when present', () => {
    const identity = resolvePodIdentity({
      podName: 'workers-batch-7f8c9d-abc12',
      hostnameEnv: 'workers-batch-7f8c9d-abc12',
      osHostname: () => 'fallback-host'
    })
    expect(identity).toBe('workers-batch-7f8c9d-abc12')
  })

  it('falls back to HOSTNAME when POD_NAME is unset', () => {
    const identity = resolvePodIdentity({
      podName: undefined,
      hostnameEnv: 'workers-hooks-9a1b2c-xyz34',
      osHostname: () => 'fallback-host'
    })
    expect(identity).toBe('workers-hooks-9a1b2c-xyz34')
  })

  it('falls back to os.hostname() when both POD_NAME and HOSTNAME are unset', () => {
    const identity = resolvePodIdentity({
      podName: undefined,
      hostnameEnv: undefined,
      osHostname: () => 'kernel-reported-hostname'
    })
    expect(identity).toBe('kernel-reported-hostname')
  })

  it('falls back to "local" when nothing usable is available', () => {
    const identity = resolvePodIdentity({
      podName: undefined,
      hostnameEnv: undefined,
      osHostname: () => ''
    })
    expect(identity).toBe('local')
  })

  // Dockerfile.prod sets HOSTNAME=0.0.0.0 as the bind address; it is not a pod identity.
  it('rejects HOSTNAME=0.0.0.0 (the bind address this repo bakes into the image) and falls through to os.hostname()', () => {
    const identity = resolvePodIdentity({
      podName: undefined,
      hostnameEnv: '0.0.0.0',
      osHostname: () => 'pod-7c9f4d8b5-k2n9x'
    })
    expect(identity).toBe('pod-7c9f4d8b5-k2n9x')
  })

  it('rejects a POD_NAME that is also a bind address and falls through', () => {
    const identity = resolvePodIdentity({
      podName: '0.0.0.0',
      hostnameEnv: 'still-a-real-host',
      osHostname: () => 'kernel-host'
    })
    expect(identity).toBe('still-a-real-host')
  })

  it.each(['0.0.0.0', '::', '[::]', '127.0.0.1', 'localhost', '  0.0.0.0  '])(
    'never trusts bind-address sentinel %s at any precedence level',
    (sentinel) => {
      const identity = resolvePodIdentity({
        podName: sentinel,
        hostnameEnv: sentinel,
        osHostname: () => sentinel
      })
      expect(identity).toBe('local')
    }
  )

  it('trims whitespace from an otherwise-usable candidate', () => {
    const identity = resolvePodIdentity({
      podName: '  pod-with-padding  ',
      hostnameEnv: undefined,
      osHostname: () => 'unused'
    })
    expect(identity).toBe('pod-with-padding')
  })

  it('treats an empty-string candidate as unusable and falls through', () => {
    const identity = resolvePodIdentity({
      podName: '',
      hostnameEnv: '   ',
      osHostname: () => 'kernel-host'
    })
    expect(identity).toBe('kernel-host')
  })
})

describe('buildWorkerId', () => {
  it('appends a short uuid suffix to the resolved identity', () => {
    const workerId = buildWorkerId({
      podName: 'pod-abc',
      uuid: () => '11111111-2222-3333-4444-555555555555'
    })
    expect(workerId).toBe('pod-abc-11111111')
  })

  it('never contains 0.0.0.0, even when every source is poisoned with it', () => {
    const workerId = buildWorkerId({
      podName: '0.0.0.0',
      hostnameEnv: '0.0.0.0',
      osHostname: () => '0.0.0.0',
      uuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    })
    expect(workerId).not.toContain('0.0.0.0')
    expect(workerId).toBe('local-aaaaaaaa')
  })

  it('produces distinct worker ids across pods in the same window (multi-pod acceptance check)', () => {
    // Pod names diverge within the first 12 chars, which the ops query relies on.
    const podA = buildWorkerId({
      podName: 'workers-batch-7f8c9d-abc12',
      uuid: () => '00000000-0000-0000-0000-000000000000'
    })
    const podB = buildWorkerId({
      podName: 'workers-hooks-9a1b2c-xyz34',
      uuid: () => '11111111-1111-1111-1111-111111111111'
    })
    expect(podA).not.toBe(podB)
    expect(podA.slice(0, 12)).not.toBe(podB.slice(0, 12))
  })

  it('reads real POD_NAME/HOSTNAME env vars when no override is supplied', () => {
    const originalPodName = process.env.POD_NAME
    const originalHostname = process.env.HOSTNAME
    try {
      process.env.POD_NAME = 'env-sourced-pod'
      delete process.env.HOSTNAME
      const workerId = buildWorkerId()
      expect(workerId.startsWith('env-sourced-pod-')).toBe(true)
    } finally {
      if (originalPodName === undefined) delete process.env.POD_NAME
      else process.env.POD_NAME = originalPodName
      if (originalHostname === undefined) delete process.env.HOSTNAME
      else process.env.HOSTNAME = originalHostname
    }
  })
})
