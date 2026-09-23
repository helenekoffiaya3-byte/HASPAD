ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE environment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sites_owner_select ON sites FOR SELECT TO authenticated USING ((select auth.uid())=user_id);
CREATE POLICY sites_owner_insert ON sites FOR INSERT TO authenticated WITH CHECK ((select auth.uid())=user_id);
CREATE POLICY sites_owner_update ON sites FOR UPDATE TO authenticated USING ((select auth.uid())=user_id) WITH CHECK ((select auth.uid())=user_id);
CREATE POLICY sites_owner_delete ON sites FOR DELETE TO authenticated USING ((select auth.uid())=user_id);

CREATE POLICY pages_owner_all ON pages FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.user_id=(select auth.uid())))
WITH CHECK (EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.user_id=(select auth.uid())));

CREATE POLICY assets_owner_all ON assets FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.user_id=(select auth.uid())))
WITH CHECK (EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.user_id=(select auth.uid())));

CREATE POLICY env_owner_all ON environment_configs FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.user_id=(select auth.uid())))
WITH CHECK (EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.user_id=(select auth.uid())));

CREATE POLICY deployments_owner_all ON deployments FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.user_id=(select auth.uid())))
WITH CHECK (EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.user_id=(select auth.uid())));