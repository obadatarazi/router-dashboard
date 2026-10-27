"use strict";

require("dotenv").config();

const path = require("path");
const express = require("express");
const { createStatusService } = require("./tplink");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3847);

if (!process.env.ROUTER_PASS) {
  console.error("Missing ROUTER_PASS in .env — copy .env.example and set credentials.");
  process.exit(1);
}

const statusService = createStatusService(process.env);
const app = express();

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    host: HOST,
    port: PORT,
    router: process.env.ROUTER_HOST || "192.168.1.1",
    at: new Date().toISOString(),
  });
});

app.get("/api/status", async (req, res) => {
  const force = req.query.refresh === "1" || req.query.force === "1";
  try {
    const data = await statusService.getStatus({ force });
    res.json(data);
  } catch (err) {
    const status =
      err.code === "AUTH_FAILED" ? 401 : err.code === "FORBIDDEN" ? 403 : 502;
    res.status(status).json(
      err.payload || {
        error: true,
        code: err.code || "SCRAPE_FAILED",
        message: err.message || String(err),
        fetchedAt: new Date().toISOString(),
      }
    );
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Router dashboard listening on http://${HOST}:${PORT}`);
  console.log(`Target router: http://${process.env.ROUTER_HOST || "192.168.1.1"}`);
});
