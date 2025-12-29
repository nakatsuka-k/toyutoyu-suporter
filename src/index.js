const express = require("express");
const cron = require("node-cron");

const { getEnv, parseTargetUrls, nowJstString } = require("./config");
const { checkAll } = require("./checker");
const { notifyConsole } = require("./notifiers/console");
const { pushLineMessage, broadcastLineMessage } = require("./notifiers/line");
const { verifyLineSignature } = require("./lineWebhook");

const app = express();

const PORT = Number(getEnv("PORT", { defaultValue: "8080" }));

const TARGET_URLS = parseTargetUrls(getEnv("TARGET_URLS"));
const TIMEOUT_MS = Number(getEnv("TIMEOUT_MS", { defaultValue: "10000" }));
const CRON_SCHEDULE = getEnv("CRON_SCHEDULE", { defaultValue: "0 * * * *" });
const CRON_TIMEZONE = getEnv("CRON_TIMEZONE", { defaultValue: "Asia/Tokyo" });

const LINE_CHANNEL_SECRET = getEnv("LINE_CHANNEL_SECRET", { defaultValue: "" });
const LINE_CHANNEL_ACCESS_TOKEN = getEnv("LINE_CHANNEL_ACCESS_TOKEN", { defaultValue: "" });
const LINE_TO = getEnv("LINE_TO", { defaultValue: "" });
const LINE_BROADCAST = getEnv("LINE_BROADCAST", { defaultValue: "0" }) === "1";

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.type("text/plain").send("toyutoyu-suporter is running\n");
});

// Optional LINE webhook endpoint (URL is optional per your request)
app.post(
  "/callback",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.get("x-line-signature") || "";
    const valid = verifyLineSignature({
      channelSecret: LINE_CHANNEL_SECRET,
      rawBodyBuffer: req.body,
      signature,
    });

    if (!valid) {
      return res.status(401).send("invalid signature");
    }

    // We don't need to respond to events for this monitoring use-case.
    return res.status(200).send("ok");
  }
);

async function notify(text) {
  // Always log
  await notifyConsole(text);

  // Optional LINE notification
  if (!LINE_CHANNEL_ACCESS_TOKEN) return;

  if (LINE_BROADCAST) {
    await broadcastLineMessage({
      channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
      text,
    });
    return;
  }

  if (LINE_TO) {
    await pushLineMessage({
      channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
      to: LINE_TO,
      text,
    });
  }
}

function formatFailures({ failures }) {
  const lines = failures.map((f) => {
    if (f.error) {
      return `- ${f.url} ERROR: ${f.error}`;
    }
    return `- ${f.url} HTTP ${f.status} ${f.statusText || ""}`.trim();
  });

  return lines.join("\n");
}

async function runCheckOnce() {
  const { failures } = await checkAll(TARGET_URLS, { timeoutMs: TIMEOUT_MS });

  if (failures.length === 0) {
    return;
  }

  const message = [
    "[toyutoyu-suporter] 疎通確認エラー",
    `時刻(JST): ${nowJstString()}`,
    "対象:",
    formatFailures({ failures }),
  ].join("\n");

  await notify(message);
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Listening on :${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Cron schedule: ${CRON_SCHEDULE}`);
  // eslint-disable-next-line no-console
  console.log(`Targets: ${TARGET_URLS.join(", ")}`);
});

cron.schedule(CRON_SCHEDULE, async () => {
  try {
    await runCheckOnce();
  } catch (err) {
    const msg = err && typeof err === "object" && "message" in err ? err.message : String(err);
    await notify(
      [
        "[toyutoyu-suporter] 監視処理自体が例外",
        `時刻(JST): ${nowJstString()}`,
        `ERROR: ${msg}`,
      ].join("\n")
    );
  }
}, { timezone: CRON_TIMEZONE });
