const admin = require('firebase-admin');
const serviceAccount = require('./firebase-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
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
"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
"Accept": "application/json, text/plain, /",
"Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
"Accept-Encoding": "gzip, deflate, br",
"Connection": "keep-alive",
"sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
"sec-ch-ua-mobile": "?0",
"sec-ch-ua-platform": '"Windows"',
"Sec-Fetch-Dest": "empty",
"Sec-Fetch-Mode": "cors",
"Sec-Fetch-Site": "same-origin",
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
      const areas = (result.data.data || []).join(', ');
await admin.messaging().sendToTopic('alerts', {
  notification: {
    title: '🚨 צבע אדום!',
    body: areas,
  },
  android: {
    priority: 'high',
    notification: {
      sound: 'default',
      priority: 'max',
    },
  },
});
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
  }

  // GET /test-alert - simulate alert for testing
  if (url.pathname === "/test-alert") {
    // create a fake alert entry and add to history
    const fake = {
      id: "test-" + Date.now(),
      cat: "1",
      title: "ירי רקטות",
      data: ["תל אביב", "רמת גן"],
      receivedAt: new Date().toISOString(),
    };
    lastAlertId = fake.id;
    alertHistory.unshift(fake); //
    if (alertHistory.length > 50) alertHistory.pop();

    return respond(res, 200, { ok: true, message: "התרעת ניסיון השרת של שחר" });
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
