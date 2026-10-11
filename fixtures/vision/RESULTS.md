# Gemini wall comparison — 2026-10-11

Final experiment: `gemini-3.6-flash`, `floorplan-pixels-v3`, temperature 0.2, LOW thinking. Original A/B images are unchanged. The first valid response for each image is the canonical recording; it was selected before scoring. `experiment.json` retains all three A responses, the B response, exact scores, durations, request counts, and machine metadata. It is experiment evidence, not ground truth.

All scoring uses the unchanged evaluator and A manual annotation: undirected angle <3°, complete symmetric segment Hausdorff distance <100mm, maximum one-to-one matching; openings compare same-kind centres <200mm; room IoU ≥0.8. Scale comes from the independent CV/OCR pipeline (A error 0.171%). B has no manual annotation: N/A means unscored.

## Canonical offline comparison

Default `npm run bench:recognize` replays these recordings and makes zero API calls. `visionMs` below is historical recorded latency, including validation and any retry/backoff, not replay runtime. CV and refinement times were measured on this replay.

| image | mode | walls | matched | recall | precision | cvMs | visionMs | refineMs | calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| floorplan-a.jpg | cv | 24 | 4/29 | 13.8% | 16.7% | 1353 | 0 | 0 | 0 |
| floorplan-a.jpg | vision | 42 | 3/29 | 10.3% | 7.1% | 1353 | 15059 | 0 | 0 |
| floorplan-a.jpg | vision+refine | 37 | 6/29 | 20.7% | 16.2% | 1353 | 15059 | 2 | 0 |
| floorplan-b.jpg | cv | 50 | N/A | N/A | N/A | 1112 | 0 | 0 | 0 |
| floorplan-b.jpg | vision | 26 | N/A | N/A | N/A | 1112 | 10579 | 0 | 0 |
| floorplan-b.jpg | vision+refine | 25 | N/A | N/A | N/A | 1112 | 10579 | 1 | 0 |

## Three fresh A trials and B capture

One response supplies both raw and refined rows. Request counts are shared between the paired rows: the final run made **5 unique HTTP requests** (A: 1+1+2, B: 1). Three A trials succeeded out of three. These counts describe this final run; earlier compatibility/validation probes are excluded. Latencies below include retries and are measured separately from refinement.

| image | mode | walls | matched | recall | precision | visionMs | refineMs | calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| floorplan-a.jpg | cv | 24 | 4/29 | 13.8% | 16.7% | 0 | 0 | 0 |
| floorplan-a.jpg | vision-trial-1 | 42 | 3/29 | 10.3% | 7.1% | 15061 | 0 | 1 |
| floorplan-a.jpg | vision+refine-trial-1 | 37 | 6/29 | 20.7% | 16.2% | 15061 | 4 | 1 |
| floorplan-a.jpg | vision-trial-2 | 30 | 3/29 | 10.3% | 10.0% | 13071 | 0 | 1 |
| floorplan-a.jpg | vision+refine-trial-2 | 28 | 8/29 | 27.6% | 28.6% | 13071 | 1 | 1 |
| floorplan-a.jpg | vision-trial-3 | 32 | 0/29 | 0.0% | 0.0% | 21112 | 0 | 2 |
| floorplan-a.jpg | vision+refine-trial-3 | 30 | 3/29 | 10.3% | 10.0% | 21112 | 3 | 2 |
| floorplan-b.jpg | cv | 50 | N/A | N/A | N/A | 0 | 0 | 0 |
| floorplan-b.jpg | vision-trial-1 | 26 | N/A | N/A | N/A | 10582 | 0 | 1 |
| floorplan-b.jpg | vision+refine-trial-1 | 25 | N/A | N/A | N/A | 10582 | 8 | 1 |

Means use exact scores before rounding, with equal weight per successful trial:

| mode | successes | recall | precision |
| --- | --- | --- | --- |
| vision | 3/3 | 6.90% | 5.71% |
| vision+refine | 3/3 | 19.54% | 18.26% |

## Why the 85% target is unmet

The canonical refined result matches 6/29 walls (20.7% recall, 16.2% precision). The three-trial mean is 19.54% / 18.26%. This is not a successful 85% solution. Refinement improves the raw mean (6.90% / 5.71%), but the experiment does not establish a reliable practical improvement over CV (13.8% / 16.7%).

- **Vision errors:** A has 42 predicted segments versus 29 annotated continuous walls. The overlay shows extra/split segments, missing structural spans, and coarse locations; the kitchen outline extends into the lower dimension area and bathroom/bedroom partitions are misplaced. B also has large coordinate shifts and incorrect room semantics. These errors are already present in raw responses. A diagnostic using only the scoring fixture found 10/29 annotated walls without a parallel seed within 25px covering at least half their span; this combines omitted walls and position errors outside the refinement window, not a claim that all ten were semantically omitted.
- **Refinement errors:** 15/37 canonical refined walls lack supporting paired edges and remain at low confidence. Neighbouring furniture/window edges can still attract a seed. The strict raw matches were w15/w23/w24; refinement adds w02/w03/w06/w14, retains w15/w24, but loses w23. Correcting some wall centres does not ensure the entire segment ends satisfy <100mm. The current refinement cannot add missing walls or infer the correct global wall topology.
- **Scale is not the dominant error:** 0.171% scale error is small compared with the visible pixel shifts and missing/extended segments. No thresholds, truth coordinates, or fixture-specific prompt content were added to improve scores.

The ±25px window, wall thickness constraints and generic snapping rules are shared across images. Unsupported predictions are retained as required rather than removed to inflate precision. Room polygons and opening types/widths are not CV-refined. Opening centres are projected into the existing wallId/offset model; this can shift them when their containing wall is refined or merged. Original centres remain in the recordings.

## Opening and room reference scores

The empty opening category uses the existing evaluator's empty-denominator convention (100% when neither truth nor prediction has an opening); it is not successful detection. Room typeMatched counts correctly classified geometric matches.

| image | mode | kind | predicted | expected | matched | typeMatched | recall | precision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| floorplan-a.jpg | cv | door | 0 | 7 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | cv | window | 0 | 6 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | cv | sliding_door | 0 | 1 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | cv | opening | 0 | 0 | 0 | N/A | 100.0% | 100.0% |
| floorplan-a.jpg | cv | floor_window | 0 | 1 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | cv | rooms (IoU >= 0.8) | 0 | 9 | 0 | 0 | 0.0% | 0.0% |
| floorplan-a.jpg | vision | door | 7 | 7 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | vision | window | 4 | 6 | 1 | N/A | 16.7% | 25.0% |
| floorplan-a.jpg | vision | sliding_door | 0 | 1 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | vision | opening | 0 | 0 | 0 | N/A | 100.0% | 100.0% |
| floorplan-a.jpg | vision | floor_window | 0 | 1 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | vision | rooms (IoU >= 0.8) | 10 | 9 | 3 | 3 | 33.3% | 30.0% |
| floorplan-a.jpg | vision+refine | door | 7 | 7 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | vision+refine | window | 4 | 6 | 2 | N/A | 33.3% | 50.0% |
| floorplan-a.jpg | vision+refine | sliding_door | 0 | 1 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | vision+refine | opening | 0 | 0 | 0 | N/A | 100.0% | 100.0% |
| floorplan-a.jpg | vision+refine | floor_window | 0 | 1 | 0 | N/A | 0.0% | 0.0% |
| floorplan-a.jpg | vision+refine | rooms (IoU >= 0.8) | 10 | 9 | 3 | 3 | 33.3% | 30.0% |

Machine: Apple M1 / darwin arm64 / Node v24.21.0. Timings are a single measured run, not a latency guarantee.
