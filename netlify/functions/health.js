import { json } from "./_lib.mjs";
export default async () => json({ ok: true, service: "haspad", time: new Date().toISOString() });
