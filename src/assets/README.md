# Assets

The start countdown is **synthesized** (see `src/lib/sound.ts`) on the UCI
velodrome pattern — a marker beep at 10 s to go, a beep on each of the final 5
seconds, and a long sustained release tone at zero — scheduled on the Web Audio
clock so the release lands exactly on the rider's start. Nothing to denoise,
nothing to keep in sync.

Playing a recorded clip instead was tried and dropped: typical "UCI countdown
clock" rips carry a ticking-clock / crowd bed and trailing audio that can't be
cleaned up here and pull the alignment off. If you get a clean clip that is just
the final ~5 s with the GO on the very last frame, ask and clip playback can be
wired back in.
