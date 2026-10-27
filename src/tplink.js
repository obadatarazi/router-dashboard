"use strict";

const crypto = require("crypto");
const { load } = require("cheerio");

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 12000);
const LOGIN_PASSWORD_PLACEHOLDER = "Ha2S+eOKqmzA6nrlmTeh7w==";

function md5Hex(value) {
  return crypto.createHash("md5").update(String(value), "utf8").digest("hex");
}

function baseUrl(host) {
  return `http://${host}`;
}

function parseCookie(setCookieHeaders) {
  if (!setCookieHeaders) return "";
  const list = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders];
  return list
    .map((h) => String(h).split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookies(existing, setCookieHeaders) {
  const map = new Map();
  for (const part of String(existing || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const i = part.indexOf("=");
    if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const part of parseCookie(setCookieHeaders)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const i = part.indexOf("=");
    if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

class TpLinkClient {
  constructor({ host, user, pass }) {
    this.host = host;
    this.user = user;
    this.pass = pass;
    this.cookie = "";
    this.cache = { at: 0, data: null, error: null };
  }

  headers(extra = {}) {
    const origin = baseUrl(this.host);
    return {
      "User-Agent":
        "Mozilla/5.0 (compatible; RouterDashboard/1.0; +local-status)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "close",
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...extra,
    };
  }

  async request(path, { method = "GET", body, referer, redirect = "manual" } = {}) {
    const url = `${baseUrl(this.host)}${path}`;
    const headers = this.headers({
      Referer: referer || `${baseUrl(this.host)}/rpSys.html`,
    });
    if (body != null) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect,
    });

    let cookies = [];
    try {
      cookies =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : [];
    } catch {
      cookies = [];
    }
    if (cookies.length) {
      this.cookie = mergeCookies(this.cookie, cookies);
    }

    const text = await res.text();
    const location = res.headers.get("location") || "";
    return { status: res.status, text, location, url: res.url || url };
  }

  async login() {
    this.cookie = "";
    await this.request("/login_security.html", {
      referer: `${baseUrl(this.host)}/`,
    });

    const params = new URLSearchParams();
    params.set("tipsFlag", "0");
    params.set("timevalue", "0");
    params.set("Login_Name", this.user);
    params.set("Login_Pwd", LOGIN_PASSWORD_PLACEHOLDER);
    params.set("uiWebLoginhiddenUsername", md5Hex(this.user));
    params.set("uiWebLoginhiddenPassword", md5Hex(this.pass));

    const res = await this.request("/Forms/login_security_1", {
      method: "POST",
      body: params.toString(),
      referer: `${baseUrl(this.host)}/login_security.html`,
      redirect: "manual",
    });

    // Follow one redirect if present
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = res.location.startsWith("http")
        ? res.location.replace(baseUrl(this.host), "")
        : res.location.startsWith("/")
          ? res.location
          : `/${res.location}`;
      await this.request(next, {
        referer: `${baseUrl(this.host)}/login_security.html`,
      });
    }

    // Probe authenticated page
    const probe = await this.request("/status/status_deviceinfo.htm", {
      referer: `${baseUrl(this.host)}/navigation-status.html`,
    });

    if (
      /login_security|403 Forbidden|illegal referer|Error Message/i.test(
        probe.text
      ) ||
      probe.status === 403
    ) {
      const err = new Error(
        "Login failed or session rejected (wrong password, lockout, or referer block)"
      );
      err.code = "AUTH_FAILED";
      throw err;
    }

    return true;
  }

  async fetchDeviceInfoHtml() {
    let res = await this.request("/status/status_deviceinfo.htm", {
      referer: `${baseUrl(this.host)}/navigation-status.html`,
    });

    if (
      /login_security/i.test(res.text) ||
      /403 Forbidden|illegal referer/i.test(res.text)
    ) {
      await this.login();
      res = await this.request("/status/status_deviceinfo.htm", {
        referer: `${baseUrl(this.host)}/navigation-status.html`,
      });
    }

    if (/403 Forbidden|illegal referer/i.test(res.text)) {
      const err = new Error("Router returned 403 Forbidden: illegal referer");
      err.code = "FORBIDDEN";
      throw err;
    }
    if (/login_security/i.test(res.text)) {
      const err = new Error("Not authenticated after login");
      err.code = "AUTH_FAILED";
      throw err;
    }

    return res.text;
  }

  parseDeviceInfo(html) {
    // Insert spaces between tags so table cells do not concatenate (e.g. PVC48/35…)
    const spaced = String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/<\/(td|th|tr|div|p|br|li)>/gi, " ")
      .replace(/<(br|hr)\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const $ = load(html);
    const text = ($("body").text() || "").replace(/\u00a0/g, " ");
    // Prefer spaced HTML text for tabular fields
    const t = spaced.length > 50 ? spaced : text.replace(/\s+/g, " ");

    const pair = (label) => {
      const re = new RegExp(
        `${label}[\\s\\S]*?:\\s*([\\d.]+)\\s+([\\d.]+)`,
        "i"
      );
      const m = t.match(re) || text.match(re);
      return m
        ? { down: Number(m[1]), up: Number(m[2]) }
        : { down: null, up: null };
    };

    const single = (label) => {
      const re = new RegExp(
        `${label}\\s*:\\s*(\\S+(?:\\s+\\S+){0,6}?)(?=\\s+(?:Line State|Modulation|Annex Mode|SNR Margin|Line Attenuation|Data Rate|Max Rate|CRC|Downstream|Upstream|WAN|Wireless)\\b|$)`,
        "i"
      );
      const m = t.match(re) || text.match(re);
      if (!m) return null;
      return m[1].replace(/\s+/g, " ").trim();
    };

    const wifiClients = [];
    const macRe = /\b([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})\b/g;
    const wifiSection = t.match(
      /Current Connected Wireless Clients[\s\S]*?(?=WAN\b|ADSL\b|$)/i
    );
    const macSource = wifiSection ? wifiSection[0] : t;
    let mm;
    const seen = new Set();
    while ((mm = macRe.exec(macSource))) {
      const mac = mm[1].toUpperCase();
      if (mac === "00:00:00:00:00:00") continue;
      if (seen.has(mac)) continue;
      seen.add(mac);
      wifiClients.push({ mac });
    }

    let wan = {
      pvc: "PVC4",
      status: null,
      ip: null,
      gateway: null,
      dns: null,
      encapsulation: null,
      vpiVci: null,
    };

    const pvc4 = t.match(
      /PVC4\s+(\d+)\s*\/\s*(\d+)\s+(\d+\.\d+\.\d+\.\d+|N\/A)\s+(\d+\.\d+\.\d+\.\d+|N\/A)\s+(\d+\.\d+\.\d+\.\d+|N\/A)\s+(\d+\.\d+\.\d+\.\d+|N\/A)\s+(PPPoE|Bridge|PPPoA)\s+(Up|Down)/i
    );
    if (pvc4) {
      const na = (v) => (/^N\/A$/i.test(v) ? null : v);
      wan = {
        pvc: "PVC4",
        vpiVci: `${pvc4[1]}/${pvc4[2]}`,
        ip: na(pvc4[3]),
        gateway: na(pvc4[5]),
        dns: na(pvc4[6]),
        encapsulation: pvc4[7],
        status: pvc4[8],
      };
    }

    return {
      line: {
        state: single("Line State"),
        modulation: single("Modulation"),
        annex: single("Annex Mode"),
        firmware: single("ADSL Firmware Version"),
        snr: pair("SNR Margin"),
        attenuation: pair("Line Attenuation"),
        dataRate: pair("Data Rate"),
        maxRate: pair("Max Rate"),
        crc: pair("CRC"),
      },
      wan,
      wifiClients,
      rawClientCount: wifiClients.length,
    };
  }
}

async function probeLatency(host, timeoutMs = 2500) {
  const start = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(`http://${host}/`, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "manual",
    });
    return Math.round(performance.now() - start);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function probeDnsLatency(timeoutMs = 2500) {
  const start = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Lightweight HTTPS HEAD to Cloudflare DNS IP (not a DNS query, but path RTT)
    await fetch("https://1.1.1.1/cdn-cgi/trace", {
      method: "GET",
      signal: ctrl.signal,
    });
    return Math.round(performance.now() - start);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function createStatusService(env) {
  const client = new TpLinkClient({
    host: env.ROUTER_HOST || "192.168.1.1",
    user: env.ROUTER_USER || "admin",
    pass: env.ROUTER_PASS || "",
  });
  const ttl = Number(env.CACHE_TTL_MS || CACHE_TTL_MS);

  return {
    async getStatus({ force = false } = {}) {
      const now = Date.now();
      if (
        !force &&
        client.cache.data &&
        now - client.cache.at < ttl
      ) {
        return { ...client.cache.data, cached: true };
      }

      try {
        if (!client.cookie) {
          await client.login();
        }
        const html = await client.fetchDeviceInfoHtml();
        const parsed = client.parseDeviceInfo(html);

        const [gatewayMs, dnsMs] = await Promise.all([
          probeLatency(client.host),
          probeDnsLatency(),
        ]);

        const data = {
          fetchedAt: new Date().toISOString(),
          device: {
            host: client.host,
            label: "TP-Link ADSL2+ Modem Router",
          },
          line: parsed.line,
          wan: parsed.wan,
          wifiClients: parsed.wifiClients,
          probes: {
            gatewayMs,
            dnsMs,
          },
          cached: false,
        };

        client.cache = { at: now, data, error: null };
        return data;
      } catch (err) {
        // Invalidate session on auth errors
        if (err.code === "AUTH_FAILED" || err.code === "FORBIDDEN") {
          client.cookie = "";
        }
        const payload = {
          error: true,
          code: err.code || "SCRAPE_FAILED",
          message: err.message || String(err),
          fetchedAt: new Date().toISOString(),
        };
        client.cache = { at: now, data: null, error: payload };
        throw Object.assign(err, { payload });
      }
    },
  };
}

module.exports = {
  createStatusService,
  TpLinkClient,
  md5Hex,
};
