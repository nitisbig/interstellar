import { useEffect, useRef } from "react";

/**
 * Ocean — a procedural night seascape rendered to canvas.
 *
 * A calm open ocean under the northern lights: a deep night sky with drifting
 * aurora curtains, a low pale moon laying a silver road across gentle swell,
 * and a lone sailboat that sits almost still and breathes with the water. Like
 * the Starfield it reads `motionRef` (shared per-frame audio state) so the
 * swell, aurora and moon-road shimmer breathe with the music.
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
    const HORIZON = 0.34; // fraction of height where sea meets sky (lower than
    //                       the old framing → more sky for the aurora to fill)
    const MOON_U = -0.16; // the moon (and its reflected road) sits left of centre
    const GLITTER = 90;

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

    // ---- palette (clear arctic night) ------------------------------------
    // a near-black zenith eases down through deep blue to a cool grey-blue
    // band at the waterline — a calm, real night rather than golden hour.
    const SKY_TOP = [5, 8, 20]; // near-black zenith
    const SKY_HIGH = [10, 18, 40]; // deep blue
    const SKY_MID = [16, 30, 54]; // mid blue
    const SKY_HZN = [34, 52, 72]; // cool grey-blue at the horizon
    const MOON_CORE = [234, 242, 250];
    const MOON_BODY = [198, 212, 230];

    const SEA_HZN = [40, 60, 76]; // cool, hazy far water
    const SEA_MID = [20, 38, 54];
    const SEA_DEEP = [5, 13, 22]; // near-black foreground

    const HL_LIGHT = [206, 226, 230]; // moonlit crest
    const HL_COOL = [96, 134, 146]; // mid crest
    const HL_DARK = [22, 40, 52]; // foreground crest (barely lit)

    // aurora ribbon colours — classic green, teal and a violet upper veil
    const AURORA = [
      [70, 230, 150],
      [64, 210, 205],
      [150, 120, 235],
    ];

    // ---- moon glitter (sparkles riding the moon road) --------------------
    let glints = [];
    let stars = []; // sky stars, twinkling above the horizon

    function build() {
      glints = [];
      for (let i = 0; i < GLITTER; i++) {
        glints.push({
          u: rand(-0.95, 0.95),
          v: rand(0.004, 0.5), // strung down the moon road toward the viewer
          ph: rand(0, Math.PI * 2),
          sp: rand(2.0, 5),
        });
      }

      // scatter stars across the night sky (denser toward the zenith, thinning
      // out near the lighter horizon where they'd wash out)
      stars = [];
      const NSTARS = 260;
      for (let i = 0; i < NSTARS; i++) {
        const sy = Math.pow(Math.random(), 1.5); // bias upward
        stars.push({
          x: Math.random(),
          y: sy * 0.92, // fraction of the sky band (0 top → 1 horizon)
          r: rand(0.3, 1.3),
          ph: rand(0, Math.PI * 2),
          sp: rand(0.6, 2.2),
          warm: Math.random() < 0.15, // a few amber stars among the cool ones
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
    // v). Tuned gentle here — long, low swell rather than chop. This is the
    // single source of truth for the wave shape — the mesh, the crest sheen,
    // the glitter and the boat's bob all read from it.
    function waveDisp(u, v, time) {
      const a = Math.sin(v * 15.0 - time * 0.8 + u * 1.0);
      const b = Math.sin(v * 30.0 - time * 1.3 - u * 1.8 + 1.3);
      const c = Math.sin(v * 55.0 - time * 1.9 + u * 3.0 + 4.0);
      const d = Math.sin(v * 96.0 - time * 2.5 - u * 4.2 + 2.1);
      return a * 0.5 + b * 0.3 + c * 0.12 + d * 0.06;
    }

    // vertical wave amplitude in screen px at depth v — tiny at the compressed
    // horizon, modest and rolling up close (the audio envelope swells it).
    // Kept well below the old scene so the sea reads calm.
    function ampAt(v, mul) {
      return lerp(0.3, 15, Math.pow(v, 1.45)) * mul;
    }

    // light reaching the surface: strong near the moon road, dim up close.
    function moonlight(u, v) {
      const depth = lerp(1.0, 0.14, smooth(0, 1, v));
      const toward = 1 - 0.3 * Math.abs(u - MOON_U); // brighter near the moon
      return depth * clamp(toward, 0.5, 1);
    }

    // ---- aurora -----------------------------------------------------------
    // Several luminous curtains hang in the sky. Each is a band of vertical
    // streaks whose lower hem waves smoothly across x and shimmers along its
    // length; painted additively so overlaps bloom like real aurora.
    const curtains = [
      { c: AURORA[0], hem: 0.80, top: 0.12, amp: 0.06, k: 3.0, sp: 0.18, a: 0.22 },
      { c: AURORA[1], hem: 0.66, top: 0.06, amp: 0.05, k: 4.5, sp: -0.13, a: 0.16 },
      { c: AURORA[2], hem: 0.92, top: 0.36, amp: 0.08, k: 2.2, sp: 0.24, a: 0.12 },
    ];

    function drawAurora(time, env, beat) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const intensity = 0.55 + env * 0.5 + beat * 0.3;
      const cols = 96;
      const stepW = w / cols;
      for (const cur of curtains) {
        for (let i = 0; i < cols; i++) {
          const fx = i / (cols - 1);
          const x = fx * w;
          const hemY =
            yH *
            (cur.hem +
              cur.amp * Math.sin(fx * Math.PI * cur.k + time * cur.sp * 3) +
              cur.amp * 0.4 * Math.sin(fx * Math.PI * cur.k * 2.7 - time * cur.sp * 4.3));
          const topY = yH * cur.top;
          const flick = 0.55 + 0.45 * Math.sin(fx * 30 + time * 1.1 + cur.k);
          const a = cur.a * intensity * flick;
          if (a < 0.01) continue;
          const g = ctx.createLinearGradient(0, topY, 0, hemY);
          g.addColorStop(0, rgb(cur.c, 0));
          g.addColorStop(0.55, rgb(cur.c, a * 0.35));
          g.addColorStop(1, rgb(cur.c, a));
          ctx.fillStyle = g;
          ctx.fillRect(x - 0.5, topY, stepW + 1, hemY - topY);
        }
      }
      ctx.restore();
    }

    // ---- the boat ---------------------------------------------------------
    // a larger, more detailed sloop that sits almost still in calm water and
    // breathes with the swell — no skating across the sea.
    const boat = { u: MOON_U + 0.34, v: 0.5 };

    function drawBoat(time, env) {
      // barely-there drift — a long, slow wander that keeps the boat steady in
      // frame rather than travelling.
      const bu = boat.u + Math.sin(time * 0.018) * 0.022 + Math.sin(time * 0.009) * 0.012;
      const bv = boat.v + Math.sin(time * 0.014 + 1.2) * 0.008;
      const [bx, byBase] = project(bu, bv);

      // calm float: ride the surface height beneath the hull with a gentle
      // damped bob. No beat-kick — the music swells the sea, not the boat.
      const swell = waveDisp(bu, bv, time);
      const bob = swell * ampAt(bv, 0.5 + env * 0.15);
      const by = byBase + bob;
      // roll softly into the local slope of the swell, plus a slow idle sway
      const slope = waveDisp(bu, bv + 0.012, time) - swell;
      const roll = Math.sin(time * 0.32) * 0.012 + slope * 2.0;
      const s = lerp(2.0, 3.4, bv); // perspective scale — noticeably bigger

      // ---- broken moonlit reflection on the water, just below the hull ----
      ctx.save();
      for (let i = 0; i < 8; i++) {
        const ry = by + (4 + i * 3.4) * s;
        const fade = (1 - i / 8) * 0.16;
        const jitter = Math.sin(time * 2.4 + i * 1.3 + bx) * 2.4 * s;
        ctx.fillStyle = rgb(HL_LIGHT, fade * (0.6 + 0.4 * Math.sin(time * 3 + i)));
        ctx.fillRect(bx - 7 * s + jitter, ry, 14 * s, 1.1 * s);
      }
      ctx.restore();

      // ---- hull + rig ----
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(roll);
      ctx.scale(s, s);

      // hull — a long dark sloop hull with a raised bow
      ctx.fillStyle = "rgba(14,20,28,0.96)";
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.quadraticCurveTo(-15.5, 4.2, -8, 5.4);
      ctx.lineTo(12, 5.4);
      ctx.quadraticCurveTo(18.5, 4.4, 19, -0.4); // upswept bow
      ctx.lineTo(-16, 0);
      ctx.closePath();
      ctx.fill();

      // moonlit waterline along the top edge of the hull
      ctx.strokeStyle = "rgba(170,196,206,0.45)";
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(-15.5, -0.1);
      ctx.lineTo(18.6, -0.4);
      ctx.stroke();

      // small cabin with a warm lit porthole
      ctx.fillStyle = "rgba(26,34,44,0.96)";
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(-5, -3.4);
      ctx.lineTo(2.5, -3.4);
      ctx.lineTo(3.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,206,128,0.85)";
      ctx.fillRect(-3.2, -2.6, 2.4, 1.7);

      // mast + boom
      ctx.strokeStyle = "rgba(44,50,58,0.92)";
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(2, -1);
      ctx.lineTo(2, -42); // taller mast for the bigger boat
      ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(2, -3);
      ctx.lineTo(15, -2.6); // boom
      ctx.stroke();

      // mainsail (a softly curved triangle catching the cool moonlight)
      const main = ctx.createLinearGradient(2, -40, 14, -3);
      main.addColorStop(0, "rgba(228,238,242,0.97)");
      main.addColorStop(1, "rgba(150,170,186,0.9)");
      ctx.fillStyle = main;
      ctx.beginPath();
      ctx.moveTo(3, -40);
      ctx.quadraticCurveTo(16, -22, 14.5, -3.5);
      ctx.lineTo(3, -3.5);
      ctx.closePath();
      ctx.fill();
      // a couple of faint horizontal batten seams on the main
      ctx.strokeStyle = "rgba(120,140,156,0.4)";
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.moveTo(3, -28); ctx.lineTo(11.5, -27);
      ctx.moveTo(3, -16); ctx.lineTo(13, -15.5);
      ctx.stroke();

      // jib (foresail) ahead of the mast
      ctx.fillStyle = "rgba(206,218,226,0.93)";
      ctx.beginPath();
      ctx.moveTo(1, -37);
      ctx.quadraticCurveTo(-10, -19, -11, -2.5);
      ctx.lineTo(1, -2.5);
      ctx.closePath();
      ctx.fill();

      // tiny masthead light
      ctx.fillStyle = "rgba(255,240,210,0.95)";
      ctx.fillRect(1.4, -42.6, 1.2, 1.2);

      ctx.restore();

      // ---- faint trailing wake on the calm surface ----
      ctx.save();
      ctx.strokeStyle = rgb(HL_LIGHT, 0.08);
      ctx.lineWidth = 1.4 * s;
      ctx.beginPath();
      ctx.moveTo(bx - 14 * s, by + 2 * s);
      ctx.quadraticCurveTo(bx - 90 * s, by + 7 * s, bx - 190 * s, by + 2.5 * s);
      ctx.stroke();
      ctx.restore();
    }

    // a tiny distant vessel near the horizon — a far light on the water.
    function drawSpeck() {
      const [sx, sy] = project(0.66, 0.03);
      ctx.fillStyle = rgb(MOON_CORE, 0.6);
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
      // a four-stop night ramp: black zenith → deep blue → blue → cool horizon
      const sky = ctx.createLinearGradient(0, 0, 0, yH + 4);
      sky.addColorStop(0, rgb(SKY_TOP));
      sky.addColorStop(0.45, rgb(SKY_HIGH));
      sky.addColorStop(0.78, rgb(SKY_MID));
      sky.addColorStop(1, rgb(SKY_HZN));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, yH + 4);

      // ---------- STARS ----------
      // twinkle across the sky, fading gently toward the brighter horizon
      for (const st of stars) {
        const sy = st.y * yH;
        const fadeUp = clamp(1 - st.y * 0.7, 0, 1);
        const tw = 0.45 + 0.55 * Math.sin(t * st.sp + st.ph);
        const a = clamp(tw * fadeUp * (0.6 + env * 0.4), 0, 1) * 0.95;
        if (a < 0.02) continue;
        ctx.fillStyle = rgb(st.warm ? [255, 226, 196] : [220, 230, 255], a);
        ctx.fillRect(st.x * w, sy, st.r, st.r);
      }

      // ---------- AURORA ----------
      drawAurora(t, env, beat);

      // ---------- MOON ----------
      // a low pale moon, off-centre, lighting the scene and casting the road
      const moonX = w * (0.5 + MOON_U * 0.5);
      const moonR = h * (0.05 + env * 0.004);
      const moonY = yH * 0.44;
      // soft halo
      const mhalo = ctx.createRadialGradient(
        moonX, moonY, moonR * 0.6, moonX, moonY, moonR * 4.2
      );
      mhalo.addColorStop(0, rgb(MOON_CORE, 0.24));
      mhalo.addColorStop(1, rgb(MOON_CORE, 0));
      ctx.fillStyle = mhalo;
      ctx.fillRect(moonX - moonR * 4.2, moonY - moonR * 4.2, moonR * 8.4, moonR * 8.4);
      // disc
      const md = ctx.createRadialGradient(
        moonX - moonR * 0.3, moonY - moonR * 0.3, moonR * 0.2, moonX, moonY, moonR
      );
      md.addColorStop(0, rgb(MOON_CORE));
      md.addColorStop(1, rgb(MOON_BODY));
      ctx.fillStyle = md;
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
      ctx.fill();
      // faint craters / maria
      ctx.fillStyle = rgb(mix(MOON_BODY, SKY_MID, 0.3), 0.45);
      ctx.beginPath();
      ctx.arc(moonX - moonR * 0.28, moonY + moonR * 0.12, moonR * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(moonX + moonR * 0.32, moonY - moonR * 0.22, moonR * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(moonX + moonR * 0.1, moonY + moonR * 0.34, moonR * 0.1, 0, Math.PI * 2);
      ctx.fill();

      // low moon-glow blooming over the horizon under the road
      const glow = ctx.createRadialGradient(
        moonX, yH, 0, moonX, yH, w * (0.26 + env * 0.06)
      );
      glow.addColorStop(0, rgb(MOON_CORE, clamp(0.3 + env * 0.14, 0, 0.55)));
      glow.addColorStop(0.5, rgb(SKY_HZN, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, yH + 24);

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
      // crests to larger v). Audio swells the amplitude — gently.
      const ampMul = 1 + env * 0.5 + beat * 0.25;

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

        // body colour of this depth band (cool hazy far → deep navy near)
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
        // brightest where the wave face tips toward the moon and near the road
        ctx.lineWidth = lerp(0.8, 2.2, v);
        ctx.beginPath();
        let drawing = false;
        for (let cx = 0; cx < COLS; cx++) {
          const u = xArr[cx];
          const sx = w * (0.5 + u * 0.5 * (0.82 + 0.18 * v));
          const sy = topArr[row + cx];
          // up-face (slope<0 means crest rises toward viewer) catches light
          const face = clamp(-hlArr[row + cx] * 3.5, 0, 1);
          const lit = moonlight(u, v);
          const road = smooth(0.5, 0.0, Math.abs(u - MOON_U)); // moon road
          const a = clamp(face * lit * (0.3 + road * 0.9) * (0.55 + env * 0.5), 0, 0.85);
          if (a > 0.05) {
            const col = mix(HL_COOL, HL_LIGHT, clamp(road + (1 - v) * 0.4, 0, 1));
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

      // ---------- AURORA REFLECTION ----------
      // the curtains spill a faint coloured glow onto the far water, mirrored
      // and additive so it sits in the surface rather than on top of it.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const reflH = (h - yH) * 0.32;
      const refl = ctx.createLinearGradient(0, yH, 0, yH + reflH);
      refl.addColorStop(0, rgb(AURORA[0], 0.1 * (0.6 + env * 0.5)));
      refl.addColorStop(0.4, rgb(AURORA[1], 0.05 * (0.6 + env * 0.5)));
      refl.addColorStop(1, rgb(AURORA[0], 0));
      ctx.fillStyle = refl;
      ctx.fillRect(0, yH, w, reflH);
      ctx.restore();

      // ---------- MOON GLITTER ----------
      // sparkles snap onto the crest line beneath them so they ride the waves
      const ampBoost = 1 + env * 0.4;
      for (const g of glints) {
        g.v += dt * 0.035 * ampBoost; // run down the moon road toward the viewer
        g.ph += dt * g.sp;
        if (g.v > 0.6) {
          g.v = 0.004;
          g.u = rand(-0.95, 0.95);
        }
        const tw = Math.sin(g.ph);
        if (tw < 0.55) continue; // sparse, sparkling
        const near = 1 - 1.6 * Math.abs(g.u - MOON_U);
        if (near <= 0) continue; // glitter only on the moon road
        const x = w * (0.5 + g.u * 0.5 * (0.82 + 0.18 * g.v));
        const amp = ampAt(g.v, ampBoost);
        const y =
          yH + (h - yH) * Math.pow(g.v, 1.55) + waveDisp(g.u, g.v, t) * amp;
        const a = clamp((tw - 0.55) * 2.0 * near * (0.7 + beat * 0.6), 0, 1);
        const s = lerp(0.7, 2.2, g.v);
        ctx.fillStyle = rgb(MOON_CORE, a);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }

      // ---------- horizon crisp line + haze ----------
      const haze = ctx.createLinearGradient(0, yH - 6, 0, yH + 10);
      haze.addColorStop(0, rgb(SKY_HZN, 0));
      haze.addColorStop(0.45, rgb(MOON_CORE, 0.35 + beat * 0.15));
      haze.addColorStop(1, rgb(SEA_HZN, 0));
      ctx.fillStyle = haze;
      ctx.fillRect(0, yH - 6, w, 16);

      // ---------- vessels ----------
      drawSpeck();
      drawBoat(t, env);

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
