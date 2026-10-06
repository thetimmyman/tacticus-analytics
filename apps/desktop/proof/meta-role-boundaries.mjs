import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'

// Synthetic transactions leave the existing workspace and membership unchanged.
export async function proveMetaRoleBoundaries(services, subject) {
  assert.match(subject, /^[a-f0-9-]{36}$/)
  const team = randomUUID(),
    peer = randomUUID(),
    foreign = randomUUID()
  const claims = JSON.stringify({ sub: subject, role: 'authenticated' })
  const seed = `BEGIN;
    INSERT INTO auth.users(id,aud,role,email) VALUES
      ('${peer}','authenticated','authenticated','synthetic-meta-peer@example.invalid'),
      ('${foreign}','authenticated','authenticated','synthetic-meta-foreign@example.invalid');
    INSERT INTO public.player_mapping(id,player_id,display_name,guild_code,user_id,is_current,is_active)
      VALUES(21001,'synthetic-meta-peer','Synthetic Meta Peer','SYN001','${peer}',true,true),
      (21002,'synthetic-meta-foreign','Synthetic Meta Foreign','SYN003','${foreign}',true,true);
    INSERT INTO public.meta_teams(id,team_name) VALUES('${team}','Synthetic Meta Team');
    INSERT INTO public.player_meta_roles(user_id,meta_team_id,source,set_by)
      VALUES('${peer}','${team}','auto','${peer}'),('${foreign}','${team}','auto','${foreign}');
    SELECT set_config('request.jwt.claims','${claims}',true);
    SET LOCAL ROLE authenticated;`
  const result = await services.psql(
    seed +
      `
    DO $control$ BEGIN
      IF (SELECT count(*) FROM public.player_meta_roles WHERE meta_team_id='${team}') <> 1
        THEN RAISE EXCEPTION 'Foreign membership leaked'; END IF;
    END $control$;
    INSERT INTO public.player_meta_roles(user_id,meta_team_id,source,set_by)
      VALUES('${subject}','${team}','self','${subject}');
    UPDATE public.player_meta_roles SET updated_at='2000-01-01' WHERE user_id='${subject}' AND meta_team_id='${team}';
    DO $control$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.player_meta_roles WHERE user_id='${subject}' AND meta_team_id='${team}' AND updated_at>'2000-01-02')
        THEN RAISE EXCEPTION 'Canonical timestamp trigger failed'; END IF;
    END $control$;
    DELETE FROM public.player_meta_roles WHERE user_id='${subject}' AND meta_team_id='${team}';
    ROLLBACK;`
  )
  assert.ok(result)
  for (const [user, source, setter] of [
    [foreign, 'self', subject],
    [subject, 'self', foreign],
    [subject, 'auto', subject],
    [subject, 'leader_override', subject]
  ]) {
    await assert.rejects(
      services.psql(
        seed +
          `
      INSERT INTO public.player_meta_roles(user_id,meta_team_id,source,set_by)
        VALUES('${user}','${team}','${source}','${setter}'); ROLLBACK;`
      )
    )
  }
  const leaderSeed = seed.replace(
    'SET LOCAL ROLE authenticated;',
    `UPDATE public.player_mapping SET role='leader' WHERE user_id='${subject}' AND is_current; SET LOCAL ROLE authenticated;`
  )
  await services.psql(
    leaderSeed +
      `
    UPDATE public.player_meta_roles SET source='leader_override',set_by='${subject}' WHERE user_id='${peer}' AND meta_team_id='${team}';
    DO $control$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.player_meta_roles WHERE user_id='${peer}' AND meta_team_id='${team}' AND source='leader_override' AND set_by='${subject}')
        THEN RAISE EXCEPTION 'Same-guild override failed'; END IF;
      IF EXISTS (SELECT 1 FROM public.player_meta_roles WHERE user_id='${foreign}')
        THEN RAISE EXCEPTION 'Foreign leader scope leaked'; END IF;
    END $control$;
    ROLLBACK;`
  )
  await assert.rejects(
    services.psql(
      leaderSeed +
        `
    INSERT INTO public.player_meta_roles(user_id,meta_team_id,source,set_by)
      VALUES('${foreign}','${team}','leader_override','${subject}'); ROLLBACK;`
    )
  )
  await assert.rejects(
    services.psql(
      `BEGIN; SET LOCAL ROLE anon; SELECT * FROM public.player_meta_roles; ROLLBACK;`
    )
  )
  assert.equal(
    (
      await services.psql(
        `SELECT count(*) FROM public.meta_teams WHERE id='${team}';`
      )
    ).trim(),
    '0'
  )
}
