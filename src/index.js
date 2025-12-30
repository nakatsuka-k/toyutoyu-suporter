const express = require("express");
const cron = require("node-cron");

const { getEnv, parseTargetUrls, nowJstString } = require("./config");
const { checkAll } = require("./checker");
const { notifyConsole } = require("./notifiers/console");
const { pushLineMessage, replyLineMessage, broadcastLineMessage } = require("./notifiers/line");
const { verifyLineSignature } = require("./lineWebhook");
const { LineSessionStore } = require("./lineSessionStore");
const { authCheck, getUserPoints } = require("./toyutoyuApi");
const { generateAiReply } = require("./aiResponder");

const app = express();

const PORT = Number(getEnv("PORT", { defaultValue: "8080" }));

const TARGET_URLS = parseTargetUrls(getEnv("TARGET_URLS"));
const TIMEOUT_MS = Number(getEnv("TIMEOUT_MS", { defaultValue: "10000" }));
const CRON_SCHEDULE = getEnv("CRON_SCHEDULE", { defaultValue: "*/15 * * * *" });
const CRON_TIMEZONE = getEnv("CRON_TIMEZONE", { defaultValue: "Asia/Tokyo" });

const LINE_CHANNEL_SECRET = getEnv("LINE_CHANNEL_SECRET", { defaultValue: "" });
const LINE_CHANNEL_ACCESS_TOKEN = getEnv("LINE_CHANNEL_ACCESS_TOKEN", { defaultValue: "" });
const LINE_TO = getEnv("LINE_TO", { defaultValue: "" });
const LINE_BROADCAST = getEnv("LINE_BROADCAST", { defaultValue: "0" }) === "1";

const TOYUTOYU_WP_BASE_URL = getEnv("TOYUTOYU_WP_BASE_URL", { defaultValue: "https://toyutoyu.com/app/" });
const LOGIN_FLOW_TTL_MS = Number(getEnv("LOGIN_FLOW_TTL_MS", { defaultValue: String(10 * 60 * 1000) }));
const LOGGED_IN_TTL_MS = Number(getEnv("LOGGED_IN_TTL_MS", { defaultValue: String(60 * 60 * 1000) }));

const OPENAI_API_KEY = getEnv("OPENAI_API_KEY", { defaultValue: "" });
const OPENAI_MODEL = getEnv("OPENAI_MODEL", { defaultValue: "gpt-4o" });

const sessionStore = new LineSessionStore({
  loginFlowTtlMs: LOGIN_FLOW_TTL_MS,
  loggedInTtlMs: LOGGED_IN_TTL_MS,
});

function normalizeText(text) {
  return String(text ?? "").trim();
}

function isValidEmail(email) {
  const v = String(email ?? "").trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isAiEligibleText(text) {
  const t = normalizeText(text);
  if (!t) return false;
  // Don't send credential-related text to AI.
  if (t.includes("パスワード")) return false;
  // Commands are handled elsewhere.
  if (t === "ログイン" || t === "ポイント" || t === "キャンセル") return false;
  return true;
}

function detectGuidedQa(text) {
  const t = normalizeText(text);
  if (!t) return null;

  // Q6: English-like payment screen (must be checked before generic payment).
  if ((t.includes("英語") || t.toLowerCase().includes("english")) && (t.includes("支払い") || t.includes("決済") || t.includes("画面"))) {
    return {
      key: "payment_english_screen",
      text:
        "支払い画面に英語のような表示が出ても、ポイント支払いは完了している場合があります😊\nそのまま入館していただいて問題ありません。\n\nこの表示は、システムメンテナンスや一時的な不具合が原因で出ることがあります。復旧までお待ちいただけますと幸いです。ご迷惑をおかけし、申し訳ございません。",
      imageUrls: ["https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/error-test.png"],
    };
  }

  // Q1: Password reset
  if (t.includes("パスワード") && (t.includes("再設定") || t.includes("リセット") || t.includes("忘"))) {
    return {
      key: "password_reset",
      text: "パスワードの再設定は、以下の画像の手順で行っていただけます📱",
      imageUrls: [
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488825_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488826_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488827_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488828_0.jpg",
      ],
    };
  }

  // Q3: New registration
  if (t.includes("新規登録") || t.includes("登録方法") || t.includes("アカウント作成") || t.includes("会員登録")) {
    return {
      key: "signup",
      text:
        "新規登録は、以下のQRコードを読み取っていただき、画像の手順に沿って進めてください😊\n\n不明点があれば、状況を教えてください。",
      imageUrls: [
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488834_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488836_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488837_0.jpg",
      ],
    };
  }

  // Q4: Account deletion
  if ((t.includes("アカウント") || t.includes("会員")) && (t.includes("削除") || t.includes("退会"))) {
    return {
      key: "account_delete",
      text: "アカウント削除は、以下の画像の手順で行っていただけます🧾",
      imageUrls: [
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488842_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488843_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488844_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488845_0.jpg",
      ],
    };
  }

  // Q5: Subscription cancellation
  if ((t.includes("サブスク") || t.includes("定期")) && (t.includes("解約") || t.includes("停止") || t.includes("キャンセル"))) {
    return {
      key: "subscription_cancel",
      text: "サブスクの解約は、以下の画像の手順で可能です🙆‍♂️",
      imageUrls: [
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488847_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488848_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488849_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488850_0.jpg",
      ],
    };
  }

  // Q2: Point purchase
  if (t.includes("ポイント") && (t.includes("購入") || t.includes("買") || t.includes("チャージ") || t.includes("課金"))) {
    return {
      key: "points_purchase",
      text: "ポイントの購入は、以下の画像の手順で可能です💳（サブスク・一括・チャージ対応）",
      imageUrls: [
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488832_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488833_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488829_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488830_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488831_0.jpg",
      ],
    };
  }

  // Q3(2): Facility point payment
  if ((t.includes("施設") || t.includes("入館")) && t.includes("ポイント") && (t.includes("支払") || t.includes("決済") || t.includes("使"))) {
    return {
      key: "facility_payment",
      text:
        "施設へのポイント支払いは、以下の方法で可能です😊（※詳細は画像をご確認ください。）",
      imageUrls: [
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488838_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488839_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488840_0.jpg",
        "https://pub-d1e01f0fee96410f83abf27aa8f5b7c7.r2.dev/S__5488841_0.jpg",
      ],
    };
  }

  return null;
}

function buildImageMessage(url) {
  return {
    type: "image",
    originalContentUrl: url,
    previewImageUrl: url,
  };
}

async function replyWithImagesIfNeeded({ userId, replyToken, text, imageUrls }) {
  const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
  const allMessages = [{ type: "text", text: String(text ?? "") }, ...urls.map(buildImageMessage)];

  const chunks = [];
  for (let i = 0; i < allMessages.length; i += 5) {
    chunks.push(allMessages.slice(i, i + 5));
  }

  const first = chunks.shift();
  if (!first) return;

  await replyLineMessage({ channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN, replyToken, messages: first });

  // LINEのreplyは1回限りなので、残りはpushで送る（個別チャット前提）
  for (const c of chunks) {
    await pushLineMessage({ channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN, to: userId, messages: c });
  }
}

async function replyUsage({ replyToken }) {
  await replyLineMessage({
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
    replyToken,
    text:
      "操作方法😊\n1) ログイン: 『ログイン』→メールアドレス→パスワード\n2) ポイント確認: ログイン後に『ポイント』\n3) 中断: 『キャンセル』",
  });
}

async function handleLineText({ userId, replyToken, text }) {
  const t = normalizeText(text);
  if (!t) return;

  if (!userId) {
    await replyLineMessage({
      channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
      replyToken,
      text: "個別チャット（ユーザーIDが取得できる環境）でお試しください。",
    });
    return;
  }

  if (t === "キャンセル") {
    sessionStore.clear(userId);
    await replyLineMessage({
      channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
      replyToken,
      text: "キャンセルしました。",
    });
    return;
  }

  if (t === "ログイン") {
    sessionStore.startLoginFlow(userId);
    await replyLineMessage({
      channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
      replyToken,
      text: "メールアドレスを送ってください。\n途中でやめる場合は「キャンセル」と送ってください。",
    });
    return;
  }

  if (t === "ポイント") {
    const sess = sessionStore.get(userId);
    if (!sess || sess.state !== "logged_in" || !sess.email) {
      await replyLineMessage({
        channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
        replyToken,
        text: "ポイント確認にはログインが必要です。まず「ログイン」と送ってください。",
      });
      return;
    }

    try {
      const result = await getUserPoints({ baseUrl: TOYUTOYU_WP_BASE_URL, email: sess.email });
      const points = result && typeof result === "object" && "points" in result ? result.points : "";
      await replyLineMessage({
        channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
        replyToken,
        text: `現在のポイントは ${points} です。`,
      });
    } catch (_err) {
      await replyLineMessage({
        channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
        replyToken,
        text: "ポイント取得に失敗しました。しばらくしてからもう一度お試しください。",
      });
    }

    return;
  }

  // Guided Q&A with images (only when NOT in login flow)
  const current = sessionStore.get(userId);
  if (!current || current.state !== "login") {
    const guided = detectGuidedQa(t);
    if (guided) {
      await replyWithImagesIfNeeded({ userId, replyToken, text: guided.text, imageUrls: guided.imageUrls });
      return;
    }
  }

  // If user is NOT in login flow, route other messages to AI (support/inquiry).
  if (!current || current.state !== "login") {
    if (t.includes("パスワード")) {
      await replyLineMessage({
        channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
        replyToken,
        text:
          "パスワードに関する案内です。ログインは『ログイン』→メールアドレス→パスワードの順で進めてください。\nパスワードの再設定などはサブスク詳細ページもあわせてご確認ください: https://toyutoyu.com/price",
      });
      return;
    }

    if (!OPENAI_API_KEY) {
      await replyUsage({ replyToken });
      return;
    }

    if (!isAiEligibleText(t)) {
      await replyUsage({ replyToken });
      return;
    }

    try {
      const aiText = await generateAiReply({ apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, userText: t });
      await replyLineMessage({
        channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
        replyToken,
        text: aiText || "恐れ入ります、うまく回答を生成できませんでした。『ログイン』『ポイント』などをお試しください。",
      });
    } catch (err) {
      const msg = err && typeof err === "object" && "message" in err ? err.message : String(err);
      await notifyConsole(`AI reply error: ${msg}`);
      await replyLineMessage({
        channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
        replyToken,
        text: "恐れ入ります、ただいま自動応答が混み合っています。少し時間をおいてからもう一度お試しください。",
      });
    }

    return;
  }

  const sess = current;
  if (!sess || sess.state !== "login") {
    await replyUsage({ replyToken });
    return;
  }

  if (sess.step === "await_email") {
    if (!isValidEmail(t)) {
      await replyLineMessage({
        channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
        replyToken,
        text: "メールアドレスの形式が正しくないようです。もう一度送ってください。",
      });
      return;
    }

    sessionStore.setAwaitPassword(userId, t);
    await replyLineMessage({
      channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
      replyToken,
      text: "パスワードを送ってください。\n途中でやめる場合は「キャンセル」と送ってください。",
    });
    return;
  }

  if (sess.step === "await_password") {
    const guided = detectGuidedQa(t);
    if (guided && guided.key === "password_reset") {
      await replyWithImagesIfNeeded({ userId, replyToken, text: guided.text, imageUrls: guided.imageUrls });
      return;
    }

    try {
      const result = await authCheck({
        baseUrl: TOYUTOYU_WP_BASE_URL,
        email: sess.email,
        password: t,
      });

      if (result && typeof result === "object" && result.success === true) {
        const wpUserId = "user_id" in result ? result.user_id : null;
        sessionStore.setLoggedIn(userId, { email: sess.email, wpUserId });
        await replyLineMessage({
          channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
          replyToken,
          text: "ログインOKです。\nポイントを確認する場合は「ポイント」と送ってください。",
        });
        return;
      }

      await replyLineMessage({
        channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
        replyToken,
        text: "メールアドレスまたはパスワードが正しくありません。\nやり直す場合は「ログイン」と送ってください。",
      });
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 0;
      if (status === 401) {
        await replyLineMessage({
          channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
          replyToken,
          text: "メールアドレスまたはパスワードが正しくありません。\nやり直す場合は「ログイン」と送ってください。",
        });
        return;
      }

      await replyLineMessage({
        channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
        replyToken,
        text: "認証処理でエラーが発生しました。しばらくしてからもう一度お試しください。",
      });
    }

    return;
  }

  await replyLineMessage({
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
    replyToken,
    text: "操作: 「ログイン」→ メールアドレス → パスワード の順に送ってください。",
  });
}

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
  async (req, res) => {
    try {
      await notifyConsole(
        `LINE webhook received: content-length=${req.get("content-length") || ""} has-signature=${Boolean(
          req.get("x-line-signature")
        )}`
      );
    } catch (_err) {
      // ignore logging errors
    }

    const signature = req.get("x-line-signature") || "";
    const valid = verifyLineSignature({
      channelSecret: LINE_CHANNEL_SECRET,
      rawBodyBuffer: req.body,
      signature,
    });

    if (!valid) {
      await notifyConsole("LINE webhook: invalid signature (check LINE_CHANNEL_SECRET)");
      return res.status(401).send("invalid signature");
    }

    // Ack ASAP. We'll process events after sending the response.
    res.status(200).send("ok");

    if (!LINE_CHANNEL_ACCESS_TOKEN) {
      await notifyConsole("LINE webhook: missing LINE_CHANNEL_ACCESS_TOKEN (cannot reply)");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(req.body).toString("utf8"));
    } catch (_err) {
      await notifyConsole("LINE webhook: invalid JSON body");
      return;
    }

    const events = payload && typeof payload === "object" && Array.isArray(payload.events) ? payload.events : [];
    await notifyConsole(`LINE webhook: events=${events.length}`);

    for (const ev of events) {
      try {
        if (!ev || typeof ev !== "object") continue;
        if (ev.type !== "message") continue;
        if (!ev.message || typeof ev.message !== "object") continue;
        if (ev.message.type !== "text") continue;
        if (!ev.replyToken) continue;

        const userId = ev.source && typeof ev.source === "object" ? ev.source.userId : "";
        await handleLineText({ userId, replyToken: ev.replyToken, text: ev.message.text });
      } catch (err) {
        const msg = err && typeof err === "object" && "message" in err ? err.message : String(err);
        await notifyConsole(`LINE webhook handler error: ${msg}`);
      }
    }
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
      return `・${f.url} エラー: ${f.error}`;
    }
    return `・${f.url} HTTP ${f.status} ${f.statusText || ""}`.trim();
  });

  return lines.join("\n");
}

async function runCheckOnce() {
  const { failures } = await checkAll(TARGET_URLS, { timeoutMs: TIMEOUT_MS });

  if (failures.length === 0) {
    return;
  }

  const message = [
    "【と湯と湯 みまもり】あれれ？サイトが開けないみたいです…（しょんぼり）",
    `時刻(JST): ${nowJstString()}`,
    "うまく確認できなかったURLはこちらです（404はOK扱いです）:",
    formatFailures({ failures }),
  ].join("\n");

  await notify(message);
}

app.listen(PORT, "0.0.0.0", () => {
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
        "【と湯と湯 みまもり】ごめんなさい…監視処理でエラーが出ちゃいました",
        `時刻(JST): ${nowJstString()}`,
        `内容: ${msg}`,
      ].join("\n")
    );
  }
}, { timezone: CRON_TIMEZONE });
