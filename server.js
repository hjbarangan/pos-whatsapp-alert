const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

const ENV = process.env.NODE_ENV || "development";
const authPath =
  ENV === "production"
    ? "/usr/src/app/.wwebjs_auth" // Docker
    : path.join(__dirname, "session"); // Local development

console.log(`🚀 Running in ${ENV} mode`);
console.log(`📂 Using WhatsApp session path: ${authPath}`);

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: authPath }),
});

client.on("qr", (qr) => {
  console.log("Scan this QR code in WhatsApp:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ WhatsApp Bot is ready!");
});

// FETCH GROUPS AND GROUP_IDS
app.get("/groups", async (req, res) => {
  try {
    const chats = await client.getChats();
    const groups = chats
      .filter((chat) => chat.id.server === "g.us")
      .map((group) => ({
        name: group.name,
        id: group.id._serialized,
      }));

    res.json({ status: "success", groups });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// SEND NOTIFICATION WITH DYNAMIC GROUP_ID AND MESSAGE
app.post("/send", async (req, res) => {
  const { groupId, message } = req.body;

  try {
    await client.sendMessage(groupId, message);
    console.log(`✅ Message sent to group ${groupId}: ${message}`);
    res.json({ status: "success", message: `Sent to group ${groupId}` });
  } catch (error) {
    console.error(`❌ Error sending message: ${error}`);
    res.status(500).json({ status: "error", message: "Failed to send" });
  }
});

// SEND NOTIFICATION WITH FORMATTED MESSAGE
app.post("/send-alert", async (req, res) => {
  const {
    groupId,
    messageType,
    server,
    database,
    backupFile,
    timestamp,
    errorMessage,
  } = req.body;

  let formattedMessage = "";

  if (messageType === "backup_success") {
    formattedMessage =
      `✅ *Backup Completed Successfully!* ✅\n\n` +
      `🔹 *Timestamp:* \`${timestamp}\`\n` +
      `🔹 *Server:* \`${server}\`\n` +
      `🔹 *Database:* \`${database}\`\n` +
      `🔹 *Backup File:* \`${backupFile}\``;
  } else if (messageType === "backup_failure") {
    formattedMessage =
      `🚨 *Backup Failed!* 🚨\n\n` +
      `🔹 *Timestamp:* \`${timestamp}\`\n` +
      `🔹 *Server:* \`${server}\`\n` +
      `🔹 *Database:* \`${database}\`\n` +
      `🔹 *Attempted Backup Path:* \`${backupFile}\`\n\n` +
      `*Error Message: *\n\`\`\`\n${errorMessage}\n\`\`\``;
  } else if (messageType === "restore_success") {
    formattedMessage =
      `✅ *Restoration Completed Successfully!* ✅\n\n` +
      `🔹 *Timestamp:* \`${timestamp}\`\n` +
      `🔹 *Server:* \`${server}\`\n` +
      `🔹 *Restored Database:* \`${database}\`\n` +
      `🔹 *Backup File:* \`${backupFile}\``;
  } else if (messageType === "restore_failure") {
    formattedMessage =
      `🚨 *Restoration Failed!* 🚨\n\n` +
      `🔹 *Timestamp:* \`${timestamp}\`\n` +
      `🔹 *Server:* \`${server}\`\n` +
      `🔹 *Database:* \`${database}\`\n` +
      `🔹 *Backup File:* \`${backupFile}\`\n\n` +
      `*Error Message: *\n\`\`\`\n${errorMessage}\n\`\`\``;
  } else if (messageType === "validation_failure") {
    formattedMessage =
      `❌ *Validation Failed!* ❌\n\n` +
      `🔹 *Timestamp:* \`${timestamp}\`\n` +
      `🔹 *Server:* \`${server}\`\n` +
      `🔹 *Database:* \`${database}\`\n` +
      `🔹 *Backup File:* \`${backupFile}\`\n\n` +
      `*Error Message: *\n\`\`\`\n${errorMessage}\n\`\`\``;
  } else if (messageType === "validation_success") {
    formattedMessage =
      `✅ *Validation Success!* ✅\n\n` +
      `🔹 *Timestamp:* \`${timestamp}\`\n` +
      `🔹 *Server:* \`${server}\`\n` +
      `🔹 *Database:* \`${database}\`\n` +
      `🔹 *Backup File:* \`${backupFile}\``;
  }

  try {
    await client.sendMessage(groupId, formattedMessage);
    console.log(`✅ Message sent to group ${groupId}:\n${formattedMessage}`);
    res.json({ status: "success", message: `Sent to group ${groupId}` });
  } catch (error) {
    console.error(`❌ Error sending message: ${error}`);
    res.status(500).json({ status: "error", message: "Failed to send" });
  }
});

client.initialize();

app.listen(3001, () => {
  console.log("🚀 WhatsApp API running on http://localhost:3001");
});
