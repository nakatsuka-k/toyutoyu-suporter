const DEFAULT_LOGIN_FLOW_TTL_MS = 10 * 60 * 1000;
const DEFAULT_LOGGED_IN_TTL_MS = 60 * 60 * 1000;

function nowMs() {
  return Date.now();
}

class LineSessionStore {
  constructor({ loginFlowTtlMs = DEFAULT_LOGIN_FLOW_TTL_MS, loggedInTtlMs = DEFAULT_LOGGED_IN_TTL_MS } = {}) {
    this.loginFlowTtlMs = loginFlowTtlMs;
    this.loggedInTtlMs = loggedInTtlMs;
    this.sessions = new Map();
  }

  cleanupExpired() {
    const t = nowMs();
    for (const [userId, sess] of this.sessions.entries()) {
      if (sess.expiresAtMs && sess.expiresAtMs <= t) {
        this.sessions.delete(userId);
      }
    }
  }

  get(userId) {
    this.cleanupExpired();
    return this.sessions.get(userId) || null;
  }

  startLoginFlow(userId) {
    const sess = {
      state: "login",
      step: "await_email",
      email: null,
      userId: null,
      expiresAtMs: nowMs() + this.loginFlowTtlMs,
    };
    this.sessions.set(userId, sess);
    return sess;
  }

  setAwaitPassword(userId, email) {
    const sess = {
      state: "login",
      step: "await_password",
      email,
      userId: null,
      expiresAtMs: nowMs() + this.loginFlowTtlMs,
    };
    this.sessions.set(userId, sess);
    return sess;
  }

  setLoggedIn(userId, { email, wpUserId }) {
    const sess = {
      state: "logged_in",
      step: null,
      email,
      userId: wpUserId,
      expiresAtMs: nowMs() + this.loggedInTtlMs,
    };
    this.sessions.set(userId, sess);
    return sess;
  }

  clear(userId) {
    this.sessions.delete(userId);
  }
}

module.exports = {
  LineSessionStore,
};
