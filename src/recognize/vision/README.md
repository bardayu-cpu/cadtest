# Vision wall comparison (Issue #16)

The Gemini adapter is **Node/server-only** (`node:crypto`, filesystem imports,
and a browser runtime guard). The portable `pipeline.ts` does not import or
re-export it. A browser build of the adapter fails; the pipeline continues to
bundle without the adapter. Never import it into a Next.js client component.

As checked on 2026-10-11, the default is `gemini-3.6-flash`: Google's
[model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)
lists image input and structured output; the
[pricing page](https://ai.google.dev/gemini-api/docs/pricing) lists a free tier.
The initially evaluated 3.8 Flash endpoint was unstable (400/503), while a 3.6
structured request succeeded. `GEMINI_MODEL` can override the default. Calls use
the documented `responseMimeType` and `responseJsonSchema` compatibility fields
from the [REST reference](https://ai.google.dev/api/generate-content). The newer
guide's `responseFormat` examples did not work reliably in this experiment.

## Local credentials and API requests

Put `GEMINI_API_KEY` in the ignored `.env.local`; `GEMINI_MODEL=` may be blank.
Only live CLI commands load this file. No `NEXT_PUBLIC_` variables, API routes,
or browser credential handling are introduced. The key travels in the
`x-goog-api-key` header, never in a URL, prompt, cache identity, or log. Upstream
error messages are discarded; errors contain only a safe category, duration,
and request count. Successful recordings are scrubbed for accidental key echoes.

Only the public fixture image and a generic architecture extraction prompt are
sent to Gemini. The prompt describes structural walls vs crossed cabinets,
furniture, dimension lines, and symbols without sample-specific dimensions or
room counts. Original image dimensions are supplied to establish pixel units.
The provider schema uses a common JSON Schema subset; local Zod validation
checks finite pixels, positive widths, image bounds, non-zero segments, unique wall IDs, and opening
references. Responses must finish with `STOP` before they can be cached.

Timeout is 60 seconds per attempt. HTTP 429/5xx and network/timeouts retry with
1/2/4 second exponential backoff, **at most three retries** (four requests total).
Permanent HTTP errors and invalid structured output fail immediately. CV remains
available even when live recognition fails. No paid-tier or billing changes are
made by these scripts.

Cache files live in ignored `tmp/vision-cache/`, keyed by image SHA-256, image
dimensions, model, prompt, generation configuration, and response schema with image-specific pixel bounds. Corrupt or mismatched caches are
not trusted. `bypassCache` explicitly forces new calls for the three-trial test.
The committed recordings retain the first successful requested A/B response,
raw provider JSON, parsed pixel plan, hash, model, timestamp, latency and attempt
count. They are replay data, **not manual ground truth**.

## Reproduction

```sh
nvm use
npm ci
npm run bench:recognize                 # all modes, recorded responses, no key/API
npm run bench:recognize -- cv
npm run bench:recognize -- vision
npm run bench:recognize -- vision+refine
npm run bench:recognize -- all --live    # A three fresh trials, B uses cache if present
npm run bench:recognize -- all --live --record # explicitly refresh first A/B recordings
npm run record:vision -- --live          # standalone A-three/B-one recording utility
npm run overlay -- fixtures/floorplan-a.jpg tmp/floorplan-a.vision-refine.json tmp/floorplan-a.vision-refine.png
npm run overlay -- fixtures/floorplan-b.jpg tmp/floorplan-b.vision-refine.json tmp/floorplan-b.vision-refine.png
```

The legacy `tmp/*.recognized.json` CV outputs remain available for existing overlay commands.

Replay timing labels historical API latency as `visionMs`, with `calls=0` and
`origin=recording`; it does not claim a live API call took place. `cvMs` includes
the existing scale/wall pipeline; `refineMs` times the pure wall refinement.
Live paired vision/refine rows share one response and its request count; use
`actualRequests` in the JSON report to count unique requests. Each A trial and
their mean are reported, with the number of successes; failed trials are not
converted into zero accuracy. Detailed door/window-by-kind and room IoU/type
scores are in `tmp/bench-recognize.json`, alongside the wall comparison.

## Refinement and limits

`refineWalls(visionWalls, lines, mmPerPixel)` is a portable pure function. It
searches within 25 pixels for parallel edge pairs 80–300mm apart, reuses generic
door-gap edge joining, ranks nearby pairs by centre/thickness/span support,
aligns centreline/width/nearby endpoints, orthogonalizes within 3 degrees, snaps
T/end junctions, and merges collinear segments while preserving thickness
changes. Unsupported and oblique predictions remain, with lower confidence.
Confidence is a geometry heuristic, not a calibrated probability. Refinement
can improve coordinates but cannot recover walls omitted by the vision model.

Vision mode only converts pixel coordinates to millimetres. Openings and rooms
receive no CV refinement. Original pixel predictions are retained in recordings;
conversion maps an opening centre to the existing model's wallId/offset form.
In refined mode, references to a merged wall are rebound to the nearest surviving
segment. This representation projects centres onto walls and can shift opening
positions; widths/types and room polygons are otherwise preserved. Heights and
ceiling style use the model defaults because a floor plan cannot measure them.

No expected coordinates, fixture-specific thresholds, or evaluator changes are
used in recognition/refinement. A is scored against the existing manual truth;
B has no truth and is checked by execution/overlay only. Quantitative results
and gap analysis are recorded in `fixtures/vision/RESULTS.md`; all final live trial
responses and exact scores are retained in `fixtures/vision/experiment.json`.
The canonical refined result is 20.7% recall / 16.2% precision; three fresh A
trials average 19.54% / 18.26%. The 85% target is unmet. The PR contains both
refined overlays.
