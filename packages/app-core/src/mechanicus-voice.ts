/**
 * Deterministic Mechanicus flavor for error copy: never alters the literal message
 * or links. NEXT_PUBLIC_ERROR_VOICE sets intensity, capped at 'medium' for high/critical.
 */

export type VoiceIntensity = 'off' | 'light' | 'medium' | 'heavy'
export type VoiceCategory =
  'auth' | 'database' | 'api' | 'validation' | 'encryption' | 'ui' | 'network'
export type VoiceSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface MechanicusVoiceInput {
  message: string
  code?: string
  category?: VoiceCategory
  severity?: VoiceSeverity
  intensity?: VoiceIntensity
}

const PREFIX_BANK: Record<VoiceCategory | 'default', readonly string[]> = {
  auth: [
    'Rite of authentication rejected',
    'Sigil unrecognised',
    'Communion-rite lapsed'
  ],
  database: [
    'Data-vault unreachable',
    'Archive-spirit silent',
    'Cogitator fault'
  ],
  api: [
    'Rite of binding failed',
    'Servo-link fault',
    'Machine Spirit displeased'
  ],
  validation: [
    'Offering malformed',
    'Identifier unsanctified',
    'Data-glyph rejected'
  ],
  encryption: ['Cipher-seal broken', 'Crypto-rite failed'],
  ui: ['Cogitator protests', 'Display-rite faltered'],
  network: [
    'Noospheric link severed',
    'Vox-channel disrupted',
    'Data-tether strained'
  ],
  default: [
    'Machine Spirit displeased',
    'Cogitator fault',
    'Tech-rite interrupted'
  ]
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function pickPrefix(category: VoiceCategory | undefined, seed: string): string {
  const bank = PREFIX_BANK[category ?? 'default'] ?? PREFIX_BANK.default
  return bank[hashString(seed) % bank.length]!
}

function isIntensity(v: unknown): v is VoiceIntensity {
  return v === 'off' || v === 'light' || v === 'medium' || v === 'heavy'
}

export function resolveVoiceIntensity(
  severity?: VoiceSeverity,
  override?: VoiceIntensity
): VoiceIntensity {
  // Direct member access so the build inlines it.
  const envValue =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_ERROR_VOICE
      : undefined
  const chosen: VoiceIntensity =
    override ?? (isIntensity(envValue) ? envValue : 'medium')
  if ((severity === 'high' || severity === 'critical') && chosen === 'heavy') {
    return 'medium'
  }
  return chosen
}

/** The original `message` is always present, unmodified, in the result. */
export function applyMechanicusVoice(input: MechanicusVoiceInput): string {
  const { message, code, category, severity, intensity } = input
  // Loosely typed non-strings (e.g. an `unknown` toast description) pass through.
  if (!message || typeof message !== 'string') return message

  const level = resolveVoiceIntensity(severity, intensity)
  if (level === 'off' || level === 'light') return message

  // Never double-prefix already themed text (e.g. a re-themed toast body).
  if (message.startsWith('++ ')) return message

  const prefix = pickPrefix(category, code || category || message)
  if (level === 'medium') {
    return `++ ${prefix} ++ ${message}`
  }
  // Heavy adds a closing benediction; ensure terminal punctuation first.
  const ending = /[.!?:]$/.test(message) ? '' : '.'
  return `++ ${prefix.toUpperCase()} ++ ${message}${ending} Praise the Omnissiah.`
}

/** Connective before the `[#Bug Reports](url)` link; the caller appends the link. */
export function mechanicusReportLead(
  severity?: VoiceSeverity,
  intensity?: VoiceIntensity
): string {
  const level = resolveVoiceIntensity(severity, intensity)
  switch (level) {
    case 'off':
    case 'light':
      return 'Report in'
    case 'heavy':
      return 'Summon the Tech-Priests in'
    case 'medium':
    default:
      return 'Transmit the fault-glyph to the Tech-Priests in'
  }
}
