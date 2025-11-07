import express from "express";
import expressWs from "express-ws";
import WebSocket from "ws";

const app = express();
expressWs(app); // enable WebSocket on Express

// Simple health check route
app.get("/", (req, res) => res.send("✅ OpenAI Realtime proxy is running."));

// WebSocket endpoint for Twilio
app.ws("/gpt", (client, req) => {
  console.log("🔗 Twilio connected");

  // --- Read query parameters ---
  const query = new URLSearchParams(req.url.split("?")[1]);
  const voice = query.get("voice") || "ballad";
  const instructions = query.get("instructions") || "You are a helpful AI assistant.";

  console.log(`🎙️ Voice: ${voice}`);
  console.log(`🧠 Instructions: ${instructions.slice(0, 80)}...`);

  // --- Connect to OpenAI Realtime ---
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

  // --- When OpenAI connects ---
  target.on("open", () => {
    console.log("✅ Connected to OpenAI Realtime");

    // Send system instructions (acts like the system prompt)
    const initMessage = {
      type: "response.create",
      response: {
        instructions: instructions
      }
    };
    target.send(JSON.stringify(initMessage));
  });

  // --- Pipe data both ways ---
  client.on("message", msg => target.send(msg));
  target.on("message", msg => client.send(msg));
  target.on("close", () => client.close());
  client.on("close", () => target.close());
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy running on port ${PORT}`));
