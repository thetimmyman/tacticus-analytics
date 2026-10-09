import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { nativeServices } from './native-services.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'

// Fixture SQL sets up synthetic authority. All assignment assertions cross the
// actual signed Auth/PostgREST interface, never a mocked authorization helper.
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const password = randomBytes(24).toString('hex')
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
let services, listener, token, subject
let stage = 'startup'
const checks = []
const check = (name) => checks.push({ name, passed: true })
const rest = (
  path,
  body,
  method = body === undefined ? 'GET' : 'POST',
  bearer = token
) =>
  fetch(`http://127.0.0.1:${services.ports.rest}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      Prefer: 'return=representation'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
const expectStatus = async (response, expected) => {
  assert.equal(
    response.status,
    expected,
    `Expected fixed HTTP ${expected}, observed ${response.status}`
  )
  return response.json()
}
async function login() {
  const account = await expectStatus(
    await fetch(
      `http://127.0.0.1:${services.ports.auth}/token?grant_type=password`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'desktop@localhost.invalid', password })
      }
    ),
    200
  )
  if (subject) assert.equal(account.user.id, subject)
  token = account.access_token
  subject = account.user.id
}
try {
  services = await nativeServices({
    ...config,
    schemaDirectory: config.previousSchemaDirectory || config.schemaDirectory
  })
  const handler = workspaceSetup(
    services,
    new URL('../launcher/', import.meta.url).pathname
  )
  listener = createServer((req, res) => {
    void handler(req, res, new URL(req.url, 'http://127.0.0.1')).catch(() => {
      res.statusCode = 500
      res.end()
    })
  })
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${listener.address().port}`
  await expectStatus(
    await fetch(origin + '/desktop/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ password, sample: true })
    }),
    201
  )
  await new Promise((resolve) => listener.close(resolve))
  listener = undefined
  await login()
  if (config.previousSchemaDirectory) {
    await expectStatus(
      await rest('rpc/desktop_clear_saved_assignments', {
        p_season_number: '9999'
      }),
      404
    )
    await services.stop()
    services = undefined
    services = await nativeServices(config)
    assert.equal(services.fresh, false)
    await login()
    check(
      'Actual prior-schema workspace upgrades without replacing its Auth identity or imported state'
    )
  }
  await services.psql(
    `UPDATE public.player_mapping SET role='officer' WHERE user_id=${quote(subject)} AND is_current;`
  )
  const own = JSON.parse(
    (
      await services.psql(
        `SELECT row_to_json(p) FROM (SELECT player_id,guild_code,discord_user_id FROM public.player_mapping WHERE user_id=${quote(subject)} AND is_current) p;`
      )
    ).trim()
  )
  const replacement = {
    p_season_number: '9999',
    p_bosses: [{ level: 'L1', boss_name: 'riptide', sub_bosses: {} }],
    p_assignments: [{ player_id: own.player_id, token_allocations: { L1: 1 } }]
  }
  assert.deepEqual(
    await expectStatus(
      await rest('rpc/desktop_replace_saved_assignments', replacement),
      200
    ),
    { assignedCount: 1, totalPlayers: 1, totalTokens: 1 }
  )
  check(
    'Signed lowercase officer saves one selected-season assignment through the local wrapper'
  )
  stage = 'paired-read'
  const paired = () =>
    rest('rpc/desktop_get_saved_assignments', { p_season_number: '9999' })
  const initialPair = await expectStatus(await paired(), 200)
  assert.equal(initialPair.assignments.length, 1)
  assert.equal(initialPair.bosses.length, 1)
  assert.deepEqual(Object.keys(initialPair).sort(), ['assignments', 'bosses'])
  assert.equal('guild_code' in initialPair.assignments[0], false)
  assert.equal('assigned_by' in initialPair.assignments[0], false)
  assert.equal('selected_by' in initialPair.bosses[0], false)
  const selected =
    'upcoming_season_assignments?season_number=eq.9999&order=player_id'
  const bosses = 'upcoming_season_bosses?season_number=eq.9999&order=level'
  const stored = async () => ({
    assignments: await expectStatus(await rest(selected), 200),
    bosses: await expectStatus(await rest(bosses), 200)
  })
  const save = (value = replacement, bearer = token) =>
    rest('rpc/desktop_replace_saved_assignments', value, 'POST', bearer)
  const role = (value) =>
    services.psql(
      `UPDATE public.player_mapping SET role=${quote(value)},is_active=true,is_current=true WHERE user_id=${quote(subject)};`
    )
  stage = 'empty-prime-choice'
  const blankPrimes = {
    ...replacement,
    p_bosses: [
      {
        ...replacement.p_bosses[0],
        sub_bosses: { sub1: '', sub2: '', sub1_skip: false, sub2_skip: false }
      }
    ]
  }
  await expectStatus(await save(blankPrimes), 200)
  await expectStatus(await save(), 200)
  const secondPlayer = 'SYN' + 'Q'.repeat(253)
  const boundaryPlayers = [128, 129].map(
    (length) => 'SYN' + 'B'.repeat(length - 3)
  )
  stage = 'replacement-fixtures'
  await services.psql(`INSERT INTO public.player_mapping(id,player_id,display_name,guild_code,is_current,is_active) SELECT max(id)+1,${quote(secondPlayer)},'Synthetic duplicate label',${quote(own.guild_code)},true,true FROM public.player_mapping;
    UPDATE public.player_mapping SET display_name='Synthetic duplicate label',primary_boss='Synthetic preserved mapping',secondary_boss='Synthetic preserved secondary' WHERE user_id=${quote(subject)};
    INSERT INTO public.upcoming_season_assignments(guild_code,season_number,player_id,display_name,total_tokens_allocated) VALUES(${quote(own.guild_code)},'9998','SYNOTHER','Synthetic other season',7);
    INSERT INTO public.upcoming_season_bosses(guild_code,season_number,level,boss_name,sub_bosses) VALUES(${quote(own.guild_code)},'9998','L1','Synthetic preserved boss','{}');`)
  for (const playerId of boundaryPlayers)
    await services.psql(
      `INSERT INTO public.player_mapping(id,player_id,display_name,guild_code,is_current,is_active) SELECT max(id)+1,${quote(playerId)},'Synthetic boundary player',${quote(own.guild_code)},true,true FROM public.player_mapping;`
    )
  await services.psql(`INSERT INTO public.guild_config(id,guild_code,display_name,enabled,cluster_code) SELECT (SELECT coalesce(max(id),0)+1 FROM public.guild_config),'SYNFOREIGN','Synthetic foreign guild',true,cluster_code FROM public.guild_config WHERE guild_code=${quote(own.guild_code)};
    INSERT INTO public.player_mapping(id,player_id,display_name,guild_code,is_current,is_active) SELECT max(id)+1,'SYNFOREIGNPLAYER','Synthetic foreign roster','SYNFOREIGN',true,true FROM public.player_mapping;
    INSERT INTO public.upcoming_season_assignments(guild_code,season_number,player_id,display_name) VALUES('SYNFOREIGN','9999','SYNFOREIGNPLAYER','Synthetic foreign roster');
    INSERT INTO public.upcoming_season_bosses(guild_code,season_number,level,boss_name) VALUES('SYNFOREIGN','9999','L1','Synthetic foreign boss');`)
  const domain = async () =>
    (
      await services.psql(`SELECT jsonb_build_object(
    'mapping',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.player_mapping p),
    'otherAssignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.upcoming_season_assignments a WHERE season_number<>'9999' OR guild_code<>${quote(own.guild_code)}),
    'otherBosses',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.upcoming_season_bosses b WHERE season_number<>'9999' OR guild_code<>${quote(own.guild_code)}),
    'history',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public."EOT_GR_data" e),
    'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.guild_raid_season_plans p),
    'targets',(SELECT jsonb_agg(to_jsonb(t) ORDER BY guild_code,boss_name,rarity,set,encounter_id,season_number) FROM public.boss_target_tokens t),
    'config',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.guild_config g)
  );`)
    ).trim()
  const preservedDomain = await domain()
  stage = 'replacement'
  for (const playerId of boundaryPlayers)
    assert.deepEqual(
      await expectStatus(
        await save({
          ...replacement,
          p_assignments: [{ player_id: playerId, token_allocations: { L1: 1 } }]
        }),
        200
      ),
      { assignedCount: 1, totalPlayers: 1, totalTokens: 1 }
    )
  const two = {
    ...replacement,
    p_bosses: [
      {
        level: 'L1',
        boss_name: 'riptide',
        sub_bosses: { sub1: 'Synthetic prime', sub1_skip: false }
      },
      { level: 'L2', boss_name: 'Synthetic second boss', sub_bosses: {} }
    ],
    p_assignments: [
      { player_id: own.player_id, token_allocations: { L1: 1 } },
      { player_id: secondPlayer, token_allocations: { L2: 2 } }
    ]
  }
  assert.deepEqual(await expectStatus(await save(two), 200), {
    assignedCount: 2,
    totalPlayers: 2,
    totalTokens: 3
  })
  const both = await stored()
  assert.equal(both.assignments.length, 2)
  assert.deepEqual(
    both.assignments.map((row) => row.total_tokens_allocated).sort(),
    [1, 2]
  )
  assert(
    both.assignments.every(
      (row) =>
        row.display_name === 'Synthetic duplicate label' &&
        row.assigned_by === subject &&
        row.primary_boss === null &&
        row.secondary_boss === null &&
        row.uses_flexible_tokens === true
    )
  )
  await expectStatus(await save(), 200)
  const replaced = await stored()
  assert.equal(replaced.assignments.length, 1)
  assert.equal(replaced.bosses.length, 1)
  assert.deepEqual(replaced.bosses[0].sub_bosses, {})
  assert.equal(await domain(), preservedDomain)
  check(
    'Replacement removes omitted players, stages and prime keys without merging duplicate labels or changing other domain state'
  )
  assert.deepEqual(
    await expectStatus(
      await save({
        ...replacement,
        p_bosses: [two.p_bosses[0]],
        p_assignments: [
          { player_id: own.player_id, token_allocations: { L1_Sub1: 1 } }
        ]
      }),
      200
    ),
    { assignedCount: 1, totalPlayers: 1, totalTokens: 1 }
  )
  assert.deepEqual(
    await expectStatus(
      await save({
        ...replacement,
        p_assignments: [
          { player_id: own.player_id, token_allocations: { L1: 0 } }
        ]
      }),
      200
    ),
    { assignedCount: 0, totalPlayers: 1, totalTokens: 0 }
  )
  await expectStatus(await save(), 200)

  stage = 'authority'
  for (const value of ['member', 'Officer', 'Leader']) {
    await role(value)
    await expectStatus(await save(), 403)
    await expectStatus(
      await rest('rpc/desktop_clear_saved_assignments', {
        p_season_number: '9999'
      }),
      403
    )
    assert.equal((await expectStatus(await rest(selected), 200)).length, 1)
    assert.equal(
      (await expectStatus(await paired(), 200)).assignments.length,
      1
    )
  }
  await role('member')
  await services.psql(
    `UPDATE public.player_mapping SET is_app_admin=true WHERE user_id=${quote(subject)};`
  )
  await expectStatus(await save(), 403)
  await services.psql(
    `UPDATE public.player_mapping SET is_app_admin=false WHERE user_id=${quote(subject)};`
  )
  await role('leader')
  await expectStatus(await save(), 200)
  assert.deepEqual(
    await expectStatus(
      await rest('upcoming_season_assignments?guild_code=eq.SYNFOREIGN'),
      200
    ),
    []
  )
  assert.deepEqual(
    await expectStatus(
      await rest('upcoming_season_bosses?guild_code=eq.SYNFOREIGN'),
      200
    ),
    []
  )
  await role('officer')
  for (const column of ['is_current', 'is_active']) {
    await services.psql(
      `UPDATE public.player_mapping SET ${column}=false WHERE user_id=${quote(subject)};`
    )
    await expectStatus(await save(), 403)
    assert.deepEqual(await expectStatus(await rest(selected), 200), [])
    await expectStatus(await paired(), 403)
    await services.psql(
      `UPDATE public.player_mapping SET ${column}=true WHERE user_id=${quote(subject)};`
    )
  }
  await expectStatus(await save(replacement, services.token.anon), 401)
  await expectStatus(await save(replacement, token + 'x'), 401)
  await expectStatus(await save(replacement, services.token.service), 403)
  await expectStatus(
    await rest(
      'rpc/desktop_get_saved_assignments',
      { p_season_number: '9999' },
      'POST',
      services.token.anon
    ),
    401
  )
  await expectStatus(
    await rest(
      'rpc/desktop_get_saved_assignments',
      { p_season_number: '9999' },
      'POST',
      services.token.service
    ),
    403
  )
  await expectStatus(
    await rest('upcoming_season_assignments', {
      guild_code: own.guild_code,
      season_number: '9999',
      player_id: 'SYNFORGED',
      display_name: 'Synthetic forged row'
    }),
    403
  )
  await expectStatus(
    await rest('rpc/manage_season_assignments', {
      p_guild_code: own.guild_code,
      p_season_number: '9999'
    }),
    403
  )
  await expectStatus(
    await rest('rpc/clear_season_assignments', {
      p_guild_code: own.guild_code,
      p_season_number: '9999'
    }),
    403
  )
  await expectStatus(await rest('user_bans?select=subject_value'), 403)
  await expectStatus(
    await rest('rpc/desktop_saved_assignment_subjects', {}),
    403
  )
  check(
    'Only actual lowercase active current officers and leaders write; member/admin/case variants, anonymous/service and direct parents/tables cannot bypass'
  )

  stage = 'validation-and-rollback'
  const invalid = [
    { ...replacement, p_season_number: '09999' },
    { ...replacement, p_season_number: '9997' },
    { ...replacement, p_bosses: null },
    {
      ...replacement,
      p_bosses: [{ ...replacement.p_bosses[0], boss_name: 'x'.repeat(70000) }]
    },
    {
      ...replacement,
      p_bosses: [...replacement.p_bosses, ...replacement.p_bosses]
    },
    {
      ...replacement,
      p_bosses: [{ level: 'L6', boss_name: 'riptide', sub_bosses: {} }]
    },
    {
      ...replacement,
      p_bosses: [
        { ...replacement.p_bosses[0], sub_bosses: { unknown: 'Synthetic' } }
      ]
    },
    {
      ...replacement,
      p_assignments: [
        ...replacement.p_assignments,
        ...replacement.p_assignments
      ]
    },
    {
      ...replacement,
      p_assignments: [{ player_id: 'SYNFOREIGN', token_allocations: { L1: 1 } }]
    },
    {
      ...replacement,
      p_assignments: [
        { player_id: 'SYNFOREIGNPLAYER', token_allocations: { L1: 1 } }
      ]
    },
    {
      ...replacement,
      p_assignments: [
        { player_id: 'SYN' + 'Q'.repeat(254), token_allocations: { L1: 1 } }
      ]
    },
    {
      ...blankPrimes,
      p_assignments: [
        { player_id: own.player_id, token_allocations: { L1_Sub1: 1 } }
      ]
    },
    {
      ...replacement,
      p_assignments: [{ ...replacement.p_assignments[0], assigned_by: subject }]
    },
    {
      ...replacement,
      p_assignments: [
        { ...replacement.p_assignments[0], token_allocations: { L1: -1 } }
      ]
    },
    {
      ...replacement,
      p_assignments: [
        { ...replacement.p_assignments[0], token_allocations: { L1: 0.5 } }
      ]
    },
    {
      ...replacement,
      p_assignments: [
        {
          ...replacement.p_assignments[0],
          token_allocations: { L1: 2147483648 }
        }
      ]
    },
    {
      ...replacement,
      p_bosses: [
        {
          ...two.p_bosses[0],
          sub_bosses: { sub1: 'Synthetic prime', sub1_skip: true }
        }
      ],
      p_assignments: [
        { player_id: own.player_id, token_allocations: { L1_Sub1: 1 } }
      ]
    },
    {
      ...replacement,
      p_bosses: two.p_bosses,
      p_assignments: [
        {
          player_id: own.player_id,
          token_allocations: { L1: 2147483647, L2: 1 }
        }
      ]
    },
    {
      ...replacement,
      p_assignments: [
        { ...replacement.p_assignments[0], token_allocations: { L2: 1 } }
      ]
    },
    {
      ...replacement,
      p_assignments: [
        { ...replacement.p_assignments[0], token_allocations: { L1_Sub1: 1 } }
      ]
    },
    {
      ...replacement,
      p_assignments: Array.from({ length: 31 }, (_, index) => ({
        player_id: `SYNBOUND${index}`,
        token_allocations: {}
      }))
    }
  ]
  const beforeInvalid = await stored()
  for (const value of invalid) {
    await expectStatus(await save(value), 400)
    assert.deepEqual(await stored(), beforeInvalid)
  }
  for (const field of ['is_current', 'is_active']) {
    await services.psql(
      `UPDATE public.player_mapping SET ${field}=false WHERE player_id=${quote(secondPlayer)};`
    )
    await expectStatus(
      await save({
        ...replacement,
        p_assignments: [
          { player_id: secondPlayer, token_allocations: { L1: 1 } }
        ]
      }),
      400
    )
    assert.deepEqual(await stored(), beforeInvalid)
    await services.psql(
      `UPDATE public.player_mapping SET ${field}=true WHERE player_id=${quote(secondPlayer)};`
    )
  }
  await services.psql(
    `ALTER TABLE public.upcoming_season_assignments ADD CONSTRAINT synthetic_insert_failure CHECK(total_tokens_allocated<>2) NOT VALID;`
  )
  try {
    await expectStatus(
      await save({
        ...replacement,
        p_assignments: [
          { player_id: own.player_id, token_allocations: { L1: 2 } }
        ]
      }),
      400
    )
  } finally {
    await services.psql(
      'ALTER TABLE public.upcoming_season_assignments DROP CONSTRAINT synthetic_insert_failure;'
    )
  }
  assert.deepEqual(await stored(), beforeInvalid)
  check(
    'Malformed bounds, duplicates, foreign/unavailable roster and unsupported allocation identities refuse atomically; a real post-delete constraint failure rolls back both tables'
  )

  // Latch the real RPC after its authority check, then observe a concurrent
  // downgrade waiting on the protected mapping row. No scheduling guess is
  // treated as evidence, and every fixture lock/backend is bounded/retired.
  stage = 'authority-lock'
  const waitFor = async (sql, label) => {
    const deadline = performance.now() + 2500
    while (performance.now() < deadline) {
      if ((await services.psql(sql)).trim() === 't') return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Synthetic ${label} database latch not observed`)
  }
  const cancelHold = () =>
    services.psql(
      "SELECT pg_cancel_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=6212 AND objid=1515 AND granted;"
    )
  let hold, pendingSave, downgrade
  await services.psql(`CREATE FUNCTION public.synthetic_assignment_latch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(6212,1515); RETURN OLD; END; $$;
    CREATE TRIGGER synthetic_assignment_latch BEFORE DELETE ON public.upcoming_season_assignments FOR EACH ROW EXECUTE FUNCTION public.synthetic_assignment_latch();`)
  try {
    hold = services
      .psql(
        'BEGIN; SELECT pg_advisory_xact_lock(6212,1515); SELECT pg_sleep(10); COMMIT;'
      )
      .catch(() => {})
    await waitFor(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=6212 AND objid=1515 AND granted);",
      'holder'
    )
    pendingSave = save()
    await waitFor(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=6212 AND objid=1515 AND NOT granted);",
      'writer'
    )
    downgrade = role('member')
    await waitFor(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE public.player_mapping SET role=%');",
      'downgrade'
    )
    await cancelHold()
    await expectStatus(await pendingSave, 200)
    await downgrade
    await expectStatus(await save(), 403)
    assert.equal(
      (await expectStatus(await paired(), 200)).assignments.length,
      1
    )
  } finally {
    await cancelHold()
    await Promise.allSettled([hold, pendingSave, downgrade])
    await services.psql(
      'DROP TRIGGER synthetic_assignment_latch ON public.upcoming_season_assignments; DROP FUNCTION public.synthetic_assignment_latch();'
    )
    await role('officer')
  }
  check(
    'Observed real write/downgrade lock ordering protects accepted authority until commit and rejects the subsequent downgraded write'
  )

  // Pause an actual paired read inside its table scan, commit a replacement,
  // then resume. Its two arrays must retain the one pre-commit SQL snapshot.
  stage = 'paired-read-snapshot'
  const cancelReadHold = () =>
    services.psql(
      "SELECT pg_cancel_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=6212 AND objid=1516 AND granted;"
    )
  let readHold, pendingRead
  const nextPair = {
    ...replacement,
    p_bosses: [two.p_bosses[1]],
    p_assignments: [{ player_id: own.player_id, token_allocations: { L2: 2 } }]
  }
  const pairValues = (value) => ({
    levels: value.bosses.map((row) => row.level),
    allocations: value.assignments.map((row) => row.token_allocations)
  })
  await services.psql(`CREATE FUNCTION public.synthetic_assignment_read_latch() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
    IF current_setting('request.path',true)='/rpc/desktop_get_saved_assignments' THEN PERFORM pg_advisory_xact_lock(6212,1516); END IF;
    RETURN true; END; $$;
    CREATE POLICY synthetic_assignment_read_latch ON public.upcoming_season_assignments AS RESTRICTIVE FOR SELECT TO desktop_assignment_writer USING(public.synthetic_assignment_read_latch());`)
  try {
    readHold = services
      .psql(
        'BEGIN; SELECT pg_advisory_xact_lock(6212,1516); SELECT pg_sleep(10); COMMIT;'
      )
      .catch(() => {})
    await waitFor(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=6212 AND objid=1516 AND granted);",
      'paired read holder'
    )
    pendingRead = paired()
    await waitFor(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=6212 AND objid=1516 AND NOT granted);",
      'paired read scan'
    )
    await expectStatus(await save(nextPair), 200)
    await cancelReadHold()
    assert.deepEqual(pairValues(await expectStatus(await pendingRead, 200)), {
      levels: ['L1'],
      allocations: [{ L1: 1 }]
    })
    assert.deepEqual(pairValues(await expectStatus(await paired(), 200)), {
      levels: ['L2'],
      allocations: [{ L2: 2 }]
    })
  } finally {
    await cancelReadHold()
    await Promise.allSettled([readHold, pendingRead])
    await services.psql(
      'DROP POLICY synthetic_assignment_read_latch ON public.upcoming_season_assignments; DROP FUNCTION public.synthetic_assignment_read_latch();'
    )
  }
  await expectStatus(await save(), 200)
  check(
    'A lock-observed paired read returns both pre-commit intent arrays while a replacement commits; the next read returns both new arrays'
  )

  stage = 'bans'
  const ban = async (kind, value, immutable = false, extra = '') => {
    await services.psql(
      `INSERT INTO public.user_bans(id,ban_group_id,auth_user_id,subject_type,subject_value,banned_at${extra ? ',expires_at' : ''}) VALUES(gen_random_uuid(),gen_random_uuid(),${quote(immutable ? subject : randomUUID())},${quote(kind)},${quote(value)},now()-interval '2 days'${extra ? ",now()-interval '1 day'" : ''});`
    )
  }
  const unban = () => services.psql('DELETE FROM public.user_bans;')
  for (const [kind, value, immutable] of [
    ['user_id', 'synthetic-unrelated-handle', true],
    ['user_id', subject, false],
    ['email', 'desktop@localhost.invalid', false],
    ['player_id', own.player_id.toLowerCase(), false]
  ]) {
    await ban(kind, value, immutable)
    await expectStatus(await save(), 403)
    await expectStatus(await paired(), 403)
    assert.deepEqual(await expectStatus(await rest(selected), 200), [])
    await unban()
  }
  await services.psql(
    `UPDATE public.player_mapping SET discord_user_id='111111111111111111' WHERE user_id=${quote(subject)};`
  )
  await ban('discord_user_id', '111111111111111111')
  await expectStatus(await save(), 403)
  await unban()
  await services.psql(
    `UPDATE public.player_mapping SET discord_user_id=${own.discord_user_id === null ? 'NULL' : quote(own.discord_user_id)} WHERE user_id=${quote(subject)};`
  )
  const identities = JSON.parse(
    (
      await services.psql(
        `SELECT jsonb_agg(jsonb_build_object('id',id,'provider',provider,'identity_data',identity_data)) FROM auth.identities WHERE user_id=${quote(subject)};`
      )
    ).trim()
  )
  await services.psql(
    `UPDATE auth.identities SET provider='discord',identity_data='{"provider_id":"222222222222222222"}'::jsonb WHERE user_id=${quote(subject)};`
  )
  await ban('discord_user_id', '222222222222222222')
  await expectStatus(await save(), 403)
  await unban()
  for (const identity of identities)
    await services.psql(
      `UPDATE auth.identities SET provider=${quote(identity.provider)},identity_data=${quote(JSON.stringify(identity.identity_data))}::jsonb WHERE id=${quote(identity.id)};`
    )
  await ban('user_id', subject, false, 'expired')
  await expectStatus(await save(), 200)
  await unban()
  await ban('user_id', subject)
  await services.psql(
    `UPDATE public.user_bans SET lifted_at=now(),lifted_by=${quote(subject)};`
  )
  await expectStatus(await save(), 200)
  await unban()
  await services.psql(
    'REVOKE SELECT(expires_at) ON public.user_bans FROM desktop_assignment_writer;'
  )
  try {
    await expectStatus(await save(), 403)
  } finally {
    await services.psql(
      'GRANT SELECT(expires_at) ON public.user_bans TO desktop_assignment_writer;'
    )
  }
  await expectStatus(await save(), 200)
  check(
    'Direct RPC checks immutable subject, normalized user/email/player and canonical linked/mapped Discord bans; expired/lifted bans clear and ACL uncertainty refuses'
  )

  stage = 'clear-and-restart'
  assert.deepEqual(
    await expectStatus(
      await rest('rpc/desktop_clear_saved_assignments', {
        p_season_number: '9999'
      }),
      200
    ),
    { assignmentsDeleted: 1, bossesDeleted: 1 }
  )
  assert.deepEqual(await stored(), { assignments: [], bosses: [] })
  assert.deepEqual(
    await expectStatus(
      await rest('rpc/desktop_clear_saved_assignments', {
        p_season_number: '9999'
      }),
      200
    ),
    { assignmentsDeleted: 0, bossesDeleted: 0 }
  )
  assert.equal(await domain(), preservedDomain)
  check(
    'Clear is selected-season-only, idempotent and conserves other seasons and global mapping without fallback'
  )
  await services.stop()
  services = undefined
  services = await nativeServices(config)
  assert.equal(services.fresh, false)
  await login()
  assert.deepEqual(await stored(), { assignments: [], bosses: [] })
  assert.equal(await domain(), preservedDomain)
  check(
    'Full native restart preserves authoritative empty saved intent and unrelated state despite populated global mapping'
  )
  await writeFile(
    config.result,
    JSON.stringify(
      {
        status: 'passed',
        checks,
        limits: [
          'Native RPC storage proof; no captured-lineup, as-of/model-budget, renderer or full feature qualification claim.'
        ]
      },
      null,
      2
    ) + '\n',
    { flag: 'wx', mode: 0o600 }
  )
} catch (error) {
  await writeFile(
    config.result,
    JSON.stringify(
      {
        status: 'failed',
        stage,
        checks,
        errorClass: error?.name === 'AssertionError' ? 'assertion' : 'operation'
      },
      null,
      2
    ) + '\n',
    { flag: 'wx', mode: 0o600 }
  )
  throw error
} finally {
  if (listener) await new Promise((resolve) => listener.close(resolve))
  await services?.stop()
}
