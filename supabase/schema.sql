CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  full_name VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('github','google','gitlab','bitbucket')),
  provider_user_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_provider_user UNIQUE (provider,provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_lookup
  ON user_identities(provider,provider_user_id);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(63) UNIQUE NOT NULL,
  custom_domain VARCHAR(255) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  provider_hosting_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sites_subdomain ON sites(subdomain);
CREATE INDEX IF NOT EXISTS idx_sites_custom_domain ON sites(custom_domain);

CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug VARCHAR(255) NOT NULL,
  seo JSONB NOT NULL DEFAULT '{}'::jsonb,
  root_block JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_site_slug UNIQUE(site_id,slug)
);

CREATE TABLE IF NOT EXISTS site_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner','editor','viewer')),
  CONSTRAINT unique_site_user UNIQUE(site_id,user_id)
);

CREATE INDEX IF NOT EXISTS idx_site_members_lookup
  ON site_members(user_id,site_id);

CREATE INDEX IF NOT EXISTS idx_pages_site_slug
  ON pages(site_id,slug);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION provision_initial_site(
  p_user_id UUID,
  p_site_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_site sites;
  v_base TEXT;
  v_subdomain TEXT;
BEGIN
  IF p_user_id IS NULL OR p_site_name IS NULL
     OR length(trim(p_site_name)) < 2
     OR length(trim(p_site_name)) > 80 THEN
    RAISE EXCEPTION 'Données de site invalides';
  END IF;

  v_base := lower(regexp_replace(trim(p_site_name),'[^a-zA-Z0-9]+','-','g'));
  v_base := regexp_replace(v_base,'^-+|-+$','','g');
  IF v_base='' THEN v_base:='mon-site'; END IF;

  LOOP
    v_subdomain := left(v_base,54) || '-' ||
      substr(replace(uuid_generate_v4()::text,'-',''),1,8);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM sites WHERE subdomain=v_subdomain
    );
  END LOOP;

  INSERT INTO sites(user_id,name,subdomain,status)
  VALUES(p_user_id,trim(p_site_name),v_subdomain,'draft')
  RETURNING * INTO v_site;

  INSERT INTO site_members(site_id,user_id,role)
  VALUES(v_site.id,p_user_id,'owner');

  INSERT INTO pages(site_id,slug,seo,root_block)
  VALUES(
    v_site.id,
    'index',
    jsonb_build_object('title','Accueil'),
    jsonb_build_object(
      'id','blk_root',
      'type','section',
      'props',jsonb_build_object('semanticTag','main'),
      'styles',jsonb_build_object(
        'desktop',jsonb_build_object('padding','40px 20px')
      ),
      'children',jsonb_build_array(
        jsonb_build_object(
          'id','blk_welcome_heading',
          'type','heading',
          'props',jsonb_build_object(
            'level',1,
            'text','Bienvenue sur ' || trim(p_site_name)
          ),
          'styles',jsonb_build_object(
            'desktop',jsonb_build_object(
              'fontSize','36px',
              'textAlign','center'
            )
          )
        )
      )
    )
  );

  RETURN jsonb_build_object(
    'id',v_site.id,
    'name',v_site.name,
    'subdomain',v_site.subdomain,
    'status',v_site.status
  );
END;
$$;

REVOKE ALL ON FUNCTION provision_initial_site(UUID,TEXT) FROM PUBLIC;