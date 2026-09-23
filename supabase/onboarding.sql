CREATE OR REPLACE FUNCTION public.provision_initial_site(p_user_id UUID,p_site_name TEXT)
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
  IF p_user_id IS NULL OR (auth.uid() IS DISTINCT FROM p_user_id AND current_user <> 'service_role') THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  IF p_site_name IS NULL OR length(trim(p_site_name)) < 2 OR length(trim(p_site_name)) > 80 THEN
    RAISE EXCEPTION 'Nom de site invalide';
  END IF;

  v_base := lower(regexp_replace(trim(p_site_name),'[^a-zA-Z0-9]+','-','g'));
  v_base := regexp_replace(v_base,'^-+|-+$','','g');
  IF v_base='' THEN v_base:='mon-site'; END IF;

  LOOP
    v_subdomain := v_base || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM sites WHERE subdomain=v_subdomain);
  END LOOP;

  INSERT INTO sites(user_id,name,subdomain,status)
  VALUES(p_user_id,trim(p_site_name),v_subdomain,'draft')
  RETURNING * INTO v_site;

  INSERT INTO site_members(site_id,user_id,role)
  VALUES(v_site.id,p_user_id,'owner');

  INSERT INTO pages(site_id,slug,title,seo,root)
  VALUES(
    v_site.id,'index','Accueil',
    jsonb_build_object('title','Accueil'),
    jsonb_build_object(
      'id','blk_root','type','section',
      'props',jsonb_build_object('semanticTag','main'),
      'styles',jsonb_build_object('desktop',jsonb_build_object('padding','40px 20px')),
      'children',jsonb_build_array(
        jsonb_build_object(
          'id','blk_welcome_heading','type','heading',
          'props',jsonb_build_object('level',1,'text','Bienvenue sur ' || trim(p_site_name)),
          'styles',jsonb_build_object('desktop',jsonb_build_object('fontSize','36px','textAlign','center'))
        )
      )
    )
  );

  RETURN jsonb_build_object('id',v_site.id,'name',v_site.name,'subdomain',v_site.subdomain,'status',v_site.status);
END;
$$;

REVOKE ALL ON FUNCTION public.provision_initial_site(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_initial_site(UUID,TEXT) TO service_role;