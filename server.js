import express from "express";
import expressWs from "express-ws";
import WebSocket from "ws";

const app = express();
expressWs(app);

app.get("/", (req, res) => res.send("✅ OpenAI Realtime proxy is running."));

app.ws("/gpt", (client, req) => {
  console.log("🔗 Twilio connected");

  const query = new URLSearchParams(req.url.split("?")[1]);
  const voice = query.get("voice") || "ballad";
  const instructions =
    query.get("instructions") ||
    "You are a friendly and helpful AI receptionist.";

  console.log(`🎙️ Voice: ${voice}`);
  console.log(`🧠 Instructions: ${instructions.slice(0, 120)}...`);

  const target = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-01&voice=${encodeURIComponent(
      voice
    )}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );

  let targetOpen = false;

  target.on("open", () => {
    targetOpen = true;
    console.log("✅ Connected to OpenAI Realtime");

    // Ask for immediate spoken reply
    const initMessage = {
      type: "response.create",
      response: {
        modalities: ["audio"],
        instructions:
          "You are a friendly receptionist. Say: 'Hello! Thanks for calling, how can I help you today?' Then listen for the caller."
      }
    };
    target.send(JSON.stringify(initMessage));
  });

  // Forward Twilio audio to OpenAI when ready
  client.on("message", (msg) => {
    if (targetOpen && target.readyState === WebSocket.OPEN) {
      target.send(msg);
    }
  });

  // Forward OpenAI audio back to Twilio
  target.on("message", (msg) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });

  // Graceful closes
  target.on("close", () => {
    console.log("❌ OpenAI stream closed");
    client.close();
  });
  client.on("close", () => {
    console.log("❌ Twilio stream closed");
    target.close();
  });

  target.on("error", (err) => console.error("OpenAI WS error:", err));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy running on port ${PORT}`));
