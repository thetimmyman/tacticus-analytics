import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  qualifiesPhysicalMobile,
  validateEvidence
} from '../../../apps/platform-lab/contracts/validate.mjs'

const script = readFileSync(
  new URL(
    '../../../apps/mobile/android/scripts/measure-installed.sh',
    import.meta.url
  ),
  'utf8'
)
const producer = script.match(/python3 - <<'PY'\n([\s\S]*?)\nPY\n/)[1]
const captures = {
  'all.txt':
    'PASS phase=unlocked checks=3\nPASS phase=airplane checks=2\nPASS phase=all checks=73\n',
  'reopen.txt': 'PASS phase=reopen checks=7\n',
  'locked.txt': 'PASS phase=locked checks=5\n',
  'relaunch.txt': 'Status: ok\nTotalTime: 123\n'
}

for (const dirty of [true, false]) {
  test(`actual Android evidence producer meets shared contract (dirty=${dirty})`, () => {
    const root = mkdtempSync(join(tmpdir(), 'android-evidence-contract-'))
    try {
      const report = join(root, 'report')
      const tools = join(root, 'tools')
      const sdk = join(root, 'sdk')
      for (const directory of [
        report,
        tools,
        join(sdk, 'emulator'),
        join(sdk, 'platform-tools')
      ])
        mkdirSync(directory, { recursive: true })
      for (const [name, data] of Object.entries(captures))
        writeFileSync(join(report, name), data)
      writeFileSync(
        join(report, 'credential-isolation-evidence.json'),
        'stale unsupported record'
      )
      writeFileSync(
        join(sdk, 'emulator/source.properties'),
        'Pkg.Revision=37.2.12\n'
      )
      writeFileSync(
        join(tools, 'java'),
        '#!/bin/sh\nprintf \'openjdk version "17.0.20.1"\\n\' >&2\n',
        { mode: 0o700 }
      )
      writeFileSync(
        join(sdk, 'platform-tools/adb'),
        "#!/bin/sh\nprintf 'Android Debug Bridge version 1.0.41\\nVersion 37.0.1\\n'\n",
        { mode: 0o700 }
      )
      execFileSync('python3', ['-c', producer], {
        env: {
          ...process.env,
          PATH: `${tools}:${process.env.PATH}`,
          ANDROID_HOME: sdk,
          REPORT: report,
          SOURCE_SHA: 'a'.repeat(40),
          APK_SHA: 'b'.repeat(64),
          FIXTURE_SHA: 'c'.repeat(64),
          SOURCE_DIRTY: String(dirty),
          STARTED_AT: '2026-10-06T12:00:00.123Z',
          COMPLETED_AT: '2026-10-06T12:00:01.456Z',
          API: '26',
          ABI: 'x86_64'
        },
        stdio: 'pipe'
      })
      const measurement = JSON.parse(
        readFileSync(join(report, 'measurement.json'), 'utf8')
      )
      assert.equal(measurement.releaseQualified, false)
      assert.deepEqual(measurement.qualificationBlockers, [
        'Physical owner-signed phone/tablet release qualification pending',
        'Full accepted application parity pending',
        'Real authorized upstream checks and live contribution integration pending'
      ])
      for (const scenario of ['offline-core', 'restart-persistence']) {
        const evidence = JSON.parse(
          readFileSync(join(report, `${scenario}-evidence.json`), 'utf8')
        )
        validateEvidence(evidence)
        assert.equal(
          evidence.evidenceKind,
          dirty ? 'harness-self-test' : 'product-acceptance'
        )
        assert.equal(qualifiesPhysicalMobile(evidence), false)
        assert.equal(evidence.fixture.sha256, 'c'.repeat(64))
        assert.equal(evidence.startedAt, '2026-10-06T12:00:00.123Z')
        assert.equal(evidence.completedAt, '2026-10-06T12:00:01.456Z')
        assert.deepEqual(
          evidence.attachments
            .map(({ name, mediaType }) => ({ name, mediaType }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          [
            ...Object.keys(captures).map((name) => ({
              name,
              mediaType: 'text/plain'
            })),
            { name: 'measurement.json', mediaType: 'application/json' }
          ].sort((a, b) => a.name.localeCompare(b.name))
        )
        for (const attachment of evidence.attachments)
          assert.equal(
            attachment.sha256,
            createHash('sha256')
              .update(readFileSync(join(report, attachment.name)))
              .digest('hex')
          )
        if (scenario === 'offline-core')
          assert.equal(
            evidence.assertions.find(
              (row) => row.id === 'installed-credential-isolation'
            ).actual,
            captures['locked.txt'].trim()
          )
      }
      assert.throws(
        () => readFileSync(join(report, 'credential-isolation-evidence.json')),
        /ENOENT/
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
