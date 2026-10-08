import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '../../..')
test('checked-in native project is deterministic and carries all source/test targets', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'synthetic-ios-project-'))
  try {
    const project = join(root, 'apps/mobile/ios')
    const copy = join(temporary, 'ios')
    await cp(project, copy, { recursive: true })
    const result = spawnSync(
      'python3',
      [join(copy, 'scripts/generate-project.py')],
      { encoding: 'utf8' }
    )
    assert.equal(result.status, 0, result.stderr)
    const current = await readFile(
      join(project, 'TacticusIOS.xcodeproj/project.pbxproj'),
      'utf8'
    )
    assert.equal(
      await readFile(
        join(copy, 'TacticusIOS.xcodeproj/project.pbxproj'),
        'utf8'
      ),
      current
    )
    for (const target of ['TacticusIOS', 'WorkspaceTests', 'WorkspaceUITests'])
      assert.ok(current.includes(`"name" = "${target}"`))
    for (const file of [
      'AppDelegate',
      'Domain',
      'Store',
      'OfficialSource',
      'CredentialVault',
      'PlayerCache',
      'PlayerInspection'
    ])
      assert.ok(current.includes(`Sources/${file}.swift`))
    assert.ok(
      current.includes('"-lsqlite3"') ||
        current.includes('$(inherited) -lsqlite3')
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
test('portable core v1 excludes native security, consent and identity claims', async () => {
  const domain = JSON.parse(
    await readFile(join(root, 'apps/mobile/ios/mobile-domain-v1.json'), 'utf8')
  )
  assert.equal(domain.documentVersion, 'mobile-workspace/v1')
  assert.deepEqual(domain.documentFields, [
    'schemaVersion',
    'mode',
    'player',
    'raids'
  ])
  const serialized = JSON.stringify(domain.playerFields)
  for (const forbidden of [
    'credential',
    'vault',
    'stablePlayerID',
    'guildId',
    'consent'
  ])
    assert.ok(!serialized.includes(forbidden))
})

test('native Player projection uses the complete canonical public schema', async () => {
  const canonical = await readFile(
    join(root, 'packages/workspace-onboarding/player-schema.json'),
    'utf8'
  )
  assert.equal(
    await readFile(
      join(root, 'apps/mobile/ios/Resources/player-schema.json'),
      'utf8'
    ),
    canonical
  )
  const schema = JSON.parse(canonical)
  const fixture = JSON.parse(
    await readFile(
      join(root, 'apps/mobile/ios/Resources/synthetic-player.json'),
      'utf8'
    )
  )
  const { projectCachedPlayer } =
    await import('../../../packages/workspace-onboarding/v1.mjs')
  const projected = projectCachedPlayer({
    player: fixture.player,
    updatedOn: fixture.updatedOn
  })
  assert.deepEqual(projected.apiData, fixture.player)
  assert.ok(schema.definitions.Player.required.includes('inventory'))
  assert.equal(projected.apiData.inventory.items.length, 52)
})
