import { useEffect, useRef } from "react";

/**
 * Ocean — a procedural golden-hour seascape rendered to canvas.
 *
 * An aerial, drone-height view of an open ocean at sunset: a hazy warm horizon,
 * deep navy water in the foreground, perspective-compressed sun glitter, and a
 * lone sailboat that bobs, rolls and slowly drifts across the swell. Like the
 * Starfield it reads `motionRef` (shared per-frame audio state) so the swell,
 * shimmer and horizon glow breathe with the music.
 *
 * Everything is drawn in a normalised (u, v) water space and projected to the
 * screen each frame:
 *   u ∈ [-1, 1]  — horizontal position across the sea
 *   v ∈ (0, 1]   — depth toward the viewer (v→0 horizon, v→1 nearest)
 */
export default function Ocean({ motionRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let w = 0;
    let h = 0;
    let yH = 0; // horizon, in CSS px
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let t = 0; // accumulated seconds (smooth, frame-rate independent)

    // ---- composition constants -------------------------------------------
    const HORIZON = 0.22; // fraction of height where sea meets sky (high, so the
    //                       open water dominates — the aerial drone framing)
    const SUN_U = 0.06; // sun centred on the horizon
    const RIPPLES = 320;
    const GLITTER = 150;

    // ---- tiny helpers -----------------------------------------------------
    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (e0, e1, x) => {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const mix = (c1, c2, t) => [
      lerp(c1[0], c2[0], t),
      lerp(c1[1], c2[1], t),
      lerp(c1[2], c2[2], t),
    ];
    const rgb = (c, a = 1) =>
      `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

    // ---- palette (golden hour) -------------------------------------------
    const SKY_TOP = [58, 74, 92];
    const SKY_MID = [150, 150, 146];
    const SKY_HZN = [243, 232, 200];
    const SUN_CORE = [255, 246, 220];

    const SEA_HZN = [183, 176, 146]; // warm, hazy far water
    const SEA_MID = [70, 86, 96];
    const SEA_DEEP = [12, 27, 38]; // near-black navy foreground

    const HL_WARM = [247, 238, 210]; // sunlit crest
    const HL_COOL = [120, 142, 156]; // mid crest
    const HL_DARK = [26, 42, 54]; // foreground crest (barely lit)

    // ---- field of ripple facets ------------------------------------------
    let ripples = [];
    let glints = [];

    function build() {
      ripples = [];
      for (let i = 0; i < RIPPLES; i++) {
        ripples.push({
          u: rand(-1.12, 1.12),
          v: Math.random(),
          ph: rand(0, Math.PI * 2),
          sp: rand(0.5, 1), // twinkle rate
        });
      }
      glints = [];
      for (let i = 0; i < GLITTER; i++) {
        glints.push({
          u: rand(-0.95, 0.95),
          v: rand(0.004, 0.22), // clustered near the horizon
          ph: rand(0, Math.PI * 2),
          sp: rand(2.5, 6),
        });
      }
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      yH = h * HORIZON;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    // project water-space (u, v) → screen px. Depth is eased so wave rows
    // pack tightly near the horizon and spread toward the viewer.
    function project(u, v) {
      const y = yH + (h - yH) * Math.pow(v, 1.55);
      const spread = 0.5 * (0.82 + 0.18 * v);
      const x = w * (0.5 + u * spread);
      return [x, y];
    }

    // coherent travelling-wave field → roughly -1..1, used to gather ripple
    // highlights onto moving crests so the sea reads as swell, not static fuzz.
    function crest(u, v, time) {
      const a = Math.sin(u * 3.0 + v * 8.5 - time * 0.55);
      const b = Math.sin(-u * 2.1 + v * 16.0 - time * 0.95 + 1.7);
      const c = Math.sin(u * 5.4 + v * 26.0 - time * 1.5 + 4.1);
      return a * 0.5 + b * 0.32 + c * 0.22;
    }

    // light reaching the surface: strong at the hazy horizon, dim up close.
    function sunlight(u, v) {
      const depth = lerp(1.0, 0.1, smooth(0, 1, v));
      const toward = 1 - 0.35 * Math.abs(u - SUN_U); // warmer near the sun
      return depth * clamp(toward, 0.55, 1);
    }

    // ---- the boat ---------------------------------------------------------
    // wanders slowly within a bounded patch so it "floats around" the sea.
    const boat = { u: SUN_U + 0.28, v: 0.42 };

    function drawBoat(time, env, beat) {
      // gentle drift + depth wander
      const bu = boat.u + Math.sin(time * 0.06) * 0.16 + Math.sin(time * 0.017) * 0.05;
      const bv = boat.v + Math.sin(time * 0.043 + 1.2) * 0.05;
      const [bx, byBase] = project(bu, bv);

      // bob with the swell + a small beat kick; roll a few degrees
      const swell = crest(bu, bv, time);
      const bob = swell * 4 + Math.sin(time * 1.6) * 2 + beat * 5 * (1 + env);
      const by = byBase + bob;
      const roll = (Math.sin(time * 0.9) * 0.05 + swell * 0.04);
      const s = lerp(0.95, 1.95, bv); // perspective scale

      // ---- broken reflection on the water, just below the hull ----
      ctx.save();
      for (let i = 0; i < 7; i++) {
        const ry = by + (3 + i * 3.2) * s;
        const fade = (1 - i / 7) * 0.18;
        const jitter = Math.sin(time * 3 + i * 1.3 + bx) * 2 * s;
        ctx.fillStyle = rgb(HL_WARM, fade * (0.6 + 0.4 * Math.sin(time * 4 + i)));
        ctx.fillRect(bx - 5 * s + jitter, ry, 10 * s, 1.1 * s);
      }
      ctx.restore();

      // ---- hull + sails ----
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(roll);
      ctx.scale(s, s);

      // hull — a slim dark curved shape
      ctx.fillStyle = "rgba(24,26,30,0.92)";
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.quadraticCurveTo(0, 6.5, 11, 0);
      ctx.quadraticCurveTo(7, 2.2, -7, 2.2);
      ctx.closePath();
      ctx.fill();

      // mast
      ctx.strokeStyle = "rgba(40,38,34,0.85)";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(0.5, 0);
      ctx.lineTo(0.5, -26);
      ctx.stroke();

      // mainsail (catches the warm light) + jib
      const sailGrad = ctx.createLinearGradient(0, -26, 6, -2);
      sailGrad.addColorStop(0, "rgba(255,250,238,0.97)");
      sailGrad.addColorStop(1, "rgba(214,205,184,0.9)");
      ctx.fillStyle = sailGrad;
      ctx.beginPath();
      ctx.moveTo(1.4, -25);
      ctx.quadraticCurveTo(9, -12, 8, -1.5);
      ctx.lineTo(1.4, -1.5);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(244,238,224,0.92)";
      ctx.beginPath();
      ctx.moveTo(-0.4, -24);
      ctx.quadraticCurveTo(-7, -11, -6.5, -1.5);
      ctx.lineTo(-0.4, -1.5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // ---- faint trailing wake ----
      ctx.save();
      ctx.strokeStyle = rgb(HL_WARM, 0.1);
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.moveTo(bx - 9 * s, by + 1.5 * s);
      ctx.quadraticCurveTo(bx - 70 * s, by + 6 * s, bx - 150 * s, by + 2 * s);
      ctx.stroke();
      ctx.restore();
    }

    // a tiny distant vessel near the horizon — the speck from the reference.
    function drawSpeck() {
      const [sx, sy] = project(0.66, 0.03);
      ctx.fillStyle = rgb(SUN_CORE, 0.7);
      ctx.fillRect(sx - 0.6, sy - 2.4, 1.2, 2.4);
      ctx.fillStyle = rgb(SEA_DEEP, 0.6);
      ctx.fillRect(sx - 1.1, sy, 2.2, 0.9);
    }

    // ---- frame ------------------------------------------------------------
    let prev = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      t += dt;
      const m = motionRef.current || { envelope: 0, beat: 0 };
      const env = m.envelope;
      const beat = m.beat;

      // ---------- SKY ----------
      const sky = ctx.createLinearGradient(0, 0, 0, yH + 4);
      sky.addColorStop(0, rgb(SKY_TOP));
      sky.addColorStop(0.62, rgb(mix(SKY_TOP, SKY_MID, 0.85)));
      sky.addColorStop(1, rgb(SKY_HZN));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, yH + 4);

      // broad warm sun-glow blooming over the horizon (breathes with audio)
      const sunX = w * (0.5 + SUN_U * 0.5);
      const glow = ctx.createRadialGradient(
        sunX, yH, 0,
        sunX, yH, w * (0.5 + env * 0.12)
      );
      const gA = 0.5 + env * 0.28 + beat * 0.18;
      glow.addColorStop(0, rgb(SUN_CORE, clamp(gA, 0, 0.95)));
      glow.addColorStop(0.18, rgb(SKY_HZN, gA * 0.55));
      glow.addColorStop(0.5, rgb(SKY_HZN, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, yH + 30);

      // ---------- WATER base ----------
      const sea = ctx.createLinearGradient(0, yH, 0, h);
      sea.addColorStop(0, rgb(SEA_HZN));
      sea.addColorStop(0.06, rgb(mix(SEA_HZN, SEA_MID, 0.55)));
      sea.addColorStop(0.4, rgb(SEA_MID));
      sea.addColorStop(1, rgb(SEA_DEEP));
      ctx.fillStyle = sea;
      ctx.fillRect(0, yH, w, h - yH);

      // rolling swell — a few wide soft bands sliding toward the viewer
      for (let i = 0; i < 6; i++) {
        const v = ((t * 0.03 + i / 6) % 1);
        const [, y] = project(0, v);
        const band = Math.sin(t * 0.4 + i) * 0.5 + 0.5;
        const hgt = lerp(4, 26, v);
        ctx.fillStyle = rgb(
          band > 0.5 ? HL_COOL : SEA_DEEP,
          0.05 * (1 - v) + 0.02
        );
        ctx.fillRect(0, y - hgt / 2, w, hgt);
      }

      // ---------- RIPPLE FACETS ----------
      const ampBoost = 1 + env * 0.5;
      for (const r of ripples) {
        r.v += dt * (0.018 + r.v * 0.05) * ampBoost; // drift toward viewer
        r.ph += dt * r.sp;
        if (r.v > 1) {
          r.v -= 1;
          r.u = rand(-1.12, 1.12);
        }
        const c = crest(r.u, r.v, t);
        if (c < 0.12) continue; // only light the crests
        const [x, y] = project(r.u, r.v);
        const lit = sunlight(r.u, r.v);
        const twk = 0.6 + 0.4 * Math.sin(r.ph);
        let col;
        if (r.v < 0.28) col = mix(HL_WARM, HL_COOL, r.v / 0.28);
        else col = mix(HL_COOL, HL_DARK, (r.v - 0.28) / 0.72);
        const a = clamp(
          smooth(0.12, 0.9, c) * lit * twk * (0.5 + env * 0.5),
          0, 0.85
        );
        if (a < 0.01) continue;
        const rw = lerp(6, 44, r.v);
        const rh = lerp(0.9, 5, r.v);
        ctx.fillStyle = rgb(col, a);
        ctx.beginPath();
        ctx.ellipse(x, y, rw / 2, rh / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        // a thin shadow trough just beyond the brighter near crests adds relief
        if (r.v > 0.35) {
          ctx.fillStyle = rgb(SEA_DEEP, a * 0.4);
          ctx.fillRect(x - rw / 2, y + rh * 0.6, rw, rh * 0.5);
        }
      }

      // ---------- SUN GLITTER ----------
      for (const g of glints) {
        g.v += dt * 0.01 * ampBoost;
        g.ph += dt * g.sp;
        if (g.v > 0.24) {
          g.v = 0.004;
          g.u = rand(-0.95, 0.95);
        }
        const tw = Math.sin(g.ph);
        if (tw < 0.55) continue; // sparse, sparkling
        const [x, y] = project(g.u, g.v);
        const warm = 1 - 0.5 * Math.abs(g.u - SUN_U);
        const a = clamp((tw - 0.55) * 2.0 * warm * (0.7 + beat * 0.8), 0, 1);
        const s = lerp(0.6, 1.8, 1 - g.v / 0.24);
        ctx.fillStyle = rgb(SUN_CORE, a);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }

      // ---------- horizon crisp line + haze ----------
      const haze = ctx.createLinearGradient(0, yH - 6, 0, yH + 10);
      haze.addColorStop(0, rgb(SKY_HZN, 0));
      haze.addColorStop(0.45, rgb(SUN_CORE, 0.5 + beat * 0.2));
      haze.addColorStop(1, rgb(SEA_HZN, 0));
      ctx.fillStyle = haze;
      ctx.fillRect(0, yH - 6, w, 16);

      // ---------- vessels ----------
      drawSpeck();
      drawBoat(t, env, beat);

      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [motionRef]);

  return <canvas ref={canvasRef} className="ocean" aria-hidden="true" />;
}
