/**
 * Local static server + API proxy for the Electron desktop app.
 * Matches run_desktop.py so navigation, scripts, and API calls work in release builds.
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT) || 17890;
const DISCORD_PORT = 3001;
// Default API is prod; SCHOLAXIA_API overrides per-run (e.g. local dev server).
const REMOTE_API = (process.env.SCHOLAXIA_API || "https://scholaxia1.onrender.com").replace(/\/$/, "");
const REMOTE_USE_HTTP = REMOTE_API.indexOf("http://") === 0;
const REMOTE_HTTP_MODULE = REMOTE_USE_HTTP ? require("http") : https;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

let server = null;

function rendererDir() {
  return path.join(__dirname, "renderer");
}

function sendCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function proxyApi(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let remotePath = url.pathname.slice("/api-proxy".length);
  if (!remotePath.startsWith("/")) remotePath = "/" + remotePath;
  if (url.search) remotePath += url.search;

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = chunks.length ? Buffer.concat(chunks) : null;
    const headers = {};
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;

    const proxyReq = REMOTE_HTTP_MODULE.request(
      REMOTE_API + remotePath,
      { method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, {
          "Content-Type": proxyRes.headers["content-type"] || "application/json",
        });
        proxyRes.pipe(res);
      }
    );

    // HARD DEADLINE: when the internet drops mid-request the outbound TCP
    // connect can hang for MINUTES with no error event, leaving the renderer
    // waiting forever (student saw "submit does nothing"). Fail fast so the
    // app's own submit fallback (local score + queued sync) can take over.
    proxyReq.setTimeout(15000, () => {
      proxyReq.destroy(new Error("proxy timeout"));
    });

    proxyReq.on("error", () => {
      if (res.headersSent) { try { res.end(); } catch (e) {} return; }
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "API proxy error" }));
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}

const SKIP_DISCORD_HEADERS = new Set([
  "transfer-encoding",
  "connection",
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
]);

function proxyDiscord(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const targetPath = url.pathname + (url.search || "");

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = chunks.length ? Buffer.concat(chunks) : null;
    const headers = {};
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
    if (req.headers.accept) headers.Accept = req.headers.accept;
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;

    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: DISCORD_PORT,
        path: targetPath,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const outHeaders = { "X-Frame-Options": "SAMEORIGIN" };
        Object.entries(proxyRes.headers).forEach(([key, value]) => {
          if (!value || SKIP_DISCORD_HEADERS.has(key.toLowerCase())) return;
          outHeaders[key] = value;
        });
        res.writeHead(proxyRes.statusCode || 502, outHeaders);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", () => {
      res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<h2>Community server not running</h2><p>Run START-DISCORD.bat or npm run dev in scholaxia/discord-community</p>"
      );
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/app.html";

  const filePath = path.normalize(path.join(rendererDir(), rel.replace(/^\//, "")));
  const root = path.normalize(rendererDir());
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if ([".html", ".js", ".css"].includes(ext)) {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      headers.Pragma = "no-cache";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function waitForHealth(timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api-proxy/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(`http://127.0.0.1:${PORT}`);
        else if (Date.now() < deadline) setTimeout(tick, 200);
        else reject(new Error("Desktop server health check failed"));
      });
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(tick, 200);
        else reject(new Error("Desktop server did not start"));
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (Date.now() < deadline) setTimeout(tick, 200);
        else reject(new Error("Desktop server timed out"));
      });
    };
    tick();
  });
}

function startDesktopServer() {
  if (server) {
    return waitForHealth(5000);
  }

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

      if (url.pathname === "/api-proxy/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
        return;
      }

      // Tells the renderer where the real backend lives, so the classroom chat
      // WebSocket dials the SAME server the REST proxy targets. desktop-server
      // cannot proxy WebSocket upgrades itself, so the renderer needs the origin.
      if (url.pathname === "/backend-origin") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ api: REMOTE_API, ws: REMOTE_API.replace(/^http/i, "ws") }));
        return;
      }

      if (url.pathname.startsWith("/api-proxy")) {
        if (req.method === "OPTIONS") {
          sendCors(res);
          res.writeHead(204);
          res.end();
          return;
        }
        proxyApi(req, res);
        return;
      }

      if (url.pathname.startsWith("/discord-app")) {
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        proxyDiscord(req, res);
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end("Method not allowed");
        return;
      }

      serveStatic(req, res);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        waitForHealth(3000).then(resolve).catch(reject);
        return;
      }
      reject(err);
    });

    server.listen(PORT, "127.0.0.1", () => {
      waitForHealth(5000).then(resolve).catch(reject);
    });
  });
}

function stopDesktopServer() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = { startDesktopServer, stopDesktopServer, PORT };
