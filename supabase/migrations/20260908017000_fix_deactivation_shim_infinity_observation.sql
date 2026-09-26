-- The 4-argument deactivate_player_mappings shim passed '-infinity' as observation
-- time, so it never deactivated anything yet reported success. Mint it at call
-- time with clock_timestamp() (now() is the transaction start).
CREATE OR REPLACE FUNCTION public.deactivate_player_mappings(
  p_guild_code text,
  p_player_ids text[],
  p_reason text,
  p_source text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.deactivate_player_mappings_observed(
    p_guild_code,
    p_player_ids,
    p_reason,
    p_source,
    clock_timestamp()
  );
$function$;
