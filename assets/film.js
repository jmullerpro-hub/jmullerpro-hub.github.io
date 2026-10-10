/* SnowLine — film de motion design en code (Canvas 2D).
   Une seule horloge (la musique, ou le temps réel si le son est coupé) pilote toutes les scènes.
   Les coupes tombent sur les mesures du morceau : 126 BPM, première mesure à 0,16 s, « drop » à 11,59 s. */
(function () {
  "use strict";
  const TOTAL = 51.134, T0 = 0.16, BEAT = 60 / 126, BAR = BEAT * 4, bar = n => T0 + n * BAR;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const eOutExpo = x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  const eOutCubic = x => 1 - Math.pow(1 - x, 3);
  const eInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const eOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const ramp = (u, s, l) => clamp((u - s) / l);
  const frac = x => x - Math.floor(x);
  const rgb = (r, g, b, a = 1) => `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;
  const nv = a => rgb(0.016, 0.039, 0.078, a);
  const STOPS = [[0.176, 0.482, 1], [0.18, 0.77, 1], [1, 0.82, 0.25], [1, 0.3, 0.24]];
  function speedColor(p, a = 1) {
    const q = clamp(p) * 3, i = Math.min(Math.floor(q), 2), f = q - i, c0 = STOPS[i], c1 = STOPS[i + 1];
    return rgb(c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f, a);
  }
  const SERIF = "ui-serif,'New York','Iowan Old Style','Palatino Linotype',Georgia,serif";
  const SANS = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif";

  /* ───── textes ───── */
  const TXT = {
    fr: {
      scenes: [
        { tag: "Replay 3D", title: "Revis chaque descente sur le vrai relief.", it: 5, chips: ["Vue Poursuite", "Maquette 3D en AR"] },
        { tag: "Carte", title: "Ta vitesse, tracée sur la montagne.", it: 3, chips: ["Du bleu au rouge", "Hors connexion"] },
        { tag: "Écran verrouillé · Apple Watch", title: "Sans sortir le téléphone.", it: 1, chips: ["Dynamic Island", "Cadran Apple Watch"] },
        { tag: "Sécurité", title: "Une chute ? SnowLine s'en rend compte.", it: 4, chips: ["Détection d'impact", "Secours en un geste"] },
        { tag: "Groupes", title: "Défie tes amis.", it: 1, chips: ["Classement en direct", "Vitesse · Dénivelé · Descentes"] },
        { tag: "Partage", title: "Ta plus belle descente, en story.", it: 4, chips: ["Story Instagram", "20 s sur le vrai relief"] },
        { tag: "Découvrir", title: "Les stations du monde entier.", it: 1, chips: ["Pistes et remontées", "Même depuis ton canapé"] }],
      intro: "Ta journée de ski, comme tu ne l'as jamais vue.", introIt: 7, introTag: "Ski tracker & GPS",
      traceTag: "Chaque virage, tracé", traceSub: "2,5 km  ·  832 m de dénivélé",
      dashTag: "Tableau de bord", dash: "Tout ton ski en un coup d'œil.", dashIt: 3, dashChips: ["Vitesse max", "Dénivelé", "Météo"],
      finale: "Gratuit. Sans compte. Sans pub.", finaleIt: 3, stats: ["compte à créer", "pub ni pisteur", "langues", "pays"],
      tagline: "Ton ski, comme jamais", badge: "Gratuit sur l'App Store" },
    en: {
      scenes: [
        { tag: "3D replay", title: "Relive every run on real terrain.", it: 5, chips: ["Chase view", "3D model in AR"] },
        { tag: "Map", title: "Your speed, drawn on the mountain.", it: 3, chips: ["Blue to red", "Works offline"] },
        { tag: "Lock Screen · Apple Watch", title: "No need to take your phone out.", it: 5, chips: ["Dynamic Island", "Apple Watch dial"] },
        { tag: "Safety", title: "A fall? SnowLine notices.", it: 3, chips: ["Impact detection", "One tap to call for help"] },
        { tag: "Groups", title: "Challenge your friends.", it: 1, chips: ["Live leaderboard", "Speed · Vertical · Runs"] },
        { tag: "Sharing", title: "Your best run, in a story.", it: 4, chips: ["Instagram Story", "20 s on real terrain"] },
        { tag: "Discover", title: "Ski areas worldwide.", it: 1, chips: ["Runs and lifts", "Even from your couch"] }],
      intro: "Your ski day, like you've never seen it.", introIt: 5, introTag: "Ski tracker & GPS",
      traceTag: "Every turn, drawn", traceSub: "2.5 km  ·  832 m vertical",
      dashTag: "Dashboard", dash: "Your whole day at a glance.", dashIt: 4, dashChips: ["Top speed", "Vertical", "Weather"],
      finale: "Free. No account. No ads.", finaleIt: 3, stats: ["account to create", "ads or trackers", "languages", "countries"],
      tagline: "Your ski, like never before", badge: "Free on the App Store" },
  };

  /* ───── état ───── */
  let canvas, ctx, off, offCtx, audio, hostEl;
  let W = 1080, H = 1920, PORTRAIT = true, DPR = 1;
  let lang = "fr", t = 0, playing = false, soundOn = false, inView = false, running = false, ready = false, loading = false;
  let lastNow = 0, reduce = false, chapterCb = null;
  const IMG = {};
  const BASE = "assets/";

  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function loadAll() {
    if (ready || loading) return; loading = true;
    const list = {};
    for (let n = 1; n <= 7; n++) list["m" + n] = BASE + "m0" + n + ".webp";
    list.hero = BASE + "hero.webp"; list.icon = BASE + "icon.png";
    ["dashboard", "model3d", "speedmap", "lock", "fall", "groups", "share", "discover", "watch"].forEach(k => { list[k + "-fr"] = BASE + k + "-fr.webp"; list[k + "-en"] = BASE + k + "-en.webp"; });
    await Promise.all(Object.entries(list).map(([k, v]) => loadImg(v).then(i => (IMG[k] = i))));
    ready = true; loading = false;
  }
  const shot = k => IMG[k + "-" + lang];

  /* ───── primitives ───── */
  function rr(x, y, w, h, r) {
    ctx.beginPath(); r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function coverRect(im, box, zoom, ax, ay, dx, dy) {
    const s = Math.max(box.w / im.width, box.h / im.height) * zoom, w = im.width * s, h = im.height * s;
    return { x: box.x + (box.w - w) * ax + dx, y: box.y + (box.h - h) * ay + dy, w, h };
  }
  function cover(im, box, zoom, ax = 0.5, ay = 0.5, dx = 0, dy = 0, alpha = 1) {
    const r = coverRect(im, box, zoom, ax, ay, dx, dy);
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip(); ctx.globalAlpha = alpha;
    ctx.drawImage(im, r.x, r.y, r.w, r.h); ctx.restore(); return r;
  }
  function lin(x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(s => g.addColorStop(s[0], s[1])); return g; }
  function glow(cx, cy, r, color) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, color); g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  const setFont = (size, weight = 400, italic = false, fam = SERIF) => { ctx.font = `${italic ? "italic " : ""}${weight} ${size}px ${fam}`; };
  function spaced(px) { if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px"; }
  function text(s, x, y, o = {}) {
    ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    setFont(o.size || 40, o.weight || 400, o.italic, o.sans ? SANS : SERIF); spaced(o.kern || 0);
    ctx.fillStyle = o.color || "rgb(245,250,255)"; ctx.textBaseline = "alphabetic"; ctx.textAlign = o.align || "left";
    ctx.fillText(s, x, y); ctx.restore();
  }
  function measure(s, size, weight, italic, sans, kern) { ctx.save(); setFont(size, weight, italic, sans ? SANS : SERIF); spaced(kern || 0); const w = ctx.measureText(s).width; ctx.restore(); return w; }
  function caps(s, x, y, o = {}) {
    const size = o.size || 26, kern = size * 0.2, str = s.toUpperCase();
    const w = measure(str, size, 600, false, true, kern);
    text(str, o.center ? x - w / 2 : x, y + size * 0.8, { size, weight: 600, sans: true, kern, color: o.color || "rgb(76,201,255)", alpha: o.alpha });
  }
  /* titre en serif : mots révélés un à un derrière un masque */
  function titleLayout(str, size, maxW) {
    const words = str.split(" "), space = measure(" ", size, 400, false, false, -size * 0.02);
    const lines = [[]], lw = [0];
    words.forEach((w, i) => {
      const ww = measure(w, size, 400, false, false, -size * 0.02), L = lines.length - 1, add = lines[L].length ? ww + space : ww;
      if (lw[L] + add > maxW && lines[L].length) { lines.push([i]); lw.push(ww); } else { lines[L].push(i); lw[L] += add; }
    });
    return { words, lines, lw, space };
  }
  function revealTitle(str, it, size, x, top, maxW, p, o = {}) {
    const lay = titleLayout(str, size, maxW), lh = size * (o.leading || 1.02), st = 0.11, n = lay.words.length, kern = -size * 0.02;
    lay.lines.forEach((line, li) => {
      let cx = o.center ? x - lay.lw[li] / 2 : x; const y = top + li * lh;
      line.forEach(i => {
        const q = clamp(p * (1 + (n - 1) * st) - i * st), e = eOutExpo(q);
        ctx.save(); ctx.beginPath(); ctx.rect(0, y - size * 0.1, W, lh + size * 0.14); ctx.clip();
        text(lay.words[i], cx, y + size * 0.82 + (1 - e) * lh * 0.95, { size, italic: i >= it, kern, alpha: Math.min(1, e * 1.6), color: o.color });
        ctx.restore();
        cx += measure(lay.words[i], size, 400, i >= it, false, kern) + lay.space;
      });
    });
    return top + lay.lines.length * lh;
  }
  /* pastille « verre » ; retourne sa largeur */
  function chip(s, x, y, p, size = 33) {
    const kern = 0.2, tw = measure(s, size, 600, false, true, kern), padX = size * 0.9, h = size * 2.3, w = tw + padX * 2 + size, full = w;
    if (p <= 0) return full;
    const e = eOutBack(p), al = Math.min(1, p * 2.2);
    ctx.save(); ctx.translate(x, y + h / 2); ctx.scale(0.7 + 0.3 * e, 0.7 + 0.3 * e); ctx.translate(0, -h / 2); ctx.globalAlpha = al;
    rr(0, 0, w, h, h / 2); ctx.fillStyle = nv(0.72); ctx.fill();
    ctx.strokeStyle = "rgba(150,205,255,.38)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(padX - 2, h / 2, size * 0.2, 0, 6.283); ctx.fillStyle = speedColor(0.35); ctx.fill();
    text(s, padX + size * 0.55, h / 2 + size * 0.34, { size, weight: 600, sans: true, kern });
    ctx.restore(); return full;
  }
  /* téléphone : cadre, reflet, écran arrondi */
  function phone(im, cx, cy, w, rot = 0, alpha = 1, withGlow = true) {
    const h = (w * 1347) / 620, rad = w * 0.158;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    if (withGlow) glow(0, 0, w * 1.15, rgb(0.17, 0.55, 1, 0.3 * alpha));
    ctx.globalAlpha = alpha;
    const sh = ctx.createRadialGradient(0, h * 0.5, 0, 0, h * 0.5, w * 0.75); sh.addColorStop(0, "rgba(0,0,0,.5)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh; ctx.fillRect(-w, h * 0.5 - w * 0.4, w * 2, w * 0.8);
    rr(-w / 2, -h / 2, w, h, rad); ctx.fillStyle = "rgb(4,7,12)"; ctx.fill();
    rr(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, rad - 1); ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = 2; ctx.stroke();
    const b = w * 0.021; rr(-w / 2 + b, -h / 2 + b, w - 2 * b, h - 2 * b, rad - b); ctx.clip();
    ctx.drawImage(im, -w / 2 + b, -h / 2 + b, w - 2 * b, h - 2 * b);
    ctx.restore();
  }
  function watchView(cx, cy, w, rot, alpha) {
    const h = w * 1.2, rad = w * 0.3, im = IMG["watch-" + lang];
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.globalAlpha = alpha;
    const sh = ctx.createRadialGradient(0, h * 0.5, 0, 0, h * 0.5, w * 0.8); sh.addColorStop(0, "rgba(0,0,0,.55)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh; ctx.fillRect(-w, h * 0.5 - w * 0.4, w * 2, w * 0.8);
    rr(-w / 2, -h / 2, w, h, rad); ctx.fillStyle = "rgb(4,7,12)"; ctx.fill();
    rr(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, rad - 1); ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = 2; ctx.stroke();
    const b = w * 0.05, iw = w - 2 * b, ih = h - 2 * b; rr(-iw / 2, -ih / 2, iw, ih, rad - b); ctx.clip();
    const s = Math.max(iw / im.width, ih / im.height); ctx.drawImage(im, -im.width * s / 2, -im.height * s / 2, im.width * s, im.height * s);
    ctx.restore();
  }
  const beat = tt => Math.exp(-Math.max(0, ((tt - T0) / BEAT) % 1) * 6);
  function snow(tt, count = 70) {
    const sc = PORTRAIT ? 1 : 0.8;
    for (let i = 0; i < count; i++) {
      const depth = frac(i * 0.6180339), size = (2 + depth * 6.5) * sc, speed = 30 + depth * 120;
      const x = frac(Math.sin(i * 12.9898) * 43758.5453) * W + Math.sin(tt * (0.5 + depth) + i) * (20 + depth * 40);
      const y = (frac(Math.sin(i * 78.233) * 12345.6789) * H + tt * speed) % H;
      ctx.fillStyle = rgb(0.93, 0.97, 1, 0.18 + 0.5 * depth); ctx.fillRect(x, y, size, size);
    }
  }

  /* ───── décor ───── */
  function backdrop(idx, u, dur, tt, o = {}) {
    const k = eInOut(clamp(u / dur)), z = (o.z0 || 1.14) + ((o.z1 || 1.02) - (o.z0 || 1.14)) * k + 0.006 * beat(tt);
    if (PORTRAIT) {
      const r = cover(IMG["m" + idx], { x: 0, y: 0, w: W, h: H }, z, 0.5, o.ay == null ? 0.35 : o.ay, 0, -18 * (k - 0.5));
      ctx.fillStyle = nv(o.dim == null ? 0.22 : o.dim); ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = lin(0, 0, 0, H, [[0, nv(0.8)], [0.38, nv(0)]]); ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = lin(0, 0, 0, H, [[0.55, nv(0)], [1, nv(0.78)]]); ctx.fillRect(0, 0, W, H);
      return r;
    }
    // paysage : fond bleu nuit de l'app + photo verticale en panneau, comme dans le récit du site
    ctx.fillStyle = lin(0, 0, 0, H, [[0, "#071528"], [1, "#040a14"]]); ctx.fillRect(0, 0, W, H);
    glow(W * 0.72, H * 0.55, H * 0.95, rgb(0.05, 0.23, 0.39, 0.9));
    const ph = H * 0.9, pw = ph * 853 / 1844, px = W * 0.72 - pw * 0.5 + pw * 0.26, py = (H - ph) / 2;
    const box = { x: px, y: py, w: pw, h: ph };
    const r = cover(IMG["m" + idx], box, z, 0.5, 0.5, 0, -14 * (k - 0.5));
    ctx.fillStyle = lin(0, py, 0, py + ph, [[0, nv(0.4)], [0.4, nv(0)], [1, nv(0.4)]]); ctx.fillRect(px, py, pw, ph);
    return box;
  }
  function hud(tt, chapter, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha;
    const m = PORTRAIT ? 64 : W * 0.07, p = clamp(tt / TOTAL);
    ctx.fillStyle = "rgba(255,255,255,.16)"; ctx.fillRect(m, 30, W - 2 * m, 3);
    ctx.fillStyle = lin(m, 0, W - m, 0, [[0, speedColor(0)], [0.34, speedColor(0.34)], [0.68, speedColor(0.68)], [1, speedColor(1)]]);
    ctx.fillRect(m, 28, (W - 2 * m) * p, 7);
    ctx.restore();
    text("SnowLine", m, 66 + 38 * 0.8 - 20, { size: 38, weight: 600, kern: -0.8, alpha });
    if (chapter) text(String(chapter).padStart(2, "0") + " / 07", W - m, 90, { size: 32, align: "right", color: "rgb(188,208,237)", alpha });
  }

  /* ───── mise en page selon l'orientation ───── */
  function L() {
    if (PORTRAIT) return { x: 64, tag: 150, titleTop: 232, titleSize: 92, titleW: W - 128, pw: 640, pcx: W / 2 + 20, pcy: 1290, chipsRow: true };
    return { x: W * 0.07, tag: H * 0.2, titleTop: H * 0.27, titleSize: 84, titleW: W * 0.4, pw: H * 0.86 * 620 / 1347, pcx: W * 0.72 - H * 0.06, pcy: H * 0.5, chipsRow: false };
  }

  /* ───── scènes ───── */
  function sceneFeature(idx, bgIdx, u, dur, tt, screenKey, extra) {
    const S = TXT[lang].scenes[idx], l = L();
    backdrop(bgIdx, u, dur, tt); snow(tt);
    caps(S.tag, l.x, l.tag, { alpha: eOutCubic(ramp(u, 0.15, 0.5)) });
    ctx.save(); ctx.beginPath(); ctx.rect(l.x, l.tag + 46, 150 * eOutExpo(ramp(u, 0.25, 0.7)), 4); ctx.clip();
    ctx.fillStyle = lin(l.x, 0, l.x + 150, 0, [[0, speedColor(0)], [0.5, speedColor(0.5)], [1, speedColor(1)]]); ctx.fillRect(l.x, l.tag + 46, 150, 4); ctx.restore();
    const bottom = revealTitle(S.title, S.it, l.titleSize, l.x, l.titleTop, l.titleW, ramp(u, 0.2, 1.1));
    const enter = eOutExpo(ramp(u, 0.1, 1.0)), exit = eInOut(ramp(u, dur - 0.45, 0.45));
    const cy = l.pcy + (1 - enter) * (PORTRAIT ? 900 : 700) - exit * 60 + Math.sin(u * 1.7) * 8;
    const rot = (1 - enter) * 0.1 - 0.012 + Math.sin(u * 1.1) * 0.006;
    phone(IMG[screenKey + "-" + lang], l.pcx, cy, l.pw, rot, 1 - exit * 0.5);
    if (extra) extra(u, l.pcx, cy, l);
    let cx0 = l.x, cy0 = bottom + 26;
    S.chips.forEach((c, i) => {
      const p = ramp(u, 0.9 + i * 0.3, 0.55), w = chip(c, cx0, cy0, p);
      if (PORTRAIT) cx0 += w + 16; else cy0 += 100;
    });
  }
  function extraWatch(u, pcx, pcy, l) {
    const e = eOutBack(ramp(u, 0.9, 0.8)), w = l.pw * 0.38;
    watchView(pcx + l.pw * 0.40, pcy + l.pw * 0.62 - (1 - e) * 120, w, 0.1 - (1 - e) * 0.2, Math.min(1, e * 2));
  }
  function sceneIntro(u, dur, tt) {
    if (PORTRAIT) backdrop(7, u, dur, tt, { z0: 1.32, z1: 1.06, ay: 0.62, dim: 0.1 });
    else {
      const k = eInOut(clamp(u / dur)); cover(IMG.hero, { x: 0, y: 0, w: W, h: H }, 1.18 - 0.14 * k + 0.004 * beat(tt), 0.5, 0.62);
      ctx.fillStyle = lin(0, 0, W, 0, [[0, nv(0.7)], [0.55, nv(0.12)], [1, nv(0)]]); ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = lin(0, 0, 0, H, [[0, nv(0.55)], [0.3, nv(0)], [0.75, nv(0)], [1, nv(0.7)]]); ctx.fillRect(0, 0, W, H);
    }
    snow(tt, 90);
    const T = TXT[lang];
    if (PORTRAIT) {
      caps(T.introTag, W / 2, 640, { center: true, alpha: eOutCubic(ramp(u, 0.5, 0.7)) });
      revealTitle(T.intro, T.introIt, 112, W / 2, 700, W - 150, ramp(u, 0.45, 1.9), { center: true, leading: 1.0 });
    } else {
      caps(T.introTag, W * 0.07, H * 0.34, { alpha: eOutCubic(ramp(u, 0.5, 0.7)) });
      revealTitle(T.intro, T.introIt, 104, W * 0.07, H * 0.4, W * 0.5, ramp(u, 0.45, 1.9), { leading: 1.0 });
    }
    ctx.fillStyle = `rgba(0,0,0,${1 - eOutCubic(clamp(tt / 0.9))})`; ctx.fillRect(0, 0, W, H);
  }
  const PATH = [[0.69, 0.575], [0.69, 0.625], [0.68, 0.685], [0.74, 0.735], [0.8, 0.785], [0.8, 0.845], [0.72, 0.915], [0.6, 0.975], [0.52, 1.03]];
  function catmull(p, n) {
    const out = [];
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)];
      for (let s = 0; s < n; s++) {
        const t = s / n, t2 = t * t, t3 = t2 * t, c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
        out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(p[p.length - 1]); return out;
  }
  const TRACE = catmull(PATH, 24);
  const speedProfile = p => Math.pow(Math.sin(Math.min(p / 0.72, 1) * Math.PI / 2), 1.15) * (1 - 0.22 * clamp((p - 0.72) / 0.28));
  function drawTabular(str, x, y, size, color) {
    const cell = measure("0", size, 400, false, false, 0) + 2;
    for (let i = 0; i < str.length; i++) text(str[i], x + i * cell, y, { size, color, kern: 0 });
    return cell * str.length;
  }
  function sceneTrace(u, dur, tt) {
    const T = TXT[lang], k = eInOut(clamp(u / dur)), z = 1 + 0.22 * (1 - k) + 0.006 * beat(tt);
    let r;
    if (PORTRAIT) {
      r = cover(IMG.m2, { x: 0, y: 0, w: W, h: H }, z, 0.5, 1, 0, -30 * k);
      ctx.fillStyle = nv(0.12); ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = lin(0, 0, 0, H, [[0, nv(0.86)], [0.45, nv(0)]]); ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = lin(0, 0, 0, H, [[0.7, nv(0)], [1, nv(0.7)]]); ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = lin(0, 0, 0, H, [[0, "#071528"], [1, "#040a14"]]); ctx.fillRect(0, 0, W, H);
      const ph = H * 0.9, pw = ph * 853 / 1844, px = W * 0.66 - pw / 2, box = { x: px, y: (H - ph) / 2, w: pw, h: ph };
      glow(W * 0.66, H * 0.55, H * 0.9, rgb(0.05, 0.23, 0.39, 0.9));
      r = cover(IMG.m2, box, z, 0.5, 1, 0, -20 * k);
      ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip(); ctx.restore();
    }
    const pt = q => [r.x + q[0] * r.w, r.y + q[1] * r.h];
    const prog = eInOut(ramp(u, 0.55, dur - 1.2)), n = TRACE.length, head = Math.floor((n - 1) * prog);
    ctx.save();
    if (!PORTRAIT) { const ph = H * 0.9, pw = ph * 853 / 1844; ctx.beginPath(); ctx.rect(W * 0.66 - pw / 2, (H - ph) / 2, pw, ph); ctx.clip(); }
    if (head > 1) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i <= head; i++) {
        const a = pt(TRACE[i - 1]), b = pt(TRACE[i]), c = speedColor(speedProfile(i / (n - 1)), pass === 0 ? 0.28 : 1);
        ctx.strokeStyle = c; ctx.lineWidth = pass === 0 ? 44 : 14 + 6 * (i / n);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      const h = pt(TRACE[head]); glow(h[0], h[1], 90, "rgba(255,255,255,.55)");
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(h[0], h[1], 16, 0, 6.283); ctx.fill();
    }
    ctx.restore();
    const lx = PORTRAIT ? 64 : W * 0.07, ly = PORTRAIT ? 150 : H * 0.22, v = Math.round(84 * speedProfile(prog));
    caps(T.traceTag, lx, ly, { alpha: eOutCubic(ramp(u, 0.15, 0.5)) });
    const size = PORTRAIT ? 250 : 300, a = eOutCubic(ramp(u, 0.2, 0.6));
    ctx.save(); ctx.globalAlpha = a; const wdt = drawTabular(String(v), lx - 6, ly + (PORTRAIT ? 300 : 340), size, "rgb(245,250,255)"); ctx.restore();
    text("km/h", lx + wdt + 18, ly + (PORTRAIT ? 300 : 340), { size: 46, sans: true, weight: 500, kern: 2, color: "rgb(188,214,242)", alpha: eOutCubic(ramp(u, 0.35, 0.6)) });
    text(T.traceSub, lx, ly + (PORTRAIT ? 380 : 420), { size: 36, sans: true, weight: 400, kern: 0.5, color: "rgb(204,224,247)", alpha: eOutCubic(ramp(u, 0.6, 0.6)) });
    snow(tt, 50);
  }
  function sceneDash(u, dur, tt) {
    const T = TXT[lang], l = L();
    backdrop(1, u, dur, tt, { z0: 1.05, z1: 1.22, ay: 0.7, dim: 0.3 }); snow(tt);
    caps(T.dashTag, l.x, l.tag, { alpha: eOutCubic(ramp(u, 0.15, 0.5)) });
    const bottom = revealTitle(T.dash, T.dashIt, l.titleSize, l.x, l.titleTop, l.titleW, ramp(u, 0.2, 1.1));
    const enter = eOutExpo(ramp(u, 0, 1.1)), r2 = eInOut(ramp(u, 1.2, dur - 1.2));
    const cy = l.pcy + (1 - enter) * 1000 - r2 * 30;
    phone(IMG["dashboard-" + lang], l.pcx, cy, l.pw * (1 + 0.1 * r2), (1 - enter) * -0.12 + Math.sin(u * 1.5) * 0.006);
    let cx0 = l.x, cy0 = bottom + 26;
    T.dashChips.forEach((c, i) => { const w = chip(c, cx0, cy0, ramp(u, 0.9 + i * 0.25, 0.5)); if (PORTRAIT) cx0 += w + 16; else cy0 += 100; });
  }
  function sceneFinale(u, dur, tt) {
    const T = TXT[lang];
    backdrop(5, u, dur, tt, { z0: 1.1, z1: 1.0, ay: 0.5, dim: 0.36 }); snow(tt);
    const shots = [["speedmap", -1, -0.1], ["dashboard", 0, 0], ["model3d", 1, 0.1]];
    if (PORTRAIT) revealTitle(T.finale, T.finaleIt, 100, W / 2, 170, W - 130, ramp(u, 0.2, 1.2), { center: true });
    else revealTitle(T.finale, T.finaleIt, 84, W / 2, H * 0.07, W * 0.8, ramp(u, 0.2, 1.2), { center: true });
    const pwSide = PORTRAIT ? 400 : H * 0.34, pwMid = PORTRAIT ? 470 : H * 0.4, gap = PORTRAIT ? 300 : H * 0.32;
    const baseY = PORTRAIT ? 1010 : H * 0.5;
    shots.forEach((s, i) => {
      const e = eOutExpo(ramp(u, 0.2 + i * 0.18, 1)), drift = Math.sin(u * 1.2 + i) * 8;
      phone(IMG[s[0] + "-" + lang], W / 2 + s[1] * gap * (0.55 + 0.45 * e), baseY + (i === 1 ? 0 : (PORTRAIT ? 60 : 30)) + (1 - e) * 900 + drift, i === 1 ? pwMid : pwSide, s[2] * e, 1, i === 1);
    });
    const nums = [0, 0, 7, 174], mx = PORTRAIT ? 64 : W * 0.1, colW = (W - 2 * mx) / 4, y0 = PORTRAIT ? 1620 : H * 0.84;
    nums.forEach((nn, i) => {
      const p = ramp(u, 1.4 + i * 0.25, 1.4), al = eOutCubic(ramp(u, 1.3 + i * 0.25, 0.5)), x = mx + colW * i;
      ctx.fillStyle = `rgba(255,255,255,${0.22 * al})`; ctx.fillRect(x, y0, colW - 22, 2);
      text(String(Math.round(nn * eOutCubic(p))), x, y0 + (PORTRAIT ? 110 : 84), { size: PORTRAIT ? 96 : 72, kern: -3, alpha: al });
      text(T.stats[i], x, y0 + (PORTRAIT ? 150 : 118), { size: PORTRAIT ? 26 : 22, sans: true, weight: 400, color: "rgb(194,214,240)", alpha: al });
    });
  }
  function sceneEnd(u, dur, tt) {
    const T = TXT[lang];
    if (PORTRAIT) backdrop(7, u, dur, tt, { z0: 1.12, z1: 1, ay: 0.6, dim: 0.34 });
    else { cover(IMG.hero, { x: 0, y: 0, w: W, h: H }, 1.12 - 0.1 * eInOut(clamp(u / dur)), 0.5, 0.6); ctx.fillStyle = nv(0.5); ctx.fillRect(0, 0, W, H); }
    snow(tt, 90);
    const e = eOutExpo(ramp(u, 0.2, 1.2)), cy = PORTRAIT ? 660 : H * 0.3, S = PORTRAIT ? 200 : 150, cx = W / 2;
    ctx.save(); ctx.globalAlpha = e;
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    rr(cx - S / 2, cy - S / 2 + (1 - e) * 40, S, S, S * 0.225); ctx.fillStyle = "rgb(0,94,189)"; ctx.fill(); ctx.shadowColor = "transparent";
    ctx.save(); rr(cx - S / 2, cy - S / 2 + (1 - e) * 40, S, S, S * 0.225); ctx.clip(); ctx.drawImage(IMG.icon, cx - S / 2, cy - S / 2 + (1 - e) * 40, S, S); ctx.restore();
    ctx.restore();
    const wsz = PORTRAIT ? 170 : 150, wy = cy + S / 2 + (PORTRAIT ? 190 : 170);
    text("SnowLine", cx, wy + (1 - eOutExpo(ramp(u, 0.35, 1.2))) * 40, { size: wsz, weight: 500, kern: -6, align: "center", alpha: eOutExpo(ramp(u, 0.35, 1)) });
    caps(T.tagline, cx, wy + 50, { center: true, alpha: eOutCubic(ramp(u, 0.9, 0.8)), size: 30 });
    const bp = eOutBack(ramp(u, 1.3, 0.8)), bs = PORTRAIT ? 30 : 26, kern = 4, bt = T.badge.toUpperCase(), bw = measure(bt, bs, 700, false, true, kern) + 90, bh = bs * 3.6;
    ctx.save(); ctx.translate(cx, wy + 150 + bh / 2); ctx.scale(0.8 + 0.2 * bp, 0.8 + 0.2 * bp); ctx.globalAlpha = Math.min(1, bp * 2);
    rr(-bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fillStyle = "#fff"; ctx.fill();
    text(bt, -bw / 2 + 45, bs * 0.36, { size: bs, weight: 700, sans: true, kern, color: "rgb(5,13,23)" }); ctx.restore();
  }

  /* ───── ligne de temps ───── */
  const SLOTS = [[0, bar(2)], [bar(2), bar(4)], [bar(4), bar(6)], [bar(6), bar(8)], [bar(8), bar(10)], [bar(10), bar(12)], [bar(12), bar(14)], [bar(14), bar(16)], [bar(16), bar(18)], [bar(18), bar(20)], [bar(20), bar(24)], [bar(24), TOTAL]];
  function drawSlot(i, tt) {
    const u = tt - SLOTS[i][0], dur = SLOTS[i][1] - SLOTS[i][0];
    switch (i) {
      case 0: sceneIntro(u, dur, tt); break;
      case 1: sceneTrace(u, dur, tt); break;
      case 2: sceneDash(u, dur, tt); break;
      case 3: sceneFeature(0, 2, u, dur, tt, "model3d"); break;
      case 4: sceneFeature(1, 3, u, dur, tt, "speedmap"); break;
      case 5: sceneFeature(2, 4, u, dur, tt, "lock", extraWatch); break;
      case 6: sceneFeature(3, 5, u, dur, tt, "fall"); break;
      case 7: sceneFeature(4, 6, u, dur, tt, "groups"); break;
      case 8: sceneFeature(5, 1, u, dur, tt, "share"); break;
      case 9: sceneFeature(6, 7, u, dur, tt, "discover"); break;
      case 10: sceneFinale(u, dur, tt); break;
      default: sceneEnd(u, dur, tt);
    }
  }
  const chapterOf = i => (i >= 3 && i <= 9 ? i - 2 : 0);
  function slotAt(tt) { for (let i = 0; i < SLOTS.length; i++) if (tt >= SLOTS[i][0] && tt < SLOTS[i][1]) return i; return SLOTS.length - 1; }

  function frame(tt) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const cur = slotAt(tt), TR = 0.42, since = tt - SLOTS[cur][0];
    if (cur > 0 && since < TR) {
      drawSlot(cur - 1, tt);
      const k = eInOut(since / TR), main = ctx; ctx = offCtx;
      offCtx.setTransform(off.width / W, 0, 0, off.height / H, 0, 0); offCtx.clearRect(0, 0, W, H);
      drawSlot(cur, tt); ctx = main;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = k; ctx.drawImage(off, 0, 0, canvas.width, canvas.height); ctx.restore();
    } else drawSlot(cur, tt);
    if (cur !== 11) hud(tt, chapterOf(cur), cur === 0 ? eOutCubic(ramp(tt, 1, 0.8)) : 1);
    // balayage lumineux « vitesse » à chaque changement de scène
    for (let i = 1; i < SLOTS.length; i++) {
      const d = tt - SLOTS[i][0];
      if (d >= -0.05 && d < 0.55) {
        const e = eOutCubic((d + 0.05) / 0.6), y = H * (1 - e);
        ctx.save(); ctx.globalAlpha = 1 - e;
        ctx.fillStyle = lin(0, 0, W, 0, [[0, speedColor(0, 0)], [0.2, speedColor(0, 1)], [0.5, speedColor(0.5, 1)], [0.8, speedColor(1, 1)], [1, speedColor(1, 0)]]);
        ctx.fillRect(0, y - 2, W, 5); ctx.restore();
      }
    }
    for (const f of [bar(6), bar(24)]) {
      const d = tt - f;
      if (d >= 0 && d < 0.45) { ctx.fillStyle = `rgba(230,245,255,${0.8 * Math.pow(1 - d / 0.45, 2)})`; ctx.fillRect(0, 0, W, H); }
    }
    if (tt > TOTAL - 1.1) { ctx.fillStyle = `rgba(0,0,0,${clamp((tt - (TOTAL - 1.1)) / 1.1)})`; ctx.fillRect(0, 0, W, H); }
    if (chapterCb) chapterCb(tt, chapterOf(cur));
  }

  /* ───── lecture ───── */
  function resize() {
    const r = hostEl.getBoundingClientRect(); if (!r.width || !r.height) return;
    PORTRAIT = r.height >= r.width * 1.05;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    let cw = Math.round(r.width * DPR), ch = Math.round(r.height * DPR);
    const maxPx = 2.6e6; if (cw * ch > maxPx) { const s = Math.sqrt(maxPx / (cw * ch)); cw = Math.round(cw * s); ch = Math.round(ch * s); }
    canvas.width = cw; canvas.height = ch; off.width = cw; off.height = ch;
    if (PORTRAIT) { W = 1080; H = Math.round(1080 * r.height / r.width); } else { H = 1080; W = Math.round(1080 * r.width / r.height); }
    if (ready) frame(t);
  }
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
    if (playing) {
      if (soundOn && !audio.paused && audio.readyState > 2) { t = audio.currentTime; }
      else t += dt;
      if (t >= TOTAL) { t = 0; if (soundOn) { audio.currentTime = 0; audio.play().catch(() => {}); } }
    }
    if (ready) frame(t);
    requestAnimationFrame(loop);
  }
  function start() { if (running) return; running = true; lastNow = performance.now(); requestAnimationFrame(loop); }
  function stop() { running = false; }

  const api = {
    async init(opts) {
      canvas = opts.canvas; hostEl = opts.host; audio = opts.audio; chapterCb = opts.onFrame || null;
      ctx = canvas.getContext("2d", { alpha: false }); off = document.createElement("canvas"); offCtx = off.getContext("2d");
      reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      new ResizeObserver(resize).observe(hostEl); resize();
      new IntersectionObserver(es => es.forEach(e => {
        inView = e.isIntersecting;
        if (inView) { loadAll().then(() => { resize(); if (!reduce) { playing = true; } start(); if (opts.onReady) opts.onReady(); }); }
        else { playing = false; stop(); if (audio && !audio.paused) audio.pause(); }
      }), { threshold: 0.2 }).observe(hostEl);
      if (reduce) { t = 14.6; }
    },
    setLang(l) { lang = l; if (ready && !running) frame(t); },
    get time() { return t; }, get total() { return TOTAL; }, get playing() { return playing; }, get sound() { return soundOn; },
    chapters: SLOTS.slice(3, 10).map(s => s[0]),
    seek(s) { t = clamp(s, 0, TOTAL - 0.05); if (soundOn) audio.currentTime = t; if (ready && !running) frame(t); },
    toggleSound() {
      soundOn = !soundOn;
      if (soundOn) { audio.currentTime = t; audio.volume = 0.9; audio.play().then(() => { playing = true; start(); }).catch(() => { soundOn = false; }); }
      else audio.pause();
      return soundOn;
    },
    togglePlay() { playing = !playing; if (soundOn) { playing ? audio.play().catch(() => {}) : audio.pause(); } if (playing) start(); return playing; },
  };
  if (!window.SnowFilm) window.SnowFilm = api;
})();
