export type SpeechStage = "ack" | "answer";

import { apiUrl } from "./api";

export type SpeechHandle = {
  mode: "streaming" | "fallback";
  firstAudible: Promise<{ rimeTtfbMs: number; playbackMs: number }>;
  finished: Promise<void>;
  stop: () => void;
};

type SpeechOptions = {
  text: string;
  stage: SpeechStage;
  signal: AbortSignal;
};

class SpeechFailure extends Error {}

function makeDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * Streams Rime MP3 bytes through MediaSource when the browser supports it.
 * The Blob fallback remains Rime audio, but should not be used for benchmark claims.
 */
export async function speakWithRime(options: SpeechOptions): Promise<SpeechHandle> {
  const requestStarted = performance.now();
  const response = await fetch(apiUrl("/api/tts"), {
    method: "POST",
    signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: options.text, stage: options.stage }),
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new SpeechFailure(payload.error ?? "Rime did not return an audio stream.");
  }

  const responseAt = performance.now();
  const reportedTtfb = Number(response.headers.get("X-FastField-Rime-TTFB-Ms"));
  const rimeTtfbMs = Number.isFinite(reportedTtfb)
    ? reportedTtfb
    : Math.round(responseAt - requestStarted);
  const firstAudible = makeDeferred<{ rimeTtfbMs: number; playbackMs: number }>();
  const finished = makeDeferred<void>();
  const audio = new Audio();
  let objectUrl = "";
  let stopped = false;
  let audibleRecorded = false;
  let mediaSource: MediaSource | null = null;

  const cleanup = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    audio.removeAttribute("src");
    mediaSource = null;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    audio.pause();
    cleanup();
    firstAudible.reject(new DOMException("Speech cancelled", "AbortError"));
    finished.reject(new DOMException("Speech cancelled", "AbortError"));
  };

  options.signal.addEventListener("abort", stop, { once: true });
  audio.addEventListener("ended", () => {
    if (!stopped) {
      cleanup();
      finished.resolve();
    }
  });
  audio.addEventListener("error", () => {
    if (!stopped) {
      const failure = new SpeechFailure("Audio playback failed.");
      firstAudible.reject(failure);
      finished.reject(failure);
      cleanup();
    }
  });

  const markAudible = () => {
    if (audibleRecorded || stopped) return;
    audibleRecorded = true;
    firstAudible.resolve({
      rimeTtfbMs,
      playbackMs: Math.round(performance.now() - requestStarted),
    });
  };

  const waitForCurrentTime = () => {
    if (stopped || audibleRecorded) return;
    if (audio.currentTime > 0.01) {
      markAudible();
      return;
    }
    requestAnimationFrame(waitForCurrentTime);
  };

  audio.addEventListener("playing", waitForCurrentTime, { once: true });

  const canStream =
    "MediaSource" in window &&
    typeof MediaSource.isTypeSupported === "function" &&
    MediaSource.isTypeSupported("audio/mpeg");

  if (!canStream) {
    // The fallback is deliberately visible in Judge Mode. It preserves functional Rime audio,
    // but waits for the complete clip and is not an acceptable latency-test transport.
    const audioBlob = await response.blob();
    if (stopped) throw new DOMException("Speech cancelled", "AbortError");
    objectUrl = URL.createObjectURL(audioBlob);
    audio.src = objectUrl;
    await audio.play();
    return { mode: "fallback", firstAudible: firstAudible.promise, finished: finished.promise, stop };
  }

  mediaSource = new MediaSource();
  objectUrl = URL.createObjectURL(mediaSource);
  audio.src = objectUrl;

  mediaSource.addEventListener(
    "sourceopen",
    () => {
      if (!mediaSource || stopped) return;
      const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let streamDone = false;
      let playbackStarted = false;

      const endStream = () => {
        if (mediaSource?.readyState === "open") mediaSource.endOfStream();
      };

      const appendNext = () => {
        if (stopped || sourceBuffer.updating) return;
        const chunk = chunks.shift();
        if (chunk) {
          // Copy into a plain ArrayBuffer: DOM typings reject the potentially shared
          // ArrayBuffer backing a fetch Uint8Array, while SourceBuffer requires one.
          const appendable = new Uint8Array(chunk.byteLength);
          appendable.set(chunk);
          sourceBuffer.appendBuffer(appendable.buffer);
          if (!playbackStarted) {
            playbackStarted = true;
            void audio.play().catch((error: unknown) => {
              firstAudible.reject(error);
              finished.reject(error);
            });
          }
          return;
        }
        if (streamDone) endStream();
      };

      sourceBuffer.addEventListener("updateend", appendNext);
      void (async () => {
        try {
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
            appendNext();
          }
          streamDone = true;
          appendNext();
        } catch (error) {
          if (!stopped) {
            firstAudible.reject(error);
            finished.reject(error);
          }
        }
      })();
    },
    { once: true },
  );

  return { mode: "streaming", firstAudible: firstAudible.promise, finished: finished.promise, stop };
}
