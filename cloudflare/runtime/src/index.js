import { Container } from "cloudflare:containers";

export class HasPadContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      PORT: "3000"
    };
  }

  async fetch(request) {
    return await super.fetch(request);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "haspad-runtime", provider: "cloudflare-containers" });
    }

    const id = env.HASPAD_CONTAINER.idFromName("default");
    const container = env.HASPAD_CONTAINER.get(id);
    return container.fetch(request);
  }
};
