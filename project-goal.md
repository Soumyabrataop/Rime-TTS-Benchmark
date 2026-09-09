# FastField Project Goal

## Project name

**FastField: An interruption-safe voice copilot for field technicians**

## One-sentence goal

Build a free, hands-free equipment diagnostic assistant that gives a useful
Rime-generated acknowledgement immediately, remains responsive while a lookup
is running, and cancels obsolete speech when the technician interrupts or
changes the request.

## Why this existing project is the right submission

The repository already contains the core of a working product:

- A browser voice and typed interaction
- A controlled equipment-lookup fixture
- Rime server-side TTS streaming
- Immediate acknowledgement speech
- Deliberately delayed tool work
- Turn cancellation and stale-result fencing
- Judge Mode measurements
- A repeatable benchmark command
- Rime configuration and evidence documentation

This is more aligned with the hackathon than converting the project into a
generic TTS leaderboard. It demonstrates a real user situation in which speech
is essential and proves one difficult voice behavior end to end.

## Target user and situation

The target user is a field technician inspecting or repairing equipment while
their hands and attention are occupied.

The technician asks questions such as:

- “What’s wrong with pump four?”
- “Check pump seven.”
- “Is motor twelve safe to restart?”

The system gives an immediate spoken acknowledgement, performs the equipment
lookup, and then speaks the answer. The fixture data is intentionally
synthetic and repeatable for the demo.

## The user problem

In a hands-busy workflow, silence after the user finishes speaking makes the
assistant feel broken. A slow lookup can also produce a dangerous interaction
when the user changes their request while the previous answer is still pending.

FastField solves both problems:

1. It starts useful Rime speech before the slow lookup completes.
2. It accepts a new voice turn while the prior request is active.
3. It stops obsolete audio promptly.
4. It prevents delayed results from being spoken as if they applied to the new
   request.

## Hard voice problem

The primary challenge is:

> **Conversation continuity during tool work, with interruption and recovery,
> while reducing perceived response time.**

This is a complete application property, not a claim about TTS latency alone.
The browser, server, Rime stream, delayed lookup, playback, cancellation, and
conversation state all participate in the result.

## Why speech is essential

Speech is the primary interaction and output channel:

- The technician can ask while looking at equipment.
- The acknowledgement communicates that work has started without requiring a
  screen check.
- The final diagnostic is spoken while the technician remains hands-free.
- Interruption is performed through a new spoken turn.

Removing speech would leave a significantly different and less useful product.
The application is not a text chatbot with an optional audio button.

## Core product flow

1. The user starts a microphone turn or submits a repeatable typed test prompt.
2. FastField creates a new monotonically increasing turn ID.
3. The delayed fixture lookup and Rime acknowledgement begin in parallel.
4. Rime streams a short acknowledgement such as “Checking pump four now.”
5. The user may interrupt and submit a corrected request.
6. FastField aborts the previous lookup and Rime request, stops playback, and
   fences stale state transitions.
7. The new request receives its own acknowledgement and final answer.
8. Rime speaks the final equipment result.
9. Judge Mode displays the active Rime configuration and user-visible timings.

## Acceptance test

Define and run both tests in the exact path shown in the demo.

### Normal flow

1. Enable the fixed two-second lookup delay.
2. Ask, “What’s wrong with pump four?”
3. Verify that Rime begins the acknowledgement before the lookup completes.
4. Verify that the final answer describes pump four.
5. Record:
   - end-of-user-turn timestamp
   - Rime time to first byte
   - first audible playback timestamp
   - lookup completion time
   - final-answer completion time
6. Repeat at least 20 times and report P50 and P90. Label cold and warm runs
   separately.
7. Label microphone, typed, cold, and warm measurements separately.

### Deliberate interruption stress case

1. Enable the fixed two-second lookup delay.
2. Start “Check pump four.”
3. While its acknowledgement or answer is active, interrupt with “Actually,
   pump seven.”
4. Verify that pump-four audio stops and never resumes.
5. Verify that the delayed pump-four result is not spoken as current.
6. Verify that the final spoken response describes pump seven.
7. Record the number of stale-result and stale-audio failures.

### Pass criteria

- Rime speech begins before the delayed final lookup in the normal flow.
- The final spoken answer matches the active request.
- Audio from an interrupted turn stops promptly.
- No stale lookup result re-enters the conversation.
- The active Rime model, speaker, language, endpoint, format, and transport are
  visible in Judge Mode.
- The measured results come from the shipped browser path, not only a server
  timing proxy.

## Rime role and configuration

Rime provides all audible assistant speech:

- Immediate acknowledgements
- Final equipment answers
- Error and cancellation messages where applicable

The API key remains server-side. The browser never calls Rime directly.

Before submission, verify the exact current catalog configuration and record it
in `README.md` and `RIME_EVIDENCE.md`:

```text
modelId: current selected Rime model
speaker: current catalog speaker
language: current language tag
endpoint: regional endpoint used by the demo
audio format: current response format
transport: streaming HTTP proxy, or the exact shipped transport
```

The repository currently targets low-latency streaming HTTP. That is suitable
for the perceived-response-time claim. If the final configuration changes,
measure and document the changed path rather than relying on advertised Rime
benchmarks.

## Free implementation

The project can remain free of cost apart from event-provided Rime access:

| Area | Existing choice |
| --- | --- |
| UI | React and Vite |
| API | Node.js and Express |
| Speech recognition | Browser Web Speech API |
| Speech synthesis | Rime server-side API |
| Lookup | Synthetic local fixture |
| Storage | No paid database or user account |
| Deployment | Local demo or free Cloudflare Pages/Workers path |
| Measurement | Browser and server performance timestamps |

No paid LLM, database, analytics, or alternative TTS service is needed.

## Evidence and repository deliverables

The submission must contain:

- Working source repository
- Recorded demo no longer than four to five minutes
- `README.md`
- `RIME.md`
- `RIME_EVIDENCE.md`
- `.env.example` and/or `.dev.vars.example` with placeholders only
- Fixed equipment fixtures
- Benchmark fixture
- Repeatable benchmark command
- Architecture diagram
- Measured result artifact from the final shipped configuration

The demo must show:

1. The field-technician user and hands-busy problem.
2. The normal end-to-end interaction.
3. Rime as the active spoken-output provider.
4. The delayed lookup stress condition.
5. An interruption that changes pump four to pump seven.
6. Old speech stopping and the final response reflecting pump seven.
7. Judge Mode measurements and Rime configuration.

## Eligibility checklist

- [x] Clear user and problem.
- [x] Speech is materially necessary.
- [x] Working product path exists in the repository.
- [x] Rime is the primary spoken-output provider.
- [x] Rime is used for meaningful interaction, not just a welcome or final
  confirmation.
- [x] A focused hard voice problem is defined.
- [x] A normal test and deliberate stress test are defined.
- [x] The application owns input, orchestration, state, cancellation, and
  evaluation.
- [x] Credentials are kept server-side.
- [ ] Run the final browser measurements and commit the generated evidence
  artifact.
- [ ] Complete at least 20 normal browser runs and one interruption stress
  case, with the interruption event exported from Judge Mode.
- [ ] Verify the final Rime model, voice, language, endpoint, format, and
  transport against the live catalog and organizer preflight.
- [ ] Record and submit the final four-to-five-minute demo.

## Out of scope

Do not broaden the project tonight into a generic assistant, a telephony
system, a multi-provider TTS benchmark, or a production maintenance database.
Those additions would dilute the central claim and create more failure points.

## Definition of done

FastField is ready when a judge can run the repository, observe Rime beginning
useful speech before a delayed lookup completes, interrupt with a corrected
request, hear obsolete audio stop, and verify that the final response reflects
what the technician actually requested.
