function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function authCheck({ baseUrl, webhookSecret, email, password, timeoutMs = 10000 }) {
  const { signal, clear } = withTimeout(timeoutMs);

  try {
    const url = new URL("/wp-json/toyutoyu/v1/auth-check", baseUrl);

    const headers = {
      "content-type": "application/json",
    };

    // webhookSecret is optional depending on WP side configuration.
    if (webhookSecret) {
      headers["x-toyutoyu-webhook-secret"] = webhookSecret;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password }),
      signal,
    });

    const text = await res.text().catch(() => "");
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const message =
        json && typeof json === "object" && "message" in json
          ? String(json.message)
          : text || `${res.status} ${res.statusText}`;

      const err = new Error(`auth-check failed: ${res.status} ${message}`.trim());
      err.status = res.status;
      err.body = json ?? text;
      throw err;
    }

    if (!json || typeof json !== "object") {
      const err = new Error("auth-check returned non-json response");
      err.status = res.status;
      err.body = text;
      throw err;
    }

    return json;
  } finally {
    clear();
  }
}

async function getUserPoints({ baseUrl, email, timeoutMs = 10000 }) {
  const { signal, clear } = withTimeout(timeoutMs);

  try {
    const url = new URL("/wp-json/toyutoyu/v1/user-points", baseUrl);
    url.searchParams.set("email", email);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json",
      },
      signal,
    });

    const text = await res.text().catch(() => "");
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const message =
        json && typeof json === "object" && "message" in json
          ? String(json.message)
          : text || `${res.status} ${res.statusText}`;

      const err = new Error(`user-points failed: ${res.status} ${message}`.trim());
      err.status = res.status;
      err.body = json ?? text;
      throw err;
    }

    if (!json || typeof json !== "object") {
      const err = new Error("user-points returned non-json response");
      err.status = res.status;
      err.body = text;
      throw err;
    }

    return json;
  } finally {
    clear();
  }
}

module.exports = {
  authCheck,
  getUserPoints,
};
