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
    const GLITTER = 150;

    // The sea is rendered as a deck of travelling wave ribbons stacked from the
    // horizon toward the viewer and painted back-to-front, so a near crest
    // genuinely hides the trough behind it (true swell, not flat shimmer).
    let NROWS = 110; // depth rows (recomputed on resize)
    let COLS = 180; // horizontal samples per row
    let xArr = new Float32Array(COLS); // screen x for each column
    let topArr = new Float32Array(NROWS * COLS); // crest-line y per (row,col)
    let hlArr = new Float32Array(NROWS * COLS); // crest-highlight alpha

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

    // ---- sun glitter (sparkles riding the sun road) ----------------------
    let glints = [];

    function build() {
      glints = [];
      for (let i = 0; i < GLITTER; i++) {
        glints.push({
          u: rand(-0.95, 0.95),
          v: rand(0.004, 0.5), // strung down the sun road toward the viewer
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

      // scale the wave mesh to the viewport (denser on big screens, cheaper on
      // small ones) and (re)allocate the per-vertex buffers.
      COLS = clamp(Math.round(w / 9), 90, 240);
      NROWS = clamp(Math.round((h - yH) / 7), 70, 170);
      xArr = new Float32Array(COLS);
      topArr = new Float32Array(NROWS * COLS);
      hlArr = new Float32Array(NROWS * COLS);
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

    // Surface height field, normalised to roughly -1..1. Four sine trains of
    // differing wavelength and heading sum into irregular swell; every train's
    // phase advances with time so the crests roll toward the viewer (increasing
    // v). This is the single source of truth for the wave shape — the mesh, the
    // crest sheen, the glitter and the boat's bob all read from it.
    function waveDisp(u, v, time) {
      const a = Math.sin(v * 18.0 - time * 1.0 + u * 1.1);
      const b = Math.sin(v * 34.0 - time * 1.7 - u * 2.0 + 1.3);
      const c = Math.sin(v * 61.0 - time * 2.5 + u * 3.3 + 4.0);
      const d = Math.sin(v * 104.0 - time * 3.3 - u * 4.6 + 2.1);
      return a * 0.46 + b * 0.3 + c * 0.15 + d * 0.09;
    }

    // vertical wave amplitude in screen px at depth v — tiny at the compressed
    // horizon, tall and rolling up close (the audio envelope swells it).
    function ampAt(v, mul) {
      return lerp(0.4, 30, Math.pow(v, 1.4)) * mul;
    }

    // light reaching the surface: strong at the hazy horizon, dim up close.
    function sunlight(u, v) {
      const depth = lerp(1.0, 0.12, smooth(0, 1, v));
      const toward = 1 - 0.32 * Math.abs(u - SUN_U); // warmer near the sun
      return depth * clamp(toward, 0.5, 1);
    }

    // ---- the boat ---------------------------------------------------------
    // wanders slowly within a bounded patch so it "floats around" the sea.
    const boat = { u: SUN_U + 0.28, v: 0.42 };

    function drawBoat(time, env, beat) {
      // gentle drift + depth wander
      const bu = boat.u + Math.sin(time * 0.06) * 0.16 + Math.sin(time * 0.017) * 0.05;
      const bv = boat.v + Math.sin(time * 0.043 + 1.2) * 0.05;
      const [bx, byBase] = project(bu, bv);

      // bob on the actual surface height beneath the hull + a small beat kick
      const swell = waveDisp(bu, bv, time);
      const bob = swell * ampAt(bv, 1 + env * 0.6) + beat * 5 * (1 + env);
      const by = byBase + bob;
      // roll into the local slope of the swell (finite difference along v)
      const slope = waveDisp(bu, bv + 0.012, time) - swell;
      const roll = Math.sin(time * 0.9) * 0.04 + slope * 6;
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
      // flat tonal gradient underneath, so any sub-pixel seams between ribbons
      // read as deep water rather than sky.
      const sea = ctx.createLinearGradient(0, yH, 0, h);
      sea.addColorStop(0, rgb(SEA_HZN));
      sea.addColorStop(0.06, rgb(mix(SEA_HZN, SEA_MID, 0.55)));
      sea.addColorStop(0.4, rgb(SEA_MID));
      sea.addColorStop(1, rgb(SEA_DEEP));
      ctx.fillStyle = sea;
      ctx.fillRect(0, yH, w, h - yH);

      // ---------- WAVE MESH ----------
      // The swell drifts toward the camera (the time term in waveDisp marches
      // crests to larger v). Audio swells the amplitude.
      const ampMul = 1 + env * 0.9 + beat * 0.45;

      // precompute the normalised x of every column once
      for (let cx = 0; cx < COLS; cx++) {
        xArr[cx] = (cx / (COLS - 1)) * 2 - 1;
      }

      // 1) sample the crest line (y) + slope for every vertex of the mesh
      for (let ry = 0; ry < NROWS; ry++) {
        // depth eased so rows pack tight near the horizon, spread up close
        const v = clamp(ry / (NROWS - 1), 0.0005, 1);
        const amp = ampAt(v, ampMul);
        const base = yH + (h - yH) * Math.pow(v, 1.55);
        const row = ry * COLS;
        for (let cx = 0; cx < COLS; cx++) {
          const u = xArr[cx];
          const disp = waveDisp(u, v, t);
          topArr[row + cx] = base + disp * amp;
          // store local depth-slope of the surface for crest sheen shading
          hlArr[row + cx] = waveDisp(u, v + 0.006, t) - disp;
        }
      }

      // 2) paint ribbons far→near. Each ribbon fills the band between its own
      //    crest line and the next row's crest line; drawn in depth order the
      //    near crest overlaps (occludes) the dip behind it → real relief.
      for (let ry = 0; ry < NROWS - 1; ry++) {
        const v = ry / (NROWS - 1);
        const row = ry * COLS;
        const next = (ry + 1) * COLS;

        // body colour of this depth band (warm hazy far → deep navy near)
        let body;
        if (v < 0.5) body = mix(SEA_HZN, SEA_MID, smooth(0, 0.5, v));
        else body = mix(SEA_MID, SEA_DEEP, smooth(0.5, 1, v));

        // build the closed ribbon polygon: this crest, across, next crest back
        ctx.beginPath();
        ctx.moveTo(0, topArr[row]);
        for (let cx = 0; cx < COLS; cx++) {
          ctx.lineTo(w * (0.5 + xArr[cx] * 0.5 * (0.82 + 0.18 * v)), topArr[row + cx]);
        }
        for (let cx = COLS - 1; cx >= 0; cx--) {
          ctx.lineTo(
            w * (0.5 + xArr[cx] * 0.5 * (0.82 + 0.18 * v)),
            topArr[next + cx]
          );
        }
        ctx.closePath();
        ctx.fillStyle = rgb(body, 1);
        ctx.fill();

        // crest sheen as a thin bright stroke riding the top of the ribbon,
        // brightest where the wave face tips toward the sun and near the sun road
        ctx.lineWidth = lerp(0.8, 2.4, v);
        ctx.beginPath();
        let drawing = false;
        for (let cx = 0; cx < COLS; cx++) {
          const u = xArr[cx];
          const sx = w * (0.5 + u * 0.5 * (0.82 + 0.18 * v));
          const sy = topArr[row + cx];
          // up-face (slope<0 means crest rises toward viewer) catches light
          const face = clamp(-hlArr[row + cx] * 3.5, 0, 1);
          const lit = sunlight(u, v);
          const road = smooth(0.55, 0.0, Math.abs(u - SUN_U)); // sun glitter path
          const a = clamp(face * lit * (0.35 + road * 0.9) * (0.6 + env * 0.6), 0, 0.9);
          if (a > 0.05) {
            const col = mix(HL_COOL, HL_WARM, clamp(road + (1 - v) * 0.4, 0, 1));
            if (!drawing) {
              ctx.strokeStyle = rgb(col, a);
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              drawing = true;
            } else {
              ctx.lineTo(sx, sy);
            }
          } else if (drawing) {
            ctx.stroke();
            drawing = false;
          }
        }
        if (drawing) ctx.stroke();
      }

      // ---------- SUN GLITTER ----------
      // sparkles snap onto the crest line beneath them so they ride the waves
      const ampBoost = 1 + env * 0.5;
      for (const g of glints) {
        g.v += dt * 0.04 * ampBoost; // run down the sun road toward the viewer
        g.ph += dt * g.sp;
        if (g.v > 0.6) {
          g.v = 0.004;
          g.u = rand(-0.95, 0.95);
        }
        const tw = Math.sin(g.ph);
        if (tw < 0.5) continue; // sparse, sparkling
        const warm = 1 - 1.5 * Math.abs(g.u - SUN_U);
        if (warm <= 0) continue; // glitter only on the sun road
        const x = w * (0.5 + g.u * 0.5 * (0.82 + 0.18 * g.v));
        const amp = ampAt(g.v, ampBoost);
        const y =
          yH + (h - yH) * Math.pow(g.v, 1.55) + waveDisp(g.u, g.v, t) * amp;
        const a = clamp((tw - 0.5) * 2.0 * warm * (0.7 + beat * 0.8), 0, 1);
        const s = lerp(0.8, 2.4, g.v);
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
