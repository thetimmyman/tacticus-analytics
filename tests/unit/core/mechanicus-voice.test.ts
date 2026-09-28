/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import {
  applyMechanicusVoice,
  mechanicusReportLead,
  resolveVoiceIntensity
} from '@tacticus/app-core/mechanicus-voice'

describe('applyMechanicusVoice', () => {
  it('preserves the literal message verbatim at every intensity', () => {
    const msg = 'Could not connect to the database.'
    for (const intensity of ['off', 'light', 'medium', 'heavy'] as const) {
      const out = applyMechanicusVoice({ message: msg, code: 'X', intensity })
      expect(out).toContain(msg)
    }
  })

  it('NEVER alters a markdown link (the #Bug Reports breadcrumb survives)', () => {
    const link = '[#Bug Reports](https://discord.com/channels/1/2)'
    const msg = `Failed. Report in ${link}`
    for (const intensity of ['medium', 'heavy'] as const) {
      const out = applyMechanicusVoice({ message: msg, code: 'Y', intensity })
      expect(out).toContain(link)
    }
  })

  it('medium wraps with a ++ prefix ++ and is deterministic by code', () => {
    const a = applyMechanicusVoice({
      message: 'Boom',
      code: 'API_KEY_SAVE_FAILED',
      category: 'api',
      intensity: 'medium'
    })
    const b = applyMechanicusVoice({
      message: 'Boom',
      code: 'API_KEY_SAVE_FAILED',
      category: 'api',
      intensity: 'medium'
    })
    expect(a).toBe(b) // stable across calls — no Math.random
    expect(a.startsWith('++ ')).toBe(true)
    expect(a).toMatch(/\+\+ .+ \+\+ Boom/)
  })

  it('off and light return the message unchanged', () => {
    expect(applyMechanicusVoice({ message: 'Plain', intensity: 'off' })).toBe(
      'Plain'
    )
    expect(applyMechanicusVoice({ message: 'Plain', intensity: 'light' })).toBe(
      'Plain'
    )
  })

  it('severity-caps high/critical to medium (no heavy benediction on serious faults)', () => {
    const lowHeavy = applyMechanicusVoice({
      message: 'X',
      code: 'C',
      severity: 'low',
      intensity: 'heavy'
    })
    expect(lowHeavy).toContain('Praise the Omnissiah')

    for (const severity of ['high', 'critical'] as const) {
      const capped = applyMechanicusVoice({
        message: 'X',
        code: 'C',
        severity,
        intensity: 'heavy'
      })
      expect(capped).not.toContain('Praise the Omnissiah')
      expect(capped.startsWith('++ ')).toBe(true)
    }
  })

  it('returns empty input unchanged (no prefix on empty string)', () => {
    expect(applyMechanicusVoice({ message: '', intensity: 'medium' })).toBe('')
  })
})

describe('resolveVoiceIntensity', () => {
  it('defaults to medium and caps serious faults', () => {
    expect(resolveVoiceIntensity(undefined, undefined)).toBe('medium')
    expect(resolveVoiceIntensity('critical', 'heavy')).toBe('medium')
    expect(resolveVoiceIntensity('low', 'heavy')).toBe('heavy')
    expect(resolveVoiceIntensity('high', 'off')).toBe('off')
  })
})

describe('mechanicusReportLead', () => {
  it('themes the connective but stays a plain prefix (link appended by caller)', () => {
    expect(mechanicusReportLead('medium', 'off')).toBe('Report in')
    expect(mechanicusReportLead('low', 'medium')).toContain('Tech-Priests')
    expect(mechanicusReportLead('critical', 'heavy')).toContain('Tech-Priests') // capped to medium lead
  })
})

describe('applyMechanicusVoice guards (sweep)', () => {
  it('is idempotent — never double-prefixes an already-themed string', () => {
    const once = applyMechanicusVoice({
      message: 'Boom',
      code: 'C',
      intensity: 'medium'
    })
    const twice = applyMechanicusVoice({
      message: once,
      code: 'C',
      intensity: 'medium'
    })
    expect(twice).toBe(once)
    expect((twice.match(/\+\+/g) || []).length).toBe(2) // exactly one ++ … ++ pair
  })

  it('returns non-string input unchanged (no "[object Object]" prefix)', () => {
    const obj = { a: 1 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(
      applyMechanicusVoice({ message: obj as any, intensity: 'medium' })
    ).toBe(obj)
  })

  it('heavy mode adds terminal punctuation before the benediction', () => {
    const out = applyMechanicusVoice({
      message: 'Failed to save',
      code: 'C',
      severity: 'low',
      intensity: 'heavy'
    })
    expect(out).toContain('Failed to save. Praise the Omnissiah.')
    const out2 = applyMechanicusVoice({
      message: 'Failed to save.',
      code: 'C',
      severity: 'low',
      intensity: 'heavy'
    })
    expect(out2).not.toContain('save..')
  })
})
