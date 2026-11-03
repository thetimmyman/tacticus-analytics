import { createHash } from 'node:crypto'

/**
 * Offline Interface, Asset Validation, and Player Feature Projection
 *
 * Provides:
 * 1. Sanitization of hostile player, guild, and inventory display data (XSS prevention)
 * 2. Complete offline cached player projection (units, upgrades, badges, progression)
 * 3. Asset and route integrity verification ensuring zero remote CDN/telemetry leakage
 */

export function sanitizeDisplayText(
  rawInput,
  { maxLength = 128, allowSpaces = true } = {}
) {
  if (typeof rawInput !== 'string') {
    throw new Error('Display input must be a string')
  }

  // Reject control characters, null bytes, and non-printable sequences
  if (/[\u0000-\u001f\u007f-\u009f]/.test(rawInput)) {
    throw new Error('Hostile input detected: control characters are forbidden')
  }

  // Trim and enforce length bound
  const trimmed = rawInput.trim()
  if (!trimmed.length || trimmed.length > maxLength) {
    throw new Error(
      `Display text must be between 1 and ${maxLength} characters`
    )
  }

  if (!allowSpaces && /\s/.test(trimmed)) {
    throw new Error('Whitespace is forbidden in this identifier')
  }

  // HTML entity encoding to prevent XSS in webview renderer
  const sanitized = trimmed
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;')
    .replaceAll('/', '&#x2F;')

  return sanitized
}

export function projectCachedPlayerFeatures(apiData) {
  if (!apiData || typeof apiData !== 'object') {
    throw new Error('Invalid player data payload')
  }

  const { player = {}, inventory = {}, progress = {} } = apiData
  const details = player.details || {}

  // Sanitize player display metadata
  const playerName = sanitizeDisplayText(details.name || 'Unnamed Commander', {
    maxLength: 64
  })
  const powerLevel =
    Number.isSafeInteger(details.powerLevel) && details.powerLevel >= 0
      ? details.powerLevel
      : 0

  // Project character units
  const units = Array.isArray(apiData.units)
    ? apiData.units
    : Array.isArray(player.units)
      ? player.units
      : []
  const projectedUnits = units.map((u) => {
    return {
      id: sanitizeDisplayText(u.id || u.unitId || 'unknown-unit', {
        maxLength: 64,
        allowSpaces: false
      }),
      name: sanitizeDisplayText(u.name || u.id || 'Unit', { maxLength: 64 }),
      rank: Number.isSafeInteger(u.rank) && u.rank >= 1 ? u.rank : 1,
      rarity: sanitizeDisplayText(u.rarity || 'Common', { maxLength: 32 }),
      power: Number.isSafeInteger(u.power) && u.power >= 0 ? u.power : 0,
      xpLevel:
        Number.isSafeInteger(u.xpLevel) && u.xpLevel >= 1 ? u.xpLevel : 1,
      shards: Number.isSafeInteger(u.shards) ? u.shards : 0
    }
  })

  // Categorize inventory entries
  const categorizedInventory = []
  const categories = [
    ['upgrades', 'Upgrades'],
    ['shards', 'Character Shards'],
    ['orbs', 'Ascension Orbs'],
    ['abilityBadges', 'Ability Badges'],
    ['xpBooks', 'XP Books']
  ]

  for (const [key, label] of categories) {
    const items = Array.isArray(inventory[key]) ? inventory[key] : []
    for (const item of items) {
      categorizedInventory.push({
        category: label,
        id: sanitizeDisplayText(item.id || 'item', {
          maxLength: 64,
          allowSpaces: false
        }),
        name: sanitizeDisplayText(item.name || item.id || label, {
          maxLength: 64
        }),
        amount:
          Number.isSafeInteger(item.amount) && item.amount >= 0
            ? item.amount
            : 0
      })
    }
  }

  // Calculate high-level summary metrics
  const totalUnits = projectedUnits.length
  const totalPower = projectedUnits.reduce((acc, u) => acc + u.power, 0)
  const maxRank = projectedUnits.reduce((max, u) => Math.max(max, u.rank), 0)

  return {
    playerName,
    powerLevel: Math.max(powerLevel, totalPower),
    totalUnits,
    maxRank,
    units: projectedUnits,
    inventory: categorizedInventory,
    cachedAt: new Date().toISOString()
  }
}

export function verifyDesktopAssetEnvironment({
  config = {},
  htmlContent = ''
}) {
  const violations = []

  // 1. Assert telemetry is disabled
  if (config.NEXT_TELEMETRY_DISABLED !== '1') {
    violations.push('NEXT_TELEMETRY_DISABLED must be explicitly set to 1')
  }

  // 2. Assert runtime profile is desktop
  if (config.NEXT_PUBLIC_RUNTIME_PROFILE !== 'desktop') {
    violations.push('NEXT_PUBLIC_RUNTIME_PROFILE must be set to desktop')
  }

  // 3. Assert no external CDN URLs or Google Fonts in HTML
  const forbiddenDomains = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'google-analytics.com',
    'telemetry'
  ]

  for (const domain of forbiddenDomains) {
    if (htmlContent.includes(domain)) {
      violations.push(
        `Forbidden external asset/telemetry domain found: ${domain}`
      )
    }
  }

  // 4. Assert no raw production API keys baked into config
  for (const [key, val] of Object.entries(config)) {
    if (
      typeof val === 'string' &&
      (val.startsWith('sbp_') || (val.startsWith('eyJh') && val.length > 100))
    ) {
      violations.push(`Baked production secret detected in config key: ${key}`)
    }
  }

  return {
    isCompliant: violations.length === 0,
    violations
  }
}
