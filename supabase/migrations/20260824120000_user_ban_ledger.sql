-- Ban rows are grouped by ban_group_id so a new email does not evade a ban. No policies
-- and service_role-only grants: a banned user never reads or edits their own ban.

CREATE TABLE IF NOT EXISTS public.user_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ban_group_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  subject_type text NOT NULL,
  subject_value text NOT NULL,
  reason text,
  banned_by uuid,
  banned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid,
  lift_reason text,
  CONSTRAINT user_bans_subject_type_check
    CHECK (subject_type = ANY (ARRAY[
      'user_id'::text,
      'email'::text,
      'discord_user_id'::text,
      'player_id'::text
    ])),
  -- Lowercase so case variations of an email or player id cannot evade a ban.
  CONSTRAINT user_bans_subject_value_normalized
    CHECK (btrim(subject_value) <> '' AND subject_value = lower(subject_value)),
  CONSTRAINT user_bans_expires_after_banned
    CHECK (expires_at IS NULL OR expires_at > banned_at),
  CONSTRAINT user_bans_lift_is_complete
    CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
);

-- One active ban per identifier; lifted rows stay as history and allow a re-ban.
CREATE UNIQUE INDEX IF NOT EXISTS user_bans_active_subject_key
  ON public.user_bans (subject_type, subject_value)
  WHERE lifted_at IS NULL;

-- The per-request identifier check scans only active bans.
CREATE INDEX IF NOT EXISTS user_bans_active_lookup_idx
  ON public.user_bans (subject_value, subject_type)
  WHERE lifted_at IS NULL;

CREATE INDEX IF NOT EXISTS user_bans_group_idx
  ON public.user_bans (ban_group_id);

CREATE INDEX IF NOT EXISTS user_bans_auth_user_idx
  ON public.user_bans (auth_user_id, banned_at DESC);

ALTER TABLE public.user_bans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_bans FROM PUBLIC, anon, authenticated;
-- DELETE only rolls back a failed GoTrue ban; unbans are soft closes.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_bans TO service_role;
