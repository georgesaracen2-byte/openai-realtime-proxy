// --- server.js ---
// Minimal, Render-free-tier-friendly OpenAI Realtime proxy for Twilio

import express from "express";
import http from "http";
import WebSocket from "ws";

const fetch = global.fetch; // ✅ built-in fetch in Node 18+
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 10000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// Landing page for quick sanity check
app.get("/", (req, res) => {
  res.send("✅ OpenAI Realtime proxy is running");
});

wss.on("connection", async (twilio, req) => {
  console.log("🔗 Twilio connected");

  // Extract query params (from Twilio Function)
  const params = new URLSearchParams(req.url.split("?")[1] || "");
  const voice = params.get("voice") || "alloy"; // alloy / verse / copper
  const instructions =
    params.get("instructions") ||
    "You are a friendly and helpful AI receptionist.";

  console.log("🎙️ Voice:", voice);
  console.log("🧠 Instructions:", instructions.slice(0, 100) + "...");

  try {
    // 1️⃣ Create OpenAI Realtime session
    const sessionRes = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview",
        voice,
        input_audio_format: "mulaw-8000",
        output_audio_format: "mulaw-8000",
        instructions,
      }),
    });

    if (!sessionRes.ok) {
      console.error("❌ Session creation failed:", sessionRes.status, await sessionRes.text());
      twilio.close();
      return;
    }

    const session = await sessionRes.json();
    const oaUrl = session.client_secret?.value;
    if (!oaUrl) {
      console.error("❌ No client_secret in session response");
      twilio.close();
      return;
    }

    // 2️⃣ Connect to OpenAI Realtime
    const oa = new WebSocket(oaUrl, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    });

    oa.on("open", () => console.log("🧠 OpenAI Realtime connected"));
    oa.on("close", () => console.log("🧠 OpenAI Realtime closed"));
    oa.on("error", (err) => console.error("❌ OA error:", err.message));

    // Twilio → OpenAI
    twilio.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.event === "media") {
          oa.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: data.media.payload,
            })
          );
        } else if (data.event === "stop") {
          oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          oa.send(JSON.stringify({ type: "response.create" }));
        }
      } catch (e) {
        console.error("Parse error Twilio->OA:", e);
      }
    });

    // OpenAI → Twilio
    oa.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === "response.created")
          console.log("💬 Response started");
        if (data.type === "output_audio_buffer.append") {
          twilio.send(
            JSON.stringify({
              event: "media",
              streamSid: "realtime",
              media: { payload: data.audio },
            })
          );
        }
      } catch (e) {
        console.error("Parse error OA->Twilio:", e);
      }
    });

    twilio.on("close", () => {
      console.log("❌ Twilio stream closed");
      oa.close();
    });
  } catch (err) {
    console.error("Proxy error:", err);
    twilio.close();
  }
});

server.listen(PORT, () =>
  console.log(`🚀 Proxy running on port ${PORT}`)
);
