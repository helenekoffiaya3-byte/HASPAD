import crypto from "node:crypto";

const API = "https://api.northflank.com/v1";
const jobs = new Map();

const env = (name) => process.env[name] || "";
const required = (name) => {
  const value = env(name);
  if (!value) throw new Error(name + "_NOT_CONFIGURED");
  return value;
};
const clean = (value, max = 54) => String(value || "").replace(/[^a-zA-Z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "haspad";

async function nfRequest(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer " + required("NORTHFLANK_API_TOKEN"), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.message || data?.error || data?.errors?.[0]?.message || "NORTHFLANK_API_ERROR").slice(0, 500));
  return data?.data ?? data;
}

function statusFromService(service) {
  const build = String(service?.status?.build?.status || "").toUpperCase();
  const deployment = String(service?.status?.deployment?.status || "").toUpperCase();
  if (deployment === "FAILED" || ["FAILURE", "SUBMISSION_FAILURE", "ABORTED", "CRASHED"].includes(build)) return "failed";
  if (deployment === "COMPLETED" && build === "SUCCESS") return "running";
  if (["PENDING", "IN_PROGRESS"].includes(deployment) || ["QUEUED", "PENDING", "STARTING", "CLONING", "BUILDING", "UPLOADING", "IN_PROGRESS"].includes(build)) return "building";
  return "unknown";
}

function findUrl(value) {
  if (!value || typeof value !== "object") return null;
  for (const candidate of [value.url, value.href, value.publicUrl, value.publicURL, value.hostname ? "https://" + value.hostname : null]) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
  }
  for (const child of Object.values(value)) {
    const found = findUrl(child);
    if (found) return found;
  }
  return null;
}

async function findService(runtimeId) {
  const projectId = required("NORTHFLANK_PROJECT_ID");
  const name = "haspad-" + clean(runtimeId, 45);
  const data = await nfRequest("/projects/" + encodeURIComponent(projectId) + "/services?per_page=100");
  const services = Array.isArray(data?.services) ? data.services : [];
  return services.find((service) => service.id === name || service.name === name) || null;
}

function githubSource(body) {
  const source = {
    projectUrl: "https://github.com/" + body.repositoryOwner + "/" + body.repositoryName,
    projectType: "github",
    projectBranch: body.branch || "main"
  };
  if (env("NORTHFLANK_GITHUB_ACCOUNT_LOGIN")) source.accountLogin = env("NORTHFLANK_GITHUB_ACCOUNT_LOGIN");
  return source;
}

function servicePayload(body, serviceName) {
  const port = Number(body.port || 3000);
  const healthPath = String(body.healthcheckPath || "/");
  const portConfig = { name: "http", internalPort: port, public: true, vpcAccessible: false, protocol: "HTTP" };
  if (body.host && env("NORTHFLANK_USE_CUSTOM_DOMAINS") === "true") portConfig.domains = [String(body.host).toLowerCase()];

  return {
    name: serviceName,
    description: "HASPAD managed deployment " + serviceName,
    billing: { deploymentPlan: required("NORTHFLANK_DEPLOYMENT_PLAN"), buildPlan: required("NORTHFLANK_BUILD_PLAN") },
    deployment: { instances: 1, docker: { configType: "default" }, storage: { ephemeralStorage: { storageSize: 1024 } } },
    ports: [portConfig],
    buildSource: "git",
    vcsData: githubSource(body),
    buildSettings: { dockerfile: { buildEngine: "buildkit", dockerFilePath: "/" + String(body.dockerfilePath || "Dockerfile").replace(/^\/+/, ""), dockerWorkDir: "/" } },
    buildConfiguration: { ciIgnoreFlags: ["[skip ci]", "[ci skip]", "[skip nf]", "[nf skip]", "[skip northflank]"] },
    healthChecks: [{ protocol: "HTTP", type: "readinessProbe", path: healthPath, port, initialDelaySeconds: 10, periodSeconds: 30, timeoutSeconds: 5, failureThreshold: 3, successThreshold: 1 }],
    autoscaling: { horizontal: { enabled: false } }
  };
}

export async function deploy(body) {
  const runtimeId = clean(body.runtimeId || crypto.randomUUID(), 54);
  const serviceName = "haspad-" + runtimeId;
  const port = Number(body.port || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("INVALID_RUNTIME_PORT");

  const existing = await findService(runtimeId).catch(() => null);
  const projectId = required("NORTHFLANK_PROJECT_ID");
  const service = existing
    ? await nfRequest("/projects/" + encodeURIComponent(projectId) + "/services/combined/" + encodeURIComponent(existing.id), { method: "PATCH", body: JSON.stringify(servicePayload(body, serviceName)) })
    : await nfRequest("/projects/" + encodeURIComponent(projectId) + "/services/combined", { method: "POST", body: JSON.stringify(servicePayload(body, serviceName)) });

  const serviceId = service?.id || service?.serviceId || serviceName;
  const result = { success: true, accepted: true, runtimeId, provider: "northflank", serviceId, status: statusFromService(service), publicUrl: findUrl(service), host: body.host || null };
  jobs.set(runtimeId, { ...result, projectId, updatedAt: new Date().toISOString() });
  return result;
}

export async function getRuntimeStatus(runtimeId) {
  const rid = clean(runtimeId, 54);
  const projectId = required("NORTHFLANK_PROJECT_ID");
  const service = await findService(rid);
  if (!service) return jobs.get(rid) || { runtimeId: rid, status: "unknown", provider: "northflank" };
  const result = { runtimeId: rid, provider: "northflank", serviceId: service.id, status: statusFromService(service), buildStatus: service?.status?.build?.status || null, deploymentStatus: service?.status?.deployment?.status || null, publicUrl: findUrl(service), host: jobs.get(rid)?.host || null, projectId };
  jobs.set(rid, { ...jobs.get(rid), ...result, updatedAt: new Date().toISOString() });
  return result;
}

export async function getLogs(runtimeId) {
  const rid = clean(runtimeId, 54);
  const projectId = required("NORTHFLANK_PROJECT_ID");
  const service = await findService(rid);
  if (!service) throw new Error("RUNTIME_NOT_FOUND");
  const data = await nfRequest("/projects/" + encodeURIComponent(projectId) + "/services/" + encodeURIComponent(service.id) + "/logs?type=runtime&lineLimit=500&direction=backward");
  const logs = Array.isArray(data) ? data : [];
  return { runtimeId: rid, provider: "northflank", logs: logs.map((entry) => ({ ts: entry.ts, log: entry.log })) };
}

export async function rollback(body) {
  if (!body?.runtimeId) throw new Error("runtimeId_REQUIRED");
  return deploy(body);
}

export async function restartRuntime(runtimeId) {
  const rid = clean(runtimeId, 54);
  const projectId = required("NORTHFLANK_PROJECT_ID");
  const service = await findService(rid);
  if (!service) throw new Error("RUNTIME_NOT_FOUND");
  const data = await nfRequest("/projects/" + encodeURIComponent(projectId) + "/services/" + encodeURIComponent(service.id) + "/build", { method: "POST", body: JSON.stringify({ branch: service?.vcsData?.projectBranch || "main" }) });
  return { success: true, runtimeId: rid, provider: "northflank", status: "building", buildId: data?.id || null };
}

export async function stopRuntime() { throw new Error("NORTHFLANK_STOP_NOT_IMPLEMENTED"); }
