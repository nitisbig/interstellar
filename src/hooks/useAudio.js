import { useCallback, useRef, useState } from "react";

/**
 * Owns the Web Audio graph and the per-frame signal analysis that drives the
 * visuals. The smoothing state (envelope follower, adaptive beat detector)
 * lives in refs so the render loop can sample it every frame without causing
 * React re-renders.
 *
 * Ported and tidied from the original vanilla implementation.
 */
export function useAudio(srcUrl) {
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("");
  const [volume, setVolumeState] = useState(0.8);

  const audioElRef = useRef(null);
  const volumeRef = useRef(0.8); // mirrors `volume` for use inside callbacks
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const freqRef = useRef(null);
  const startedRef = useRef(false);

  // Smoothed motion state, persisted across frames.
  const stateRef = useRef({
    envelope: 0, // overall intensity, 0..1
    beat: 0, // decays after each detected beat
    bassAvg: 0, // running bass average (adaptive threshold)
    lastBeat: 0,
  });

  const BASS_BINS = 8;
  const BEAT_FACTOR = 1.32;
  const BEAT_DEBOUNCE = 230; // ms

  const ensureGraph = useCallback(() => {
    if (startedRef.current) return;
    const el = new Audio(srcUrl);
    el.loop = true;
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.addEventListener("error", () => {
      const e = el.error;
      setStatus(`Audio error: ${e ? e.code : "unknown"} — check file path`);
    });
    audioElRef.current = el;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;
    const src = ctx.createMediaElementSource(el);
    src.connect(analyser);
    analyser.connect(ctx.destination);

    ctxRef.current = ctx;
    analyserRef.current = analyser;
    freqRef.current = new Uint8Array(analyser.frequencyBinCount);
    startedRef.current = true;
  }, [srcUrl]);

  const play = useCallback(() => {
    ensureGraph();
    const ctx = ctxRef.current;
    const el = audioElRef.current;
    if (ctx.state === "suspended") ctx.resume();
    el.volume = volumeRef.current;
    const p = el.play();
    if (p && p.catch) {
      p.then(() => setPlaying(true)).catch((err) => {
        setPlaying(false);
        console.error("Audio play failed:", err);
        setStatus("Audio blocked — tap again");
      });
    } else {
      setPlaying(true);
    }
  }, [ensureGraph]);

  const toggle = useCallback(() => {
    if (!startedRef.current) {
      play();
      return;
    }
    const el = audioElRef.current;
    if (!el.paused) {
      el.pause();
      setPlaying(false);
    } else {
      if (ctxRef.current.state === "suspended") ctxRef.current.resume();
      el.play();
      setPlaying(true);
    }
  }, [play]);

  /** Set output volume (0..1). Applies immediately to the live audio element. */
  const setVolume = useCallback((v) => {
    const vol = Math.min(1, Math.max(0, v));
    volumeRef.current = vol;
    setVolumeState(vol);
    if (audioElRef.current) audioElRef.current.volume = vol;
  }, []);

  /**
   * Sample the analyser and advance the smoothed motion state.
   * Returns { envelope, beat, level, bass } for the current frame.
   */
  const sample = useCallback((now, dt) => {
    const s = stateRef.current;
    const analyser = analyserRef.current;
    const freq = freqRef.current;
    const el = audioElRef.current;
    let level = 0;
    let bass = 0;

    if (analyser && el && !el.paused) {
      analyser.getByteFrequencyData(freq);

      let bSum = 0;
      for (let i = 1; i <= BASS_BINS; i++) bSum += freq[i];
      bass = bSum / (BASS_BINS * 255);

      let sum = 0;
      for (let i = 0; i < freq.length; i++) sum += freq[i];
      level = sum / (freq.length * 255);

      s.bassAvg = s.bassAvg * 0.94 + bass * 0.06;
      if (
        bass > s.bassAvg * BEAT_FACTOR &&
        bass > 0.06 &&
        now - s.lastBeat > BEAT_DEBOUNCE
      ) {
        s.lastBeat = now;
        s.beat = 1;
      }
    }

    // Envelope follower: fast attack, slow decay.
    if (level > s.envelope) s.envelope += (level - s.envelope) * 0.35;
    else s.envelope += (level - s.envelope) * 0.08;

    // Beat pulse exponential decay (~gone in a few hundred ms).
    s.beat *= Math.pow(0.001, dt);

    return { envelope: s.envelope, beat: s.beat, level, bass };
  }, []);

  return { playing, status, volume, play, toggle, setVolume, sample };
}
