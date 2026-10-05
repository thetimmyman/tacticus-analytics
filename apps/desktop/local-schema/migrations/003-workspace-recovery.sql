-- Local recovery stores only a digest; existing workspaces opt in.

ALTER TABLE public.desktop_preview_setup ADD COLUMN recovery_code_hash text CHECK (recovery_code_hash ~ '^[a-f0-9]{64}$');
REVOKE ALL ON public.desktop_preview_setup FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
