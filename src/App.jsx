import { useEffect, useRef, useState } from "react";
import { useAudio } from "./hooks/useAudio.js";
import Starfield from "./components/Starfield.jsx";
import BlackHole from "./components/BlackHole.jsx";
import Dial from "./components/Dial.jsx";
import Intro from "./components/Intro.jsx";

const AUDIO_URL = `${import.meta.env.BASE_URL}interstellar_piano.mp3`;

export default function App() {
  const { playing, status, play, toggle, sample } = useAudio(AUDIO_URL);

  const [started, setStarted] = useState(false);

  const stageRef = useRef(null);
  const handRef = useRef(null);
  const motionRef = useRef({ envelope: 0, beat: 0 }); // shared with Starfield
  const handAngleRef = useRef(0);
  const firstDoneRef = useRef(false);
  const playingRef = useRef(false);
  playingRef.current = playing;

  // --- input: first gesture starts, later gestures toggle play/pause ---
  useEffect(() => {
    const onTap = () => {
      if (!firstDoneRef.current) {
        firstDoneRef.current = true;
        setStarted(true);
        play();
      } else {
        toggle();
      }
    };
    const onKey = (e) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        onTap();
      }
    };
    const onTouch = (e) => {
      e.preventDefault();
      onTap();
    };
    window.addEventListener("click", onTap);
    window.addEventListener("touchstart", onTouch, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onTap);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("keydown", onKey);
    };
  }, [play, toggle]);

  // --- single render loop: drives every reactive part via CSS vars + the hand ---
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();

    const loop = (now) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      const { envelope, beat } = sample(now, dt);
      motionRef.current.envelope = envelope;
      motionRef.current.beat = beat;

      const stage = stageRef.current;
      if (stage) {
        stage.style.setProperty("--env", envelope.toFixed(4));
        stage.style.setProperty("--beat", beat.toFixed(4));
      }

      // Continuous, intensity-modulated rotation of the indicator hand.
      const speed = 14 + envelope * 150 + beat * 120; // deg/sec
      handAngleRef.current = (handAngleRef.current + speed * dt) % 360;
      if (handRef.current) {
        handRef.current.setAttribute(
          "transform",
          `rotate(${handAngleRef.current.toFixed(2)})`
        );
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sample]);

  return (
    <div className="stage" ref={stageRef}>
      <Starfield motionRef={motionRef} />

      <div className="scene">
        <BlackHole />
        <Dial ref={handRef} />
      </div>

      <div className="vignette" />
      <Intro hidden={started} />

      {status ? <div className="status">{status}</div> : null}

      {started ? (
        <button
          className="play-hint"
          aria-label={playing ? "Pause" : "Play"}
          tabIndex={-1}
        >
          {playing ? "❚❚" : "▶"}
        </button>
      ) : null}
    </div>
  );
}
