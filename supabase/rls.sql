ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE environment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_owner_select ON sites;
CREATE POLICY sites_member_select ON sites FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=sites.id AND m.user_id=(select auth.uid())));

DROP POLICY IF EXISTS sites_owner_insert ON sites;
CREATE POLICY sites_owner_insert ON sites FOR INSERT TO authenticated
WITH CHECK ((select auth.uid())=user_id);

DROP POLICY IF EXISTS sites_owner_update ON sites;
CREATE POLICY sites_member_update ON sites FOR UPDATE TO authenticated
USING (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=sites.id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','editor')))
WITH CHECK (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=sites.id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','editor')));

DROP POLICY IF EXISTS sites_owner_delete ON sites;
CREATE POLICY sites_owner_delete ON sites FOR DELETE TO authenticated
USING (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=sites.id AND m.user_id=(select auth.uid()) AND m.role='owner'));

DROP POLICY IF EXISTS pages_owner_all ON pages;
CREATE POLICY pages_member_all ON pages FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=pages.site_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','editor')))
WITH CHECK (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=pages.site_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','editor')));

DROP POLICY IF EXISTS assets_owner_all ON assets;
CREATE POLICY assets_member_all ON assets FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=assets.site_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','editor')))
WITH CHECK (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=assets.site_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','editor')));

DROP POLICY IF EXISTS env_owner_all ON environment_configs;
CREATE POLICY env_owner_all ON environment_configs FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=environment_configs.site_id AND m.user_id=(select auth.uid()) AND m.role='owner'))
WITH CHECK (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=environment_configs.site_id AND m.user_id=(select auth.uid()) AND m.role='owner'));

DROP POLICY IF EXISTS deployments_owner_all ON deployments;
CREATE POLICY deployments_member_all ON deployments FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=deployments.site_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','editor')))
WITH CHECK (EXISTS(SELECT 1 FROM site_members m WHERE m.site_id=deployments.site_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','editor')));

DROP POLICY IF EXISTS site_members_select ON site_members;
CREATE POLICY site_members_select ON site_members FOR SELECT TO authenticated
USING (user_id=(select auth.uid()) OR EXISTS(
  SELECT 1 FROM site_members me WHERE me.site_id=site_members.site_id AND me.user_id=(select auth.uid()) AND me.role='owner'
));

DROP POLICY IF EXISTS site_members_owner_manage ON site_members;
CREATE POLICY site_members_owner_manage ON site_members FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM site_members me WHERE me.site_id=site_members.site_id AND me.user_id=(select auth.uid()) AND me.role='owner'))
WITH CHECK (EXISTS(SELECT 1 FROM site_members me WHERE me.site_id=site_members.site_id AND me.user_id=(select auth.uid()) AND me.role='owner'));