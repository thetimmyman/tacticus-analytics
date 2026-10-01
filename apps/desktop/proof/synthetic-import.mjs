import { randomUUID } from 'node:crypto'

/** Fixture-only import. This is not a game capture or general public import API. */
export function syntheticRaidFixture(subject) {
  if (!/^[a-f0-9-]{36}$/.test(subject))
    throw new Error('Invalid synthetic Auth subject')
  const cluster = randomUUID(),
    otherCluster = randomUUID(),
    attestation = randomUUID()
  const rows = [
    [1, 'SYN001', 'synthetic-player-a', 'SyntheticPlayer-A', 100, 900],
    [2, 'SYN001', 'synthetic-player-a', 'SyntheticPlayer-A', 200, 800],
    [3, 'SYN001', 'synthetic-player-a', 'SyntheticPlayer-A', 175, 0],
    [4, 'SYN001', 'synthetic-player-a', 'SyntheticPlayer-A', 50, 0],
    [5, 'SYN001', 'synthetic-player-b', 'SyntheticPlayer-B', 25, 975],
    [6, 'SYN001', 'synthetic-player-b', 'SyntheticPlayer-B', 75, 925],
    [7, 'SYN002', 'synthetic-player-c', 'SyntheticPlayer-C', 225, 775],
    [8, 'SYN003', 'synthetic-player-d', 'SyntheticPlayer-D', 500, 500]
  ].map(([id, Guild, userId, displayName, damageDealt, remainingHp]) => ({
    id,
    Guild,
    userId,
    displayName,
    damageDealt,
    remainingHp,
    Season: '9999',
    Name: 'SyntheticBoss',
    damageType: 'Battle',
    maxHp: 1000,
    encounterId: 0,
    rarity: 'Legendary',
    set: 0,
    tier: 4,
    startedOn: '2000-01-01T00:00:00Z',
    cluster_code: Guild === 'SYN003' ? 'SYN-OTHER' : 'SYN-CLUSTER',
    cluster_id: Guild === 'SYN003' ? otherCluster : cluster
  }))
  return {
    format: 'synthetic-local-raid-v1',
    subject,
    cluster,
    otherCluster,
    attestation,
    rows
  }
}
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`
export async function importSyntheticRaid(services, fixture) {
  if (
    fixture.format !== 'synthetic-local-raid-v1' ||
    JSON.stringify(fixture).length > 65536 ||
    !Array.isArray(fixture.rows) ||
    fixture.rows.length !== 8
  )
    throw new Error('Invalid synthetic fixture envelope')
  const expected = syntheticRaidFixture(fixture.subject)
  for (let i = 0; i < fixture.rows.length; i++) {
    const row = fixture.rows[i],
      reference = expected.rows[i]
    if (
      JSON.stringify(Object.keys(row).sort()) !==
      JSON.stringify(Object.keys(reference).sort())
    )
      throw new Error('Unexpected synthetic fields')
    for (const key of Object.keys(reference)) {
      if (key === 'cluster_id') continue
      if (row[key] !== reference[key]) throw new Error('Invalid synthetic row')
    }
    if (
      row.cluster_id !==
      (row.Guild === 'SYN003' ? fixture.otherCluster : fixture.cluster)
    )
      throw new Error('Invalid synthetic cluster')
  }
  for (const key of ['subject', 'cluster', 'otherCluster', 'attestation'])
    if (!/^[a-f0-9-]{36}$/.test(fixture[key]))
      throw new Error('Invalid fixture identity')
  const columns = Object.keys(expected.rows[0])
    .map((key) => `"${key}"`)
    .join(',')
  await services.psql(`BEGIN;
    INSERT INTO public.guild_config(id,guild_code,display_name,enabled,cluster_code,cluster_id,auto_sync_enabled)
    VALUES(1,'SYN001','Synthetic Guild A',true,'SYN-CLUSTER',${sqlString(fixture.cluster)},false),(2,'SYN002','Synthetic Guild B',true,'SYN-CLUSTER',${sqlString(fixture.cluster)},false),(3,'SYN003','Synthetic Guild Other',true,'SYN-OTHER',${sqlString(fixture.otherCluster)},false);
    INSERT INTO public.player_mapping(id,player_id,display_name,guild_code,user_id,is_current,is_active,cluster_code,cluster_id)
    VALUES(1,'synthetic-player-a','SyntheticPlayer-A','SYN001',${sqlString(fixture.subject)},true,true,'SYN-CLUSTER',${sqlString(fixture.cluster)}),(2,'synthetic-player-b','SyntheticPlayer-B','SYN001',null,true,true,'SYN-CLUSTER',${sqlString(fixture.cluster)}),(3,'synthetic-player-c','SyntheticPlayer-C','SYN002',null,true,true,'SYN-CLUSTER',${sqlString(fixture.cluster)}),(4,'synthetic-player-d','SyntheticPlayer-D','SYN003',null,true,true,'SYN-OTHER',${sqlString(fixture.otherCluster)});
    INSERT INTO public.player_identity_attestations(id,mapping_id,player_id,subject_user_id,source,consumed_at,attested_at)
    VALUES(${sqlString(fixture.attestation)},1,'synthetic-player-a',${sqlString(fixture.subject)},'operator_quarantine_restore','2000-01-01T00:00:00Z','2000-01-01T00:00:00Z');
    UPDATE public.player_mapping SET ownership_attestation_id=${sqlString(fixture.attestation)} WHERE id=1;
    INSERT INTO public."EOT_GR_data" (${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::public."EOT_GR_data",${sqlString(JSON.stringify(fixture.rows))}::jsonb);
    COMMIT;`)
}
