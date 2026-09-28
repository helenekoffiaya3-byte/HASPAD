import { Container, getContainer } from "@cloudflare/containers";

export class HasPadContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      PORT: "3000"
    };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "haspad-runtime",
        provider: "cloudflare-containers"
      });
    }

    return getContainer(env.HASPAD_CONTAINER, "default").fetch(request);
  }
};
