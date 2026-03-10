const http = require("http");
const https = require("https");

const PORT = 3000;

// ─── Fetch from oref.org.il ──────────────────────────────────────────────────
function fetchOref(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "www.oref.org.il",
      path,
      method: "GET",
      headers: {
        "Referer": "https://www.oref.org.il/",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          // oref sometimes returns BOM or empty string
          const cleaned = data.replace(/^\uFEFF/, "").trim();
          const json = cleaned ? JSON.parse(cleaned) : null;
          resolve({ status: res.statusCode, data: json, raw: cleaned });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

// ─── In-memory alert history ─────────────────────────────────────────────────
const alertHistory = [];
let lastAlertId = null;

async function pollAlerts() {
  try {
    const result = await fetchOref("/WarningMessages/alert/alerts.json");

    if (result.data && result.data.id && result.data.id !== lastAlertId) {
      lastAlertId = result.data.id;
      const entry = {
        ...result.data,
        receivedAt: new Date().toISOString(),
      };
      alertHistory.unshift(entry);
      if (alertHistory.length > 50) alertHistory.pop();
      console.log(`🚨 התרעה חדשה! [${result.data.id}]`, result.data.data);
    }
  } catch (err) {
    console.error("Poll error:", err.message);
  }
}

// Poll every 2 seconds
setInterval(pollAlerts, 2000);
pollAlerts(); // immediate first call

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

function respond(res, status, body) {
  res.writeHead(status, CORS_HEADERS);
  res.end(JSON.stringify(body, null, 2));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /alerts — current active alerts
  if (url.pathname === "/alerts") {
    try {
      const result = await fetchOref("/WarningMessages/alert/alerts.json");
      return respond(res, 200, {
        active: result.data ? true : false,
        alert: result.data,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      return respond(res, 500, { error: err.message });
    }
  }

  // GET /history — last 50 alerts seen since server started
  if (url.pathname === "/history") {
    return respond(res, 200, {
      count: alertHistory.length,
      alerts: alertHistory,
    });
  }

  // GET /districts — all alert districts/areas
  if (url.pathname === "/districts") {
    try {
      const result = await fetchOref("/districts/districts.json");
      return respond(res, 200, result.data || { error: "empty response" });
    } catch (err) {
      return respond(res, 500, { error: err.message });
    }
  }

  // GET /health — server status
  if (url.pathname === "/health") {
    return respond(res, 200, {
      status: "ok",
      uptime: Math.floor(process.uptime()),
      historyCount: alertHistory.length,
      lastAlertId,
      serverTime: new Date().toISOString(),
    });
  // GET /test-alert - simulate alert for testing
  if (url.pathname === "/test-alert") {
    lastAlert = { id: "test-" + Date.now(), cat: "1", title: "ירי רקטות", data: ["תל אביב", "רמת גן"] };
    lastAlertActive = true;
    setTimeout(() => { lastAlertActive = false; }, 10000);
    return respond(res, 200, { ok: true, message: ss"התרעת ניסיון השרת של שחר " });
  }
  }


  // 404
  return respond(res, 404, {
    error: "Not found",
    routes: ["/alerts", "/history", "/districts", "/health"],
  });
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   🚨  Oref Proxy Server  – פועל!        ║
╠══════════════════════════════════════════╣
║  http://localhost:${PORT}/health            ║
║  http://localhost:${PORT}/alerts            ║
║  http://localhost:${PORT}/history           ║
║  http://localhost:${PORT}/districts         ║
╚══════════════════════════════════════════╝

מתחיל polling כל 2 שניות...
`);
});
