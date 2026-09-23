-- HASPAD authentication / tenant membership layer.
-- Supabase Auth owns passwords and OAuth identities.

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','editor','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(site_id,user_id)
);

CREATE INDEX IF NOT EXISTS idx_site_members_lookup ON site_members(user_id,site_id);
CREATE INDEX IF NOT EXISTS idx_site_members_site ON site_members(site_id);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_self_select ON profiles;
CREATE POLICY profiles_self_select ON profiles FOR SELECT TO authenticated USING (id=(select auth.uid()));
DROP POLICY IF EXISTS profiles_self_update ON profiles;
CREATE POLICY profiles_self_update ON profiles FOR UPDATE TO authenticated USING (id=(select auth.uid())) WITH CHECK (id=(select auth.uid()));

DROP POLICY IF EXISTS site_members_self_select ON site_members;
CREATE POLICY site_members_self_select ON site_members FOR SELECT TO authenticated USING (user_id=(select auth.uid()));

DROP POLICY IF EXISTS site_members_owner_manage ON site_members;
CREATE POLICY site_members_owner_manage ON site_members FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM sites s WHERE s.id=site_members.site_id AND s.user_id=(select auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id=site_members.site_id AND s.user_id=(select auth.uid())));

CREATE OR REPLACE FUNCTION consume_auth_rate_limit(p_key TEXT,p_max INTEGER,p_window_seconds INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r auth_rate_limits%ROWTYPE;
BEGIN
  SELECT * INTO r FROM auth_rate_limits WHERE key=p_key FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO auth_rate_limits(key,window_started_at,attempts) VALUES(p_key,now(),1);
    RETURN TRUE;
  END IF;
  IF r.window_started_at + make_interval(secs=>p_window_seconds) <= now() THEN
    UPDATE auth_rate_limits SET window_started_at=now(),attempts=1 WHERE key=p_key;
    RETURN TRUE;
  END IF;
  IF r.attempts >= p_max THEN RETURN FALSE; END IF;
  UPDATE auth_rate_limits SET attempts=attempts+1 WHERE key=p_key;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION consume_auth_rate_limit(TEXT,INTEGER,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_auth_rate_limit(TEXT,INTEGER,INTEGER) TO service_role;
