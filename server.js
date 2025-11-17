// --- server.js ---
// OpenAI Realtime proxy for Twilio (Node 22+, Render compatible)
// ✅ Works with sk-proj keys using ephemeral key exchange
// ✅ Buffers audio until OA socket is ready (fixes "WebSocket not open" errors)

import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

const fetch = global.fetch;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 10000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

app.get("/", (_, res) => res.send("✅ OpenAI Realtime proxy is running"));

wss.on("connection", async (twilio, req) => {
  console.log("🔗 Twilio connected");

  // --- 1️⃣ Extract parameters ---
  const params = new URLSearchParams(req.url.split("?")[1] || "");
  let voice = (params.get("voice") || "alloy").toLowerCase();
  const instructions =
    params.get("instructions") ||
    "You are a friendly and helpful AI receptionist.";

  const allowedVoices = ["alloy", "verse", "copper"];
  if (!allowedVoices.includes(voice)) {
    console.warn(`⚠️ Unsupported voice "${voice}", falling back to alloy`);
    voice = "alloy";
  }

  console.log("🎙️ Voice:", voice);
  console.log("🧠 Instructions:", instructions.slice(0, 100) + "...");

  try {
    // --- 2️⃣ Create ephemeral Realtime session ---
    const sessionRes = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview",
        voice,
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        instructions,
      }),
    });

    if (!sessionRes.ok) {
      console.error("❌ Session creation failed:", sessionRes.status, await sessionRes.text());
      twilio.close();
      return;
    }

    const session = await sessionRes.json();
    const ephemeralKey = session.client_secret?.value;
    if (!ephemeralKey?.startsWith("ek_")) {
      console.error("❌ No ephemeral key returned:", session);
      twilio.close();
      return;
    }

    // --- 3️⃣ Connect to OpenAI Realtime WebSocket ---
    const oaUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";
    const oa = new WebSocket(oaUrl, {
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    const buffer = []; // temporarily store audio until OA ready
    let oaReady = false;

    oa.on("open", () => {
      console.log("🧠 OpenAI Realtime connected (ephemeral)");
      oaReady = true;
      // Flush buffered audio
      buffer.forEach((pkt) => oa.send(JSON.stringify(pkt)));
      buffer.length = 0;
    });

    oa.on("close", () => console.log("🧠 OpenAI Realtime closed"));
    oa.on("error", (err) => console.error("❌ OA error:", err.message));

    // --- 4️⃣ Twilio → OpenAI ---
    twilio.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);

        if (data.event === "media") {
          const packet = {
            type: "input_audio_buffer.append",
            audio: data.media.payload,
          };
          if (oaReady) oa.send(JSON.stringify(packet));
          else buffer.push(packet);
        } else if (data.event === "stop") {
          const commit = { type: "input_audio_buffer.commit" };
          const create = { type: "response.create" };
          if (oaReady) {
            oa.send(JSON.stringify(commit));
            oa.send(JSON.stringify(create));
          } else {
            buffer.push(commit, create);
          }
        }
      } catch (e) {
        console.error("Parse error Twilio→OA:", e);
      }
    });

    // --- 5️⃣ OpenAI → Twilio ---
    oa.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === "response.created") console.log("💬 Response started");

        if (data.type === "output_audio_buffer.append" && data.audio) {
          const payload = data.audio.replace(/[\r\n]+/g, "");
          twilio.send(
            JSON.stringify({
              event: "media",
              streamSid: "realtime",
              media: { payload },
            })
          );
        }

        if (data.type === "response.output_audio_buffer.commit") {
          twilio.send(JSON.stringify({ event: "mark", mark: { name: "done" } }));
        }
      } catch (e) {
        console.error("Parse error OA→Twilio:", e);
      }
    });

    // --- 6️⃣ Cleanup ---
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
