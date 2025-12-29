async function checkUrl(url, { timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "toyutoyu-suporter/1.0 (+https://toyutoyu.com)",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const ok = (res.status >= 200 && res.status < 300) || res.status === 404;
    return {
      url,
      ok,
      status: res.status,
      statusText: res.statusText,
    };
  } catch (err) {
    const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);

    // Treat our own timeout abort as OK (requested behavior).
    // Node's fetch (undici) may throw DOMException/AbortError with message like:
    // "This operation was aborted".
    if (/operation was aborted/i.test(msg)) {
      return {
        url,
        ok: true,
        status: null,
        statusText: "aborted",
      };
    }

    return {
      url,
      ok: false,
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkAll(urls, { timeoutMs }) {
  const results = await Promise.all(urls.map((url) => checkUrl(url, { timeoutMs })));
  const failures = results.filter((r) => !r.ok);
  return { results, failures };
}

module.exports = {
  checkUrl,
  checkAll,
};
