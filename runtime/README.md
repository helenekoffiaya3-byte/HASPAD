# HASPAD Docker Runtime

This directory is the execution plane for Docker applications. Netlify remains the HASPAD control plane.

## Architecture

Netlify Functions -> HTTPS/HMAC -> runtime worker -> local Docker Engine -> Traefik -> application container.

The worker is the only component that needs access to the Docker Unix socket. Do not expose Docker Engine on TCP 2375.

## Host prerequisites

- Linux VPS/VM with Docker Engine and Docker Compose
- public DNS record for `runtime.haspad.com` pointing to the runtime host
- ports 80 and 443 reachable from the Internet
- a DNS hostname under `haspad.com` for each deployed application

Traefik obtains certificates with ACME HTTP-01; HTTP-01 requires the public host to be reachable on port 80 and HTTPS applications use port 443.

## Configure

1. Copy `runtime/.env.example` to `runtime/.env`.
2. Generate a long random `RUNTIME_SHARED_SECRET`.
3. Set `RUNTIME_CONTROL_DOMAIN=runtime.haspad.com`.
4. Set `LETSENCRYPT_EMAIL`.
5. On Netlify, set the same `HASPAD_RUNTIME_SHARED_SECRET` and `HASPAD_RUNTIME_URL=https://runtime.haspad.com`.
6. Start the runtime:

```bash
cd runtime
mkdir -p letsencrypt
touch letsencrypt/acme.json
chmod 600 letsencrypt/acme.json
docker compose up -d --build
```

7. Verify the worker through HASPAD's authenticated runtime endpoint.

The worker accepts only signed requests from HASPAD. The Docker socket is never exposed to the public network.

## Security defaults

Application containers receive memory, CPU and PID limits, no-new-privileges, all Linux capabilities dropped, a read-only root filesystem, a temporary `/tmp`, and a dedicated Docker network. The worker itself is trusted infrastructure because Docker socket access is equivalent to host-level control.

Build secrets must not be put in Dockerfile `ARG` or `ENV`; use BuildKit secret mounts when a project genuinely needs a build secret.
