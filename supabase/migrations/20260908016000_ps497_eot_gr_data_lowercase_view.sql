-- Lowercase pass-through view over "EOT_GR_data" for the read-only shim, which
-- refuses double-quoted identifiers.
-- security_invoker = true is load-bearing: without it the view bypasses forced RLS.

create view public.eot_gr_data_compat
with (security_invoker = true)
as
select
  id,
  "Guild" as guild,
  "Season" as season,
  "displayName" as display_name,
  "Name" as name,
  "damageType" as damage_type,
  "damageDealt" as damage_dealt,
  "loopIndex" as loop_index,
  tier,
  set,
  "startedOn" as started_on,
  "completedOn" as completed_on,
  timestamp,
  "encounterId" as encounter_id,
  rarity,
  "userId" as user_id,
  "encounterIndex" as encounter_index,
  "encounterType" as encounter_type,
  "globalConfigHash" as global_config_hash,
  "heroDetails" as hero_details,
  "machineOfWarDetails" as machine_of_war_details,
  "unitId" as unit_id,
  type,
  cluster_code,
  cluster_id,
  "maxHp" as max_hp,
  "remainingHp" as remaining_hp,
  season_num
from public."EOT_GR_data";

comment on view public.eot_gr_data_compat is
  'PS-497 shim-compatibility alias: lowercase pass-through over public."EOT_GR_data" '
  'so the PS-123 read-only shim (which refuses double-quoted identifiers, PS-489) can '
  'reach it. Not a curated reporting surface -- do not build new features on this view; '
  'use public."EOT_GR_data" directly from an unshimmed lane instead. '
  'security_invoker = true is required: it keeps the base table''s forced RLS in effect '
  'for the querying role. Do not remove it.';

-- Grants mirror the base table's SELECT grants exactly.
grant select on public.eot_gr_data_compat to analytics_ro;
grant select on public.eot_gr_data_compat to authenticated;
