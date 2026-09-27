import { admin, json, authenticatedUser } from "./_credits.js";
import { generateProjectBlueprint } from "./aiService.js";

const ALLOWED_TYPES = new Set([
  "section", "heading", "text", "button", "card", "input", "image", "form", "nav", "footer"
]);

function validSlug(value) {
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(String(value || ""));
}

function safeText(value, max = 2000) {
  if (typeof value !== "string" || value.length > max) throw new Error("COMPONENT_PROPERTY_INVALID");
  return value;
}

function normalizeUrl(value) {
  const v = safeText(value);
  if (!v) return v;
  if (/^javascript:/i.test(v) || /^data:/i.test(v) || /^vbscript:/i.test(v)) {
    throw new Error("COMPONENT_URL_INVALID");
  }
  if (!/^(https:\/\/|\/|#)/i.test(v)) throw new Error("COMPONENT_URL_INVALID");
  return v;
}

function validateBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== "object") throw new Error("BLUEPRINT_INVALID");
  if (!["CREATE_OR_UPDATE_PAGE", "UPDATE_COMPONENTS"].includes(blueprint.action)) {
    throw new Error("BLUEPRINT_ACTION_INVALID");
  }

  const meta = blueprint.metadata;
  if (!meta || !validSlug(meta.page_slug) || typeof meta.page_title !== "string" || meta.page_title.length > 160) {
    throw new Error("BLUEPRINT_METADATA_INVALID");
  }

  if (!Array.isArray(blueprint.components) || blueprint.components.length > 50) {
    throw new Error("BLUEPRINT_COMPONENTS_INVALID");
  }

  return blueprint.components.map((component, index) => {
    if (!component || typeof component !== "object") throw new Error("COMPONENT_INVALID");

    const id = String(component.id || "");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("COMPONENT_ID_INVALID");
    if (!ALLOWED_TYPES.has(component.type)) throw new Error("COMPONENT_TYPE_INVALID");

    const input = component.properties;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("COMPONENT_PROPERTIES_INVALID");
    }

    const properties = {};
    for (const [key, value] of Object.entries(input)) {
      if (!["label", "className", "text", "href", "src", "alt"].includes(key)) continue;
      if (key === "href" || key === "src") properties[key] = normalizeUrl(value);
      else properties[key] = safeText(value);
    }

    return { id, type: component.type, properties, position_index: index };
  });
}

function componentToBlock(component) {
  const p = component.properties || {};
  const base = {
    id: component.id,
    type: component.type === "card" ? "container" :
          component.type === "nav" ? "container" :
          component.type === "footer" ? "section" :
          component.type === "form" ? "form" :
          component.type,
    props: {},
    styles: { desktop: {} },
    children: []
  };

  if (component.type === "section") {
    base.props.semanticTag = "section";
  } else if (component.type === "heading" || component.type === "text" || component.type === "button") {
    base.props.text = p.text || p.label || "";
  } else if (component.type === "card") {
    base.props.text = p.text || p.label || "";
  } else if (component.type === "input") {
    base.props.name = p.label || component.id;
    base.props.inputType = "text";
  } else if (component.type === "image") {
    base.props.src = p.src || "";
    base.props.alt = p.alt || "";
  } else if (component.type === "form") {
    base.props.text = p.text || p.label || "";
  } else if (component.type === "nav" || component.type === "footer") {
    base.props.text = p.text || p.label || "";
  }

  if (component.type === "button" && p.href) {
    base.type = "link";
    base.props.url = p.href;
  }
  if (component.type === "nav" && p.href) {
    base.type = "link";
    base.props.url = p.href;
  }

  return base;
}

function blueprintToRoot(components) {
  const children = components.map(componentToBlock);
  return {
    id: "ai_root",
    type: "section",
    props: { semanticTag: "main" },
    styles: { desktop: { padding: "40px 20px" } },
    children
  };
}

async function syncPublishedPage(siteId, slug, title, rootBlock) {
  const { data: existing, error: readError } = await admin
    .from("pages")
    .select("id")
    .eq("site_id", siteId)
    .eq("slug", slug)
    .maybeSingle();

  if (readError) throw new Error("PAGE_READ_FAILED");

  if (existing) {
    const { data, error } = await admin
      .from("pages")
      .update({ root_block: rootBlock, seo: { title } })
      .eq("id", existing.id)
      .select("id,slug")
      .single();
    if (error) throw new Error("PAGE_UPDATE_FAILED");
    return data;
  }

  const { data, error } = await admin
    .from("pages")
    .insert({ site_id: siteId, slug, seo: { title }, root_block: rootBlock })
    .select("id,slug")
    .single();

  if (error) throw new Error("PAGE_CREATE_FAILED");
  return data;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  const user = await authenticatedUser(req);
  if (!user) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(req.body || "{}"); }
  catch { return json(400, { error: "JSON invalide." }); }

  const siteId = String(body.siteId || "");
  const prompt = String(body.prompt || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(siteId) || !prompt || prompt.length > 12000) {
    return json(400, { error: "siteId ou demande invalide." });
  }

  const { data: site, error: siteError } = await admin
    .from("sites")
    .select("id")
    .eq("id", siteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (siteError) return json(500, { error: "Vérification du projet impossible." });
  if (!site) return json(403, { error: "Accès non autorisé à ce projet." });

  try {
    const [{ data: pages, error: pagesError }, { data: components, error: componentsError }] = await Promise.all([
      admin.from("site_pages").select("id,slug,title,is_published,layout_config").eq("site_id", siteId).limit(100),
      admin.from("site_components").select("id,page_id,component_type,identifier,design_props,position_index,updated_at").eq("site_id", siteId).order("position_index", { ascending: true }).limit(500)
    ]);

    if (pagesError || componentsError) throw new Error("PROJECT_SCHEMA_READ_FAILED");

    const aiResult = await generateProjectBlueprint(prompt, { pages: pages || [], components: components || [] });
    if (!aiResult.success) return json(502, { error: aiResult.error });

    const blueprint = aiResult.blueprint;
    const normalizedComponents = validateBlueprint(blueprint);
    const rootBlock = blueprintToRoot(normalizedComponents);

    // The deploy compiler reads public.pages.root_block. The AI write path must
    // update that authoritative deployment snapshot, not only editor metadata.
    const deployedPage = await syncPublishedPage(
      siteId,
      blueprint.metadata.page_slug,
      blueprint.metadata.page_title,
      rootBlock
    );

    let { data: page } = await admin
      .from("site_pages")
      .select("id,slug,title,layout_config")
      .eq("site_id", siteId)
      .eq("slug", blueprint.metadata.page_slug)
      .maybeSingle();

    if (!page) {
      const { data: createdPage, error: createPageError } = await admin
        .from("site_pages")
        .insert({
          site_id: siteId,
          slug: blueprint.metadata.page_slug,
          title: blueprint.metadata.page_title,
          is_published: false,
          layout_config: {}
        })
        .select("id,slug,title,layout_config")
        .single();
      if (createPageError) throw new Error("EDITOR_PAGE_CREATE_FAILED");
      page = createdPage;
    } else {
      const { data: updatedPage, error: updatePageError } = await admin
        .from("site_pages")
        .update({
          title: blueprint.metadata.page_title,
          is_published: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", page.id)
        .select("id,slug,title,layout_config")
        .single();
      if (updatePageError) throw new Error("EDITOR_PAGE_UPDATE_FAILED");
      page = updatedPage;
    }

    // Keep editor metadata synchronized with the authoritative page snapshot.
    await admin.from("site_components").delete().eq("site_id", siteId).eq("page_id", page.id);

    if (normalizedComponents.length) {
      const rows = normalizedComponents.map(component => ({
        site_id: siteId,
        page_id: page.id,
        component_type: component.type,
        identifier: component.id,
        design_props: component.properties,
        position_index: component.position_index,
        updated_at: new Date().toISOString()
      }));

      const { error: componentError } = await admin.from("site_components").insert(rows);
      if (componentError) throw new Error("COMPONENT_WRITE_FAILED");
    }

    const { error: logError } = await admin.from("ai_activity_logs").insert({
      site_id: siteId,
      agent_name: "gemini-3.8-flash",
      action_taken: blueprint.action,
      details: {
        prompt,
        blueprint,
        deployed_page_id: deployedPage.id,
        component_count: normalizedComponents.length
      }
    });
    if (logError) throw new Error("AI_LOG_WRITE_FAILED");

    return json(200, {
      success: true,
      model: aiResult.model,
      page: { id: page.id, slug: page.slug, title: page.title },
      deploymentSnapshotUpdated: true,
      blueprint
    });
  } catch (error) {
    console.error("AI Architect:", error);
    return json(500, { error: "Le Blueprint n'a pas pu être appliqué." });
  }
};
