# Cycling TT Timer

A desktop app for timing a cycling **time trial**: build the field, set the start
order, run an interval countdown that releases riders automatically, then stop
each rider with a single finish button and read off the results.

Electron shell + React/TypeScript renderer (Vite). All state is kept locally and
auto-saved; nothing leaves the machine.

## How it works

### Setup tab

- **Race settings** — race name, an optional **initial start time** (rider 1's
  scheduled clock time — leave blank to just start on demand), **start
  interval** (seconds between riders), **countdown** length (the audible
  5‑4‑3‑2‑1 before each start), and an optional **course distance (km)** — set
  it to show average speed per rider in Results and in the results CSV.
- **Start list** shows each rider's planned start time — an absolute clock time
  when an initial start time is set, otherwise an offset from whenever you
  press Start race.
- **Add rider** — bib, name, optional category. Or **Import CSV** with columns
  `bib, name, category` (a header row is detected).
- **Start list** — reorder with ▲/▼, **Shuffle order**, or **Sort by bib**.
  Edit any field inline. Riders who have already started keep their start
  order permanently — they can't be reordered, shuffled/sorted past, or
  removed; only riders still waiting to start are affected by those controls.

### Race tab

- Press **Start race**. If an initial start time is set and hasn't passed yet,
  the countdown is timed so rider 1 is released exactly on that clock time
  (otherwise it begins immediately). The app then arms each subsequent rider at
  `previous start + interval` automatically — no further input needed.
- **Countdown sound**: synthesized (`src/lib/sound.ts`) — a marker beep at 10 s
  to go, a beep on each of the final 5 seconds (500 Hz), and a release tone at
  zero an octave higher (1000 Hz — rider goes on its leading edge). No official
  spec is published for the pre-start sequence, but those two frequencies are a
  real reference point from a UCI-approved track timing vendor's countdown
  beeper. Every tone is scheduled on the Web Audio clock so it lands exactly on
  the rider's release. Released early via *Start next now*? Leftover beeps are
  dropped and the release tone sounds immediately.
- Riders start at their *scheduled* instant, so loop timing / a brief freeze
  never shifts official start times.
- **Pause / Resume** shifts every not‑yet‑started rider by the paused duration.
  **Start next now** releases the next rider immediately, skipping the
  countdown. **Countdown next now** instead re-runs the full countdown for the
  next rider starting this instant (keeping the interval spacing for everyone
  after them). **Postpone start +10s** pushes the next rider — and everyone
  still scheduled after them — back by 10 seconds; click it again to add more.
  **Next = DNS** skips a slot.
- **Resetting a rider** (Results → reset, DNS, DNF, or clearing their start in
  the time editor) always puts them back to `scheduled` in a state that
  requires a deliberate restart — the starter engine will never auto-fire them
  off a schedule slot that may already be due, no matter how they got there.
  When the "Next to start" card shows such a rider it offers **Countdown next
  now (20s)** — a standalone 20‑second countdown just for them, independent of
  the shared schedule (so it can't drag every later rider's time along with
  it) — or plain **Start next now** for an immediate release. **Cancel
  countdown** backs out of a running one.
- **On course** lists everyone still riding with a live elapsed clock. Each row
  also has a **🏁 quick-finish** button right next to the elapsed time — a
  one-click capture-and-assign for when there's no ambiguity about who just
  crossed the line. Mispressed it? An **Undo** banner appears above the list;
  it puts the capture back in the unassigned pool (nothing is lost) and
  pre-selects it so you can immediately tap the right rider.
- **FINISH** (button, or `F` / `Space`) captures a finish‑line timestamp. You
  then assign it to a rider — click the rider in **On course**, pick from the
  dropdown, or use the `→ bib` shortcut for the rider who has been out longest.
  Because captures are assigned deliberately, riders finishing a second apart are
  handled correctly; nudge a capture ±0.1 / ±1 s if needed, or discard a misfire.
  This two-step flow is unchanged by the quick-finish button above.

Keyboard on the Race tab: `F` / `Space` = finish, `N` = start next now,
`C` = countdown next now, `P` = pause/resume.

### Results tab

- Live classification by elapsed time with gap to the leader; DNS/DNF listed
  separately. The two are mutually exclusive by whether the rider has
  started: **DNS** only shows for riders still `scheduled` (never started),
  **DNF** only shows once a rider has actually started.
- **Export results CSV**, **Export start list CSV**, **Export race JSON**
  (and re‑import a race JSON).
- **Adjust times & race data** (collapsible): hand‑edit any start/finish time as
  `HH:MM:SS(.mmm)`, set DNF/DNS, **Reset all timing**, or **New race**.

The full race state is written to `localStorage` a few times a second, so a
reload or crash resumes where you left off.

## Running

Requires **Node.js** (18+ recommended; works on 16 with the pinned versions).

```bash
npm install
npm run dev        # starts Vite + Electron with hot reload
```

Other scripts:

```bash
npm run typecheck  # tsc --noEmit
npm run build      # build the renderer into dist/
npm run dist       # package a Windows installer with electron-builder
```

## Notes / possible next steps

- Categories are recorded but classification is currently overall only —
  per‑category results would be a small addition in `computeResults`.
- No network/multi-device support by design (single operator machine). A start
  station + finish station split would need the backend option instead.
