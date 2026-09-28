import http from "node:http";

const port = Number(process.env.PORT || 3000);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "haspad-runtime-container" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    ok: true,
    service: "haspad-runtime-container",
    message: "HASPAD Cloudflare Container runtime is running"
  }));
});

server.listen(port, "0.0.0.0");
