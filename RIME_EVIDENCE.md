# Rime Evidence

## Hard voice claim

FastField makes a hands-busy equipment lookup feel immediate by beginning useful Rime-generated speech before the slow lookup completes. The short response is not a decorative welcome or optional playback: it is the default first spoken output on every judged request, and the final answer is also synthesized by Rime.

## Acceptance test: complete user path

**Fixture:** [`fixtures/benchmark.json`](fixtures/benchmark.json), run through the deployed FastField browser URL. Use the same Rime endpoint, region, model, speaker, format, and transport as the final demo.

**Setup:**

1. In `.env`, set the production Rime configuration and start FastField.
2. Use a Chrome-family browser with MediaSource MP3 support. Open Judge Mode and enable the 2-second Stress test.
3. Clear old browser tabs or mark the first run as cold. Run at least 20 turns
   from the fixed corpus and use the microphone path for the official
   end-of-turn-to-audible number when available.

**For each turn, capture:**

- end of user speech (browser timestamp);
- STT completion (if microphone input);
- fixture-tool completion;
- Rime proxy time-to-first-byte;
- playback start / first audible Rime audio;
- final-answer completion.

**Pass criteria:**

1. First Rime audio begins after the user turn and before the delayed final lookup result.
2. The final spoken answer matches the fixture.
3. Judge Mode displays a first-audio measurement and the active Rime configuration.
4. No non-Rime provider speaks assistant text.

Calculate and report P50, P90, min, and max for `first audible Rime audio − end of user turn`. Label microphone and typed runs separately; only microphone runs make the intended end-of-turn claim. Label warm and cold sets separately.

## Stress test: interruption

1. Enable the fixed 2-second fixture delay.
2. Start “Check pump 4.”
3. Before its final answer, interrupt with “Actually, pump 7.”
4. Pass only if pump four audio stops and never resumes, including after its deliberately delayed lookup completes. The final audio must describe pump seven.

The client increments a turn ID, aborts the active fetches, stops the `HTMLAudioElement`, and checks the active ID before every state transition. This provides both cancellation and stale-result fencing.

## How to collect and summarize browser evidence

1. Start the application with `npm.cmd run dev`.
2. Open `http://localhost:5173` in Chrome or Chromium.
3. Confirm **Rime connected**, keep **Judge Mode** open, and enable the fixed
   two-second **Stress test**.
4. Run at least 20 completed normal turns. Use the microphone if browser speech
   recognition works. If it reports a `network` error, use typed prompts and
   label them `typed`; do not call them microphone measurements.
5. Click **Download readings** in Judge Mode and save the JSON export under
   `evaluation/results/`.
6. Summarize the export:

```powershell
npm.cmd run summarize:browser -- evaluation/results/fastfield-browser-runs.json
```

This writes a `.summary.json` file containing P50, P90, minimum, and maximum
values for first audible playback, final answer completion, tool time, and Rime
TTFB. Copy the values from the summary into the result table below.

For the interruption stress case, run at least 10 deliberate demonstrations
separately:

1. Submit `Check pump four.`
2. While the acknowledgement or answer is active, submit or say
   `Actually, pump seven.`
3. Count a pass only when pump-four audio stops, the delayed pump-four result
   never resumes, and the final spoken answer is for pump seven.
4. Use the Judge Mode interruption notice and downloaded `interruptions` array
   to document the interrupted turn and replacement request. Record any
   stale-audio or stale-result failures separately. These results are not
   inferred from completed-turn latency statistics.

## Result table

| Scenario | N | P50 first audible | P90 first audible | P50 final answer | P90 final answer | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline (complete answer only) | — | — | — | — | — | Not measured |
| FastField warm, 2s delayed tool | 14 | 1,056 ms | 1,198 ms | 8,375 ms | 10,938 ms | 13 microphone, 1 typed; streaming |
| FastField cold, 2s delayed tool | 6 | 1,043 ms | 1,309 ms | 8,282 ms | 11,036 ms | Microphone; streaming |
| FastField typed, 2s delayed tool | 1 | 1,351 ms | 1,351 ms | 10,976 ms | 10,976 ms | Typed; not a microphone end-of-turn claim |
| Interruption events | 15 | — | — | — | — | 14 replacement prompts captured; 1 event has no replacement prompt |

The values above come from
`evaluation/results/fastfield-browser-runs.summary.json` exported on
2026-09-09. The export contains **20 completed runs**, including 19 microphone
runs and one typed run. All 20 used streaming playback. It contains **15
interruption events**; 14 have a captured replacement prompt and one ended
without a replacement prompt.

The interruption event log proves that active turns were cancelled and
replacement requests were started. The export does not independently record
whether stale audio was heard or whether a stale result was spoken. During the
demo, state the observed interruption outcome explicitly and add the manual
counts below.

### Interruption outcome

```text
Interruption events recorded: 15
Replacement prompts captured: 14
Incomplete interruption events: 1
Stale-audio failures: record from observation
Stale-result failures: record from observation
Final-answer mismatches: record from observation
```

Do not claim zero stale-audio or stale-result failures unless the runs were
observed and those counts were recorded during the stress test.

Do not populate this table with provider-advertised latency or a cherry-picked
single run.

## Repeatable server diagnostic

`npm.cmd run benchmark` uses the fixed prompt corpus, starts the delayed fixture lookup
and Rime acknowledgement in parallel, and records Rime response-header /
first-chunk timing plus the delayed fixture-tool timing. It writes a JSON
artifact to `evaluation/results/`.

This diagnostic excludes microphone capture and browser playback. It is useful for locating regressions, but it is not evidence for the complete user-path metric above.

The server diagnostic may support the browser evidence, but it must not replace
the exported Judge Mode readings in the result table.

## Known limitations

- Rime voices and production model availability must be confirmed against the live catalog before submission.
- Web Speech's end-of-turn detection differs by browser, so only a documented browser/version should be used for submitted benchmarks.
- Browser autoplay restrictions can prevent playback when the page has not received a user gesture; the judged flow begins from the microphone or send control.
- MediaSource support must be confirmed on the demo browser. The non-streaming Blob fallback must not be used for performance claims.
