# Scale and wall recognition (Issue #13)

`recognizeFloorPlan(image, options?)` accepts a browser `Blob` or an RGBA
`RasterImage` (`width`, `height`, `data`). It returns `mmPerPixel: number | null`,
millimetre `walls`, a `RecognitionReport`, and diagnostics. Every detected wall
has `source: 'auto'` and a confidence between zero and one. A scale failure
returns `scaleDetected: false`, warnings, and no millimetre walls. Invalid raster
inputs are rejected; OCR failures are reported and allow manual calibration.

The shared CV implementation uses typed arrays: alpha compositing, grayscale,
border-based dark background inversion, Otsu thresholding, isolated-pixel
denoising, horizontal/vertical edge runs, and dimension tick detection. This
avoids a second WASM runtime and keeps the geometry portable. Near-horizontal
and near-vertical raster runs are normalized to axes; arbitrary rotated plans
and oblique walls are not supported by this baseline.

Tesseract.js is dynamically imported only when dimension lines exist. Dimension
text bands are discovered from lines, vertical bands rotated, and enlarged
threefold into a single local BMP. Digits are associated with nearby dimension
spans. At least two independent measurements must agree within 2%; the scale
uses a confidence-weighted least-squares fit and revalidates outliers against
the fitted value. There are no fixture names, expected coordinates, or manually
supplied scale values in recognition code.

Double edges separated by 80–300 mm produce a centreline and thickness.
Collinear edge/wall fragments reconnect across gaps up to 1200 mm, close
intersections snap, duplicate edge pairs are removed, and small detached
rectangles are filtered. Confidence is a geometric heuristic based on support,
length, and connections, **not a calibrated probability**. Large furniture,
window frames, mixed wall thickness, and overlapping lines can still fool it.

## Runtime assets and reproduction

The Node benchmark uses Sharp only to decode pixels, outside the shared
pipeline. It supplies the installed `@tesseract.js-data/eng` language model;
OCR executes locally. The browser can pass `options.ocr` with `workerPath`,
`corePath`, and `langPath` to self-host assets. Omitting these options uses
Tesseract's default asset locations, which may require network access. No image
is sent to an external inference service.

Run `nvm use`, `npm ci`, `npm run bench:recognize` and the overlay commands in
`fixtures/RECOGNITION.md`. Timing includes image decoding, cold worker/model
initialization, CV/OCR, wall extraction, and worker shutdown; it excludes drawing
the overlay. A fresh worker is used per image.

Run `npm run smoke:recognize:browser` and open `http://127.0.0.1:3103/` to run both
fixtures in a browser with all assets served locally. The script checks that
Tesseract is absent from the initial entry bundle (20,535 bytes in this build).
It saves browser results to `tmp/browser-recognize-result.json`. Its generated
bundles live in ignored `test-results/recognize-browser/`. The entry point is
not yet connected to the editor UI; that lies outside this Issue's path scope.

## Measured limitations

On Apple M1 / macOS arm64 / Node v24.21.0, the final Node run produced:

| Image | mm/px    | Scale error | Walls | Matched | Recall | Precision | Time    |
| ----- | -------- | ----------- | ----- | ------- | ------ | --------- | ------- |
| A     | 15.49354 | 0.171%      | 24    | 4/29    | 13.8%  | 16.7%     | 5.001 s |
| B     | 20.20803 | N/A         | 50    | N/A     | N/A    | N/A       | 6.119 s |

Only scale meets A's threshold. Wall recall/precision do **not** meet 85%, and
this run does **not** meet the less-than-five-seconds target. Earlier runs on
the same machine varied approximately 2.5–18.4 seconds per image; a browser run
also took about 17–20 seconds. No timing guarantee is claimed.

The existing strict symmetric Hausdorff matcher compares complete wall spans
within 100 mm, so split/overextended segments miss even where their centreline
looks close. Endpoint snapping and gap merging currently join some furniture
or window lines into wall candidates while missing several short structural
walls. Single-pixel runs also struggle with interrupted/antialiased boundaries.
OCR model startup and enlarged band recognition dominate runtime. Improvements
should focus on generic oriented edge support, topology-aware pairing and
endpoints, and reusable workers/model caching, without sample-specific rules or
relaxing the evaluator. B is an execution/manual-overlay check, not a quantified
accuracy claim. Door/window, room, and furniture-symbol recognition are deferred.
