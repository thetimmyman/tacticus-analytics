import { randomUUID } from 'node:crypto'

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
export function localIdentity(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        !['guildCode', 'playerId', 'displayName', 'guildName'].includes(key)
    )
  )
    throw new Error('Enter your local guild and player labels.')
  for (const key of ['guildCode', 'playerId', 'displayName', 'guildName']) {
    if (
      typeof value[key] !== 'string' ||
      !value[key].trim().length ||
      value[key].length > (key === 'guildCode' ? 32 : 128) ||
      /[\u0000-\u001f\u007f]/.test(value[key])
    )
      throw new Error('Enter your local guild and player labels.')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value.guildCode))
    throw new Error(
      'Use letters, numbers, underscores or hyphens in the guild code.'
    )
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item.trim()])
  )
}
export async function createLocalWorkspace(services, subject, identity) {
  const data = localIdentity(identity)
  if (!/^[a-f0-9-]{36}$/.test(subject))
    throw new Error('Local account creation failed')
  await services.psql(`BEGIN;
    INSERT INTO public.guild_config(id,guild_code,display_name,enabled,onboarding_completed,auto_sync_enabled) VALUES(1,${quote(data.guildCode)},${quote(data.guildName)},true,false,false);
    INSERT INTO public.player_mapping(id,player_id,display_name,guild_code,user_id,is_current,is_active,role,is_app_admin) VALUES(1,${quote(data.playerId)},${quote(data.displayName)},${quote(data.guildCode)},${quote(subject)},true,true,'member',false);
    INSERT INTO public.player_identity_attestations(id,mapping_id,player_id,subject_user_id,source,consumed_at,attested_at) VALUES(${quote(randomUUID())},1,${quote(data.playerId)},${quote(subject)},'desktop_local_claim',statement_timestamp(),statement_timestamp());
    UPDATE public.player_mapping SET ownership_attestation_id=(SELECT id FROM public.player_identity_attestations WHERE mapping_id=1) WHERE id=1;
    INSERT INTO public.desktop_preview_setup(singleton,subject_user_id,identity_mode,guild_code) VALUES(true,${quote(subject)},'local-file',${quote(data.guildCode)});
    COMMIT;`)
}
