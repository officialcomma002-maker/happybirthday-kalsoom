/* Kalsoom Birthday Experience
   - Single fixed canvas: stars + fireworks
   - 5 scenes (0..4)
   - Music starts on first user click
   - Scene 2 candle: mic blow detection + click/double-tap fallback
   - Envelope open animation
   - Gift layer: built-in lightweight floating gifts (placeholder), plus hook for external link later
*/

(() => {
  'use strict';

  // --------------------------
  // Helpers
  // --------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function now() {
    return performance.now();
  }

  // --------------------------
  // Scene navigation
  // --------------------------
  const scenes = $$('.scene');
  let sceneIndex = 0;

  function setScene(i) {
    sceneIndex = clamp(i, 0, scenes.length - 1);
    scenes.forEach(s => s.classList.remove('active'));
    const active = scenes.find(s => Number(s.dataset.scene) === sceneIndex);
    if (active) active.classList.add('active');

    // Adjust fireworks intensity subtly by scene
    // 0: almost none, 1: higher, 2-4: subtle
    if (sceneIndex === 0) fx.setIntensity(0.05);
    if (sceneIndex === 1) fx.setIntensity(0.9);
    if (sceneIndex >= 2) fx.setIntensity(0.35);

    // Scene hooks
    if (sceneIndex === 1) startMemoriesSequence();
    if (sceneIndex === 2) enterCandleScene();
  }

  function nextScene() { setScene(sceneIndex + 1); }
  function restart() { setScene(0); }

  // --------------------------
  // Audio
  // --------------------------
  const bgm = $('#bgm');
  let audioStarted = false;

  function startMusic() {
    if (audioStarted) return;
    audioStarted = true;

    try {
      bgm.volume = 0.22;
      const p = bgm.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Autoplay policies may block; user can interact again to start.
          audioStarted = false;
        });
      }
    } catch {
      audioStarted = false;
    }
  }

  // --------------------------
  // Memories sequence (Scene 1)
  // --------------------------
  let memoriesStarted = false;
  function startMemoriesSequence() {
    if (memoriesStarted) return;
    memoriesStarted = true;

    const items = $$('.memory');
    items.forEach(m => m.classList.remove('show'));

    // Staggered reveal
    const baseDelay = 280;
    items.forEach((el, idx) => {
      setTimeout(() => el.classList.add('show'), baseDelay + idx * 850);
    });
  }

  // --------------------------
  // Candle blow-out logic (Scene 2)
  // --------------------------
  const continueBtn = $('#continueBtn');
  const flameEl = $('#flame');
  const candleEl = $('#candle');
  const blowHint = $('#blowHint');

  const CANDLE_KEY = 'kalsoom_candle_out_v1';

  let candleOut = sessionStorage.getItem(CANDLE_KEY) === '1';

  function setCandleOut(out) {
    candleOut = out;

    if (candleOut) {
      sessionStorage.setItem(CANDLE_KEY, '1');
      flameEl.classList.add('off');
      continueBtn.disabled = false;

      // Little visual acknowledgement: reduce hint prominence
      blowHint.style.opacity = '0.72';
    } else {
      flameEl.classList.remove('off');
      continueBtn.disabled = true;
      blowHint.style.opacity = '1';
    }
  }

  // Mic detection
  let micRequested = false;
  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let micSource = null;

  let blowScore = 0; // integrates "blow likelihood"
  let lastMicFrame = 0;

  async function requestMicOnce() {
    if (micRequested || candleOut) return;
    micRequested = true;

    // If browser doesn't support, quietly fail; fallback stays.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;

      micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(analyser);

      // Start sampling
      lastMicFrame = now();
      blowScore = 0;
    } catch {
      // Permission denied or unavailable; fallback stays.
      analyser = null;
      audioCtx = null;
      micStream = null;
      micSource = null;
    }
  }

  function stopMic() {
    try {
      if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
      }
    } catch {}
    micStream = null;

    try { micSource && micSource.disconnect(); } catch {}
    micSource = null;

    try { analyser && analyser.disconnect(); } catch {}
    analyser = null;

    try { audioCtx && audioCtx.close(); } catch {}
    audioCtx = null;
  }

  function sampleMicAndDetectBlow(t) {
    if (!analyser || candleOut) return;

    const dt = (t - lastMicFrame) / 1000;
    lastMicFrame = t;

    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);

    // RMS in [0..1] around 128
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);

    // Map rms to a probability-ish signal.
    // Typical quiet RMS ~0.01-0.03; blowing often higher.
    const threshold = 0.06;     // tuned for mobile; still works with AGC
    const strong = 0.12;
    const x = clamp((rms - threshold) / (strong - threshold), 0, 1);

    // Integrate with decay: require a short sustained burst.
    const rise = 3.0;           // score/sec when blowing
    const decay = 1.8;          // score/sec otherwise
    blowScore += (x > 0 ? rise * x : -decay) * dt;
    blowScore = clamp(blowScore, 0, 1.2);

    if (blowScore >= 1.0) {
      extinguishCandle('mic');
    }
  }

  function extinguishCandle(reason = 'fallback') {
    if (candleOut) return;
    setCandleOut(true);

    // Once out, we can stop mic to save battery.
    stopMic();

    // Add a tiny "smoke" puff via fireworks canvas (soft particles)
    fx.puffAtCenter();
  }

  // Double tap / click fallback
  let lastTap = 0;
  function onFlameTap() {
    const t = now();
    const delta = t - lastTap;
    lastTap = t;

    // On desktop: single click is enough; on touch: double-tap intended
    const isTouch = matchMedia('(pointer: coarse)').matches;
    if (!isTouch) {
      extinguishCandle('click');
      return;
    }
    if (delta < 320) {
      extinguishCandle('doubletap');
    }
  }

  function enterCandleScene() {
    // reflect persisted state
    setCandleOut(candleOut);

    // request mic on first entry to scene 2 (if not already out)
    requestMicOnce();
  }

  // Make candle/flame tappable without blocking canvas (they're in DOM)
  flameEl.addEventListener('click', onFlameTap, { passive: true });
  candleEl.addEventListener('click', onFlameTap, { passive: true });

  // --------------------------
  // Envelope (Scene 4)
  // --------------------------
  const envelopeBtn = $('#envelope');
  envelopeBtn.addEventListener('click', (e) => {
  // If it's already open and the user is interacting with the letter,
  // don't toggle it closed (prevents scroll attempts from closing it).
  if (envelopeBtn.classList.contains('open')) {
    const insideLetter = e.target && e.target.closest && e.target.closest('.letter');
    if (insideLetter) return;
  }
  envelopeBtn.classList.add('open'); // open only
});

  // --------------------------
  // Buttons
  // --------------------------
  $('#startBtn').addEventListener('click', () => {
    startMusic();
    setScene(1);
  });

  $('#openSurpriseBtn').addEventListener('click', () => {
    setScene(2);
  });

  continueBtn.addEventListener('click', () => {
    if (!candleOut) return;
    setScene(3);
  });

  $('#nextBtn').addEventListener('click', () => setScene(4));
  $('#restartBtn').addEventListener('click', () => {
    // Keep candle state "once per session" — if you want replay to reset,
    // clear sessionStorage here. Spec says once per session, so we keep it.
    setScene(0);
  });

  // --------------------------
  // Gift layer placeholder animation
  // (No external images. Uses CSS gradients.)
  // When you provide an external link later, you can replace this.
  // --------------------------
  const giftLayer = $('#giftLayer');
  let giftsEnabled = true;

  function makeGiftEl() {
    const el = document.createElement('div');
    el.className = 'gift';
    const size = Math.random() * 26 + 18;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${Math.random() * 100}%`;
    el.style.top = `${100 + Math.random() * 30}%`;
    el.style.opacity = `${0.18 + Math.random() * 0.20}`;

    const dur = 9 + Math.random() * 10;
    const drift = (Math.random() * 2 - 1) * 18;
    el.style.setProperty('--dur', `${dur}s`);
    el.style.setProperty('--drift', `${drift}px`);

    return el;
  }

  function initGiftFallback() {
    // Inject minimal CSS for gifts
    const css = document.createElement('style');
    css.textContent = `
      #giftLayer .gift{
        position:absolute;
        border-radius: 8px;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.28), transparent 45%),
          linear-gradient(135deg, rgba(255,63,180,0.85), rgba(138,63,252,0.85));
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 18px 50px rgba(0,0,0,0.35);
        transform: translate(-50%, 0);
        animation: floatGift var(--dur) linear infinite;
        filter: blur(0px);
      }
      #giftLayer .gift::before{
        content:"";
        position:absolute;
        inset: 0;
        border-radius: 8px;
        background:
          linear-gradient(90deg,
            transparent 0 42%,
            rgba(255,255,255,0.22) 42% 58%,
            transparent 58% 100%);
        opacity: 0.9;
      }
      #giftLayer .gift::after{
        content:"";
        position:absolute;
        left: 50%;
        top: -8px;
        transform: translateX(-50%);
        width: 46%;
        height: 14px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(77,124,255,0.75), rgba(255,63,180,0.55));
        border: 1px solid rgba(255,255,255,0.14);
        opacity: 0.9;
      }
      @keyframes floatGift{
        0%{ transform: translate(-50%, 0) translateX(0px); }
        100%{ transform: translate(-50%, -140vh) translateX(var(--drift)); }
      }
    `;
    document.head.appendChild(css);

    // Spawn a few gifts, keep it subtle
    for (let i = 0; i < 14; i++) {
      giftLayer.appendChild(makeGiftEl());
    }

    // Respawn on animation iteration by listening (cheap enough at this scale)
    giftLayer.addEventListener('animationiteration', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.classList.contains('gift')) return;

      el.style.left = `${Math.random() * 100}%`;
      el.style.opacity = `${0.16 + Math.random() * 0.22}`;
      el.style.setProperty('--drift', `${(Math.random() * 2 - 1) * 18}px`);
    });
  }

  // Hook to later replace with a provided link
  // Example usage later: attachGiftAnimationFromLink('https://...somefile...');
  function attachGiftAnimationFromLink(url) {
    giftsEnabled = false;
    giftLayer.innerHTML = '';
    // You can implement your link-based animation here once you provide it.
    // (Kept as a safe stub to avoid guessing the format: iframe/lottie/video/canvas/etc.)
    const note = document.createElement('div');
    note.style.cssText = 'position:absolute; inset:0; display:none;';
    note.dataset.giftUrl = url;
    giftLayer.appendChild(note);
  }
  window.attachGiftAnimationFromLink = attachGiftAnimationFromLink;

  initGiftFallback();

  // --------------------------
  // Fireworks + Stars (single canvas)
  // --------------------------
  const canvas = $('#fxCanvas');
  const ctx = canvas.getContext('2d', { alpha: true });

  const fx = (() => {
    let w = 0, h = 0, dpr = 1;
    let last = now();

    // Stars
    const stars = [];
    const STAR_COUNT_BASE = 140;

    // Fireworks particles
    const rockets = [];
    const particles = [];
    const smokes = [];

    // Intensity controls spawn rate
    let intensity = 0.05;
    let spawnAcc = 0;

    // Theme colors
    const palette = [
      { r: 170, g: 110, b: 255 }, // violet
      { r: 110, g: 160, b: 255 }, // blue
      { r: 255, g: 110, b: 220 }, // pink
      { r: 235, g: 235, b: 255 }, // white-ish
    ];

    function resize() {
      dpr = Math.max(1, Math.min(2.25, window.devicePixelRatio || 1));
      w = Math.floor(window.innerWidth * dpr);
      h = Math.floor(window.innerHeight * dpr);
      canvas.width = w;
      canvas.height = h;

      // Rebuild stars (keep it stable-ish)
      stars.length = 0;
      const count = Math.floor(STAR_COUNT_BASE * (w * h) / (900 * 700));
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          z: Math.random() * 1, // depth factor
          r: (Math.random() * 1.2 + 0.25) * dpr,
          tw: Math.random() * Math.PI * 2,
          tws: 0.7 + Math.random() * 1.8,
          a: 0.15 + Math.random() * 0.55,
        });
      }
    }

    function setIntensity(v) {
      intensity = clamp(v, 0, 1);
    }

    function launchRocket() {
      // Launch from random x, bottom-ish. Give slight 3D-ish effect via z scaling.
      const x = (Math.random() * 0.9 + 0.05) * w;
      const y = h + 10 * dpr;
      const z = 0.35 + Math.random() * 0.65; // "depth": smaller bursts further away

      const speed = (6.2 + Math.random() * 2.6) * dpr * (0.85 + 0.35 * (1 - z));
      const vx = (Math.random() * 2 - 1) * 0.6 * dpr;
      const vy = -speed;

      const targetY = (Math.random() * 0.45 + 0.12) * h;
      const color = palette[(Math.random() * palette.length) | 0];

      rockets.push({
        x, y, z,
        vx, vy,
        targetY,
        life: 0,
        color,
        trail: [],
      });
    }

    function burst(x, y, z, baseColor) {
      const count = Math.floor(70 + Math.random() * 60);
      const spread = 2.2 + Math.random() * 1.8;
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const mag = (Math.random() ** 0.45) * spread * dpr * (0.55 + 0.75 * z);
        const hueShift = (Math.random() * 0.24 - 0.12);

        const col = (Math.random() < 0.7) ? baseColor : palette[(Math.random() * palette.length) | 0];

        particles.push({
          x, y, z,
          vx: Math.cos(ang) * mag,
          vy: Math.sin(ang) * mag,
          drag: 0.985 - Math.random() * 0.01,
          g: (0.045 + Math.random() * 0.035) * dpr,
          life: 0,
          maxLife: (42 + Math.random() * 28) * (0.9 + 0.6 * z),
          r: (1.1 + Math.random() * 1.8) * dpr * (0.75 + 0.85 * z),
          col,
          hueShift,
          sparkle: Math.random() < 0.16,
          trail: [],
        });
      }

      // Soft smoke bloom
      smokes.push({
        x, y, z,
        r: (22 + Math.random() * 18) * dpr * (0.7 + 0.8 * z),
        a: 0.14,
        life: 0,
        maxLife: 56 + Math.random() * 30
      });
    }

    function puffAtCenter() {
      const x = w * 0.5 + (Math.random() * 2 - 1) * 18 * dpr;
      const y = h * 0.5 + 60 * dpr;
      smokes.push({
        x, y, z: 0.65,
        r: 26 * dpr,
        a: 0.18,
        life: 0,
        maxLife: 70
      });
    }

    function drawStars(t) {
      // Draw a subtle star layer each frame
      // (We redraw because canvas is cleared for fireworks trails.)
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(s.tw + t * 0.001 * s.tws);
        const alpha = s.a * tw;

        ctx.beginPath();
        ctx.fillStyle = `rgba(220,230,255,${alpha})`;
        ctx.arc(s.x, s.y, s.r * (0.85 + 0.35 * s.z), 0, Math.PI * 2);
        ctx.fill();

        // tiny cross sparkle occasionally
        if (tw > 0.92 && s.z > 0.7) {
          ctx.globalAlpha = alpha * 0.55;
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 0.8 * dpr;
          ctx.beginPath();
          ctx.moveTo(s.x - 3.2 * dpr, s.y);
          ctx.lineTo(s.x + 3.2 * dpr, s.y);
          ctx.moveTo(s.x, s.y - 3.2 * dpr);
          ctx.lineTo(s.x, s.y + 3.2 * dpr);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    }

    function tick(t) {
      const dt = clamp((t - last) / 16.6667, 0.2, 2.2);
      last = t;

      // Clear with a little alpha for trails
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(5, 3, 12, ${0.18})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      drawStars(t);

      // Spawn rockets based on intensity
      spawnAcc += dt * (0.015 + 0.055 * intensity);
      while (spawnAcc > 1) {
        spawnAcc -= 1;
        if (intensity > 0.08) launchRocket();
      }

      // Update rockets
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.life += dt;

        // Trail points
        r.trail.push({ x: r.x, y: r.y });
        if (r.trail.length > 14) r.trail.shift();

        r.x += r.vx * dt;
        r.y += r.vy * dt;

        // Slight drag, slight sway
        r.vx *= 0.995;
        r.vy *= 0.998;
        r.vx += Math.sin((t * 0.001) + r.life) * 0.01 * dpr;

        const reached = r.y <= r.targetY;
        const timed = r.life > 70;
        if (reached || timed) {
          burst(r.x, r.y, r.z, r.color);
          rockets.splice(i, 1);
        }
      }

      // Update particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;

        // Trail
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 10) p.trail.shift();

        p.vx *= p.drag;
        p.vy *= p.drag;
        p.vy += p.g * dt;

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (p.life > p.maxLife) {
          particles.splice(i, 1);
        }
      }

      // Update smokes
      for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i];
        s.life += dt;
        if (s.life > s.maxLife) {
          smokes.splice(i, 1);
        }
      }

      // Draw rockets, particles, smokes with additive blending
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // Rockets
      for (const r of rockets) {
        // Trail
        for (let i = 0; i < r.trail.length - 1; i++) {
          const a = i / r.trail.length;
          ctx.strokeStyle = `rgba(${r.color.r},${r.color.g},${r.color.b},${0.08 + a * 0.14})`;
          ctx.lineWidth = (1.2 + a * 1.8) * dpr * (0.7 + 0.8 * r.z);
          ctx.beginPath();
          ctx.moveTo(r.trail[i].x, r.trail[i].y);
          ctx.lineTo(r.trail[i + 1].x, r.trail[i + 1].y);
          ctx.stroke();
        }

        // Head glow
        const glow = 10 * dpr * (0.7 + 0.9 * r.z);
        const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, glow);
        g.addColorStop(0, `rgba(${r.color.r},${r.color.g},${r.color.b},0.60)`);
        g.addColorStop(1, `rgba(${r.color.r},${r.color.g},${r.color.b},0.00)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r.x, r.y, glow, 0, Math.PI * 2);
        ctx.fill();
      }

      // Particles
      for (const p of particles) {
        const life01 = clamp(p.life / p.maxLife, 0, 1);
        const fade = 1 - life01;

        // Trail
        for (let i = 0; i < p.trail.length - 1; i++) {
          const a = i / p.trail.length;
          const alpha = (0.06 + a * 0.10) * fade;
          ctx.strokeStyle = `rgba(${p.col.r},${p.col.g},${p.col.b},${alpha})`;
          ctx.lineWidth = (0.8 + a * 1.2) * dpr * (0.65 + 0.9 * p.z);
          ctx.beginPath();
          ctx.moveTo(p.trail[i].x, p.trail[i].y);
          ctx.lineTo(p.trail[i + 1].x, p.trail[i + 1].y);
          ctx.stroke();
        }

        // Sparkle flicker
        const flick = p.sparkle ? (0.65 + 0.35 * Math.sin((t * 0.02) + p.life)) : 1.0;
        const alpha = (0.22 + 0.45 * fade) * flick;

        ctx.fillStyle = `rgba(${p.col.r},${p.col.g},${p.col.b},${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.7 + 0.6 * fade), 0, Math.PI * 2);
        ctx.fill();

        // Outer glow
        const glowR = p.r * (3.2 + 3.2 * fade);
        const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        gg.addColorStop(0, `rgba(${p.col.r},${p.col.g},${p.col.b},${0.16 * fade})`);
        gg.addColorStop(1, `rgba(${p.col.r},${p.col.g},${p.col.b},0)`);
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Smoke (source-over-ish but still soft; keep lighter for dreamy feel)
      for (const s of smokes) {
        const life01 = clamp(s.life / s.maxLife, 0, 1);
        const fade = 1 - life01;
        const radius = s.r * (0.7 + 1.25 * life01);

        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius);
        g.addColorStop(0, `rgba(220,220,255,${s.a * fade})`);
        g.addColorStop(1, `rgba(220,220,255,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Mic sampling while in candle scene
      if (sceneIndex === 2 && !candleOut) {
        sampleMicAndDetectBlow(t);
      }

      requestAnimationFrame(tick);
    }

    // Public API
    return { resize, tick, setIntensity, puffAtCenter };
  })();

  // Start FX loop
  function boot() {
    fx.resize();
    // Initial clear
    ctx.fillStyle = 'rgba(5, 3, 12, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    requestAnimationFrame(fx.tick);
  }

  window.addEventListener('resize', () => fx.resize(), { passive: true });

  // Start on scene 0
  setScene(0);
  // If candle already out this session, reflect immediately if user jumps quickly
  setCandleOut(candleOut);

  boot();
})();