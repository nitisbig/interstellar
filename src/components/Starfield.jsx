import { useEffect, useRef } from "react";

/**
 * Drifting parallax starfield rendered to a canvas. Three depth layers give a
 * sense of slow travel; stars twinkle, and a shooting star streaks past on an
 * irregular cadence. Reads `motionRef` (shared per-frame audio state) to nudge
 * drift speed and brightness with the music.
 */
export default function Starfield({ motionRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const LAYERS = [
      { count: 90, speed: 1.4, size: [0.4, 0.9], alpha: 0.5 },
      { count: 55, speed: 3.2, size: [0.7, 1.5], alpha: 0.75 },
      { count: 22, speed: 6.0, size: [1.1, 2.2], alpha: 1.0 },
    ];
    let stars = [];
    let shoot = null;
    let nextShoot = 2500;

    function rand(a, b) {
      return a + Math.random() * (b - a);
    }

    function build() {
      stars = [];
      for (const layer of LAYERS) {
        for (let i = 0; i < layer.count; i++) {
          stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: rand(layer.size[0], layer.size[1]),
            a: rand(0.2, layer.alpha),
            tw: rand(0.6, 2.4), // twinkle rate
            ph: Math.random() * Math.PI * 2,
            speed: layer.speed,
          });
        }
      }
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    let prev = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const m = motionRef.current || { envelope: 0, beat: 0 };
      const boost = 1 + m.envelope * 1.6 + m.beat * 1.2;

      ctx.clearRect(0, 0, w, h);

      for (const s of stars) {
        // slow downward drift, parallax by layer, audio-scaled
        s.y += s.speed * boost * dt * 6;
        if (s.y > h + 4) {
          s.y = -4;
          s.x = Math.random() * w;
        }
        s.ph += s.tw * dt;
        const twinkle = 0.65 + 0.35 * Math.sin(s.ph);
        const alpha = Math.min(1, s.a * twinkle * (0.7 + m.envelope * 0.6));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(214, 224, 235, ${alpha.toFixed(3)})`;
        ctx.fill();
      }

      // shooting star
      nextShoot -= dt * 1000;
      if (!shoot && nextShoot <= 0) {
        const fromLeft = Math.random() > 0.5;
        shoot = {
          x: fromLeft ? -40 : w + 40,
          y: rand(h * 0.05, h * 0.5),
          vx: (fromLeft ? 1 : -1) * rand(420, 680),
          vy: rand(120, 220),
          life: 1,
        };
        nextShoot = rand(6000, 14000);
      }
      if (shoot) {
        const tailX = shoot.x - shoot.vx * 0.05;
        const tailY = shoot.y - shoot.vy * 0.05;
        const grad = ctx.createLinearGradient(shoot.x, shoot.y, tailX, tailY);
        grad.addColorStop(0, `rgba(235,242,250,${(shoot.life * 0.9).toFixed(3)})`);
        grad.addColorStop(1, "rgba(235,242,250,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(shoot.x, shoot.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        shoot.x += shoot.vx * dt;
        shoot.y += shoot.vy * dt;
        shoot.life -= dt * 0.55;
        if (shoot.life <= 0 || shoot.x < -80 || shoot.x > w + 80) shoot = null;
      }

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

  return <canvas ref={canvasRef} className="starfield" aria-hidden="true" />;
}
