import express from "express";
import expressWs from "express-ws";
import WebSocket from "ws";

const app = express();
expressWs(app); // enable WebSocket support

// Basic health check endpoint
app.get("/", (req, res) => res.send("✅ OpenAI Realtime proxy is running."));

app.ws("/gpt", (client, req) => {
  console.log("🔗 Twilio connected");

  // --- Parse query parameters from the Twilio request ---
  const query = new URLSearchParams(req.url.split("?")[1]);
  const voice = query.get("voice") || "ballad";
  const instructions =
    query.get("instructions") ||
    "You are a helpful and friendly AI receptionist. Start immediately by saying: 'Hello! Thanks for calling, how can I help you today?' Then pause and listen.";

  console.log(`🎙️ Voice: ${voice}`);
  console.log(`🧠 Instructions: ${instructions.slice(0, 120)}...`);

  // --- Connect to OpenAI Realtime API ---
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

  // --- When OpenAI connection opens ---
  target.on("open", () => {
    targetOpen = true;
    console.log("✅ Connected to OpenAI Realtime");

    // Force an instant greeting to keep Twilio connection alive
    const initMessage = {
      type: "response.create",
      response: {
        instructions:
          "You are a helpful and friendly AI receptionist. Start immediately by saying: 'Hello! Thanks for calling, how can I help you today?' Then pause and listen."
      }
    };
    target.send(JSON.stringify(initMessage));
  });

  // --- Forward messages from Twilio → OpenAI ---
  client.on("message", (msg) => {
    if (targetOpen && target.readyState === WebSocket.OPEN) {
      target.send(msg);
    }
  });

  // --- Forward messages from OpenAI → Twilio ---
  target.on("message", (msg) => client.send(msg));

  // --- Handle closures ---
  target.on("close", () => {
    console.log("❌ OpenAI stream closed");
    client.close();
  });

  client.on("close", () => {
    console.log("❌ Twilio stream closed");
    target.close();
  });

  target.on("error", (err) => {
    console.error("OpenAI WS error:", err);
  });
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy running on port ${PORT}`));
