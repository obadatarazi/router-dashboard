(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    deviceLabel: $("deviceLabel"),
    routerHost: $("routerHost"),
    fetchedAt: $("fetchedAt"),
    liveDot: $("liveDot"),
    liveLabel: $("liveLabel"),
    refreshBtn: $("refreshBtn"),
    errorBanner: $("errorBanner"),
    lineState: $("lineState"),
    snr: $("snr"),
    snrHint: $("snrHint"),
    attenuation: $("attenuation"),
    attHint: $("attHint"),
    crc: $("crc"),
    modulation: $("modulation"),
    annex: $("annex"),
    downSync: $("downSync"),
    upSync: $("upSync"),
    downBar: $("downBar"),
    upBar: $("upBar"),
    downBarLabel: $("downBarLabel"),
    downMaxLabel: $("downMaxLabel"),
    upBarLabel: $("upBarLabel"),
    upMaxLabel: $("upMaxLabel"),
    wanPvc: $("wanPvc"),
    wanStatus: $("wanStatus"),
    wanIp: $("wanIp"),
    wanGw: $("wanGw"),
    wanDns: $("wanDns"),
    wanEncap: $("wanEncap"),
    probeGw: $("probeGw"),
    probeDns: $("probeDns"),
    clientCount: $("clientCount"),
    clientRows: $("clientRows"),
    cacheHint: $("cacheHint"),
  };

  const REFRESH_MS = 15000;
  let timer = null;
  let loading = false;

  function fmtPair(pair, unit = "") {
    if (!pair || pair.down == null || pair.up == null) return "—";
    const u = unit ? ` ${unit}` : "";
    return `${pair.down}${u} / ${pair.up}${u}`;
  }

  function fmtKbps(n) {
    if (n == null || Number.isNaN(n)) return "—";
    if (n >= 1000) return `${(n / 1000).toFixed(2)} Mbps`;
    return `${n} kbps`;
  }

  function snrTone(down) {
    if (down == null) return { cls: "", hint: "" };
    if (down >= 10) return { cls: "tone-good", hint: "Good (≥10 dB)" };
    if (down >= 6) return { cls: "tone-warn", hint: "Marginal (6–10 dB)" };
    return { cls: "tone-bad", hint: "Critical (<6 dB)" };
  }

  function attTone(down) {
    if (down == null) return { cls: "", hint: "" };
    if (down <= 20) return { cls: "tone-good", hint: "Excellent (≤20 dB)" };
    if (down <= 50) return { cls: "", hint: "Acceptable (20–50 dB)" };
    return { cls: "tone-bad", hint: "High loss (>50 dB)" };
  }

  function setBar(el, sync, max) {
    const pct =
      sync != null && max != null && max > 0
        ? Math.min(100, Math.round((sync / max) * 100))
        : 0;
    el.style.width = `${pct}%`;
  }

  function showError(msg) {
    els.errorBanner.textContent = msg;
    els.errorBanner.classList.add("show");
    els.liveDot.classList.remove("on");
    els.liveDot.classList.add("off");
    els.liveLabel.textContent = "error";
  }

  function clearError() {
    els.errorBanner.classList.remove("show");
    els.errorBanner.textContent = "";
  }

  function render(data) {
    clearError();
    if (data.device?.label) els.deviceLabel.textContent = data.device.label;
    if (data.device?.host) els.routerHost.textContent = data.device.host;

    els.fetchedAt.textContent = data.fetchedAt
      ? `Fetched ${new Date(data.fetchedAt).toLocaleTimeString()}`
      : "—";
    els.cacheHint.textContent = data.cached ? "served from short cache" : "fresh scrape";

    els.liveDot.classList.remove("off");
    els.liveDot.classList.add("on");
    els.liveLabel.textContent = "live";

    const line = data.line || {};
    els.lineState.textContent = line.state || "—";
    els.modulation.textContent = line.modulation || "—";
    els.annex.textContent = line.annex || "—";
    els.crc.textContent = fmtPair(line.crc);

    const snr = snrTone(line.snr?.down);
    els.snr.textContent = fmtPair(line.snr, "dB");
    els.snr.className = `value ${snr.cls}`;
    els.snrHint.textContent = snr.hint;

    const att = attTone(line.attenuation?.down);
    els.attenuation.textContent = fmtPair(line.attenuation, "dB");
    els.attenuation.className = `value ${att.cls}`;
    els.attHint.textContent = att.hint;

    const down = line.dataRate?.down;
    const up = line.dataRate?.up;
    const downMax = line.maxRate?.down;
    const upMax = line.maxRate?.up;

    els.downSync.textContent = fmtKbps(down);
    els.upSync.textContent = fmtKbps(up);
    setBar(els.downBar, down, downMax);
    setBar(els.upBar, up, upMax);
    els.downBarLabel.textContent = `sync ${fmtKbps(down)}`;
    els.downMaxLabel.textContent = `max ${fmtKbps(downMax)}`;
    els.upBarLabel.textContent = `sync ${fmtKbps(up)}`;
    els.upMaxLabel.textContent = `max ${fmtKbps(upMax)}`;

    const wan = data.wan || {};
    els.wanPvc.textContent = wan.vpiVci
      ? `${wan.pvc} (${wan.vpiVci})`
      : wan.pvc || "—";
    els.wanStatus.textContent = wan.status || "—";
    els.wanStatus.className =
      "value " +
      (String(wan.status).toLowerCase() === "up" ? "tone-good" : "tone-bad");
    els.wanIp.textContent = wan.ip || "—";
    els.wanGw.textContent = wan.gateway || "—";
    els.wanDns.textContent = wan.dns || "—";
    els.wanEncap.textContent = wan.encapsulation || "—";

    const probes = data.probes || {};
    els.probeGw.textContent =
      probes.gatewayMs != null ? `${probes.gatewayMs} ms` : "—";
    els.probeDns.textContent =
      probes.dnsMs != null ? `${probes.dnsMs} ms` : "—";

    const clients = data.wifiClients || [];
    els.clientCount.textContent = `${clients.length} connected`;
    if (!clients.length) {
      els.clientRows.innerHTML =
        '<tr><td colspan="2" class="empty">No clients reported</td></tr>';
    } else {
      els.clientRows.innerHTML = clients
        .map(
          (c, i) =>
            `<tr><td>${i + 1}</td><td>${c.mac}</td></tr>`
        )
        .join("");
    }
  }

  async function load(force = false) {
    if (loading) return;
    loading = true;
    els.refreshBtn.disabled = true;
    els.liveLabel.textContent = "loading";
    try {
      const url = force ? "/api/status?refresh=1" : "/api/status";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || data.error) {
        showError(data.message || `HTTP ${res.status}`);
        return;
      }
      render(data);
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      loading = false;
      els.refreshBtn.disabled = false;
    }
  }

  els.refreshBtn.addEventListener("click", () => load(true));
  load(true);
  timer = setInterval(() => load(false), REFRESH_MS);
  window.addEventListener("beforeunload", () => {
    if (timer) clearInterval(timer);
  });
})();
