type Env = {
  RIME_API_KEY?: string;
  RIME_API_URL?: string;
  RIME_MODEL_ID?: string;
  RIME_SPEAKER?: string;
  RIME_LANGUAGE?: string;
  RIME_AUDIO_FORMAT?: string;
  RIME_SAMPLE_RATE?: string;
  ALLOWED_ORIGIN?: string;
};

type Equipment = {
  id: string;
  aliases: string[];
  error: string;
  description: string;
  firstCheck: string;
  secondCheck: string;
  safeToRestart: boolean;
};

const equipment: Equipment[] = [
  {
    id: "pump_4",
    aliases: ["pump 4", "pump four", "p4", "e-742", "e 742"],
    error: "E-742",
    description: "Pressure sensor fault",
    firstCheck: "Inspect the pressure-sensor connector for moisture or a loose pin.",
    secondCheck: "Restart the sensor module after reseating the connector.",
    safeToRestart: false,
  },
  {
    id: "pump_7",
    aliases: ["pump 7", "pump seven", "p7", "e-118", "e 118"],
    error: "E-118",
    description: "Low intake flow",
    firstCheck: "Check the intake strainer for blockage before restarting.",
    secondCheck: "Verify that the inlet valve is fully open.",
    safeToRestart: false,
  },
  {
    id: "motor_12",
    aliases: ["motor 12", "motor twelve", "m12", "m-331", "m 331"],
    error: "M-331",
    description: "Overcurrent under load",
    firstCheck: "Inspect the driven load for a mechanical obstruction.",
    secondCheck: "Check the overload relay setting against the nameplate.",
    safeToRestart: false,
  },
];

function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-FastField-Rime-TTFB-Ms, X-FastField-Rime-Model, X-FastField-Rime-Speaker",
  };
}

function json(data: unknown, env: Env, init: ResponseInit = {}): Response {
  const headers = new Headers(corsHeaders(env));
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(init.headers ?? {})) headers.set(key, value);
  return new Response(JSON.stringify(data), { ...init, headers });
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function findEquipment(prompt: string): Equipment | undefined {
  const value = normalized(prompt);
  return equipment.find((item) => item.aliases.some((alias) => value.includes(normalized(alias))));
}

function lookup(prompt: string) {
  const item = findEquipment(prompt);
  const value = normalized(prompt);
  const intent = /safe|restart|start again|run again/.test(value)
    ? "restart"
    : /first|inspect|check first|what should/.test(value)
      ? "first_check"
      : "diagnose";
  if (!item) {
    return {
      equipment: null,
      acknowledgement: "I’m checking the equipment record now.",
      answer: "I couldn’t match that equipment ID. Try pump four, pump seven, or motor twelve.",
    };
  }
  const label = item.id.replace("_", " ");
  const acknowledgement = `Checking ${label} now.`;
  if (intent === "restart") {
    return {
      equipment: item,
      acknowledgement,
      answer: item.safeToRestart ? "It is safe to restart after the first check." : `Do not restart it yet. ${item.firstCheck}`,
    };
  }
  if (intent === "first_check") {
    return { equipment: item, acknowledgement, answer: `For ${label}, start by ${item.firstCheck.toLowerCase()}` };
  }
  return {
    equipment: item,
    acknowledgement,
    answer: `${label} is reporting ${item.error}, a ${item.description.toLowerCase()}. First, ${item.firstCheck.toLowerCase()}`,
  };
}

async function parseText(request: Request): Promise<{ text?: string; delayMs?: number; stage?: string }> {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; delayMs?: unknown; stage?: unknown };
  return {
    text: typeof body.text === "string" ? body.text.trim() : undefined,
    delayMs: typeof body.delayMs === "number" ? body.delayMs : undefined,
    stage: typeof body.stage === "string" ? body.stage : undefined,
  };
}

function validText(text: string | undefined): text is string {
  return Boolean(text && text.length <= 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        status: "ok",
        equipmentFixtures: equipment.length,
        rimeConfigured: Boolean(env.RIME_API_KEY),
        rime: {
          modelId: env.RIME_MODEL_ID || "mistv3",
          speaker: env.RIME_SPEAKER || "cove",
          language: env.RIME_LANGUAGE || "eng",
          endpoint: env.RIME_API_URL || "https://users.rime.ai/v1/rime-tts",
          format: env.RIME_AUDIO_FORMAT || "audio/mpeg",
          transport: "streaming HTTP proxy",
        },
      }, env);
    }
    if (url.pathname === "/api/lookup" && request.method === "POST") {
      const body = await parseText(request);
      if (!validText(body.text)) return json({ error: "Provide a prompt of up to 500 characters." }, env, { status: 400 });
      const startedAt = performance.now();
      const delayMs = Math.max(0, Math.min(4_000, Math.floor(body.delayMs || 0)));
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return json({ ...lookup(body.text), serverToolMs: Math.round(performance.now() - startedAt), fixture: true }, env);
    }
    if (url.pathname === "/api/tts" && request.method === "POST") {
      const body = await parseText(request);
      if (!validText(body.text)) return json({ error: "Provide text of up to 500 characters." }, env, { status: 400 });
      if (!env.RIME_API_KEY) return json({ error: "Rime is not configured. Add RIME_API_KEY as a Worker secret." }, env, { status: 503 });
      const startedAt = performance.now();
      const rime = await fetch(env.RIME_API_URL || "https://users.rime.ai/v1/rime-tts", {
        method: "POST",
        signal: request.signal,
        headers: {
          Accept: env.RIME_AUDIO_FORMAT || "audio/mpeg",
          Authorization: `Bearer ${env.RIME_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: body.text,
          modelId: env.RIME_MODEL_ID || "mistv3",
          speaker: env.RIME_SPEAKER || "cove",
          lang: env.RIME_LANGUAGE || "eng",
          samplingRate: Number(env.RIME_SAMPLE_RATE || 22050),
          speedAlpha: 1.07,
          noTextNormalization: body.stage === "ack",
        }),
      });
      if (!rime.ok || !rime.body) return json({ error: "Rime synthesis failed", details: await rime.text() }, env, { status: rime.status || 502 });
      const headers = new Headers(corsHeaders(env));
      headers.set("Content-Type", rime.headers.get("content-type") || env.RIME_AUDIO_FORMAT || "audio/mpeg");
      headers.set("Cache-Control", "no-store");
      headers.set("X-FastField-Rime-TTFB-Ms", String(Math.round(performance.now() - startedAt)));
      headers.set("X-FastField-Rime-Model", env.RIME_MODEL_ID || "mistv3");
      headers.set("X-FastField-Rime-Speaker", env.RIME_SPEAKER || "cove");
      return new Response(rime.body, { headers });
    }
    return json({ error: "Not found" }, env, { status: 404 });
  },
};
