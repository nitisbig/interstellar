import { forwardRef, useMemo } from "react";

/**
 * A spare instrument ring overlaid on Gargantua: a sparse ring of ticks that
 * shimmer with amplitude, and a single marker that orbits the rim — its angle
 * driven imperatively by the render loop (hence the forwarded ref). Kept
 * deliberately minimal so the black hole stays the focus.
 */
const TICK_COUNT = 48;
const R_OUTER = 470;
const R_MARK = 432; // orbit radius of the indicator marker

const Dial = forwardRef(function Dial(_props, handRef) {
  const ticks = useMemo(() => {
    const out = [];
    for (let i = 0; i < TICK_COUNT; i++) {
      const major = i % 4 === 0;
      const len = major ? 24 : 12;
      const a = (i / TICK_COUNT) * Math.PI * 2 - Math.PI / 2;
      const base = major ? 0.26 : 0.1;
      out.push({
        key: i,
        x1: (Math.cos(a) * R_OUTER).toFixed(1),
        y1: (Math.sin(a) * R_OUTER).toFixed(1),
        x2: (Math.cos(a) * (R_OUTER - len)).toFixed(1),
        y2: (Math.sin(a) * (R_OUTER - len)).toFixed(1),
        width: major ? 1.6 : 0.9,
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
      {/* tick ring — shimmers via the --base custom property */}
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

      {/* indicator marker orbiting the rim */}
      <g className="hand" ref={handRef}>
        <circle cx="0" cy={-R_MARK} r="3" fill="#f2f5f8" />
        <circle
          cx="0"
          cy={-R_MARK}
          r="8"
          fill="none"
          stroke="#f2f5f8"
          strokeWidth="0.6"
          opacity="0.35"
        />
      </g>
    </svg>
  );
});

export default Dial;
