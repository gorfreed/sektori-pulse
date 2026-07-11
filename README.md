# Sektori Pulse - Performance Tracker

**A performance tracker and companion app for the game Sektori. Your runs deserve better than a leaderboard number.**

![Sektori Pulse dashboard](assets/dashboard-screenshot.png)

## Why this exists

I love Sektori. It took me almost 200 hours to beat the campaign on Challenge difficulty, and in all that time I was never bored. Every run taught me something. I didn't want to stop.

Somewhere in those hours I noticed I was getting better: reading enemy patterns faster, routing more efficiently, surviving longer. I wanted to actually see that progress instead of just feeling it, and use it to keep pushing myself. Problem is, the game's save file only remembers lifetime totals and personal bests. It doesn't keep any record of a single run. So I built Pulse to do that part myself.

## What it does

Pulse runs alongside Sektori and picks up the moment a run ends.

- Watches for the results screen and pages through all four result pages (Campaign Challenge, Statistics x2, Score Breakdown) using a virtual controller. No manual screenshotting, no interrupting your flow.
- Reads every stat off the screen with on-device OCR, cross-checked against the score breakdown so misreads get caught before they end up in your history.
- Builds a run archive you can scroll, filter by ship, and drill into. Click any point on a chart, or any "best" stat, and it jumps straight to the run that set it.
- Tracks personal bests per stat, per ship. Redeemer, Defier and Sentinel play too differently to share one leaderboard, so each gets its own.
- Shows trends over time: score/minute, kills/minute, survival time, score composition, with an adjustable time window instead of one flat wall of numbers.
- A subtle in-game overlay so you know Pulse is watching, without it fighting for your attention while you play.

Pulse reads the Sektori save file without ever modifying it. Nothing leaves your machine.

## How it works (and why it has to work this way)

Sektori's save file only stores lifetime totals and personal bests, things like total enemies destroyed across your whole career, or your single best score ever. It does not store anything about an individual run. Once you leave the results screen, the numbers on it are gone for good, and there is no file, no log, and no API that keeps them anywhere. If you want per-run history, the only place that data ever exists is on screen, for a few seconds, right after a run ends.

So Pulse reads it the same way a person would: it looks at the screen.

That comes with its own problems. The results screen is actually four separate pages (Campaign Challenge, two Statistics pages, and the Score Breakdown), and the game only cycles between them on controller input, not keyboard. Pulse gets around that by plugging in a virtual Xbox controller (via ViGEm) the moment it detects you're on the results screen, then pages through all four automatically so you never have to touch anything.

Once it has all four pages, it runs OCR over each one locally. OCR is never perfect, and a single misread digit would quietly corrupt your history. To catch that, Pulse also reads the score breakdown (enemies, bosses, tokens, chain, pads, other) and checks that those numbers actually add up to the total score shown. If they don't, it tries alternate readings of the misread digits until it finds a combination that does add up, and only then records the run. A run that still doesn't check out is flagged rather than silently trusted.

## More modes are coming

Right now Pulse only tracks the Campaign, since that's where the nearly 200 hours went and where the tracking started. Sektori has other modes too (Classic, and more), and the dashboard already has a spot reserved for them: there's a grayed-out Classic tab sitting in the nav. Turning that into a real tracker, and adding the modes after it, is next.

## Installing

1. Grab the latest installer from the [Releases page](../../releases).
2. Run it. It installs to `Program Files` and asks for admin rights to do that.
3. Launch Sektori Pulse and play. It finds your save file automatically. If it ever can't, you can point it at the file manually from Settings.

Windows only for now. Requires Sektori installed via Steam.

## Privacy

Pulse reads your Sektori save and, optionally, Steam's local achievement cache, in read-only mode, and keeps everything it captures on your machine. Nothing gets uploaded. Exporting your own data is a manual action you have to trigger yourself.

## For developers

```powershell
npm install
npm run electron:dev   # run the app in dev mode
npm run dev             # preview the dashboard alone, with demo data, in a browser
npm run dist             # build the Windows installer (release/)
```

See [CHANGELOG.md](CHANGELOG.md) for the development history.
