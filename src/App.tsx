import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { speakWithRime, type SpeechHandle } from "./audio";
import { apiUrl } from "./api";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "thinking" | "speaking" | "done" | "error";
};

type Metrics = {
  turnId: number;
  source: "voice" | "typed";
  endOfTurnMs: number;
  sttMs?: number;
  rimeTtfbMs?: number;
  playbackStartMs?: number;
  firstAudibleMs?: number;
  toolMs?: number;
  finalAnswerMs?: number;
  resultMode?: "streaming" | "fallback";
};

type Lookup = {
  acknowledgement: string;
  answer: string;
  serverToolMs: number;
  equipment: { id: string; error: string } | null;
};

type RimeConfig = {
  modelId: string;
  speaker: string;
  language: string;
  endpoint: string;
  format: string;
  transport: string;
};

const examples = [
  "What's wrong with pump four?",
  "Check pump 7.",
  "Is motor twelve safe to restart?",
];

function localAcknowledgement(prompt: string): string {
  const value = prompt.toLowerCase();
  if (/pump\s*(4|four)|\bp4\b/.test(value)) return "Checking pump four now.";
  if (/pump\s*(7|seven)|\bp7\b/.test(value)) return "Checking pump seven now.";
  if (/motor\s*(12|twelve)|\bm12\b/.test(value)) return "Checking motor twelve now.";
  return "I’m checking the equipment record now.";
}

function asMilliseconds(value?: number): string {
  return value === undefined ? "—" : `${Math.round(value)} ms`;
}

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "intro",
      role: "assistant",
      text: "I’m ready. Ask about pump four, pump seven, or motor twelve.",
      status: "done",
    },
  ]);
  const [state, setState] = useState<"ready" | "listening" | "working" | "speaking" | "error">("ready");
  const [judgeMode, setJudgeMode] = useState(true);
  const [slowTool, setSlowTool] = useState(true);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [rime, setRime] = useState<RimeConfig | null>(null);
  const [rimeReady, setRimeReady] = useState<boolean | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const active = useRef<{
    id: number;
    controller: AbortController;
    speech?: SpeechHandle;
  } | null>(null);
  const nextTurnId = useRef(1);
  const recognition = useRef<SpeechRecognition | null>(null);
  const sttStartedAt = useRef<number | null>(null);
  const transcript = useRef("");

  useEffect(() => {
    void fetch(apiUrl("/api/health"))
      .then(async (response) => {
        if (!response.ok) throw new Error("API unavailable");
        return (await response.json()) as { rimeConfigured: boolean; rime: RimeConfig };
      })
      .then((health) => {
        setRimeReady(health.rimeConfigured);
        setRime(health.rime);
      })
      .catch(() => setRimeReady(null));
  }, []);

  const cancelActive = (reason?: string) => {
    const running = active.current;
    if (!running) return;
    running.controller.abort();
    running.speech?.stop();
    active.current = null;
    if (reason) {
      setMessages((current) => [
        ...current,
        { id: `cancel-${running.id}`, role: "assistant", text: reason, status: "done" },
      ]);
    }
  };

  const updateMessage = (id: string, changes: Partial<Message>) => {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, ...changes } : message)));
  };

  const executeTurn = async (rawPrompt: string, source: "voice" | "typed", sttMs?: number) => {
    const cleanPrompt = rawPrompt.trim();
    if (!cleanPrompt) return;
    cancelActive("Previous request cancelled.");
    const turnId = nextTurnId.current++;
    const controller = new AbortController();
    active.current = { id: turnId, controller };
    const endOfTurnMs = performance.now();
    const assistantId = `assistant-${turnId}`;
    const ackText = localAcknowledgement(cleanPrompt);
    const initialMetrics: Metrics = { turnId, source, endOfTurnMs, sttMs };
    setMetrics(initialMetrics);
    setMessages((current) => [
      ...current,
      { id: `user-${turnId}`, role: "user", text: cleanPrompt },
      { id: assistantId, role: "assistant", text: ackText, status: "thinking" },
    ]);
    setState("working");
    setSpeechError(null);
    setPrompt("");

    try {
      // Start the acknowledgement and the deliberately slow tool at the same time.
      const lookupStarted = performance.now();
      const lookupPromise = fetch(apiUrl("/api/lookup"), {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanPrompt, delayMs: slowTool ? 2_000 : 0 }),
      }).then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "Lookup failed.");
        return (await response.json()) as Lookup;
      });
      const acknowledgement = await speakWithRime({ text: ackText, stage: "ack", signal: controller.signal });
      if (active.current?.id !== turnId) return;
      active.current.speech = acknowledgement;
      updateMessage(assistantId, { status: "speaking" });
      setState("speaking");

      void acknowledgement.firstAudible.then(({ rimeTtfbMs, playbackMs }) => {
        if (active.current?.id !== turnId) return;
        setMetrics((previous) =>
          previous && previous.turnId === turnId
            ? {
                ...previous,
                rimeTtfbMs,
                playbackStartMs: playbackMs,
                firstAudibleMs: Math.round(performance.now() - endOfTurnMs),
                resultMode: acknowledgement.mode,
              }
            : previous,
        );
      });

      const lookup = await lookupPromise;
      if (active.current?.id !== turnId) return;
      setMetrics((previous) =>
        previous && previous.turnId === turnId
          ? { ...previous, toolMs: Math.round(performance.now() - lookupStarted) }
          : previous,
      );

      // The answer is prepared while the short acknowledgement is spoken, then serialized for clarity.
      await acknowledgement.finished;
      if (active.current?.id !== turnId) return;
      updateMessage(assistantId, { text: lookup.answer, status: "speaking" });
      const answer = await speakWithRime({ text: lookup.answer, stage: "answer", signal: controller.signal });
      if (active.current?.id !== turnId) return;
      active.current.speech = answer;
      await answer.finished;
      if (active.current?.id !== turnId) return;
      updateMessage(assistantId, { status: "done" });
      setMetrics((previous) =>
        previous && previous.turnId === turnId
          ? { ...previous, finalAnswerMs: Math.round(performance.now() - endOfTurnMs) }
          : previous,
      );
      active.current = null;
      setState("ready");
    } catch (error) {
      if (active.current?.id !== turnId) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "The voice request could not be completed.";
      updateMessage(assistantId, { text: `Voice output unavailable: ${message}`, status: "error" });
      setSpeechError(message);
      active.current = null;
      setState("error");
    }
  };

  const beginListening = () => {
    if (state === "listening") {
      recognition.current?.stop();
      return;
    }
    cancelActive("Interrupted by a new voice turn.");
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) {
      setSpeechError("Speech recognition is unavailable in this browser. Use the text field or Chrome-based browser for the microphone demo.");
      setState("error");
      return;
    }
    const instance = new Constructor();
    recognition.current = instance;
    transcript.current = "";
    sttStartedAt.current = performance.now();
    instance.lang = "en-US";
    instance.continuous = false;
    instance.interimResults = true;
    instance.onresult = (event) => {
      transcript.current = Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0]?.transcript ?? "").join("");
      setPrompt(transcript.current);
    };
    instance.onerror = (event) => {
      if (event.error === "aborted") return;
      setSpeechError(`Speech recognition: ${event.error}. You can still type a request.`);
      setState("error");
    };
    instance.onend = () => {
      const spoken = transcript.current.trim();
      const sttMs = sttStartedAt.current ? Math.round(performance.now() - sttStartedAt.current) : undefined;
      recognition.current = null;
      if (spoken) void executeTurn(spoken, "voice", sttMs);
      else setState("ready");
    };
    setState("listening");
    setSpeechError(null);
    instance.start();
  };

  const status = useMemo(() => {
    if (state === "listening") return "Listening — release a short equipment question";
    if (state === "working") return "Starting the immediate Rime acknowledgement";
    if (state === "speaking") return "Rime is speaking";
    if (state === "error") return "Voice output needs attention";
    return "Ready for a hands-free equipment question";
  }, [state]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void executeTurn(prompt, "typed");
  };

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="FastField home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>FastField</span>
        </a>
        <div className="topbar-actions">
          <span className={`provider-pill ${rimeReady ? "is-ready" : ""}`}>
            <span className="status-dot" />
            {rimeReady ? "Rime connected" : rimeReady === false ? "Rime needs key" : "Checking Rime"}
          </span>
          <button className="text-button" type="button" onClick={() => setJudgeMode((value) => !value)}>
            {judgeMode ? "Hide judge mode" : "Show judge mode"}
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> LOW-LATENCY FIELD SUPPORT</div>
        <h1>Immediate help,<br /><em>when hands are busy.</em></h1>
        <p className="hero-copy">FastField speaks a useful Rime acknowledgement before the full equipment lookup has finished.</p>
        <div className="principle"><span>✦</span> No silent waiting while a slow tool runs.</div>
      </section>

      <section className="workspace" aria-label="FastField voice assistant">
        <div className="conversation-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">ACTIVE SESSION</span>
              <h2>Equipment copilot</h2>
            </div>
            <span className={`live-state ${state}`}><span />{state === "ready" ? "READY" : state.toUpperCase()}</span>
          </div>

          <div className="conversation" aria-live="polite">
            {messages.map((message) => (
              <article className={`message ${message.role} ${message.status ?? ""}`} key={message.id}>
                <span className="message-label">{message.role === "user" ? "TECHNICIAN" : "FASTFIELD"}</span>
                <p>{message.text}</p>
                {message.status === "thinking" && <span className="typing"><i /><i /><i /></span>}
              </article>
            ))}
          </div>

          <form className="command-form" onSubmit={submit}>
            <div className="input-wrap">
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask about equipment…"
                aria-label="Equipment question"
                disabled={state === "working" || state === "speaking"}
              />
              <button className="send-button" type="submit" disabled={!prompt.trim() || state === "working" || state === "speaking"} aria-label="Send typed question">↑</button>
            </div>
            <button className={`mic-button ${state === "listening" ? "is-listening" : ""}`} type="button" onClick={beginListening} aria-label="Use microphone">
              <span className="mic-icon" aria-hidden="true" />
              <span>{state === "listening" ? "Stop listening" : "Hold to talk"}</span>
            </button>
          </form>

          <p className="status-copy"><span className="status-dot" /> {status}</p>
          {speechError && <p className="error-copy">{speechError}</p>}
          <div className="suggestions" aria-label="Example questions">
            {examples.map((example) => <button type="button" key={example} onClick={() => setPrompt(example)}>{example}</button>)}
          </div>
        </div>

        {judgeMode && (
          <aside className="judge-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">JUDGE MODE</span>
                <h2>Latency evidence</h2>
              </div>
              <span className="turn-id">TURN {String(metrics?.turnId ?? 0).padStart(3, "0")}</span>
            </div>

            <div className="metric-hero">
              <span>END OF TURN → FIRST AUDIO</span>
              <strong>{metrics?.firstAudibleMs !== undefined ? `${metrics.firstAudibleMs} ms` : "Waiting"}</strong>
              <small>{metrics?.firstAudibleMs !== undefined ? "measured at Rime playback start" : "speak a request to measure"}</small>
            </div>

            <dl className="metric-list">
              <div><dt>Speech recognition</dt><dd>{asMilliseconds(metrics?.sttMs)}</dd></div>
              <div><dt>Fixture tool {slowTool ? "(delayed)" : ""}</dt><dd>{asMilliseconds(metrics?.toolMs)}</dd></div>
              <div><dt>Rime TTFA proxy</dt><dd>{asMilliseconds(metrics?.rimeTtfbMs)}</dd></div>
              <div><dt>Playback started</dt><dd>{asMilliseconds(metrics?.playbackStartMs)}</dd></div>
              <div><dt>Playback transport</dt><dd>{metrics?.resultMode ?? "—"}</dd></div>
              <div className="total"><dt>Final answer complete</dt><dd>{asMilliseconds(metrics?.finalAnswerMs)}</dd></div>
            </dl>

            <div className="stress-control">
              <div><strong>Stress test</strong><span>Inject a fixed 2s equipment delay</span></div>
              <button type="button" className={slowTool ? "switch on" : "switch"} onClick={() => setSlowTool((value) => !value)} aria-pressed={slowTool}><i /></button>
            </div>
            <p className="fence-note"><span>↯</span> New turns abort audio and fence obsolete tool results.</p>

            <details className="rime-details">
              <summary>Active Rime configuration</summary>
              {rime ? (
                <dl>
                  <div><dt>Model</dt><dd>{rime.modelId}</dd></div>
                  <div><dt>Voice</dt><dd>{rime.speaker}</dd></div>
                  <div><dt>Language</dt><dd>{rime.language}</dd></div>
                  <div><dt>Format</dt><dd>{rime.format}</dd></div>
                  <div><dt>Transport</dt><dd>{rime.transport}</dd></div>
                </dl>
              ) : <p>Connect the local API to read active configuration.</p>}
            </details>
          </aside>
        )}
      </section>

      <footer>
        <span>PRIMARY SPOKEN OUTPUT</span><b>RIME</b><i /> <span>CONTROLLED FIXTURE BENCHMARK</span>
      </footer>
    </main>
  );
}
