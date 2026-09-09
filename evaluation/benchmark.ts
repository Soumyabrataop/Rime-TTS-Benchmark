import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const server = process.env.FASTFIELD_SERVER_URL ?? "http://localhost:8787";
const delayMs = Number(process.env.BENCHMARK_TOOL_DELAY_MS ?? 2_000);
const prompts: string[] = JSON.parse(
  await readFile(new URL("../fixtures/benchmark.json", import.meta.url), "utf8"),
) as string[];

type Run = {
  prompt: string;
  toolMs: number;
  rimeHeaderMs: number;
  rimeFirstChunkMs: number;
};

async function run(prompt: string): Promise<Run> {
  const lookupStart = performance.now();
  const lookupResponse = await fetch(`${server}/api/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: prompt, delayMs }),
  });
  if (!lookupResponse.ok) throw new Error(`Lookup failed for ${prompt}`);
  const lookup = (await lookupResponse.json()) as { acknowledgement: string };
  const toolMs = performance.now() - lookupStart;

  const ttsStart = performance.now();
  const ttsResponse = await fetch(`${server}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lookup.acknowledgement, stage: "ack" }),
  });
  if (!ttsResponse.ok || !ttsResponse.body) {
    throw new Error(`TTS failed: ${await ttsResponse.text()}`);
  }
  const rimeHeaderMs = performance.now() - ttsStart;
  const reader = ttsResponse.body.getReader();
  await reader.read();
  await reader.cancel();

  return { prompt, toolMs, rimeHeaderMs, rimeFirstChunkMs: performance.now() - ttsStart };
}

function percentile(numbers: number[], p: number): number {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
}

const runs: Run[] = [];
for (const prompt of prompts) {
  const result = await run(prompt);
  runs.push(result);
  console.log(`${runs.length}/${prompts.length}: ${result.rimeFirstChunkMs.toFixed(0)} ms first chunk — ${prompt}`);
}

const result = {
  recordedAt: new Date().toISOString(),
  server,
  toolDelayMs: delayMs,
  scope: "Server-side Rime request timing only. It is not the browser end-of-turn to audible-playback metric.",
  p50: {
    toolMs: percentile(runs.map((item) => item.toolMs), 0.5),
    rimeHeaderMs: percentile(runs.map((item) => item.rimeHeaderMs), 0.5),
    rimeFirstChunkMs: percentile(runs.map((item) => item.rimeFirstChunkMs), 0.5),
  },
  p90: {
    toolMs: percentile(runs.map((item) => item.toolMs), 0.9),
    rimeHeaderMs: percentile(runs.map((item) => item.rimeHeaderMs), 0.9),
    rimeFirstChunkMs: percentile(runs.map((item) => item.rimeFirstChunkMs), 0.9),
  },
  runs,
};

await mkdir(new URL("./results/", import.meta.url), { recursive: true });
const output = new URL(`./results/${Date.now()}.json`, import.meta.url);
await writeFile(output, JSON.stringify(result, null, 2));
console.log(`Saved ${output.pathname}`);
