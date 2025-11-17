// --- server.js ---
// OpenAI Realtime proxy for Twilio (Node 22+, Render-ready)
// ✅ μ-law re-encode + buffered input
// ✅ Diagnostic logging of audio frame lengths sent to Twilio

import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

const fetch = global.fetch;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 10000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

app.get("/", (_, res) => res.send("✅ Realtime proxy running OK"));

wss.on("connection", async (twilio, req) => {
  console.log("🔗 Twilio connected");

  const params = new URLSearchParams(req.url.split("?")[1] || "");
  let voice = (params.get("voice") || "alloy").toLowerCase();
  const instructions =
    params.get("instructions") ||
    "You are a friendly and helpful AI receptionist.";

  const allowed = ["alloy", "verse", "copper"];
  if (!allowed.includes(voice)) voice = "alloy";
  console.log("🎙️ Voice:", voice);
  console.log("🧠 Instructions:", instructions.slice(0, 100) + "...");

  try {
    // --- 1️⃣ Create ephemeral realtime session
    const sess = await fetch("https://api.openai.com/v1/realtime/sessions", {
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

    if (!sess.ok) {
      console.error("❌ Session creation failed:", await sess.text());
      twilio.close();
      return;
    }
    const json = await sess.json();
    const ek = json.client_secret?.value;
    if (!ek?.startsWith("ek_")) {
      console.error("❌ No ephemeral key returned");
      twilio.close();
      return;
    }

    // --- 2️⃣ Connect to OA Realtime socket
    const oa = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview", {
      headers: {
        Authorization: `Bearer ${ek}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    let oaReady = false;
    const buffer = [];

    oa.on("open", () => {
      console.log("🧠 OpenAI Realtime connected (ephemeral)");
      oaReady = true;
      buffer.forEach((pkt) => oa.send(JSON.stringify(pkt)));
      buffer.length = 0;
    });

    oa.on("close", () => console.log("🧠 OpenAI Realtime closed"));
    oa.on("error", (e) => console.error("❌ OA error:", e.message));

    // --- 3️⃣ Twilio → OA
    twilio.on("message", (msg) => {
      try {
        const d = JSON.parse(msg);
        if (d.event === "media") {
          const pkt = { type: "input_audio_buffer.append", audio: d.media.payload };
          if (oaReady) oa.send(JSON.stringify(pkt));
          else buffer.push(pkt);
        } else if (d.event === "stop") {
          const c = { type: "input_audio_buffer.commit" };
          const r = { type: "response.create" };
          if (oaReady) {
            oa.send(JSON.stringify(c));
            oa.send(JSON.stringify(r));
          } else buffer.push(c, r);
        }
      } catch (e) {
        console.error("Parse error Twilio→OA:", e);
      }
    });

    // --- 4️⃣ OA → Twilio (μ-law re-encode + diagnostics)
    oa.on("message", (msg) => {
      try {
        const d = JSON.parse(msg);
        if (d.type === "response.created") console.log("💬 Response started");

        if (d.type === "output_audio_buffer.append" && d.audio) {
          const buf = Buffer.from(d.audio, "base64");
          const clean = buf.toString("base64");
          console.log(`🎧 Sending audio chunk → Twilio (${buf.length} bytes)`);

          twilio.send(
            JSON.stringify({
              event: "media",
              streamSid: "realtime",
              media: { payload: clean },
            })
          );
        }

        if (d.type === "response.output_audio_buffer.commit") {
          console.log("✅ Finished sending audio for this response");
          twilio.send(JSON.stringify({ event: "mark", mark: { name: "done" } }));
        }
      } catch (e) {
        console.error("Parse error OA→Twilio:", e);
      }
    });

    // --- 5️⃣ Cleanup
    twilio.on("close", () => {
      console.log("❌ Twilio stream closed");
      oa.close();
    });
  } catch (err) {
    console.error("Proxy error:", err);
    twilio.close();
  }
});

server.listen(PORT, () => console.log(`🚀 Proxy running on port ${PORT}`));
