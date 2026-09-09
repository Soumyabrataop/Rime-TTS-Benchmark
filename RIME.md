# Rime Integration and Benchmark Notes

This document records the official Rime information that applies to VoiceBench.
It is based on the current documentation at [docs.rime.ai](https://docs.rime.ai/)
and should be rechecked before the final demo because Rime's live voice catalog
can change.

## What Rime is

Rime is a text-to-speech platform for real-time voice applications. It provides
cloud TTS through HTTP streaming and WebSockets, plus voice, vocabulary, and
text-normalization endpoints.

For this project, Rime is the **primary spoken-output provider**. The benchmark
must use Rime in the normal product flow, not only for a welcome message or an
optional playback button.

## Current models

Rime's current cloud model families are:

| Model ID | Use when | Important capabilities |
| --- | --- | --- |
| `coda` | Voice quality and broad language coverage are the priority | Flagship model, nine cloud languages, streaming, and word timestamps on JSON WebSockets |
| `mistv3` | Lowest time-to-first-audio or custom pauses are the priority | English, French, German, and Spanish; lower latency; custom pauses; no inline pronunciation control |
| `mistv2` | Inline pronunciation control is required | English, French, German, and Spanish; custom pronunciation and custom pauses |

The Rime documentation recommends **Coda for most new applications**. The
VoiceBench default should therefore be:

```text
modelId: coda
speaker: verify against the live catalog before recording
lang: en
```

Always send `modelId` explicitly. If it is omitted or unrecognized, Rime serves
Mist v3 by default; Coda is never selected implicitly.

## Voices and languages

Rime requires a `speaker` on every TTS request. The speaker must be compatible
with both the selected model and language. A voice normally serves one
language, so a familiar speaker name must not be assumed to work for another
language.

The primary cloud language coverage documented by Rime is:

| Language | Tag | Coda | Mist v3 |
| --- | --- | --- | --- |
| Arabic | `ar` | Yes | No |
| English | `en` | Yes | Yes |
| French | `fr` | Yes | Yes |
| German | `de` | Yes | Yes |
| Hindi | `hi` | Yes | No |
| Italian | `it` | Yes | No |
| Japanese | `ja` | Yes | No |
| Portuguese | `pt` | Yes | No |
| Spanish | `es` | Yes | Yes |

For the benchmark, use one fixed English Coda speaker for all providers'
comparison conditions. Record the exact speaker in `README.md` and
`RIME_EVIDENCE.md` after checking the live catalog.

The public catalog endpoints are:

```text
https://users.rime.ai/data/voices/all-v2.json
https://users.rime.ai/data/voices/voice_details.json
```

These endpoints are public and do not require an API key.

## HTTP TTS integration

The standard cloud HTTP endpoint is:

```text
POST https://users.rime.ai/v1/rime-tts
```

Use bearer authentication and request the desired audio format through the
`Accept` header:

```http
Authorization: Bearer <RIME_API_KEY>
Content-Type: application/json
Accept: audio/wav
```

Example request:

```json
{
  "text": "Your confirmation code is spell(PRM423GDDML2354).",
  "speaker": "astra",
  "modelId": "coda",
  "lang": "en"
}
```

The HTTP response is streamed audio. Consume it incrementally when measuring
time-to-first-audio; buffering the whole body measures completion time instead
of the user's first audible response.

Supported HTTP output formats include MP3, WAV, Opus/WebM, Opus/Ogg, PCM, and
G.711 mu-law. VoiceBench should use `audio/wav` or `audio/mpeg` for saved,
blind-listening clips and document the exact choice.

## WebSocket streaming

For an interactive real-time interface, use Rime's recommended JSON WebSocket:

```text
wss://users-ws.rime.ai/ws3
```

Pass synthesis settings as query parameters and the API key as a connection
header. The browser must not connect directly with the secret because the
browser WebSocket API cannot set the required authorization header. Use a
server-side bridge.

The `/ws3` protocol provides:

- `chunk`: base64-encoded audio
- `timestamps`: word-level timing
- `done`: synthesis-batch completion
- `error`: structured synthesis failure

The application can send:

```json
{ "text": "Hello from VoiceBench.", "contextId": "item-001" }
```

and the following operations:

```json
{ "operation": "flush" }
{ "operation": "clear" }
{ "operation": "eos" }
```

Use `clear` when playback is interrupted so queued speech is discarded. Use a
VoiceBench-side item or turn ID as well; Rime context IDs help correlate audio
events but do not replace application state management.

For a simple benchmark clip generator, HTTP streaming is sufficient. For the
interactive demo, `/ws3` is preferable because it exposes timestamps and
supports interruption handling.

## Regional endpoints and latency

HTTP endpoints:

```text
https://users.rime.ai       # default / US West alias
https://users-west.rime.ai  # US West
https://users-east.rime.ai  # US East
```

WebSocket endpoints:

```text
wss://users-ws.rime.ai       # US West
wss://users-east-ws.rime.ai # US East
```

Use the endpoint closest to the application deployment. Measure the actual
endpoint used by the demo and report it. Rime's published benchmark reports
Mist v3 as faster to first audio than Coda, but those are Rime's controlled
measurements, not VoiceBench results. VoiceBench must report its own cold and
warm measurements, including network time.

Minimum latency measurement fields:

```text
request_started_at
first_audio_at
request_finished_at
audio_duration_ms
provider
model
speaker
endpoint
warm_or_cold
```

## Text normalization and pronunciation

Rime handles common spoken forms such as:

- currency
- dates and times
- phone numbers
- percentages
- standard measurements
- addresses, URLs, and email addresses
- many abbreviations and acronyms

Do not add an application-side normalization layer by default. First send the
exact text to Rime's `/textnorm` endpoint and inspect the result:

```text
POST https://optimize.rime.ai/textnorm
```

Use this endpoint in the benchmark to separate normalization errors from
synthesis-quality errors.

The `spell()` function is useful for confirmation codes, SKUs, account IDs,
and other strings that must be read character by character:

```text
Your confirmation code is spell(PRM423GDDML2354).
```

Important model limitation:

- `spell()` is processed by the Mist family.
- Coda does not run a separate `spell()` stage; do not claim forced
  character-by-character spelling for Coda without testing the exact selected
  voice and model.
- Inline phonetic pronunciation control is available on Mist v1/v2 and
  English Mist v3, not Coda.

For VoiceBench, keep the original corpus text unchanged for fairness. If a
test variant intentionally uses `spell()` or a pronunciation rewrite, label it
as a separate controllability condition rather than silently changing the
input.

The public vocabulary coverage endpoint is:

```text
POST https://users.rime.ai/oov
```

Use it to identify words outside Rime's pronunciation dictionary and include
those words in the pronunciation stress set.

## Prompting and spoken text

Rime recommends writing for the ear:

- Keep spoken sentences short, ideally under 15 words and generally under 25.
- Use punctuation to control pauses and emphasis.
- Use contractions and natural conversational phrasing.
- Use light disfluencies only where they improve realism.
- Do not send SSML tags to Coda; Coda supports no SSML.
- Do not add unsupported markup. The supported inline directive is
  model-dependent `spell(...)`.

VoiceBench should preserve the benchmark text exactly for provider comparison.
Prompting experiments belong in a separately labeled delivery or
controllability test.

## Security requirements

Rime API keys can synthesize speech against an account and must be treated as
secrets.

- Store the key only in server-side environment variables.
- Never put it in browser JavaScript, committed files, screenshots, video, or
  generated artifacts.
- Do not use the WebSocket query-string key option in the submitted product;
  it can expose the key in URLs and proxy logs.
- Include placeholders only in `.env.example`.
- Keep the active provider visible in the UI without exposing credentials.

Recommended environment variables:

```env
RIME_API_KEY=replace_me
RIME_HTTP_BASE_URL=https://users.rime.ai
RIME_WS_URL=wss://users-ws.rime.ai/ws3
RIME_MODEL_ID=coda
RIME_SPEAKER=replace_with_catalog_voice
RIME_LANGUAGE=en
RIME_AUDIO_FORMAT=wav
```

## VoiceBench implementation decision

The first implementation should use:

```text
Rime model:       coda
Transport:        HTTP streaming for clip generation
Transport:        /ws3 JSON WebSocket for the interactive demo, if needed
Language:         en
Audio format:     WAV for reproducible saved clips
Voice:            selected from the live Coda catalog
Endpoint:         nearest available Rime region
```

Use the same fixed speaker, text corpus, and measurement procedure for all
Rime runs. Compare Rime with at least two free local TTS systems, while keeping
these categories separate:

1. listening quality
2. text fidelity
3. latency
4. reliability
5. controllability

Do not present Rime's published latency or quality claims as project results.
They are background information only. All VoiceBench claims must come from
saved clips, item-level measurements, the analysis script, and clearly labeled
limitations.

## Minimal server-side Python example

Rime does not publish an official PyPI or npm SDK. Use the HTTPS API directly
with Python's standard library or a regular HTTP client:

```python
import json
import os
import urllib.request

payload = {
    "text": "Rime is speaking this benchmark sentence.",
    "speaker": os.environ["RIME_SPEAKER"],
    "modelId": os.environ.get("RIME_MODEL_ID", "coda"),
    "lang": os.environ.get("RIME_LANGUAGE", "en"),
}

request = urllib.request.Request(
    "https://users.rime.ai/v1/rime-tts",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {os.environ['RIME_API_KEY']}",
        "Content-Type": "application/json",
        "Accept": "audio/wav",
    },
    method="POST",
)

with urllib.request.urlopen(request) as response:
    with open("rime-output.wav", "wb") as audio:
        while chunk := response.read(4096):
            audio.write(chunk)
```

The request must be tested with the exact model, speaker, language, endpoint,
and audio format used in the submitted demo.

## Official references

- [Rime documentation index](https://docs.rime.ai/llms.txt)
- [Introduction](https://docs.rime.ai/docs/introduction)
- [API cheat sheet](https://docs.rime.ai/docs/api-cheat-sheet)
- [TTS in five minutes](https://docs.rime.ai/docs/quickstart-five-minute)
- [API authentication](https://docs.rime.ai/docs/api-authentication)
- [Models](https://docs.rime.ai/docs/models)
- [Voices](https://docs.rime.ai/docs/voices)
- [Streaming TTS](https://docs.rime.ai/docs/streaming)
- [WebSocket API overview](https://docs.rime.ai/docs/websockets)
- [Regional endpoints](https://docs.rime.ai/docs/regional-endpoints)
- [Latency](https://docs.rime.ai/docs/latency)
- [Prompting guide](https://docs.rime.ai/docs/prompting)
- [Text normalization](https://docs.rime.ai/docs/text-normalization)
- [Spell function](https://docs.rime.ai/docs/spell)
- [Voice catalog](https://users.rime.ai/data/voices/all-v2.json)
- [Voice metadata catalog](https://users.rime.ai/data/voices/voice_details.json)
