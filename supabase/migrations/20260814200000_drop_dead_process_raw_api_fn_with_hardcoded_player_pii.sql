-- Drop a retired helper whose body held captured account-identifier mappings.

BEGIN;

DROP FUNCTION IF EXISTS public.process_raw_api_to_structured();

COMMIT;
