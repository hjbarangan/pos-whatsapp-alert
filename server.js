const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const { EventEmitter } = require("events");
const { execSync } = require("child_process");

const app = express();
app.use(express.json());

/**
 * =========================================================
 * MESSAGE QUEUE (in-memory production-safe queue)
 * =========================================================
 */
const messageQueue = [];
const queueEvents = new EventEmitter();

let isProcessingQueue = false;

/**
 * =========================================================
 * WHATSAPP CLIENT
 * =========================================================
 */

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "backup-bot",
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

let isInitializing = false;
let isReady = false;

/**
 * =========================================================
 * CLEANUP (Docker Chromium fix)
 * =========================================================
 */
function cleanupLocks() {
  try {
    execSync("find . -name 'Singleton*' -delete");
  } catch {}
}

/**
 * =========================================================
 * INITIALIZE SAFELY
 * =========================================================
 */
async function safeInit() {
  if (isInitializing) return;

  isInitializing = true;

  try {
    cleanupLocks();
    await client.initialize();
  } catch (err) {
    console.error("Init error:", err);

    setTimeout(() => {
      safeInit();
    }, 10000);
  } finally {
    isInitializing = false;
  }
}

/**
 * =========================================================
 * QUEUE PROCESSOR (core production logic)
 * =========================================================
 */
async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (true) {
    const job = messageQueue.shift();

    if (!job) break;

    const { groupId, message, resolve, reject } = job;

    try {
      if (!isReady || !client.info) {
        throw new Error("WhatsApp not ready");
      }

      await client.sendMessage(groupId, message);

      resolve({ success: true });

    } catch (err) {
      console.error("Queue send failed:", err);

      // retry later
      messageQueue.push(job);

      await new Promise((r) => setTimeout(r, 5000));
      break;
    }
  }

  isProcessingQueue = false;
}

/**
 * Trigger queue processor
 */
queueEvents.on("new", processQueue);

/**
 * =========================================================
 * EVENTS
 * =========================================================
 */

client.on("qr", (qr) => {
  console.log("Scan QR:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ WhatsApp READY");
  isReady = true;

  processQueue();
});

client.on("auth_failure", (msg) => {
  console.error("Auth failure:", msg);
  isReady = false;
});

client.on("disconnected", async (reason) => {
  console.log("Disconnected:", reason);

  isReady = false;

  try {
    await client.destroy();
  } catch {}

  setTimeout(() => {
    safeInit();
  }, 10000);
});

/**
 * =========================================================
 * QUEUE WRAPPER FUNCTION
 * =========================================================
 */
function enqueueMessage(groupId, message) {
  return new Promise((resolve, reject) => {
    messageQueue.push({ groupId, message, resolve, reject });

    queueEvents.emit("new");
  });
}

/**
 * =========================================================
 * ROUTES
 * =========================================================
 */

app.post("/send", async (req, res) => {
  const { groupId, message } = req.body;

  try {
    const result = await enqueueMessage(groupId, message);
    res.json({ status: "queued", result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

/**
 * ALERT ROUTE
 */
app.post("/send-alert", async (req, res) => {
  const {
    groupId,
    messageType,
    server,
    database,
    backupFile,
    timestamp,
    errorMessage,
    rawMessage,
  } = req.body;

  let formatted = "";

  if (rawMessage) {
    formatted = rawMessage;
  } else {
    formatted =
      `📢 *${messageType?.toUpperCase() || "NOTIFICATION"}*\n\n` +
      `🕒 ${timestamp}\n` +
      `🖥 ${server}\n` +
      `🗄 ${database}\n` +
      `📁 ${backupFile || ""}\n` +
      (errorMessage ? `\n❌ ${errorMessage}` : "");
  }

  try {
    await enqueueMessage(groupId, formatted);
    res.json({ status: "queued" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GROUPS (safe check)
 */
app.get("/groups", async (req, res) => {
  try {
    if (!isReady || !client.info) {
      return res.status(503).json({
        status: "error",
        message: "WhatsApp not ready",
      });
    }

    const chats = await client.getChats();

    const groups = chats
      .filter((c) => c.id.server === "g.us")
      .map((g) => ({
        name: g.name,
        id: g.id._serialized,
      }));

    res.json({ status: "success", groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * =========================================================
 * STARTUP
 * =========================================================
 */

safeInit();

/**
 * API ALWAYS STARTS (IMPORTANT FOR PROD)
 */
app.listen(3001, () => {
  console.log("🚀 API running on http://localhost:3001");
});

/**
 * SAFETY HANDLERS
 */
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);