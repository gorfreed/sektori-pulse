# Changelog

## 2026-07-09 14:13

- Request: Die Previews und Next-Buttons müssen vertauscht werden. Sie müssen genau auf der jeweils anderen Seite sein.
- Swapped the run detail navigation button positions so Next Run is on the left and Previous Run is on the right.

## 2026-07-09 14:11

- Request: Make sure to include previous and next button navigation so the player can easily navigate between runs.
- Added Previous Run and Next Run controls to the OCR run detail view.
- Added compact disabled states and run position display for detail navigation.

## 2026-07-09 14:03

- Request: So now we need to remove all the redundancies and all the wrong stuff from the application. For example, we have stuff in there like the recent records. If you look at the recorded time, they all have the same date and time because it only measures it by the save state. Since we're not using that anymore, you can completely ditch that. We will only go by the records that we are creating ourselves with the new OCR method. So on the main dashboard view, there should be a panel for recent runs, one line only. And then if they are clicked, the run will be shown with the same four-page format that the results screen is showing, so the player knows right away what to look for.
- Removed Personal Records and save-derived recent record tables from the dashboard flow.
- Added an OCR-only recent runs panel with one-line rows on the main dashboard and run archive.
- Added a four-page OCR run detail view matching Campaign Challenge, Statistics, Statistics, and Score Breakdown pages.
- Added shared OCR run normalization so charts, rows, summaries, and detail pages use the same captured fields.
- Trimmed demo data so it no longer includes fake run events or Pulse Grade examples.

## 2026-07-09 13:55

- Request: Okay, I did that. But apparently the dashboard has some issues now.
- Fixed the blank Electron dashboard after the first OCR run by mapping OCR `capturedAt` timestamps into the score chart.
- Made date formatting tolerate missing timestamps instead of crashing the renderer.

## 2026-07-09 13:49

- Request: Okay, ich habe gerade die OCR ausgelöst, indem ich ein neues Spiel erstellt und bis zum Game Over gespielt habe. Jetzt ist es an der Zeit, sicherzustellen, dass die erfassten Daten auch wirklich in unser Dashboard gelangen. Dafür sollten wir wahrscheinlich zuerst die gesamte Datenbank löschen, um einen sauberen Neuanfang zu haben. Und dann sicherstellen, dass wir tatsächlich die Felder haben, um die Daten anzuzeigen. Grundsätzlich wollen wir aber das anzeigen, was wir bereits in der App haben. Das heißt, du musst alle Redundanzen oder Dinge entfernen, die eigentlich keine echten Daten sind.
- Made the Run Archive use OCR result-screen captures as the primary per-run feed.
- Changed score progression to use OCR run scores when captured, falling back to personal-best history only before any OCR run score exists.
- Removed the separate Captures navigation page and old Pulse Grade display path from the dashboard.
- Hardened OCR parsing for noisy result rows such as prefixed score lines and slashed-zero reads.
- Updated README to document the OCR run-capture data model.

## 2026-07-09 12:19

- Request: The Game Over screen shows per-run metrics (Score Breakdown, Statistics, Campaign Challenge) that never get saved anywhere, so Pulse's run history can only ever show cumulative save-counter deltas, not real per-run stats. Build a way to capture that screen and record it per run.
- Added an OCR-based result-screen capture pipeline: on every savegame.json write, Pulse screenshots the (already-foregrounded) Sektori window, confirms it's the Game Over screen via OCR, then pages through Score Breakdown / Statistics / Campaign Challenge (Page Down + re-screenshot + OCR) and returns to page 1.
- Parses each page's label/value rows generically (no per-mode hardcoding) into a `fields` map, so unseen modes still get captured under their own field names.
- Stores one JSON-lines record per run in `runCaptures.jsonl` (userData folder), alongside the source PNGs per run for auditing OCR accuracy.
- Capture never sends synthetic key presses unless the Sektori window is already the OS foreground window and OCR has already confirmed "GAME OVER" text on the first screenshot, so a false-positive save-file trigger during actual gameplay cannot inject input.
- Known limitation for this first version: relies on tesseract.js OCR accuracy against the live screen capture, which hasn't been validated against a real Game Over screen yet (only against reconstructed sample text matching the screenshots provided). Needs a real playtest to confirm end-to-end.

## 2026-06-23 03:49

- Request: If other metrics are recorded, like the number of enemies killed or accuracy of shots, there is a way to kind of still make each run individual stand out and benchmarkable by putting your own score or grade system to it.
- Added Pulse Grade as a companion benchmark for progress events using observable save-counter deltas.
- Added grade display to the run feed next to the saved/missing game score.
- Documented the Pulse Grade formula and added regression coverage.

## 2026-06-23 03:44

- Request: There is a add score button. What the fuck? Where's the score?
- Removed the manual Add Score control and related storage path.
- Changed non-personal-best run rows to show Score Not Saved instead of asking the user to enter it.
- Documented that non-personal-best score capture requires a separate result-screen capture or deeper integration path.

## 2026-06-23 03:39

- Request: The run-over view doesn't show the most important part, the score. Nothing matters more than a score. the score progression line is a flat line it is always the same since you are only calculating whatever the current best score is but not what the run score was
- Confirmed Sektori's local save, Unity logs, and Steam local cache do not expose non-personal-best run scores.
- Renamed the score chart to personal-best progression and removed wording that implied per-run score history.
- Added a score column to run events, with automatic values only for new personal bests and manual score annotation for other runs.
- Documented the exact score-source limitation.

## 2026-06-23 03:33

- Request: I have now made several runs and the application is clearly not recording runs correctly. These statistics are meaningless and flat out wrong.
- Fixed run archive derivation so the first observed save is a baseline, not a fake historic session.
- Ignored save-file hash changes when run/stat counters do not change.
- Removed speculative per-run aggression and accuracy from the run feed; entries now show factual save-counter deltas only.
- Bumped the Windows installer version to 0.1.1 so upgraded installs are unambiguous.
- Updated documentation and tests to describe the baseline and factual-delta model.

## 2026-06-23 03:21

- Request: What is important is that the application allows the user to measure their progress in terms of getting better. For that, clearly the individual run needs to be recorded. Is that the case? Specifically, how do you calculate aggression and accuracy?
- Added derived run/session progress events from save deltas, with honest confidence labels for individual runs versus multi-run batches.
- Documented and surfaced the aggression and accuracy-proxy formulas.
- Added regression tests for progress event derivation.

## 2026-06-23 01:45

- Request: Let's develop a companion tool for the game that, when installed, provides the user with performance information about his runs, their achievements, and so on and so on, in a nice, cool-looking way that fits the game's style
- Added the installable Sektori Pulse Electron companion with live save watching, local history, records, achievements, trends, settings, exports, and branded artwork.
- Added a repeatable Windows installer packaging workflow.
- Documented data sources, privacy behavior, development, and Windows installer commands.
