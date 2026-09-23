export type SiteResolution={siteId:string;deploymentId:string;host:string};
export function normalizeHostname(host:string){return host.split(":")[0].trim().toLowerCase().replace(/^www\./,"");}