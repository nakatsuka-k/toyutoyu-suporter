function getEnv(name, { required = false, defaultValue = undefined } = {}) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (required) {
      throw new Error(`Missing required env var: ${name}`);
    }
    return defaultValue;
  }
  return value;
}

function parseTargetUrls(value) {
  const raw = (value ?? "").trim();
  if (!raw) {
    return ["https://toyutoyu.com/app/", "https://toyutoyu.com/"];
  }

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function nowJstString() {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return formatter.format(new Date());
}

module.exports = {
  getEnv,
  parseTargetUrls,
  nowJstString,
};
