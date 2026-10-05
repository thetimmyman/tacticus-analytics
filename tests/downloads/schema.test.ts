import { describe, expect, it } from 'vitest'
import example from '../../apps/releases/example.manifest.v1.json'
import { releaseManifestSchema } from '../../app/lib/downloads/schema'

describe('release manifest v1 structural contract', () => {
  it('accepts the visibly synthetic versioned envelope without asserting qualification', () => {
    const parsed = releaseManifestSchema.parse(example)
    expect(parsed.purpose).toBe('fixture')
    expect(parsed.payload.releases).toEqual([])
  })

  it('rejects unknown fields at the envelope and payload boundaries', () => {
    expect(
      releaseManifestSchema.safeParse({ ...example, trusted: true }).success
    ).toBe(false)
    expect(
      releaseManifestSchema.safeParse({
        ...example,
        payload: { ...example.payload, approved: true }
      }).success
    ).toBe(false)
  })

  it('rejects unsupported versions and malformed signatures', () => {
    expect(
      releaseManifestSchema.safeParse({ ...example, schemaVersion: 2 }).success
    ).toBe(false)
    expect(
      releaseManifestSchema.safeParse({ ...example, signature: 'verified' })
        .success
    ).toBe(false)
  })
})
