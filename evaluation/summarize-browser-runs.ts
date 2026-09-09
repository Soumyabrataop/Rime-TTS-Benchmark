import { readFile, writeFile } from "node:fs/promises";

type BrowserRun = {
  recordedAt: string;
  prompt: string;
  source: "voice" | "typed";
  firstAudibleMs?: number;
  rimeTtfbMs?: number;
  playbackStartMs?: number;
  toolMs?: number;
  finalAnswerMs?: number;
  resultMode?: "streaming" | "fallback";
  outcome: "completed" | "cancelled" | "error";
  condition?: "cold" | "warm";
};

type ExportFile = {
  exportedAt: string;
  runs: BrowserRun[];
  interruptions?: Array<{
    interruptedTurnId: number;
    replacementPrompt: string;
    recordedAt: string;
    status: "interrupted";
  }>;
};

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0);
}

function range(values: number[]): { min: number | null; max: number | null } {
  return {
    min: values.length ? Math.round(Math.min(...values)) : null,
    max: values.length ? Math.round(Math.max(...values)) : null,
  };
}

function stats(runs: BrowserRun[], field: keyof BrowserRun) {
  const values = runs
    .map((run) => run[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    n: values.length,
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    ...range(values),
  };
}

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: npm.cmd run summarize:browser -- evaluation/results/fastfield-browser-runs.json");
}

const input = JSON.parse(await readFile(inputPath, "utf8")) as ExportFile;
const completed = input.runs.filter((run) => run.outcome === "completed");
const typed = completed.filter((run) => run.source === "typed");
const voice = completed.filter((run) => run.source === "voice");
const streaming = completed.filter((run) => run.resultMode === "streaming");
const cold = completed.filter((run) => run.condition === "cold");
const warm = completed.filter((run) => run.condition === "warm");
const interruptions = input.interruptions ?? [];
const completeInterruptions = interruptions.filter(
  (event) => event.replacementPrompt !== "Awaiting replacement voice request",
);

const summary = {
  exportedAt: input.exportedAt,
  scope: "Browser Judge Mode readings. These are user-path measurements from the exported application run.",
  totals: {
    exported: input.runs.length,
    completed: completed.length,
    cancelled: input.runs.filter((run) => run.outcome === "cancelled").length,
    errors: input.runs.filter((run) => run.outcome === "error").length,
    interruptions: interruptions.length,
    interruptionsWithReplacement: completeInterruptions.length,
    incompleteInterruptions: interruptions.length - completeInterruptions.length,
  },
  groups: {
    allCompleted: {
      firstAudibleMs: stats(completed, "firstAudibleMs"),
      finalAnswerMs: stats(completed, "finalAnswerMs"),
      toolMs: stats(completed, "toolMs"),
      rimeTtfbMs: stats(completed, "rimeTtfbMs"),
    },
    typed: {
      firstAudibleMs: stats(typed, "firstAudibleMs"),
      finalAnswerMs: stats(typed, "finalAnswerMs"),
    },
    microphone: {
      firstAudibleMs: stats(voice, "firstAudibleMs"),
      finalAnswerMs: stats(voice, "finalAnswerMs"),
    },
    streaming: {
      firstAudibleMs: stats(streaming, "firstAudibleMs"),
      finalAnswerMs: stats(streaming, "finalAnswerMs"),
    },
    cold: {
      firstAudibleMs: stats(cold, "firstAudibleMs"),
      finalAnswerMs: stats(cold, "finalAnswerMs"),
    },
    warm: {
      firstAudibleMs: stats(warm, "firstAudibleMs"),
      finalAnswerMs: stats(warm, "finalAnswerMs"),
    },
  },
  limitations: [
    "The export measures completed turns only; interruption success and stale-audio failures must be counted separately during the stress test.",
    "Typed runs are not microphone end-of-turn measurements.",
    "Fallback transport runs must not be used for streaming latency claims.",
  ],
};

const outputPath = inputPath.replace(/\.json$/i, ".summary.json");
await writeFile(outputPath, JSON.stringify(summary, null, 2) + "\n");
console.log(`Saved ${outputPath}`);
console.log(JSON.stringify(summary.groups.allCompleted, null, 2));
