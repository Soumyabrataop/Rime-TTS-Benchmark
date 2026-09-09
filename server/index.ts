import "dotenv/config";
import { Readable } from "node:stream";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { equipmentCount, lookupEquipment } from "./equipment.ts";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const rimeApiUrl = process.env.RIME_API_URL ?? "https://users.rime.ai/v1/rime-tts";
const rimeModelId = process.env.RIME_MODEL_ID ?? "mistv3";
const rimeSpeaker = process.env.RIME_SPEAKER ?? "cove";
const rimeLanguage = process.env.RIME_LANGUAGE ?? "eng";
const rimeAudioFormat = process.env.RIME_AUDIO_FORMAT ?? "audio/mpeg";
const rimeSampleRate = Number(process.env.RIME_SAMPLE_RATE ?? 22050);

app.use(cors());
app.use(express.json({ limit: "12kb" }));

type LookupRequest = { text?: unknown; delayMs?: unknown };
type TtsRequest = { text?: unknown; stage?: unknown };

function validatedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= 500 ? text : null;
}

function clampedDelay(value: unknown): number {
  const delay = typeof value === "number" ? value : 0;
  return Math.max(0, Math.min(4_000, Math.floor(delay)));
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("Request cancelled"));
      },
      { once: true },
    );
  });
}

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    equipmentFixtures: equipmentCount(),
    rimeConfigured: Boolean(process.env.RIME_API_KEY),
    rime: {
      modelId: rimeModelId,
      speaker: rimeSpeaker,
      language: rimeLanguage,
      endpoint: rimeApiUrl,
      format: rimeAudioFormat,
      transport: "streaming HTTP proxy",
    },
  });
});

app.post("/api/lookup", async (request: Request<unknown, unknown, LookupRequest>, response) => {
  const text = validatedText(request.body.text);
  if (!text) {
    response.status(400).json({ error: "Provide a prompt of up to 500 characters." });
    return;
  }

  const startedAt = performance.now();
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());

  try {
    await waitWithAbort(clampedDelay(request.body.delayMs), controller.signal);
    const result = lookupEquipment(text);
    response.json({
      ...result,
      serverToolMs: Math.round(performance.now() - startedAt),
      fixture: true,
    });
  } catch {
    if (!response.headersSent) response.status(499).json({ error: "Lookup cancelled" });
  }
});

app.post("/api/tts", async (request: Request<unknown, unknown, TtsRequest>, response) => {
  const text = validatedText(request.body.text);
  if (!text) {
    response.status(400).json({ error: "Provide text of up to 500 characters." });
    return;
  }
  if (!process.env.RIME_API_KEY) {
    response.status(503).json({
      error: "Rime is not configured. Add RIME_API_KEY to .env; browser speech is intentionally not used as a fallback.",
    });
    return;
  }

  const startedAt = performance.now();
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());

  try {
    const rimeResponse = await fetch(rimeApiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: rimeAudioFormat,
        Authorization: `Bearer ${process.env.RIME_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        modelId: rimeModelId,
        speaker: rimeSpeaker,
        lang: rimeLanguage,
        samplingRate: rimeSampleRate,
        speedAlpha: 1.07,
        // Ack copy is written without numerals or abbreviations; skipping normalization saves work.
        noTextNormalization: request.body.stage === "ack",
      }),
    });

    if (!rimeResponse.ok || !rimeResponse.body) {
      const details = await rimeResponse.text();
      response.status(rimeResponse.status || 502).json({ error: "Rime synthesis failed", details });
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", rimeResponse.headers.get("content-type") ?? rimeAudioFormat);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-FastField-Rime-TTFB-Ms", String(Math.round(performance.now() - startedAt)));
    response.setHeader("X-FastField-Rime-Model", rimeModelId);
    response.setHeader("X-FastField-Rime-Speaker", rimeSpeaker);
    response.setHeader("Access-Control-Expose-Headers", "X-FastField-Rime-TTFB-Ms, X-FastField-Rime-Model, X-FastField-Rime-Speaker");
    response.flushHeaders();
    Readable.fromWeb(rimeResponse.body as import("node:stream/web").ReadableStream)
      .on("error", () => response.destroy())
      .pipe(response);
  } catch (error) {
    if (!response.headersSent) {
      const message = error instanceof Error && error.name === "AbortError" ? "Rime synthesis cancelled" : "Rime request failed";
      response.status(502).json({ error: message });
    }
  }
});

app.listen(port, () => {
  console.log(`FastField API listening at http://localhost:${port}`);
});
