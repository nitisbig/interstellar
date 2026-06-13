/**
 * Tap-to-begin overlay. Fades out once playback starts (browsers require a user
 * gesture before audio can play). The breathing ring echoes the core glow.
 */
export default function Intro({ hidden }) {
  return (
    <div className={`intro${hidden ? " hide" : ""}`}>
      <div className="intro-ring" />
      <p className="intro-label">Tap to begin</p>
      <span className="intro-sub">interstellar</span>
    </div>
  );
}
