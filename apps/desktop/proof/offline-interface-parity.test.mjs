import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  sanitizeDisplayText,
  projectCachedPlayerFeatures,
  verifyDesktopAssetEnvironment
} from '../launcher/offline-interface-parity.mjs'

describe('Offline Interface Parity, Asset Integrity, and Display Sanitization Suite', () => {
  describe('Hostile Display Sanitization (XSS Prevention)', () => {
    test('sanitizes common script and HTML injection vectors', () => {
      const maliciousPayload = '<script>alert("pwned")</script>'
      const sanitized = sanitizeDisplayText(maliciousPayload)
      assert.equal(
        sanitized,
        '&lt;script&gt;alert(&quot;pwned&quot;)&lt;&#x2F;script&gt;'
      )
      assert.equal(sanitized.includes('<script>'), false)
    })

    test('rejects control characters, null bytes, and non-printable sequences', () => {
      assert.throws(
        () => sanitizeDisplayText('Injected\u0000NullByte'),
        /control characters are forbidden/
      )
      assert.throws(
        () => sanitizeDisplayText('LineBreak\nBreak'),
        /control characters are forbidden/
      )
      assert.throws(
        () => sanitizeDisplayText('CarriageReturn\rReturn'),
        /control characters are forbidden/
      )
    })

    test('enforces length boundaries and whitespace restrictions', () => {
      // Empty input
      assert.throws(() => sanitizeDisplayText(''), /must be between 1 and/)
      assert.throws(() => sanitizeDisplayText('   '), /must be between 1 and/)

      // Oversized input
      const oversized = 'A'.repeat(129)
      assert.throws(
        () => sanitizeDisplayText(oversized, { maxLength: 128 }),
        /must be between 1 and/
      )

      // Disallow spaces where required
      assert.throws(
        () => sanitizeDisplayText('has space', { allowSpaces: false }),
        /Whitespace is forbidden/
      )

      // Valid bounded identifier
      const valid = sanitizeDisplayText('clean_identifier_01', {
        allowSpaces: false
      })
      assert.equal(valid, 'clean_identifier_01')
    })
  })

  describe('Offline Cached Player Feature Projection', () => {
    test('projects full player profile, units, inventory, and calculated metrics 100% offline', () => {
      const rawApiData = {
        player: {
          details: {
            name: 'High Marshal Helbrecht',
            powerLevel: 45000
          }
        },
        units: [
          {
            id: 'unit_helbrecht',
            name: 'Helbrecht',
            rank: 11,
            rarity: 'Legendary',
            power: 25000,
            xpLevel: 45,
            shards: 120
          },
          {
            id: 'unit_bellator',
            name: 'Bellator',
            rank: 9,
            rarity: 'Epic',
            power: 18000,
            xpLevel: 38,
            shards: 45
          }
        ],
        inventory: {
          upgrades: [
            { id: 'upgrade_chainsword', name: 'Heavy Chainsword', amount: 15 }
          ],
          shards: [{ id: 'shard_calgar', name: 'Calgar Shards', amount: 80 }],
          orbs: [
            {
              id: 'orb_imperial_legendary',
              name: 'Imperial Legendary Orb',
              amount: 10
            }
          ]
        }
      }

      const projected = projectCachedPlayerFeatures(rawApiData)

      assert.equal(projected.playerName, 'High Marshal Helbrecht')
      assert.equal(projected.totalUnits, 2)
      assert.equal(projected.maxRank, 11)
      assert.equal(projected.powerLevel, 45000)

      // Check unit mapping
      assert.equal(projected.units.length, 2)
      assert.equal(projected.units[0].id, 'unit_helbrecht')
      assert.equal(projected.units[0].rank, 11)

      // Check inventory categorisation
      assert.equal(projected.inventory.length, 3)
      assert.equal(projected.inventory[0].category, 'Upgrades')
      assert.equal(projected.inventory[0].amount, 15)
      assert.equal(projected.inventory[1].category, 'Character Shards')
      assert.equal(projected.inventory[2].category, 'Ascension Orbs')

      assert.ok(projected.cachedAt)
    })

    test('safely handles missing optional fields and sanitizes malicious unit/player names', () => {
      const rawWithMalicious = {
        player: {
          details: {
            name: '<img src=x onerror=alert(1)>'
          }
        },
        units: [
          { id: 'unit_injected', name: '<script>evil()</script>', rank: -5 }
        ]
      }

      const projected = projectCachedPlayerFeatures(rawWithMalicious)

      // Name is escaped
      assert.equal(projected.playerName, '&lt;img src=x onerror=alert(1)&gt;')
      assert.equal(
        projected.units[0].name,
        '&lt;script&gt;evil()&lt;&#x2F;script&gt;'
      )
      // Negative rank clamped to minimum 1
      assert.equal(projected.units[0].rank, 1)
      // Inventory is empty array
      assert.deepEqual(projected.inventory, [])
    })
  })

  describe('Desktop Asset and Environment Verification', () => {
    test('passes compliant offline desktop environment configuration', () => {
      const cleanConfig = {
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop',
        PORT: '3000',
        HOSTNAME: '127.0.0.1'
      }

      const cleanHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="stylesheet" href="asset://localhost/styles/main.css">
          </head>
          <body>
            <div id="__next">Offline App Content</div>
          </body>
        </html>
      `

      const result = verifyDesktopAssetEnvironment({
        config: cleanConfig,
        htmlContent: cleanHtml
      })
      assert.equal(result.isCompliant, true)
      assert.equal(result.violations.length, 0)
    })

    test('flags missing telemetry disable flags and external CDN domains', () => {
      const badConfig = {
        NEXT_TELEMETRY_DISABLED: '0', // Violation
        NEXT_PUBLIC_RUNTIME_PROFILE: 'web' // Violation
      }

      const htmlWithCdn = `
        <html>
          <head>
            <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/react.min.js"></script>
          </head>
        </html>
      `

      const result = verifyDesktopAssetEnvironment({
        config: badConfig,
        htmlContent: htmlWithCdn
      })
      assert.equal(result.isCompliant, false)
      assert.ok(
        result.violations.some((v) => v.includes('NEXT_TELEMETRY_DISABLED'))
      )
      assert.ok(
        result.violations.some((v) => v.includes('NEXT_PUBLIC_RUNTIME_PROFILE'))
      )
      assert.ok(
        result.violations.some((v) => v.includes('fonts.googleapis.com'))
      )
      assert.ok(
        result.violations.some((v) => v.includes('cdnjs.cloudflare.com'))
      )
    })

    test('flags baked production secret tokens in environment configuration', () => {
      const configWithSecret = {
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop',
        PROD_API_KEY: 'sbp_live_secret_production_key_123456789'
      }

      const result = verifyDesktopAssetEnvironment({
        config: configWithSecret,
        htmlContent: ''
      })
      assert.equal(result.isCompliant, false)
      assert.ok(
        result.violations.some((v) => v.includes('Baked production secret'))
      )
    })
  })
})
