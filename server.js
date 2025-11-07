import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const app = express();

app.get("/", (req, res) => res.send("✅ OpenAI Realtime proxy is running."));

app.ws("/gpt", (client, req) => {
  console.log("🔗 Twilio connected");

  const target = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-01&voice=ballad",
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );

  client.on("message", msg => target.send(msg));
  target.on("message", msg => client.send(msg));
  target.on("close", () => client.close());
  client.on("close", () => target.close());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy running on port ${PORT}`));
