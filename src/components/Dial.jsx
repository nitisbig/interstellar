import { forwardRef, useMemo } from "react";

/**
 * The Interstellar instrument dial overlaid on Gargantua: a ring of ticks that
 * shimmer with amplitude, a ring that flares on beats, and a continuously
 * rotating indicator hand whose angle is driven imperatively by the render loop
 * (hence the forwarded ref).
 */
const TICK_COUNT = 72;
const R_OUTER = 470;

const Dial = forwardRef(function Dial(_props, handRef) {
  const ticks = useMemo(() => {
    const out = [];
    for (let i = 0; i < TICK_COUNT; i++) {
      const major = i % 6 === 0;
      const len = major ? 34 : 18;
      const a = (i / TICK_COUNT) * Math.PI * 2 - Math.PI / 2;
      const base = major ? 0.35 : 0.18;
      out.push({
        key: i,
        x1: (Math.cos(a) * R_OUTER).toFixed(1),
        y1: (Math.sin(a) * R_OUTER).toFixed(1),
        x2: (Math.cos(a) * (R_OUTER - len)).toFixed(1),
        y2: (Math.sin(a) * (R_OUTER - len)).toFixed(1),
        width: major ? 2.2 : 1.1,
        base,
      });
    }
    return out;
  }, []);

  return (
    <svg
      className="dial"
      viewBox="-500 -500 1000 1000"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* ring that flares on beats */}
      <circle
        className="ring-pulse"
        cx="0"
        cy="0"
        r="300"
        fill="none"
        stroke="#e6eaef"
        strokeWidth="1.4"
      />

      {/* tick ring — shimmers via the --boost custom property */}
      <g className="ticks" stroke="#cfd6dd" strokeLinecap="round">
        {ticks.map((t) => (
          <line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            strokeWidth={t.width}
            style={{ "--base": t.base }}
          />
        ))}
      </g>

      {/* rotating indicator hand */}
      <g className="hand" ref={handRef}>
        <line x1="0" y1="0" x2="0" y2="-378" stroke="#f2f5f8" strokeWidth="2" opacity="0.85" />
        <circle cx="0" cy="-378" r="5" fill="#ffffff" opacity="0.9" />
        <circle cx="0" cy="0" r="3.5" fill="#ffffff" opacity="0.8" />
      </g>
    </svg>
  );
});

export default Dial;
