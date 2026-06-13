import { useRef } from "react";

/**
 * Minimal volume control: a speaker glyph that mutes/unmutes on click, beside a
 * thin glowing slider. The wrapper is marked `data-no-toggle` so App's
 * tap-anywhere play/pause handler ignores interactions here.
 */
function SpeakerGlyph({ level }) {
  const muted = level <= 0.001;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9 H7 L11.5 5 V19 L7 15 H4 Z" fill="currentColor" stroke="none" />
      {muted ? (
        <>
          <line x1="16" y1="9.5" x2="21" y2="14.5" />
          <line x1="21" y1="9.5" x2="16" y2="14.5" />
        </>
      ) : (
        <>
          {level > 0.04 && <path d="M14.8 9.6 a3.6 3.6 0 0 1 0 4.8" />}
          {level > 0.5 && <path d="M17.4 7.4 a7.2 7.2 0 0 1 0 9.2" />}
        </>
      )}
    </svg>
  );
}

export default function Volume({ volume, setVolume }) {
  // Remember the last audible level so the mute button can restore it.
  const lastRef = useRef(volume > 0 ? volume : 0.8);

  const onChange = (e) => {
    const v = parseFloat(e.target.value);
    if (v > 0) lastRef.current = v;
    setVolume(v);
  };

  const toggleMute = () => {
    if (volume > 0.001) {
      lastRef.current = volume;
      setVolume(0);
    } else {
      setVolume(lastRef.current || 0.8);
    }
  };

  return (
    <div className="volume" data-no-toggle>
      <button
        className="volume-icon"
        type="button"
        onClick={toggleMute}
        aria-label={volume > 0 ? "Mute" : "Unmute"}
      >
        <SpeakerGlyph level={volume} />
      </button>
      <input
        className="volume-slider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        onChange={onChange}
        style={{ "--pct": `${Math.round(volume * 100)}%` }}
        aria-label="Volume"
      />
    </div>
  );
}
