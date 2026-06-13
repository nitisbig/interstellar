import { useEffect, useRef } from "react";

/**
 * Ocean — a procedural golden-hour seascape rendered to canvas.
 *
 * A high aerial (drone) view of the open sea near sunset: a clean, empty sky —
 * just a warm pale-gold haze at the horizon easing up into a cool blue-grey —
 * over a vast field of wind chop. The water reads light and hazy near the
 * horizon, deepens to ocean blue, and falls to a dark navy in the foreground,
 * with countless tiny sun glints riding the wavelets. A lone white sloop sits
 * almost still, center-right, breathing with the swell. Like the Starfield it
 * reads `motionRef` (shared per-frame audio state) so the chop and the glints
 * breathe gently with the music — but the scene stays calm and photographic.
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
    // A drone shot looks well down at the water, so the horizon sits high and
    // the sea fills most of the frame.
    const HORIZON = 0.18; // fraction of height where sea meets sky
    const SUN_U = 0.05; // the sun's azimuth — just right of centre

    // The sea is rendered as a deck of travelling wave ribbons stacked from the
    // horizon toward the viewer and painted back-to-front, so a near crest
    // genuinely hides the trough behind it (true relief, not flat shimmer).
    // Fine sun glints are scattered on top for the photographic chop texture.
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

    // ---- palette (dusk — a brighter after-sunset, ~70% light) ------------
    // SKY: a soft dusk blue overhead easing down to a warm afterglow band at
    // the waterline. No sun, no objects — just the residual glow.
    const SKY_TOP = [34, 48, 72]; // dusk blue (top of frame)
    const SKY_MID = [58, 76, 104]; // muted dusk blue
    const SKY_HZN = [196, 162, 132]; // warm afterglow at the horizon
    const SUN_WARM = [236, 192, 150]; // the residual sun glow, low on the sky

    // SEA: a hazy steel near the horizon (reflecting the fading sky) → dusk
    // blue → deep navy in the foreground.
    const SEA_HZN = [92, 116, 138]; // hazy far water
    const SEA_MID = [40, 70, 96];
    const SEA_DEEP = [12, 26, 40]; // deep navy foreground

    // crest / glint colours — a warm glint near the horizon cooling to steel
    // toward the viewer.
    const HL_WARM = [240, 224, 198]; // warm glint near the horizon
    const HL_COOL = [140, 172, 192]; // cool steel glint mid-water

    // ---- chop glints (sun sparkles riding the wavelets) ------------------
    let chop = []; // dense fine flecks across the whole sea

    function build() {
      // Scatter glints across the sea, biased toward the horizon where the low
      // sun rakes the chop and the texture reads densest.
      chop = [];
      const NCHOP = clamp(Math.round((w * h) / 900), 1200, 3200);
      for (let i = 0; i < NCHOP; i++) {
        chop.push({
          u: rand(-1.08, 1.08),
          v: 0.01 + Math.pow(Math.random(), 1.6) * 0.97, // dense near horizon
          ph: rand(0, Math.PI * 2),
          sp: rand(0.8, 3.2),
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
      NROWS = clamp(Math.round((h - yH) / 6), 80, 190);
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
    // horizontal spread factor at a given depth (shared with the ribbon paint)
    const spreadAt = (v) => 0.5 * (0.82 + 0.18 * v);

    // Surface height field, normalised to roughly -1..1. Four sine trains of
    // differing wavelength and heading sum into irregular wind chop; every
    // train's phase advances with time so the wavelets roll toward the viewer
    // (increasing v). Tuned as short, busy chop rather than long swell — this is
    // the single source of truth for the wave shape: the mesh, the crest sheen,
    // the glints and the boat's bob all read from it.
    function waveDisp(u, v, time) {
      const a = Math.sin(v * 16.0 - time * 0.6 + u * 1.2);
      const b = Math.sin(v * 34.0 - time * 1.0 - u * 2.4 + 1.3);
      const c = Math.sin(v * 66.0 - time * 1.6 + u * 3.6 + 4.0);
      const d = Math.sin(v * 120.0 - time * 2.2 - u * 5.5 + 2.1);
      return a * 0.42 + b * 0.3 + c * 0.16 + d * 0.12;
    }

    // vertical wave amplitude in screen px at depth v — tiny at the compressed
    // horizon, modest up close. Kept low so the sea reads as calm chop.
    function ampAt(v, mul) {
      return lerp(0.2, 9, Math.pow(v, 1.5)) * mul;
    }

    // light reaching the surface from the bright sky: strong near the horizon,
    // falling toward the dark foreground, with a broad warm brightening toward
    // the sun's azimuth.
    function seaLight(u, v) {
      const depth = lerp(1.0, 0.12, smooth(0, 1, v));
      const sun = 1 - 0.32 * clamp(Math.abs(u - SUN_U), 0, 1);
      return depth * sun;
    }

    // ---- the boat ---------------------------------------------------------
    // a small white sloop seen from a high angle, sitting almost still in the
    // chop and breathing with it — center-right, mid-distance.
    const boat = { u: 0.24, v: 0.46 };

    function drawBoat(time, env) {
      // steady: the boat holds its spot — only the faintest breath of drift so
      // it doesn't read as frozen.
      const bu = boat.u + Math.sin(time * 0.01) * 0.003;
      const bv = boat.v + Math.sin(time * 0.012 + 1.2) * 0.002;
      const [bx, byBase] = project(bu, bv);

      // gentle float: ride the surface height beneath the hull with a small bob.
      const swell = waveDisp(bu, bv, time);
      const bob = swell * ampAt(bv, 0.4 + env * 0.06);
      const by = byBase + bob;
      // a soft, slow roll into the local slope of the chop — almost still
      const slope = waveDisp(bu, bv + 0.01, time) - swell;
      const roll = Math.sin(time * 0.22) * 0.006 + slope * 1.0;
      const s = lerp(1.55, 2.15, bv); // perspective scale — a touch larger

      // ---- contact shadow + broken reflection on the water, below the hull --
      ctx.save();
      // soft dark contact shadow hugging the waterline
      ctx.fillStyle = rgb(SEA_DEEP, 0.4);
      ctx.beginPath();
      ctx.ellipse(bx, by + 2 * s, 13 * s, 2.4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      // a few broken pale streaks — the white sails mirrored in the chop
      for (let i = 0; i < 6; i++) {
        const ry = by + (3 + i * 2.6) * s;
        const fade = (1 - i / 6) * 0.18;
        const jitter = Math.sin(time * 2.2 + i * 1.3 + bx) * 1.8 * s;
        ctx.fillStyle = rgb([216, 220, 222], fade * (0.6 + 0.4 * Math.sin(time * 3 + i)));
        ctx.fillRect(bx - 4 * s + jitter, ry, 8 * s, 1.0 * s);
      }
      ctx.restore();

      // ---- hull + rig (drawn in local, scaled units) ----
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(roll);
      ctx.scale(s, s);

      // hull — a compact dark sloop hull with a slightly raised bow
      ctx.fillStyle = "rgba(26,32,40,0.96)";
      ctx.beginPath();
      ctx.moveTo(-11, 0);
      ctx.quadraticCurveTo(-10.5, 3.0, -5, 3.8);
      ctx.lineTo(8, 3.8);
      ctx.quadraticCurveTo(13, 3.0, 13.5, -0.3); // upswept bow
      ctx.lineTo(-11, 0);
      ctx.closePath();
      ctx.fill();

      // sunlit waterline along the top edge of the hull
      ctx.strokeStyle = "rgba(218,214,204,0.46)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-10.6, -0.1);
      ctx.lineTo(13.1, -0.3);
      ctx.stroke();

      // mast
      ctx.strokeStyle = "rgba(60,64,70,0.9)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(1.5, -1);
      ctx.lineTo(1.5, -34);
      ctx.stroke();

      // mainsail — a tall sail behind the mast, catching the dim afterglow on
      // its left (horizon-facing) edge and falling to dusk-grey on the right
      const main = ctx.createLinearGradient(-6, -30, 10, -3);
      main.addColorStop(0, "rgba(234,230,218,0.97)");
      main.addColorStop(1, "rgba(174,184,194,0.9)");
      ctx.fillStyle = main;
      ctx.beginPath();
      ctx.moveTo(2, -33);
      ctx.quadraticCurveTo(11, -18, 10, -3.2);
      ctx.lineTo(2, -3.2);
      ctx.closePath();
      ctx.fill();

      // jib (foresail) — a smaller sail ahead of the mast
      const jib = ctx.createLinearGradient(-9, -28, 1, -3);
      jib.addColorStop(0, "rgba(226,222,212,0.95)");
      jib.addColorStop(1, "rgba(164,176,188,0.88)");
      ctx.fillStyle = jib;
      ctx.beginPath();
      ctx.moveTo(1, -30);
      ctx.quadraticCurveTo(-7, -16, -8, -2.6);
      ctx.lineTo(1, -2.6);
      ctx.closePath();
      ctx.fill();

      // faint seam between the two sails to separate them crisply
      ctx.strokeStyle = "rgba(120,134,146,0.35)";
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(1.2, -30);
      ctx.lineTo(1.2, -3);
      ctx.stroke();

      ctx.restore();

      // ---- faint trailing wake on the calm surface ----
      ctx.save();
      ctx.strokeStyle = rgb([222, 230, 234], 0.07);
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.moveTo(bx - 10 * s, by + 2 * s);
      ctx.quadraticCurveTo(bx - 70 * s, by + 6 * s, bx - 150 * s, by + 2 * s);
      ctx.stroke();
      ctx.restore();
    }

    // a tiny distant speck near the horizon — a lone bird against the haze.
    function drawSpeck() {
      const [sx, sy] = project(0.42, 0.012);
      ctx.fillStyle = rgb([30, 36, 44], 0.5);
      ctx.fillRect(sx - 1, sy - 6, 2, 1);
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

      const sunX = w * (0.5 + SUN_U * 0.5);

      // ---------- SKY ----------
      // a dark dusk ramp: deep blue overhead → muted blue → a thin dim warm
      // afterglow only at the very horizon. Nothing else lives in the sky.
      const sky = ctx.createLinearGradient(0, 0, 0, yH + 4);
      sky.addColorStop(0, rgb(SKY_TOP));
      sky.addColorStop(0.5, rgb(SKY_MID));
      sky.addColorStop(0.84, rgb(mix(SKY_MID, SKY_HZN, 0.3)));
      sky.addColorStop(1, rgb(SKY_HZN));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, yH + 4);

      // the last residual glow — low, dim and hugging the horizon (sun is down)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const sun = ctx.createRadialGradient(sunX, yH, 0, sunX, yH, w * 0.34);
      sun.addColorStop(0, rgb(SUN_WARM, clamp(0.27 + env * 0.08, 0, 0.42)));
      sun.addColorStop(0.5, rgb(SUN_WARM, 0.08));
      sun.addColorStop(1, rgb(SUN_WARM, 0));
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, yH + 26);
      ctx.restore();

      // ---------- WATER base ----------
      // flat tonal gradient underneath, so any sub-pixel seams between ribbons
      // read as deep water rather than sky.
      const sea = ctx.createLinearGradient(0, yH, 0, h);
      sea.addColorStop(0, rgb(SEA_HZN));
      sea.addColorStop(0.08, rgb(mix(SEA_HZN, SEA_MID, 0.5)));
      sea.addColorStop(0.4, rgb(SEA_MID));
      sea.addColorStop(1, rgb(SEA_DEEP));
      ctx.fillStyle = sea;
      ctx.fillRect(0, yH, w, h - yH);

      // a dim hazy band where the fading sky reflects on the far water, with a
      // faint warm core under the afterglow — sits in the surface (additive).
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const bandH = (h - yH) * 0.22;
      const band = ctx.createLinearGradient(0, yH, 0, yH + bandH);
      band.addColorStop(0, rgb([152, 160, 166], 0.18));
      band.addColorStop(0.4, rgb([110, 128, 144], 0.07));
      band.addColorStop(1, rgb([110, 128, 144], 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, yH, w, bandH);
      const refl = ctx.createRadialGradient(sunX, yH, 0, sunX, yH, w * 0.4);
      refl.addColorStop(0, rgb(SUN_WARM, 0.15 + env * 0.05));
      refl.addColorStop(1, rgb(SUN_WARM, 0));
      ctx.fillStyle = refl;
      ctx.fillRect(0, yH, w, bandH * 1.4);
      ctx.restore();

      // ---------- WAVE MESH ----------
      // The chop drifts toward the camera (the time term in waveDisp marches
      // wavelets to larger v). Audio swells the amplitude — gently.
      const ampMul = 1 + env * 0.35 + beat * 0.15;

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
        const sp = spreadAt(v);

        // body colour of this depth band (hazy steel far → deep navy near)
        let body;
        if (v < 0.4) body = mix(SEA_HZN, SEA_MID, smooth(0, 0.4, v));
        else body = mix(SEA_MID, SEA_DEEP, smooth(0.4, 1, v));

        // build the closed ribbon polygon: this crest, across, next crest back
        ctx.beginPath();
        ctx.moveTo(0, topArr[row]);
        for (let cx = 0; cx < COLS; cx++) {
          ctx.lineTo(w * (0.5 + xArr[cx] * sp), topArr[row + cx]);
        }
        for (let cx = COLS - 1; cx >= 0; cx--) {
          ctx.lineTo(w * (0.5 + xArr[cx] * sp), topArr[next + cx]);
        }
        ctx.closePath();
        ctx.fillStyle = rgb(body, 1);
        ctx.fill();

        // crest sheen as a thin bright stroke riding the top of the ribbon,
        // brightest where the wave face tips toward the sky and near the
        // horizon. No moon road — the whole sea catches the broad sky light.
        ctx.lineWidth = lerp(0.7, 1.8, v);
        let drawing = false;
        for (let cx = 0; cx < COLS; cx++) {
          const u = xArr[cx];
          const sx = w * (0.5 + u * sp);
          const sy = topArr[row + cx];
          // up-face (slope<0 means crest rises toward viewer) catches light
          const face = clamp(-hlArr[row + cx] * 3.2, 0, 1);
          const lit = seaLight(u, v);
          const a = clamp(face * lit * (0.42 + env * 0.34), 0, 0.62);
          if (a > 0.04) {
            // warm sun-white near the horizon, cooling to steel toward viewer
            const warmth = clamp(1 - v * 1.7, 0, 1);
            const col = mix(HL_COOL, HL_WARM, warmth);
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

      // ---------- SUN GLINTS ----------
      // a dense field of fine sparkles riding the chop — the photographic sea
      // texture. Each snaps onto the crest line beneath it; brighter & warmer
      // near the horizon, sparse and cool in the dark foreground, and gated by
      // the local wave face so they sit on sunlit slopes.
      const ampBoost = 1 + env * 0.3;
      for (const g of chop) {
        g.v += dt * 0.025 * ampBoost; // drift toward the viewer
        g.ph += dt * g.sp;
        if (g.v > 1.0) {
          g.v = 0.01;
          g.u = rand(-1.08, 1.08);
        }
        const tw = Math.sin(g.ph);
        if (tw < 0.5) continue; // sparse, sparkling
        const lit = seaLight(g.u, g.v);
        if (lit < 0.06) continue;
        const sp = spreadAt(g.v);
        const x = w * (0.5 + g.u * sp);
        const disp = waveDisp(g.u, g.v, t);
        const slope = waveDisp(g.u, g.v + 0.005, t) - disp;
        const face = clamp(-slope * 4.5, 0, 1); // sit on sun-facing slopes
        const y = yH + (h - yH) * Math.pow(g.v, 1.55) + disp * ampAt(g.v, ampBoost);
        const a = clamp(
          (tw - 0.5) * 1.9 * lit * (0.4 + face * 0.6) * (0.6 + beat * 0.35),
          0,
          0.7
        );
        if (a < 0.04) continue;
        const warmth = clamp(1 - g.v * 1.7, 0, 1);
        ctx.fillStyle = rgb(mix(HL_COOL, HL_WARM, warmth), a);
        const sz = lerp(0.6, 1.8, g.v);
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }

      // ---------- horizon haze ----------
      // a soft warm line of haze where the sea meets the sky.
      const haze = ctx.createLinearGradient(0, yH - 4, 0, yH + 8);
      haze.addColorStop(0, rgb(SKY_HZN, 0));
      haze.addColorStop(0.4, rgb([220, 186, 156], 0.4 + beat * 0.08));
      haze.addColorStop(1, rgb(SEA_HZN, 0));
      ctx.fillStyle = haze;
      ctx.fillRect(0, yH - 4, w, 12);

      // ---------- vessels ----------
      drawSpeck();
      drawBoat(t, env);

      // ---------- drone vignette ----------
      // gently darken the corners (bottom most), the look of aerial footage.
      ctx.save();
      const vig = ctx.createRadialGradient(
        w * 0.5,
        h * 0.4,
        h * 0.34,
        w * 0.5,
        h * 0.52,
        h * 0.95
      );
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(2,8,14,0.4)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

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
