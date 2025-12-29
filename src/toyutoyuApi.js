function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl ?? "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

async function authCheck({ baseUrl, email, password, timeoutMs = 10000 }) {
  const { signal, clear } = withTimeout(timeoutMs);

  try {
    const base = normalizeBaseUrl(baseUrl);
    const url = new URL("wp-json/toyutoyu/v1/auth-check", base);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
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
    const base = normalizeBaseUrl(baseUrl);
    const url = new URL("wp-json/toyutoyu/v1/user-points", base);
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
