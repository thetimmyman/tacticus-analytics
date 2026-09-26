import { describe, expect, it } from 'vitest'
import { isMalformedEncryptedKey } from '@tacticus/app-core/api-key-validation'

describe('isMalformedEncryptedKey', () => {
  it('returns false for valid two-part ciphertext', () => {
    const valid = 'aabbccddeeff001122334455:ffeeddccbbaa99887766554433221100'
    expect(isMalformedEncryptedKey(valid)).toBe(false)
  })

  it('returns false for valid three-part ciphertext', () => {
    const valid =
      'aabbccddeeff001122334455:00112233445566778899aabb:ffeeddccbbaa99887766554433221100'
    expect(isMalformedEncryptedKey(valid)).toBe(false)
  })

  it('flags promise strings', () => {
    expect(isMalformedEncryptedKey('[object Promise]')).toBe(true)
    expect(isMalformedEncryptedKey('Promise { <pending> }')).toBe(true)
  })

  it('flags values without separators', () => {
    expect(isMalformedEncryptedKey('abcdef')).toBe(true)
  })

  it('flags values with too many segments', () => {
    expect(isMalformedEncryptedKey('aa:bb:cc:dd')).toBe(true)
  })

  it('flags non-hex segments', () => {
    expect(isMalformedEncryptedKey('zzzz:ffff')).toBe(true)
  })

  it('flags segments that are too short', () => {
    expect(isMalformedEncryptedKey('aa:bb')).toBe(true)
  })
})
