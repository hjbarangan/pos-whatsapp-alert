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
    execSync(`
      if [ -d /usr/src/app/.wwebjs_auth ]; then
        find /usr/src/app/.wwebjs_auth -name 'Singleton*' -delete
      fi
    `);
  } catch (e) {
    console.error("Cleanup error:", e.message);
  }
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

  while (messageQueue.length > 0) {
    const job = messageQueue.shift();

    if (!job) break;

    const { groupId, message } = job;

    try {
      if (!isReady || !client.info) {
        throw new Error("WhatsApp not ready");
      }

      await client.sendMessage(groupId, message);
    } catch (err) {
      console.error("Queue send failed:", err);

      job.attempts += 1;

      if (job.attempts > 5) {
        console.error("Dropping failed job:", job);
      } else {
        messageQueue.push(job);
      }

      isProcessingQueue = false;

      const delay = Math.min(30000, 5000 * job.attempts);

      setTimeout(() => {
        queueEvents.emit("new");
      }, delay);

      return;
    }
  }
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
const MAX_QUEUE_SIZE = 10000;

function enqueueMessage(groupId, message) {
  if (messageQueue.length >= MAX_QUEUE_SIZE) {
    throw new Error("Queue full");
  }

  messageQueue.push({
    groupId,
    message,
    attempts: 0,
    createdAt: Date.now(),
  });

  queueEvents.emit("new");
}

/**
 * =========================================================
 * ROUTES
 * =========================================================
 */

app.post("/send", async (req, res) => {
  const { groupId, message } = req.body;

  try {
    enqueueMessage(groupId, message);
    res.json({ status: "queued" });
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
    enqueueMessage(groupId, formatted);
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
