import crypto from "node:crypto";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];

function required(name) {
  const value = env(name);
  if (!value) throw new Error(name + "_NOT_CONFIGURED");
  return value;
}

const apiBase = () => (env("NORTHFLANK_API_URL") || "https://api.northflank.com/v1").replace(/\/$/, "");

async function nfRequest(path, options = {}) {
  const token = required("NORTHFLANK_API_TOKEN");
  const response = await fetch(apiBase() + path, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: "Bearer " + token,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || data?.data?.message || "NORTHFLANK_API_ERROR");
    error.status = response.status;
    throw error;
  }
  return data?.data ?? data;
}

function serviceName(buildId) {
  const suffix = String(buildId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36);
  return "haspad-" + (suffix || crypto.randomUUID().replace(/-/g, "").slice(0, 12));
}

function serviceTag(buildId) {
  return "haspad-build-" + String(buildId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 70);
}

async function findService(buildId) {
  const tag = serviceTag(buildId);
  const data = await nfRequest("/projects/" + encodeURIComponent(required("NORTHFLANK_PROJECT_ID")) + "/services?per_page=100");
  return (data?.services || []).find(service => Array.isArray(service.tags) && service.tags.includes(tag)) || null;
}

function normaliseState(service) {
  const build = String(service?.status?.build?.status || "").toUpperCase();
  const deployment = String(service?.status?.deployment?.status || "").toUpperCase();
  if (["FAILURE", "SUBMISSION_FAILURE", "ABORTED"].includes(build) || deployment === "FAILED") return "failed";
  if (deployment === "COMPLETED" && build === "SUCCESS") return "running";
  if (["QUEUED", "PENDING", "STARTING", "CLONING", "BUILDING", "UPLOADING", "IN_PROGRESS"].includes(build) || ["PENDING", "IN_PROGRESS"].includes(deployment)) return "building";
  if (build === "CRASHED") return "failed";
  return deployment.toLowerCase() || build.toLowerCase() || "building";
}

function publicUrl(service) {
  const explicit = service?.ports?.flatMap?.(port => port?.domains || []).find(Boolean);
  if (explicit) return /^https?:\/\//i.test(explicit) ? explicit : "https://" + explicit;
  const lb = service?.cluster?.loadBalancers?.find(Boolean);
  if (lb) return /^https?:\/\//i.test(lb) ? lb : "https://" + lb;
  return null;
}

export async function deployNorthflank({ buildId, owner, name, branch, port, healthcheckPath, host }) {
  const projectId = required("NORTHFLANK_PROJECT_ID");
  const deploymentPlan = required("NORTHFLANK_DEPLOYMENT_PLAN");
  const buildPlan = required("NORTHFLANK_BUILD_PLAN");
  const githubAccount = env("NORTHFLANK_GITHUB_ACCOUNT_LOGIN");
  const serviceTagValue = serviceTag(buildId);
  const existing = await findService(buildId);
  const payload = {
    name: existing?.name || serviceName(buildId),
    description: "HASPAD deployment " + String(buildId).slice(0, 48),
    billing: { deploymentPlan, buildPlan },
    deployment: {
      instances: 1,
      docker: { configType: "default" }
    },
    buildSource: "git",
    vcsData: {
      projectUrl: "https://github.com/" + owner + "/" + name,
      projectType: "github",
      projectBranch: branch,
      ...(githubAccount ? { accountLogin: githubAccount } : {})
    },
    buildSettings: {
      dockerfile: {
        buildEngine: "buildkit",
        dockerFilePath: "/Dockerfile",
        dockerWorkDir: "/"
      }
    },
    buildConfiguration: {
      ciIgnoreFlags: ["[skip ci]", "[ci skip]", "[no ci]", "[skip nf]", "[nf skip]", "[northflank skip]"]
    },
    ports: [{
      name: "http",
      internalPort: Number(port),
      public: true,
      vpcAccessible: false,
      protocol: "HTTP",
      ...(host ? { domains: [host] } : {})
    }],
    healthChecks: [{
      protocol: "HTTP",
      type: "readinessProbe",
      path: String(healthcheckPath || "/"),
      port: Number(port),
      initialDelaySeconds: 10,
      periodSeconds: 30,
      timeoutSeconds: 5,
      failureThreshold: 3,
      successThreshold: 1
    }],
    tags: [serviceTagValue]
  };

  const service = existing
    ? await nfRequest("/projects/" + encodeURIComponent(projectId) + "/services/combined/" + encodeURIComponent(existing.id), {
        method: "PATCH",
        body: JSON.stringify(payload)
      })
    : await nfRequest("/projects/" + encodeURIComponent(projectId) + "/services/combined", {
        method: "PUT",
        body: JSON.stringify(payload)
      });

  return {
    status: normaliseState(service),
    serviceId: service?.id || existing?.id || null,
    publicUrl: publicUrl(service),
    rawStatus: service?.status || null
  };
}

export async function northflankStatus(buildId) {
  const service = await findService(buildId);
  if (!service) throw new Error("NORTHFLANK_SERVICE_NOT_FOUND");
  return {
    status: normaliseState(service),
    serviceId: service.id,
    publicUrl: publicUrl(service),
    rawStatus: service.status || null
  };
}
