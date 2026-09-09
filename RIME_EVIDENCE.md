# Rime Evidence

## Hard voice claim

FastField makes a hands-busy equipment lookup feel immediate by beginning useful Rime-generated speech before the slow lookup completes. The short response is not a decorative welcome or optional playback: it is the default first spoken output on every judged request, and the final answer is also synthesized by Rime.

## Acceptance test: complete user path

**Fixture:** [`fixtures/benchmark.json`](fixtures/benchmark.json), run through the deployed FastField browser URL. Use the same Rime endpoint, region, model, speaker, format, and transport as the final demo.

**Setup:**

1. In `.env`, set the production Rime configuration and start FastField.
2. Use a Chrome-family browser with MediaSource MP3 support. Open Judge Mode and enable the 2-second Stress test.
3. Clear old browser tabs or mark the first run as cold. Run at least 20 warm turns from the fixed corpus; use the microphone path for the official end-of-turn-to-audible number.

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

## Result table — complete after running

| Scenario | N | P50 first audible | P90 first audible | P50 final answer | P90 final answer | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline (complete answer only) |  |  |  |  |  | Implement/run only if comparing against the same deployed path |
| FastField warm, 2s delayed tool |  |  |  |  |  | Primary result |
| FastField cold, 2s delayed tool |  |  |  |  |  | Label separately |
| Interruption runs |  |  |  |  |  | Count stale-result failures |

Do not populate this table with provider-advertised latency or a cherry-picked single run. The repository intentionally leaves it blank until measured in the shipped configuration.

## Repeatable server diagnostic

`npm.cmd run benchmark` uses 20 fixed prompts and records Rime response-header / first-chunk timing plus the delayed fixture-tool timing. It writes a JSON artifact to `evaluation/results/`.

This diagnostic excludes microphone capture and browser playback. It is useful for locating regressions, but it is not evidence for the complete user-path metric above.

## Known limitations

- Rime voices and production model availability must be confirmed against the live catalog before submission.
- Web Speech's end-of-turn detection differs by browser, so only a documented browser/version should be used for submitted benchmarks.
- Browser autoplay restrictions can prevent playback when the page has not received a user gesture; the judged flow begins from the microphone or send control.
- MediaSource support must be confirmed on the demo browser. The non-streaming Blob fallback must not be used for performance claims.
