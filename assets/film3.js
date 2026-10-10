/* SnowLine — film de motion design en WebGL2 (code pur, aucune dépendance).
   Vraie perspective 3D, profondeur de champ sur les photos, halo lumineux (bloom), grain, transitions « traversée »
   avec flou radial, particules en bokeh. Une seule horloge (la musique, ou le temps réel) pilote tout. */
(function () {
  "use strict";
  const probe = document.createElement("canvas");
  const GL_OK = !!(probe.getContext && probe.getContext("webgl2"));
  if (!GL_OK) return;                                    // film.js (Canvas 2D) prendra le relais

  /* ───────────── musique (timing) ───────────── */
  const MUSIC = { total: 51.134, first: 0.16, bpm: 126, src: "assets/film.m4a" };
  const BEAT = 60 / MUSIC.bpm, BAR = BEAT * 4, T0 = MUSIC.first, TOTAL = MUSIC.total;
  const bar = n => T0 + n * BAR;

  /* ───────────── outils ───────────── */
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const eOutExpo = x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  const eOutCubic = x => 1 - Math.pow(1 - x, 3);
  const eOutQuart = x => 1 - Math.pow(1 - x, 4);
  const eInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const eInOutSine = x => -(Math.cos(Math.PI * x) - 1) / 2;
  const eOutBack = x => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const ramp = (u, s, l) => clamp((u - s) / l);
  const frac = x => x - Math.floor(x);
  const pulse = tt => Math.exp(-Math.max(0, ((tt - T0) / BEAT) % 1) * 5.5);

  /* matrices 4×4 (colonnes) */
  const m4 = {
    id() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
    ortho(l, r, b, t) { const o = m4.id(); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -1; o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); return o; },
    lookAt(e, c, u) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2], zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
      let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx, xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
    },
    trs(x, y, z, rx, ry, rz, sx, sy, sz = 1) {
      const cx = Math.cos(rx), sxn = Math.sin(rx), cy = Math.cos(ry), syn = Math.sin(ry), cz = Math.cos(rz), szn = Math.sin(rz);
      // R = Rz * Ry * Rx
      const r00 = cz * cy, r01 = cz * syn * sxn - szn * cx, r02 = cz * syn * cx + szn * sxn;
      const r10 = szn * cy, r11 = szn * syn * sxn + cz * cx, r12 = szn * syn * cx - cz * sxn;
      const r20 = -syn, r21 = cy * sxn, r22 = cy * cx;
      return new Float32Array([r00 * sx, r10 * sx, r20 * sx, 0, r01 * sy, r11 * sy, r21 * sy, 0, r02 * sz, r12 * sz, r22 * sz, 0, x, y, z, 1]);
    },
  };

  /* ───────────── textes ───────────── */
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
      traceTag: "Chaque virage, tracé", traceSub: "2,5 km  ·  832 m de dénivelé",
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

  /* ───────────── état ───────────── */
  let canvas, gl, audio, hostEl, chapterCb = null, readyCb = null;
  let W = 1080, H = 1920, PORTRAIT = true, CW = 2, CH = 2;
  let lang = "fr", t = 0, playing = false, soundOn = false, inView = false, running = false, ready = false, loading = false, reduce = false;
  let lastNow = 0, frozen = false;
  const TEX = {};                       // textures chargées
  const BASE = "assets/";

  /* silhouettes exactes (en pt, centrées) du châssis de l'iPhone 17 Pro Max et de l'Apple Watch Series 11 46 mm : servent à bâtir l'épaisseur */
  const OUT = {"phone":[[148.5,492.87],[155.11,492.55],[161.72,492.11],[168.29,491.33],[174.8,490.14],[181.22,488.53],[187.48,486.38],[193.54,483.73],[199.31,480.5],[204.8,476.84],[209.87,472.63],[214.61,468.02],[218.72,462.93],[222.42,457.54],[225.56,451.75],[228.3,445.77],[230.37,439.64],[232.0,433.4],[233.25,427.08],[234.0,420.64],[234.5,414.13],[234.75,407.57],[235.0,401.01],[235.0,394.39],[235.0,387.77],[235.0,381.15],[235.0,374.53],[235.0,367.91],[235.0,361.28],[235.0,354.66],[235.0,348.04],[235.0,341.42],[235.0,334.8],[235.0,328.18],[235.0,321.56],[235.0,314.94],[235.0,308.32],[235.0,301.7],[235.0,295.08],[235.0,288.46],[235.0,281.84],[235.0,275.21],[235.0,268.59],[235.0,261.97],[235.0,255.35],[235.0,248.73],[235.0,242.11],[235.0,235.49],[235.0,228.87],[235.0,222.25],[235.0,215.63],[235.0,209.01],[235.0,202.39],[235.0,195.77],[235.0,189.15],[235.0,182.52],[235.0,175.9],[235.0,169.28],[235.0,162.66],[235.0,156.04],[235.0,149.42],[235.0,142.8],[235.0,136.18],[235.0,129.56],[235.0,122.94],[235.0,116.32],[235.0,109.7],[235.0,103.08],[235.0,96.45],[235.0,89.83],[235.0,83.21],[235.0,76.59],[235.0,69.97],[235.0,63.35],[235.0,56.73],[235.0,50.11],[235.0,43.49],[235.0,36.87],[235.0,30.25],[235.0,23.63],[235.0,17.01],[235.0,10.38],[235.0,3.76],[235.0,-2.86],[235.0,-9.48],[235.0,-16.1],[235.0,-22.72],[235.0,-29.34],[235.0,-35.96],[235.0,-42.58],[235.0,-49.2],[235.0,-55.82],[235.0,-62.44],[235.0,-69.06],[235.0,-75.69],[235.0,-82.31],[235.0,-88.93],[235.0,-95.55],[235.0,-102.17],[235.0,-108.79],[235.0,-115.41],[235.0,-122.03],[235.0,-128.65],[235.0,-135.27],[235.0,-141.89],[235.0,-148.51],[235.0,-155.13],[235.0,-161.75],[235.0,-168.38],[235.0,-175.0],[235.0,-181.62],[235.0,-188.24],[235.0,-194.86],[235.0,-201.48],[235.0,-208.1],[235.0,-214.72],[235.0,-221.34],[235.0,-227.96],[235.0,-234.58],[235.0,-241.2],[235.0,-247.82],[235.0,-254.45],[235.0,-261.07],[235.0,-267.69],[235.0,-274.31],[235.0,-280.93],[235.0,-287.55],[235.0,-294.17],[235.0,-300.79],[235.0,-307.41],[235.0,-314.03],[235.0,-320.65],[235.0,-327.27],[235.0,-333.89],[235.0,-340.52],[235.0,-347.14],[235.0,-353.76],[235.0,-360.38],[235.0,-367.0],[235.0,-373.62],[235.0,-380.24],[235.0,-386.86],[235.0,-393.48],[235.0,-400.1],[234.75,-406.66],[234.5,-413.23],[234.18,-419.77],[233.25,-426.17],[232.25,-432.56],[230.66,-438.8],[228.59,-444.94],[226.08,-450.96],[222.94,-456.75],[219.24,-462.14],[215.13,-467.24],[210.6,-472.03],[205.55,-476.26],[200.13,-480.04],[194.38,-483.31],[188.34,-485.99],[182.11,-488.24],[175.72,-489.95],[169.22,-491.2],[162.65,-492.02],[156.05,-492.55],[149.43,-492.63],[142.81,-492.64],[136.19,-492.64],[129.57,-492.65],[122.95,-492.65],[116.33,-492.66],[109.71,-492.66],[103.09,-492.67],[96.47,-492.67],[89.85,-492.68],[83.23,-492.68],[76.61,-492.69],[69.98,-492.7],[63.36,-492.7],[56.74,-492.71],[50.12,-492.71],[43.5,-492.72],[36.88,-492.72],[30.26,-492.73],[23.64,-492.73],[17.02,-492.74],[10.4,-492.74],[3.78,-492.75],[-2.84,-492.76],[-9.46,-492.76],[-16.09,-492.77],[-22.71,-492.77],[-29.33,-492.78],[-35.95,-492.78],[-42.57,-492.79],[-49.19,-492.79],[-55.81,-492.8],[-62.43,-492.8],[-69.05,-492.81],[-75.67,-492.82],[-82.29,-492.82],[-88.91,-492.83],[-95.53,-492.83],[-102.16,-492.84],[-108.78,-492.84],[-115.4,-492.85],[-122.02,-492.85],[-128.64,-492.86],[-135.26,-492.86],[-141.88,-492.87],[-148.5,-492.87],[-155.11,-492.56],[-161.72,-492.12],[-168.29,-491.33],[-174.8,-490.14],[-181.22,-488.53],[-187.48,-486.38],[-193.54,-483.73],[-199.31,-480.5],[-204.8,-476.84],[-209.87,-472.63],[-214.61,-468.02],[-218.72,-462.93],[-222.42,-457.54],[-225.56,-451.75],[-228.3,-445.77],[-230.37,-439.64],[-232.0,-433.41],[-233.25,-427.08],[-234.0,-420.64],[-234.5,-414.13],[-234.75,-407.57],[-235.0,-401.01],[-235.0,-394.39],[-235.0,-387.77],[-235.0,-381.15],[-235.0,-374.53],[-235.0,-367.91],[-235.0,-361.29],[-235.0,-354.66],[-235.0,-348.04],[-235.0,-341.42],[-235.0,-334.8],[-235.0,-328.18],[-235.0,-321.56],[-235.0,-314.94],[-235.0,-308.32],[-235.0,-301.7],[-235.0,-295.08],[-235.0,-288.46],[-235.0,-281.84],[-235.0,-275.22],[-235.0,-268.59],[-235.0,-261.97],[-235.0,-255.35],[-235.0,-248.73],[-235.0,-242.11],[-235.0,-235.49],[-235.0,-228.87],[-235.0,-222.25],[-235.0,-215.63],[-235.0,-209.01],[-235.0,-202.39],[-235.0,-195.77],[-235.0,-189.15],[-235.0,-182.52],[-235.0,-175.9],[-235.0,-169.28],[-235.0,-162.66],[-235.0,-156.04],[-235.0,-149.42],[-235.0,-142.8],[-235.0,-136.18],[-235.0,-129.56],[-235.0,-122.94],[-235.0,-116.32],[-235.0,-109.7],[-235.0,-103.08],[-235.0,-96.45],[-235.0,-89.83],[-235.0,-83.21],[-235.0,-76.59],[-235.0,-69.97],[-235.0,-63.35],[-235.0,-56.73],[-235.0,-50.11],[-235.0,-43.49],[-235.0,-36.87],[-235.0,-30.25],[-235.0,-23.63],[-235.0,-17.01],[-235.0,-10.39],[-235.0,-3.76],[-235.0,2.86],[-235.0,9.48],[-235.0,16.1],[-235.0,22.72],[-235.0,29.34],[-235.0,35.96],[-235.0,42.58],[-235.0,49.2],[-235.0,55.82],[-235.0,62.44],[-235.0,69.06],[-235.0,75.68],[-235.0,82.31],[-235.0,88.93],[-235.0,95.55],[-235.0,102.17],[-235.0,108.79],[-235.0,115.41],[-235.0,122.03],[-235.0,128.65],[-235.0,135.27],[-235.0,141.89],[-235.0,148.51],[-235.0,155.13],[-235.0,161.75],[-235.0,168.38],[-235.0,175.0],[-235.0,181.62],[-235.0,188.24],[-235.0,194.86],[-235.0,201.48],[-235.0,208.1],[-235.0,214.72],[-235.0,221.34],[-235.0,227.96],[-235.0,234.58],[-235.0,241.2],[-235.0,247.82],[-235.0,254.45],[-235.0,261.07],[-235.0,267.69],[-235.0,274.31],[-235.0,280.93],[-235.0,287.55],[-235.0,294.17],[-235.0,300.79],[-235.0,307.41],[-235.0,314.03],[-235.0,320.65],[-235.0,327.27],[-235.0,333.89],[-235.0,340.51],[-235.0,347.14],[-235.0,353.76],[-235.0,360.38],[-235.0,367.0],[-235.0,373.62],[-235.0,380.24],[-235.0,386.86],[-235.0,393.48],[-235.0,400.1],[-234.75,406.66],[-234.5,413.23],[-234.18,419.77],[-233.25,426.17],[-232.25,432.56],[-230.66,438.8],[-228.59,444.94],[-226.08,450.96],[-222.94,456.75],[-219.24,462.14],[-215.13,467.24],[-210.6,472.03],[-205.55,476.26],[-200.13,480.04],[-194.38,483.31],[-188.34,485.99],[-182.11,488.24],[-175.72,489.95],[-169.22,491.2],[-162.65,492.02],[-156.05,492.55],[-149.43,492.63],[-142.81,492.64],[-136.19,492.64],[-129.57,492.65],[-122.95,492.65],[-116.33,492.66],[-109.71,492.66],[-103.09,492.67],[-96.47,492.67],[-89.85,492.68],[-83.23,492.68],[-76.61,492.69],[-69.98,492.7],[-63.36,492.7],[-56.74,492.71],[-50.12,492.71],[-43.5,492.72],[-36.88,492.72],[-30.26,492.73],[-23.64,492.73],[-17.02,492.74],[-10.4,492.74],[-3.78,492.75],[2.84,492.76],[9.46,492.76],[16.08,492.77],[22.71,492.77],[29.33,492.78],[35.95,492.78],[42.57,492.79],[49.19,492.79],[55.81,492.8],[62.43,492.8],[69.05,492.81],[75.67,492.82],[82.29,492.82],[88.91,492.83],[95.53,492.83],[102.15,492.84],[108.78,492.84],[115.4,492.85],[122.02,492.85],[128.64,492.86],[135.26,492.86],[141.88,492.87]],"watch":[[91.25,287.87],[95.78,287.7],[100.31,287.53],[104.84,287.33],[109.36,287.02],[113.88,286.67],[118.39,286.25],[122.9,285.72],[127.39,285.11],[131.87,284.4],[136.32,283.56],[140.74,282.56],[145.14,281.46],[149.5,280.23],[153.82,278.85],[158.09,277.34],[162.28,275.61],[166.43,273.79],[170.53,271.86],[174.53,269.74],[178.49,267.55],[182.4,265.28],[186.17,262.76],[189.91,260.21],[193.54,257.52],[197.05,254.68],[200.46,251.73],[203.86,248.76],[207.07,245.56],[210.13,242.25],[213.19,238.94],[215.97,235.43],[218.74,231.9],[221.35,228.27],[223.89,224.59],[226.29,220.8],[228.5,216.88],[230.69,212.94],[232.74,208.9],[234.54,204.79],[236.35,200.68],[237.93,196.52],[239.28,192.31],[240.64,188.1],[241.77,183.83],[242.9,179.57],[243.75,175.23],[244.5,170.88],[245.25,166.52],[245.75,162.1],[246.25,157.69],[246.75,153.27],[247.0,148.8],[247.27,144.33],[247.5,139.85],[247.75,135.38],[247.99,130.9],[248.0,126.37],[248.0,121.84],[248.0,117.3],[248.0,112.77],[248.0,108.24],[248.0,103.7],[248.0,99.17],[248.0,94.64],[248.0,90.1],[248.0,85.57],[248.0,81.04],[248.0,76.5],[248.0,71.97],[248.0,67.44],[248.0,62.9],[248.0,58.37],[248.0,53.84],[248.0,49.3],[248.0,44.77],[248.0,40.24],[248.0,35.7],[248.0,31.17],[248.0,26.64],[248.0,22.1],[248.0,17.57],[248.0,13.04],[248.0,8.5],[248.0,3.97],[248.0,-0.56],[248.0,-5.1],[248.0,-9.63],[248.0,-14.16],[248.0,-18.7],[248.0,-23.23],[248.0,-27.76],[248.0,-32.3],[248.0,-36.83],[248.0,-41.36],[248.0,-45.9],[248.0,-50.43],[248.0,-54.96],[248.0,-59.5],[248.0,-64.03],[248.0,-68.56],[248.0,-73.1],[248.0,-77.63],[248.0,-82.16],[248.0,-86.7],[248.0,-91.23],[248.0,-95.76],[248.0,-100.3],[248.0,-104.83],[248.0,-109.36],[248.0,-113.9],[248.0,-118.43],[248.0,-122.96],[248.0,-127.5],[247.75,-131.97],[247.75,-136.5],[247.5,-140.98],[247.25,-145.45],[247.0,-149.93],[246.63,-154.37],[246.25,-158.82],[245.75,-163.23],[245.02,-167.59],[244.33,-171.96],[243.5,-176.3],[242.51,-180.6],[241.5,-184.9],[240.25,-189.13],[239.0,-193.37],[237.53,-197.56],[235.95,-201.72],[234.15,-205.83],[232.12,-209.88],[230.09,-213.94],[227.88,-217.86],[225.67,-221.78],[223.28,-225.57],[220.7,-229.23],[218.04,-232.83],[215.27,-236.35],[212.36,-239.77],[209.3,-243.08],[206.24,-246.39],[202.92,-249.45],[199.6,-252.52],[196.17,-255.45],[192.61,-258.22],[188.92,-260.84],[185.24,-263.47],[181.4,-265.86],[177.49,-268.13],[173.5,-270.29],[169.49,-272.38],[165.37,-274.28],[161.2,-276.04],[156.99,-277.71],[152.71,-279.22],[148.39,-280.58],[144.02,-281.76],[139.61,-282.82],[135.18,-283.77],[130.72,-284.59],[126.24,-285.27],[121.74,-285.86],[117.24,-286.35],[112.72,-286.77],[108.2,-287.13],[103.68,-287.37],[99.15,-287.62],[94.62,-287.63],[90.08,-287.64],[85.55,-287.64],[81.02,-287.65],[76.48,-287.65],[71.95,-287.66],[67.42,-287.67],[62.88,-287.67],[58.35,-287.68],[53.82,-287.68],[49.28,-287.69],[44.75,-287.7],[40.22,-287.7],[35.68,-287.71],[31.15,-287.71],[26.62,-287.72],[22.08,-287.73],[17.55,-287.73],[13.02,-287.74],[8.48,-287.74],[3.95,-287.75],[-0.58,-287.76],[-5.12,-287.76],[-9.65,-287.77],[-14.18,-287.77],[-18.72,-287.78],[-23.25,-287.79],[-27.78,-287.79],[-32.32,-287.8],[-36.85,-287.8],[-41.38,-287.81],[-45.92,-287.82],[-50.45,-287.82],[-54.98,-287.83],[-59.52,-287.83],[-64.05,-287.84],[-68.58,-287.85],[-73.12,-287.85],[-77.65,-287.86],[-82.18,-287.86],[-86.72,-287.87],[-91.25,-287.87],[-95.78,-287.7],[-100.31,-287.53],[-104.84,-287.33],[-109.36,-287.02],[-113.88,-286.67],[-118.39,-286.25],[-122.9,-285.72],[-127.39,-285.11],[-131.87,-284.4],[-136.32,-283.56],[-140.74,-282.56],[-145.14,-281.46],[-149.5,-280.23],[-153.82,-278.85],[-158.09,-277.34],[-162.28,-275.61],[-166.43,-273.79],[-170.53,-271.86],[-174.53,-269.74],[-178.49,-267.55],[-182.4,-265.28],[-186.17,-262.76],[-189.91,-260.21],[-193.54,-257.52],[-197.05,-254.68],[-200.46,-251.73],[-203.86,-248.76],[-207.07,-245.56],[-210.13,-242.25],[-213.19,-238.94],[-215.97,-235.43],[-218.74,-231.9],[-221.35,-228.27],[-223.89,-224.59],[-226.29,-220.8],[-228.5,-216.88],[-230.69,-212.94],[-232.74,-208.9],[-234.54,-204.79],[-236.35,-200.68],[-237.93,-196.52],[-239.28,-192.31],[-240.64,-188.1],[-241.77,-183.83],[-242.9,-179.57],[-243.75,-175.23],[-244.5,-170.88],[-245.25,-166.52],[-245.75,-162.1],[-246.25,-157.69],[-246.75,-153.27],[-247.0,-148.8],[-247.27,-144.33],[-247.5,-139.85],[-247.75,-135.38],[-247.99,-130.9],[-248.0,-126.37],[-248.0,-121.84],[-248.0,-117.3],[-248.0,-112.77],[-248.0,-108.24],[-248.0,-103.7],[-248.0,-99.17],[-248.0,-94.64],[-248.0,-90.1],[-248.0,-85.57],[-248.0,-81.04],[-248.0,-76.5],[-248.0,-71.97],[-248.0,-67.44],[-248.0,-62.9],[-248.0,-58.37],[-248.0,-53.84],[-248.0,-49.3],[-248.0,-44.77],[-248.0,-40.24],[-248.0,-35.7],[-248.0,-31.17],[-248.0,-26.64],[-248.0,-22.1],[-248.0,-17.57],[-248.0,-13.04],[-248.0,-8.5],[-248.0,-3.97],[-248.0,0.56],[-248.0,5.1],[-248.0,9.63],[-248.0,14.16],[-248.0,18.7],[-248.0,23.23],[-248.0,27.76],[-248.0,32.3],[-248.0,36.83],[-248.0,41.36],[-248.0,45.9],[-248.0,50.43],[-248.0,54.96],[-248.0,59.5],[-248.0,64.03],[-248.0,68.56],[-248.0,73.1],[-248.0,77.63],[-248.0,82.16],[-248.0,86.7],[-248.0,91.23],[-248.0,95.76],[-248.0,100.3],[-248.0,104.83],[-248.0,109.36],[-248.0,113.9],[-248.0,118.43],[-248.0,122.96],[-248.0,127.5],[-247.75,131.97],[-247.75,136.5],[-247.5,140.98],[-247.25,145.45],[-247.0,149.93],[-246.63,154.37],[-246.25,158.82],[-245.75,163.23],[-245.02,167.59],[-244.33,171.96],[-243.5,176.3],[-242.51,180.6],[-241.5,184.9],[-240.25,189.13],[-239.0,193.37],[-237.53,197.56],[-235.95,201.72],[-234.15,205.83],[-232.12,209.88],[-230.09,213.94],[-227.88,217.86],[-225.67,221.78],[-223.28,225.57],[-220.7,229.23],[-218.04,232.83],[-215.27,236.35],[-212.36,239.77],[-209.3,243.08],[-206.24,246.39],[-202.92,249.45],[-199.6,252.52],[-196.17,255.45],[-192.61,258.22],[-188.92,260.84],[-185.24,263.47],[-181.4,265.86],[-177.49,268.13],[-173.5,270.29],[-169.49,272.38],[-165.37,274.28],[-161.2,276.04],[-156.99,277.71],[-152.71,279.22],[-148.39,280.58],[-144.02,281.76],[-139.61,282.82],[-135.18,283.77],[-130.72,284.59],[-126.24,285.27],[-121.74,285.86],[-117.24,286.35],[-112.72,286.77],[-108.2,287.13],[-103.68,287.37],[-99.15,287.62],[-94.62,287.63],[-90.08,287.64],[-85.55,287.64],[-81.02,287.65],[-76.48,287.65],[-71.95,287.66],[-67.42,287.67],[-62.88,287.67],[-58.35,287.68],[-53.82,287.68],[-49.28,287.69],[-44.75,287.7],[-40.22,287.7],[-35.68,287.71],[-31.15,287.71],[-26.62,287.72],[-22.08,287.73],[-17.55,287.73],[-13.02,287.74],[-8.48,287.74],[-3.95,287.75],[0.58,287.76],[5.12,287.76],[9.65,287.77],[14.18,287.77],[18.72,287.78],[23.25,287.79],[27.78,287.79],[32.32,287.8],[36.85,287.8],[41.38,287.81],[45.92,287.82],[50.45,287.82],[54.98,287.83],[59.52,287.83],[64.05,287.84],[68.58,287.85],[73.12,287.85],[77.65,287.86],[82.18,287.86],[86.72,287.87]]};

  /* ───────────── shaders ───────────── */
  const GLSL_HEAD = "#version 300 es\nprecision highp float;\n";
  const VS_QUAD = GLSL_HEAD + `
layout(location=0) in vec2 aPos; uniform mat4 uMVP; out vec2 vP; out vec2 vUV;
void main(){ vP=aPos; vUV=vec2(aPos.x+.5,.5-aPos.y); gl_Position=uMVP*vec4(aPos,0.,1.); }`;
  const FS_QUAD = GLSL_HEAD + `
in vec2 vP; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform vec4 uTint; uniform vec4 uRect; uniform vec2 uSize; uniform float uRadius; uniform float uLod;
uniform float uAlpha; uniform int uMode; uniform vec2 uLight; uniform float uBezel; uniform float uTime; uniform vec2 uAux; uniform float uN;
float sdRR(vec2 p, vec2 b, float r, float n){ vec2 q=abs(p)-b+r; vec2 m=max(q,0.); float e = n<2.05 ? length(m) : pow(pow(m.x,n)+pow(m.y,n),1./n); return e+min(max(q.x,q.y),0.)-r; }
void main(){
  vec2 p = vP*uSize; vec2 hb = uSize*.5;
  float d = sdRR(p,hb,uRadius,uN);
  float aa = max(fwidth(d)*.8,.0005);
  float m = 1.-smoothstep(-aa,aa,d);
  vec4 c = uTint;
  if(uMode==0){                                  // image / aplat arrondi
    vec2 uv = mix(uRect.xy,uRect.zw,vUV); c *= textureLod(uTex,uv,uLod);
  } else if(uMode==1){                           // aplat
  } else if(uMode==2){                           // face avant : verre noir + arête en titane
    float e = 0.5; vec2 n = normalize(vec2(sdRR(p+vec2(e,0.),hb,uRadius,uN)-sdRR(p-vec2(e,0.),hb,uRadius,uN), sdRR(p+vec2(0.,e),hb,uRadius,uN)-sdRR(p-vec2(0.,e),hb,uRadius,uN))+1e-5);
    float rimW = max(uBezel,1.0);
    float inMetal = smoothstep(-rimW-0.7,-rimW+0.7,d);
    float lt = pow(max(dot(vec2(n.x,-n.y),normalize(uLight)),0.),2.);
    vec3 metal = mix(vec3(.20,.22,.26), vec3(.82,.85,.90), lt) * (.62+.38*smoothstep(0.,1.,vUV.y));
    vec3 glass = vec3(.010,.014,.022);
    c.rgb = mix(glass, metal, inMetal);
    c.rgb += vec3(.7,.75,.85)*exp(-pow((d+0.9)*1.1,2.))*.35;      // fin liseré lumineux au bord extérieur
  } else if(uMode==3){                           // reflet de verre sur l'écran
    float s = dot(vP, normalize(vec2(.55,1.)));
    float band = exp(-pow((s-uAux.x)*1.5,2.)) * .075;
    c = vec4(vec3(.8,.9,1.)*band, band);
  } else if(uMode==4){                           // ombre portée douce (SDF)
    float k = clamp(uAux.x,1.,600.);
    float eb = min(hb.x-abs(p.x), hb.y-abs(p.y));
    float a = exp(-max(d,0.)/k*2.4)*smoothstep(0.,k*1.4,eb);
    c = vec4(0.,0.,0.,a*.62);
    m = 1.;
  } else if(uMode==5){                           // halo radial
    float r = length(vP)*2.; float g = exp(-r*r*uAux.x); c = vec4(uTint.rgb*g, g*uTint.a); m=1.;
  } else if(uMode==6){                           // traînée horizontale (anamorphique)
    float gx = exp(-pow(vP.x*2.,2.)*uAux.x*.35), gy = exp(-pow(vP.y*uAux.y,2.)); c = vec4(uTint.rgb*gx*gy, gx*gy*uTint.a); m=1.;
  } else if(uMode==8){                           // silhouette teintée d'une image (épaisseur du téléphone)
    vec2 uv = mix(uRect.xy,uRect.zw,vUV); float al = textureLod(uTex,uv,0.).a; c = vec4(uTint.rgb, al*uTint.a); m = 1.;
  } else if(uMode==7){                           // anneau pulsé
    float r = length(vP)*2.; float ring = exp(-pow((r-uAux.x)*uAux.y,2.)); c = vec4(uTint.rgb*ring, ring*uTint.a); m=1.;
  }
  float a = c.a*uAlpha*m;
  o = vec4(c.rgb*a, a);
}`;
  const FS_BG = GLSL_HEAD + `
in vec2 vP; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform vec4 uCrop; uniform vec2 uCam; uniform float uBlur; uniform float uFocus; uniform float uRef;
uniform vec3 uShade; uniform float uTime; uniform vec3 uTint;
void main(){
  vec2 puv = vUV*uCrop.xy+uCrop.zw;
  float depth = clamp((puv.y-.30)/.70,0.,1.);
  puv += uCam*(depth-uRef);
  float lod = uBlur*abs(depth-uFocus)*4.;
  vec3 c = textureLod(uTex,puv,lod).rgb;
  c *= uTint;
  float top = smoothstep(.62,0.,vUV.y)*uShade.x;      // voile sombre en haut
  float bot = smoothstep(.55,1.,vUV.y)*uShade.y;      // en bas
  vec3 navy = vec3(.016,.039,.078);
  c = mix(c,navy,clamp(top+bot+uShade.z,0.,1.));
  o = vec4(c,1.);
}`;
  const VS_PART = GLSL_HEAD + `
layout(location=0) in vec4 aSeed; uniform mat4 uVP; uniform float uD; uniform float uTime; uniform vec2 uStage; uniform float uPx;
out float vA; out float vS;
void main(){
  float sp = 30.+aSeed.z*120.;
  float x = (aSeed.x-.5)*uStage.x*1.5 + sin(uTime*(.4+aSeed.z)+aSeed.w*30.)*(18.+aSeed.z*50.);
  float y = (.5 - mod(aSeed.y + uTime*sp/uStage.y*.9,1.))*uStage.y*1.2;
  float z = (aSeed.w-.35)*1100.;
  vec4 clip = uVP*vec4(x,y,z,1.);
  gl_Position = clip;
  float foc = abs(z+120.)/700.;                       // flou de profondeur : bokeh quand loin du plan net
  float size = (2.2+aSeed.z*7.)*(1.+foc*3.2);
  gl_PointSize = size*uPx*(uD/clip.w)*.55;
  vA = (.30+.55*aSeed.z)/(1.+foc*3.6); vS = foc;
}`;
  const FS_PART = GLSL_HEAD + `
in float vA; in float vS; out vec4 o; uniform float uAlpha;
void main(){ vec2 q=gl_PointCoord*2.-1.; float r=dot(q,q); if(r>1.) discard;
  float edge = mix(smoothstep(1.,.2,r), smoothstep(1.,.88,r)*.55+.18*smoothstep(1.,.0,r), clamp(vS*1.6,0.,1.));
  float a = edge*vA*uAlpha; o=vec4(vec3(.92,.96,1.)*a,a); }`;
  const VS_WALL = GLSL_HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aNrm;
uniform mat4 uVP; uniform mat4 uModel; uniform float uK; uniform float uThick; uniform vec3 uEye;
out vec3 vN; out vec3 vV; out float vD;
void main(){
  vec3 lp = vec3(aPos.xy*uK, -aPos.z*uThick*uK);
  vec4 wp = uModel*vec4(lp,1.);
  vN = normalize(mat3(uModel)*vec3(aNrm,0.)); vV = uEye-wp.xyz; vD = aPos.z;
  gl_Position = uVP*wp; }`;
  const FS_WALL = GLSL_HEAD + `
in vec3 vN; in vec3 vV; in float vD; out vec4 o; uniform float uAlpha; uniform vec3 uBase;
void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  if(dot(N,V) < 0.) discard;                                      // face tournée à l'opposé de la caméra
  vec3 L = normalize(vec3(-.45,.62,.64));
  float diff = max(dot(N,L),0.)*.62+.34;
  vec3 H = normalize(L+V);
  float spec = pow(max(dot(N,H),0.),46.)*1.1 + pow(max(dot(N,normalize(vec3(.7,-.25,.66)+V)),0.),22.)*.30;
  float fres = pow(1.-max(dot(N,V),0.),3.);
  float chamfer = exp(-pow((vD-.045)*38.,2.))*.5;                  // fin biseau lumineux près de la face avant
  vec3 col = uBase*diff*(1.-.5*smoothstep(.12,1.,vD)) + vec3(.92,.94,1.)*spec*(1.-.4*vD) + fres*vec3(.28,.33,.42) + chamfer*vec3(.7,.74,.82);
  o = vec4(col*uAlpha, uAlpha); }`;
  const VS_FS = GLSL_HEAD + `layout(location=0) in vec2 aPos; out vec2 vUV; void main(){ vUV=aPos*.5+.5; gl_Position=vec4(aPos,0.,1.); }`;
  const FS_BRIGHT = GLSL_HEAD + `in vec2 vUV; out vec4 o; uniform sampler2D uTex; uniform float uThr;
void main(){ vec3 c=texture(uTex,vUV).rgb; float l=max(c.r,max(c.g,c.b)); float k=smoothstep(uThr,uThr+.35,l); o=vec4(c*k,1.); }`;
  const FS_BLUR = GLSL_HEAD + `in vec2 vUV; out vec4 o; uniform sampler2D uTex; uniform vec2 uDir;
void main(){ vec3 s=texture(uTex,vUV).rgb*.2270270270;
  s+=texture(uTex,vUV+uDir*1.3846153846).rgb*.3162162162; s+=texture(uTex,vUV-uDir*1.3846153846).rgb*.3162162162;
  s+=texture(uTex,vUV+uDir*3.2307692308).rgb*.0702702703; s+=texture(uTex,vUV-uDir*3.2307692308).rgb*.0702702703; o=vec4(s,1.); }`;
  const FS_POST = GLSL_HEAD + `in vec2 vUV; out vec4 o;
uniform sampler2D uScene; uniform sampler2D uB0; uniform sampler2D uB1; uniform sampler2D uB2;
uniform float uBloom; uniform float uWarp; uniform float uFlash; uniform float uTime; uniform vec2 uRes; uniform float uGrain; uniform vec2 uShock;
float hash(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p+19.19); return fract(p.x*p.y); }
void main(){
  vec2 uv = vUV; vec2 cen = uv-.5;
  // onde de choc (distorsion radiale) autour du centre
  float sr = length(cen*vec2(uRes.x/uRes.y,1.));
  float sh = uShock.y*exp(-pow((sr-uShock.x)*9.,2.));
  uv += normalize(cen+1e-5)*sh*.06;
  vec3 col = vec3(0.);
  // flou radial + aberration chromatique pendant les transitions
  float w = uWarp;
  if(w>.002){
    const int N=14; vec3 acc=vec3(0.);
    for(int i=0;i<N;i++){ float f=float(i)/float(N-1); vec2 off=cen*(f*w*.16);
      acc.r+=texture(uScene,uv-off*(1.+w*.35)).r; acc.g+=texture(uScene,uv-off).g; acc.b+=texture(uScene,uv-off*(1.-w*.35)).b; }
    col=acc/float(N);
  } else { col = texture(uScene,uv).rgb; }
  vec3 bl = texture(uB0,uv).rgb*.55 + texture(uB1,uv).rgb*.75 + texture(uB2,uv).rgb*.95;
  col += bl*uBloom;
  col += vec3(.86,.94,1.)*uFlash;
  // vignette
  float v = smoothstep(1.08,.30,length(cen*vec2(1.0,1.18)));
  col *= mix(.58,1.,v);
  // courbe tonale douce + léger grading bleu dans les ombres
  col = col/(1.+col*.18)*1.12;
  col = mix(col, col*vec3(.94,.99,1.08), .35);
  col += (hash(uv*uRes+uTime)-.5)*uGrain;
  o = vec4(col,1.);
}`;

  /* ───────────── GL : programmes, géométrie, textures ───────────── */
  const P = {};            // programmes
  let quadVAO, fsVAO, partVAO, partCount = 420;
  function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src.slice(0, 200)); return s; }
  function program(vs, fs) {
    const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const inf = gl.getActiveUniform(p, i); u[inf.name] = gl.getUniformLocation(p, inf.name); }
    return { p, u };
  }
  const WALL = {};
  function makeWall(pts) {
    const n = pts.length, v = new Float32Array((n + 1) * 2 * 5);
    for (let i = 0; i <= n; i++) {
      const c = pts[i % n], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = ty, ny = -tx;                                      // normale sortante (contour parcouru dans le sens horaire à l'écran)
      for (let j = 0; j < 2; j++) { const o = (i * 2 + j) * 5; v[o] = c[0]; v[o + 1] = c[1]; v[o + 2] = j; v[o + 3] = nx; v[o + 4] = ny; }
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null); return { vao, count: (n + 1) * 2 };
  }
  function initGL() {
    gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    P.quad = program(VS_QUAD, FS_QUAD); P.bg = program(VS_QUAD, FS_BG); P.part = program(VS_PART, FS_PART);
    P.wall = program(VS_WALL, FS_WALL); WALL.phone = makeWall(OUT.phone); WALL.watch = makeWall(OUT.watch);
    P.bright = program(VS_FS, FS_BRIGHT); P.blur = program(VS_FS, FS_BLUR); P.post = program(VS_FS, FS_POST);
    // quad unité
    quadVAO = gl.createVertexArray(); gl.bindVertexArray(quadVAO);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, -.5, .5, .5, .5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // plein écran
    fsVAO = gl.createVertexArray(); gl.bindVertexArray(fsVAO);
    const fb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, fb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // particules
    partVAO = gl.createVertexArray(); gl.bindVertexArray(partVAO);
    const seeds = new Float32Array(partCount * 4); let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }
  function makeTexture(src, opts = {}) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    if (opts.mip !== false) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ext = gl.getExtension("EXT_texture_filter_anisotropic"); if (ext && opts.mip !== false) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return { tex, w: src.width, h: src.height };
  }
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = () => rej(new Error("image " + src)); i.src = src; });
  let loadP = null;
  function loadAll() { return loadP || (loadP = doLoad()); }
  async function doLoad() {
    loading = true;
    const list = { hero: "hero.webp", icon: "icon.png", frame: "iphone-frame.webp", "watch-frame": "watch-frame.webp" };
    for (let n = 1; n <= 7; n++) list["m" + n] = "m0" + n + ".webp";
    for (const l of ["fr", "en"]) {
      for (const k of ["dashboard", "model3d", "speedmap", "fall", "discover", "discovermap", "groups", "lock"]) list[k + "-" + l] = "hd/" + k + "-" + l + ".webp";
      list["share-" + l] = "share-" + l + ".webp"; list["watch-" + l] = "watch-" + l + ".webp";
    }
    list["replay-fr"] = "hd/replay-fr.webp";
    await Promise.all(Object.entries(list).map(([k, v]) => loadImg(BASE + v).then(i => { TEX[k] = makeTexture(i); })));
    TEX["replay-en"] = TEX["replay-fr"];
    ready = true; loading = false;
  }
  const tx = k => TEX[k + "-" + lang] || TEX[k + "-fr"] || TEX[k];

  /* cibles de rendu */
  const FB = {};
  function makeTarget(w, h) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }
  function makeMS(w, h) {
    const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); const smp = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, smp, gl.RGBA8, w, h);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    return { fbo, rb, w, h };
  }
  function buildTargets() {
    for (const k in FB) { if (FB[k].tex) gl.deleteTexture(FB[k].tex); if (FB[k].rb) gl.deleteRenderbuffer(FB[k].rb); gl.deleteFramebuffer(FB[k].fbo); }
    FB.ms = makeMS(CW, CH);
    FB.scene = makeTarget(CW, CH);
    let w = CW >> 1, h = CH >> 1;
    FB.bright = makeTarget(w, h);
    for (let i = 0; i < 3; i++) { FB["t" + i] = makeTarget(Math.max(2, w), Math.max(2, h)); FB["b" + i] = makeTarget(Math.max(2, w), Math.max(2, h)); w >>= 1; h >>= 1; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* ───────────── dessin ───────────── */
  let V = m4.id(), PR = m4.id(), VP = m4.id();
  const SPEED = c => c;       // (palette dessinée dans les textures de dégradé)
  function useProgram(pr) { gl.useProgram(pr.p); }
  function setBlend(mode) {
    gl.enable(gl.BLEND);
    if (mode === "add") gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  /* quad générique : o = {tex, rect:[u0,v0,u1,v1], x,y,z, rx,ry,rz, w,h, r, a, tint:[r,g,b,a], mode, lod, aux:[], light, ortho} */
  function quad(o) {
    const pr = P.quad, u = pr.u; useProgram(pr); gl.bindVertexArray(quadVAO);
    const M = m4.trs(o.x || 0, o.y || 0, o.z || 0, o.rx || 0, o.ry || 0, o.rz || 0, o.w, o.h);
    gl.uniformMatrix4fv(u.uMVP, false, m4.mul(o.ortho ? ORTHO : VP, M));
    gl.uniform2f(u.uSize, o.w, o.h); gl.uniform1f(u.uRadius, o.r || 0); gl.uniform1f(u.uAlpha, o.a == null ? 1 : o.a);
    const tn = o.tint || [1, 1, 1, 1]; gl.uniform4f(u.uTint, tn[0], tn[1], tn[2], tn[3]);
    const rc = o.rect || [0, 0, 1, 1]; gl.uniform4f(u.uRect, rc[0], rc[1], rc[2], rc[3]);
    gl.uniform1f(u.uN, o.n || 2); gl.uniform1f(u.uBezel, o.bezel || 0); gl.uniform1i(u.uMode, o.mode == null ? (o.tex ? 0 : 1) : o.mode); gl.uniform1f(u.uLod, o.lod || 0);
    const lg = o.light || [0.5, 0.8]; gl.uniform2f(u.uLight, lg[0], lg[1]);
    const ax = o.aux || [0, 0]; gl.uniform2f(u.uAux, ax[0], ax[1]); gl.uniform1f(u.uTime, curT);
    if (o.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, o.tex.tex || o.tex); gl.uniform1i(u.uTex, 0); }
    setBlend(o.add ? "add" : "over");
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  let ORTHO = m4.id(), curT = 0;

  /* coordonnées « scène » : (sx,sy) origine en haut à gauche, y vers le bas → monde (y vers le haut, origine au centre) */
  const wx = sx => sx - W / 2, wy = sy => H / 2 - sy;

  /* ───────────── photos de fond avec parallaxe + profondeur de champ ───────────── */
  function drawBG(key, o) {
    const T = TEX[key], pr = P.bg, u = pr.u; useProgram(pr); gl.bindVertexArray(quadVAO);
    const zb = o.zb || 500, ov = 1 + zb / D, s = o.zoom || 1.1;
    const iw = T.w, ih = T.h, k = Math.max(W / iw, H / ih);
    const vw = W / (iw * k), vh = H / (ih * k);                  // part de l'image visible (cover)
    const cx = (o.cx == null ? 0.5 : o.cx), cy = (o.cy == null ? 0.5 : o.cy);
    const sx = vw / s, sy = vh / s;
    const ox = clamp(cx - sx / 2, 0, 1 - sx), oy = clamp(cy - sy / 2, 0, 1 - sy);
    const M = m4.trs(0, 0, -zb, 0, 0, 0, W * ov * 1.06, H * ov * 1.06);
    gl.uniformMatrix4fv(u.uMVP, false, m4.mul(VP, M));
    gl.uniform4f(u.uCrop, sx * 1.06, sy * 1.06, ox - sx * 0.03, oy - sy * 0.03);
    gl.uniform2f(u.uCam, (o.camx || 0), (o.camy || 0));
    gl.uniform1f(u.uBlur, o.blur == null ? 1.4 : o.blur); gl.uniform1f(u.uFocus, o.focus == null ? 0.82 : o.focus); gl.uniform1f(u.uRef, o.ref == null ? 0.8 : o.ref);
    gl.uniform3f(u.uShade, o.top == null ? 0.8 : o.top, o.bot == null ? 0.7 : o.bot, o.dim == null ? 0.18 : o.dim);
    const tn = o.tint || [1, 1, 1]; gl.uniform3f(u.uTint, tn[0], tn[1], tn[2]); gl.uniform1f(u.uTime, curT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.tex); gl.uniform1i(u.uTex, 0);
    gl.disable(gl.BLEND); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return { sx, sy, ox, oy, zb, ov };
  }
  /* position écran d'un point (u,v) de la photo, pour accrocher des éléments (soleil, tracé) */
  function photoPoint(info, u, v) {
    const px = ((u - info.ox) / info.sx) * W, py = ((v - info.oy) / info.sy) * H;
    return [px, py];
  }
  /* un élément posé « sur » la photo, légèrement en avant (lift) : même taille apparente, vraie parallaxe */
  function onPhoto(info, u, v, lift = 0) {
    const p = photoPoint(info, u, v), sc = (D + info.zb - lift) / D;
    return { x: (p[0] - W / 2) * sc, y: (H / 2 - p[1]) * sc, z: -info.zb + lift, sc };
  }

  /* ───────────── particules ───────────── */
  function drawParticles(a = 1, count = partCount) {
    const pr = P.part, u = pr.u; useProgram(pr); gl.bindVertexArray(partVAO);
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniform1f(u.uTime, curT); gl.uniform2f(u.uStage, W, H); gl.uniform1f(u.uPx, CW / W); gl.uniform1f(u.uD, D); gl.uniform1f(u.uAlpha, a);
    setBlend("over"); gl.drawArrays(gl.POINTS, 0, count);
  }

  /* ───────────── texte (rastérisé en textures, révélé derrière un masque) ───────────── */
  const SERIF = "ui-serif,'New York','Iowan Old Style','Palatino Linotype',Georgia,serif";
  const SANS = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif";
  const tcv = document.createElement("canvas"), tcx = tcv.getContext("2d");
  const WT = new Map();
  function font(size, weight, italic, sans) { return `${italic ? "italic " : ""}${weight} ${size}px ${sans ? SANS : SERIF}`; }
  function measureStr(s, size, weight = 400, italic = false, sans = false, kern = 0) {
    tcx.font = font(size, weight, italic, sans); if ("letterSpacing" in tcx) tcx.letterSpacing = kern + "px"; return tcx.measureText(s).width;
  }
  function textTex(s, size, o = {}) {
    const key = [s, size, o.weight || 400, o.italic ? 1 : 0, o.sans ? 1 : 0, o.kern || 0, o.color || "w"].join("|");
    let e = WT.get(key); if (e) return e;
    const r = CW / W, pad = Math.ceil(size * 0.25);
    tcx.font = font(size * r, o.weight || 400, o.italic, o.sans); if ("letterSpacing" in tcx) tcx.letterSpacing = (o.kern || 0) * r + "px";
    const w = Math.ceil(tcx.measureText(s).width) + pad * 2, h = Math.ceil(size * r * 1.5);
    tcv.width = w; tcv.height = h;
    tcx.font = font(size * r, o.weight || 400, o.italic, o.sans); if ("letterSpacing" in tcx) tcx.letterSpacing = (o.kern || 0) * r + "px";
    tcx.fillStyle = o.color || "#f4f9ff"; tcx.textBaseline = "alphabetic"; tcx.fillText(s, pad, size * r * 1.08);
    const t2 = makeTexture(tcv, { mip: false });
    e = { tex: t2.tex, w: w / r, h: h / r, pad: pad / r, base: size * 1.08 }; WT.set(key, e); return e;
  }
  function drawWord(e, x, baseY, a, extra = {}) {
    quad(Object.assign({ tex: e.tex, x: x - W / 2 + e.w / 2 - e.pad, y: H / 2 - (baseY - e.base) - e.h / 2, w: e.w, h: e.h, a, ortho: true }, extra));
  }
  /* titre : mots qui montent un à un derrière une fenêtre (scissor) */
  function titleLayout(str, size, maxW, kern) {
    const words = str.split(" "), space = measureStr(" ", size, 400, false, false, kern);
    const lines = [[]], lw = [0];
    words.forEach((w, i) => { const ww = measureStr(w, size, 400, false, false, kern), L = lines.length - 1, add = lines[L].length ? ww + space : ww;
      if (lw[L] + add > maxW && lines[L].length) { lines.push([i]); lw.push(ww); } else { lines[L].push(i); lw[L] += add; } });
    return { words, lines, lw, space };
  }
  function title(str, it, size, x, top, maxW, p, o = {}) {
    const kern = -size * 0.02, lay = titleLayout(str, size, maxW, kern), lh = size * (o.leading || 1.03), st = 0.1, n = lay.words.length, r = CW / W;
    gl.enable(gl.SCISSOR_TEST);
    lay.lines.forEach((line, li) => {
      let cx = o.center ? x - lay.lw[li] / 2 : x; const y = top + li * lh;
      gl.scissor(0, Math.floor((H - (y + lh * 1.02)) * r), CW, Math.ceil(lh * 1.06 * r));
      line.forEach(i => {
        const q = clamp(p * (1 + (n - 1) * st) - i * st), e = eOutQuart(q);
        const wt = textTex(lay.words[i], size, { italic: i >= it, kern, color: o.color });
        drawWord(wt, cx, y + size * 0.88 + (1 - e) * lh * 1.05, Math.min(1, e * 2.2));
        cx += measureStr(lay.words[i], size, 400, i >= it, false, kern) + lay.space;
      });
    });
    gl.disable(gl.SCISSOR_TEST);
    return top + lay.lines.length * lh;
  }
  function caps(s, x, y, a = 1, o = {}) {
    const size = o.size || 24, kern = size * 0.22, str = s.toUpperCase(), w = measureStr(str, size, 600, false, true, kern);
    const e = textTex(str, size, { weight: 600, sans: true, kern, color: o.color || "#4cc9ff" });
    drawWord(e, o.center ? x - w / 2 : x, y + size, a);
    return w;
  }
  function plain(s, x, baseY, size, a = 1, o = {}) {
    const e = textTex(s, size, { weight: o.weight || 400, italic: o.italic, sans: o.sans, kern: o.kern || 0, color: o.color });
    const w = measureStr(s, size, o.weight || 400, o.italic, o.sans, o.kern || 0);
    drawWord(e, o.center ? x - w / 2 : o.right ? x - w : x, baseY, a); return w;
  }
  let mountTex = null;
  function ensureMount() {
    if (mountTex) return; const pad = 44, w = 440, h = Math.round(w * 0.34), c = document.createElement("canvas"); c.width = w + pad * 2; c.height = h + pad * 2;
    const x = c.getContext("2d"), P = [[0, 1], [0.24, 0.40], [0.38, 0.62], [0.64, 0], [1, 1]];
    const path = () => { x.beginPath(); P.forEach((q, i) => { const px = pad + q[0] * w, py = pad + q[1] * h; i ? x.lineTo(px, py) : x.moveTo(px, py); }); };
    const g = x.createLinearGradient(0, pad, 0, pad + h); g.addColorStop(0, "rgba(255,255,255,.30)"); g.addColorStop(1, "rgba(255,255,255,0)");
    path(); x.fillStyle = g; x.fill();
    x.shadowColor = "rgba(140,217,255,.7)"; x.shadowBlur = 26; x.strokeStyle = "rgba(255,255,255,.95)"; x.lineWidth = w * 0.036; x.lineCap = "round"; x.lineJoin = "round"; path(); x.stroke();
    mountTex = makeTexture(c, { mip: false }); mountTex.k = 1 / w; mountTex.pad = pad; mountTex.gw = w; mountTex.gh = h;
  }
  /* le logo : le mot « SnowLine » (jamais en capitales) avec la montagne de la marque, pic au-dessus du L (voir SnowBrandMark.swift) */
  function lockup(x, baseY, size, a, o = {}) {
    ensureMount(); const kern = -size * 0.02, ww = measureStr("SnowLine", size, 700, false, true, kern);
    const x0 = o.center ? x - ww / 2 : o.right ? x - ww : x;
    plain("SnowLine", x0, baseY, size, a, { sans: true, weight: 700, kern, color: o.color });
    const mw = size * 1.32, k = mw / mountTex.gw, peak = x0 + ww * 0.565, left = peak - 0.64 * mw, bottom = baseY - size * 0.80;
    const tw = (mountTex.gw + mountTex.pad * 2) * k, th = (mountTex.gh + mountTex.pad * 2) * k;
    quad({ tex: mountTex, x: left - mountTex.pad * k + tw / 2 - W / 2, y: H / 2 - (bottom - mountTex.gh * k - mountTex.pad * k + th / 2) , w: tw, h: th, a, ortho: true, mode: 0 });
    return ww;
  }
  /* pastille « verre » ; retourne sa largeur */
  function chip(s, x, y, p, size = 30) {
    const kern = 0.2, tw = measureStr(s, size, 600, false, true, kern), padX = size * 0.9, h = size * 2.25, w = tw + padX * 2 + size * 0.9;
    if (p <= 0) return w;
    const e = eOutBack(p), al = Math.min(1, p * 2.2), sc = 0.72 + 0.28 * e;
    const cx = x + w / 2 - W / 2, cy = H / 2 - (y + h / 2);
    quad({ x: cx, y: cy, w: w * sc + 40, h: h * sc + 40, r: h * sc / 2, mode: 4, aux: [26 * sc, 0], a: al * 0.9, ortho: true });
    quad({ x: cx, y: cy, w: w * sc, h: h * sc, r: h * sc / 2, mode: 1, tint: [0.03, 0.07, 0.14, 0.78], a: al, ortho: true });
    quad({ x: cx, y: cy, w: w * sc - 3, h: h * sc - 3, r: h * sc / 2, mode: 1, tint: [0.4, 0.62, 0.95, 0.10], a: al, ortho: true, add: true });
    const tt = textTex(s, size, { weight: 600, sans: true, kern });
    // point « vitesse »
    quad({ x: x + padX * 0.75 - W / 2, y: cy, w: size * 0.38 * sc, h: size * 0.38 * sc, r: size * 0.19 * sc, mode: 1, tint: [0.18, 0.77, 1, 1], a: al, ortho: true });
    drawWord(tt, x + padX * 1.25 + size * 0.2, y + h / 2 + size * 0.34, al);
    return w;
  }

  /* ───────────── téléphone en 3D ───────────── */
  const PN = 4.6;                                           // exposant des coins « continus » de l'iPhone
  function rotVec(rx, ry, rz, v) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    const x1 = v[0], y1 = v[1] * cx - v[2] * sx, z1 = v[1] * sx + v[2] * cx;            // Rx
    const x2 = x1 * cy + z1 * sy, y2 = y1, z2 = -x1 * sy + z1 * cy;                    // Ry
    return [x2 * cz - y2 * sz, x2 * sz + y2 * cz, z2];                                 // Rz
  }
  /* flanc en titane : maillage lisse suivant la silhouette officielle, éclairé (aucune couche empilée, donc aucune strie) */
  function wall(key, o) {
    const W_ = WALL[key], pr = P.wall, u = pr.u; useProgram(pr);
    const M = m4.trs(o.x, o.y, o.z, o.rx || 0, o.ry || 0, o.rz || 0, 1, 1, 1);
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniformMatrix4fv(u.uModel, false, M); gl.uniform1f(u.uK, o.k); gl.uniform1f(u.uThick, o.thick);
    gl.uniform3f(u.uEye, EYE[0], EYE[1], EYE[2]); gl.uniform1f(u.uAlpha, o.a == null ? 1 : o.a); const b = o.base || [0.20, 0.21, 0.24]; gl.uniform3f(u.uBase, b[0], b[1], b[2]);
    setBlend("over"); gl.bindVertexArray(W_.vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, W_.count);
  }

  /* châssis officiel de l'iPhone 17 Pro Max (art vectoriel du Simulateur Xcode, 474×990 pt, écran 440×956 pt à (17,17)) */
  function phone(o) {
    const k = o.w / 474, FW = 474 * k, FH = 990 * k, sw = 440 * k, sh = 956 * k, bodyW = 456 * k, rBody = 80 * k;
    const a = o.a == null ? 1 : o.a, rx = o.rx || 0, ry = o.ry || 0, rz = o.rz || 0, z0 = o.z || 0;
    const at = (dx, dy, dz) => { const v = rotVec(rx, ry, rz, [dx, dy, dz]); return { x: o.x + v[0], y: o.y + v[1], z: z0 + v[2], rx, ry, rz }; };
    const thick = 46 * k;
    if (o.glow !== 0) quad({ x: o.x, y: o.y, z: z0 - 30, w: FW * 2.6, h: FH * 1.5, mode: 5, tint: [0.14, 0.45, 1, 0.30 * (o.glow == null ? 1 : o.glow)], aux: [4.2, 0], a, add: true });
    quad(Object.assign({ w: bodyW * 1.35, h: FH * 1.12, r: rBody, n: PN, mode: 4, aux: [bodyW * 0.22, 0], a: a * 0.9 }, at(0, -FH * 0.035, -thick - 4)));
    // épaisseur : flanc lisse suivant la silhouette officielle
    wall("phone", Object.assign({ k, thick: 46, a }, at(0, 0, 0)));
    // écran (capture HD), puis châssis par-dessus : le trou du châssis épouse l'écran au pixel près
    const zz = o.zoom || 0, pz = o.pan || [0, 0];
    quad(Object.assign({ tex: o.tex, mode: 0, w: sw + 1, h: sh + 1, r: 52 * k, a, rect: [zz * 0.5 + pz[0], zz * 0.5 + pz[1], 1 - zz * 0.5 + pz[0], 1 - zz * 0.5 + pz[1]] }, at(0, 0, 0.3)));
    quad(Object.assign({ tex: TEX.frame, mode: 0, w: FW, h: FH, a }, at(0, 0, 0.7)));
    quad(Object.assign({ mode: 3, aux: [0.55 + ry * 1.4 + (o.sheen || 0), 0], add: true, w: sw, h: sh, r: 62 * k, n: PN, a }, at(0, 0, 0.9)));
    return { w: FW, h: FH, sw, sh, r: rBody, b: 17 * k };
  }

  /* ───────────── cartes d'interface flottantes (découpées dans les captures) ───────────── */
  const CROPS = {
    dashGauge: ["dashboard", 0.03, 0.345, 0.97, 0.525], dashWeather: ["dashboard", 0.03, 0.535, 0.97, 0.725], dashStats: ["dashboard", 0.03, 0.735, 0.97, 0.815],
    dashTiles: ["dashboard", 0.03, 0.825, 0.97, 0.935], dashDay: ["dashboard", 0.03, 0.115, 0.97, 0.185],
    terrain: ["model3d", 0.08, 0.30, 0.92, 0.76], hudTop: ["model3d", 0.03, 0.05, 0.97, 0.205], replayBar: ["model3d", 0.04, 0.82, 0.96, 0.955],
    speedBar: ["speedmap", 0.04, 0.80, 0.96, 0.945], fallCard: ["fall", 0.05, 0.60, 0.95, 0.81], fallRing: ["fall", 0.12, 0.17, 0.88, 0.545],
    rows: ["groups", 0.04, 0.345, 0.96, 0.725], rowsA: ["groups", 0.04, 0.345, 0.96, 0.50], rowsB: ["groups", 0.04, 0.46, 0.96, 0.615], rowsC: ["groups", 0.04, 0.58, 0.96, 0.725], lockWidget: ["lock", 0.03, 0.707, 0.97, 0.859], lockClock: ["lock", 0.05, 0.09, 0.95, 0.22],
    discList: ["discover", 0.03, 0.30, 0.97, 0.60], discSearch: ["discover", 0.03, 0.19, 0.97, 0.30],
  };
  function card(key, o) {
    const c = CROPS[key], T = tx(c[0]); if (!T) return;
    const w = o.w, h = w * (c[4] - c[2]) / (c[3] - c[1]) * (T.h / T.w), a = o.a == null ? 1 : o.a, r = o.r == null ? w * 0.045 : o.r;
    const lim = W / 2 - w * 0.5 * Math.cos(o.ry || 0) - 18; o = Object.assign({}, o, { x: clamp(o.x, -lim, lim), y: o.y + 7 * Math.sin(curT * 1.4 + (o.x || 0) * 0.01) });
    const base = { x: o.x, y: o.y, z: o.z || 0, rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0 };
    quad(Object.assign({ w: w * 1.25, h: h * 1.5, r, mode: 4, aux: [w * 0.12, 0], a: a * 0.85 }, base, { y: o.y - h * 0.10, z: (o.z || 0) - 6 }));
    quad(Object.assign({ tex: T, rect: [c[1], c[2], c[3], c[4]], w, h, r, a, lod: 0 }, base));
    quad(Object.assign({ w: w - 2, h: h - 2, r, mode: 1, tint: [0.55, 0.78, 1, 0.12], add: true, a }, base, { z: (o.z || 0) + 0.4 }));
    return { w, h };
  }

  /* Apple Watch Series 11 46 mm : châssis officiel (boîtier, couronne bouton latéral) + bracelet qui s'estompe, flanc 3D lisse */
  function watchObj(o) {
    const T = tx("watch"); if (!T || !TEX["watch-frame"]) return;
    const k = o.w / 512, FW = 512 * k, FH = 982 * k, a = o.a == null ? 1 : o.a, rx = o.rx || 0, ry = o.ry || 0, rz = o.rz || 0, z0 = o.z || 0;
    const at = (dx, dy, dz) => { const v = rotVec(rx, ry, rz, [dx, dy, dz]); return { x: o.x + v[0], y: o.y + v[1], z: z0 + v[2], rx, ry, rz }; };
    quad(Object.assign({ w: 496 * k * 1.5, h: 576 * k * 1.5, r: 72 * k, mode: 4, aux: [496 * k * 0.2, 0], a: a * 0.75 }, at(-5 * k, -30 * k, -60 * k)));
    wall("watch", Object.assign({ k, thick: 92, a, base: [0.15, 0.16, 0.19] }, at(-5 * k, 0, 0)));
    quad(Object.assign({ tex: T, mode: 0, w: 418 * k, h: 498 * k, r: 40 * k, a }, at(-5 * k + 0, 0, 0.3)));
    quad(Object.assign({ tex: TEX["watch-frame"], mode: 0, w: FW, h: FH, a }, at(0, 0, 0.7)));
    quad(Object.assign({ mode: 3, aux: [0.35 + (o.sheen || 0), 0], add: true, w: 416 * k, h: 496 * k, r: 58 * k, n: PN, a }, at(-5 * k, 0, 0.9)));
  }

  /* ───────────── ruban de vitesse qui flotte au-dessus du relief ───────────── */
  const PATH = [[0.69, 0.575], [0.69, 0.625], [0.68, 0.685], [0.74, 0.735], [0.8, 0.785], [0.8, 0.845], [0.72, 0.915], [0.6, 0.975], [0.52, 1.03]];
  function catmull(p, n) {
    const out = [];
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)];
      for (let s = 0; s < n; s++) { const t = s / n, t2 = t * t, t3 = t2 * t, c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3); out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]); }
    }
    out.push(p[p.length - 1]); return out;
  }
  const TRACE = catmull(PATH, 22);
  const speedProfile = p => Math.pow(Math.sin(Math.min(p / 0.72, 1) * Math.PI / 2), 1.15) * (1 - 0.22 * clamp((p - 0.72) / 0.28));
  const STOPS = [[0.176, 0.482, 1], [0.18, 0.77, 1], [1, 0.82, 0.25], [1, 0.3, 0.24]];
  function speedRGB(p) { const q = clamp(p) * 3, i = Math.min(Math.floor(q), 2), f = q - i, a = STOPS[i], b = STOPS[i + 1]; return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]; }
  let ribbonTex = null;
  function ensureDot() {
    if (ribbonTex) return; const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); ribbonTex = makeTexture(c, { mip: false });
  }
  function drawRibbon(info, prog, o = {}) {
    ensureDot(); const n = TRACE.length, head = Math.floor((n - 1) * prog), lift = o.lift == null ? 60 : o.lift;
    const pts = []; for (let i = 0; i <= head; i++) pts.push(onPhoto(info, TRACE[i][0], TRACE[i][1], lift));
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i], c = speedRGB(speedProfile(i / (n - 1))), k = i / Math.max(1, pts.length - 1);
        const size = (pass === 0 ? 120 : pass === 1 ? 42 : 17 + 9 * k) * q.sc, alpha = pass === 0 ? 0.20 : pass === 1 ? 0.55 : 1;
        quad({ tex: ribbonTex, x: q.x, y: q.y, z: q.z + (pass === 2 ? 3 : 0), w: size, h: size, tint: [c[0], c[1], c[2], 1], a: alpha, add: pass < 2, mode: 0 });
      }
    }
    if (pts.length) { const h = pts[pts.length - 1];
      quad({ tex: ribbonTex, x: h.x, y: h.y, z: h.z + 8, w: 220 * h.sc, h: 220 * h.sc, tint: [1, 1, 1, 1], a: 0.9, add: true, mode: 0 });
      quad({ tex: ribbonTex, x: h.x, y: h.y, z: h.z + 10, w: 46 * h.sc, h: 46 * h.sc, tint: [1, 1, 1, 1], a: 1, mode: 0 }); }
    return pts;
  }

  /* ───────────── caméra ───────────── */
  let D = 1000, FOV = 26 * Math.PI / 180, EYE = [0, 0, 1000];
  function setCamera(c = {}) {
    D = (H / 2) / Math.tan(FOV / 2);
    const shk = reduce ? 0 : 1, dz = (c.dz || 0), ex = (c.x || 0) + 3.5 * Math.sin(curT * 1.3) * shk, ey = (c.y || 0) + 2.6 * Math.sin(curT * 1.7 + 1) * shk;
    const eye = [ex + (c.orbit || 0) * 0, ey, D + dz];
    const yaw = c.yaw || 0, pitch = c.pitch || 0;
    // la caméra tourne autour de l'origine (vue orbitale)
    const rad = D + dz, cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const e = [ex + rad * syw * cp, ey + rad * sp, rad * cyw * cp];
    EYE = e; V = m4.lookAt(e, [c.tx || 0, c.ty || 0, 0], [Math.sin((c.roll || 0) + 0.0025 * Math.sin(curT * 0.9) * shk), Math.cos(c.roll || 0), 0]);
    PR = m4.persp(FOV, W / H, 50, 6000); VP = m4.mul(PR, V);
  }
  const drawOverlayBegin = () => { ORTHO = m4.ortho(-W / 2, W / 2, -H / 2, H / 2); };

  /* ───────────── mise en page ───────────── */
  function L() {
    if (PORTRAIT) return { x: 64, tag: 140, titleTop: 214, titleSize: 90, titleW: W - 128, pw: 600, px: 0, py: -(H * 0.075) - 62, chipsRow: true };
    return { x: W * 0.07, tag: H * 0.2, titleTop: H * 0.265, titleSize: 80, titleW: W * 0.4, pw: H * 0.405, px: W * 0.2, py: 0, chipsRow: false };
  }

  /* ───────────── scènes ───────────── */
  // helper : en-tête de scène (étiquette, filet, titre) ; renvoie le bas du titre
  function header(tag, titleStr, it, u, l) {
    caps(tag, l.x, l.tag, eOutCubic(ramp(u, 0.15, 0.5)));
    const w = 150 * eOutExpo(ramp(u, 0.25, 0.7));
    quad({ x: l.x + w / 2 - W / 2, y: H / 2 - (l.tag + 44), w, h: 4, mode: 1, tint: [0.3, 0.7, 1, 1], a: 1, ortho: true });
    return title(titleStr, it, l.titleSize, l.x, l.titleTop, l.titleW, ramp(u, 0.12, 0.85));
  }
  function chips(list, bottom, u, l) {
    let cx = l.x, cy = bottom + 24;
    list.forEach((c, i) => { const w = chip(c, cx, cy, ramp(u, 0.9 + i * 0.3, 0.55)); if (PORTRAIT) cx += w + 14; else cy += 92; });
  }

  function sceneIntro(u, dur, tt) {
    const k = eInOut(clamp(u / dur)), l = L(), key = PORTRAIT ? "m7" : "hero";
    setCamera({ dz: -(220 * k) + 60 * Math.sin(tt * 0.5), x: 0, y: 0, yaw: -0.05 + 0.1 * k });
    const sun = PORTRAIT ? [0.235, 0.36] : [0.866, 0.336];
    const info = drawBG(key, { zoom: 1.22 - 0.1 * k, cy: PORTRAIT ? 0.58 : 0.52, camx: -0.02 * k + 0.012, top: 0.55, bot: 0.7, dim: 0.06, blur: 1.1, focus: 0.9 });
    // soleil : halo + traînée anamorphique qui bat avec la musique
    const so = onPhoto(info, sun[0], sun[1], 4), pu = pulse(tt);
    quad({ x: so.x, y: so.y, z: so.z, w: 1000 * so.sc, h: 1000 * so.sc, mode: 5, tint: [1, 0.72, 0.38, 0.46 + 0.04 * pu], aux: [3.6, 0], add: true });
    quad({ x: so.x, y: so.y, z: so.z, w: W * 1.3 * so.sc, h: 120 * so.sc, mode: 6, tint: [1, 0.85, 0.6, 0.20 + 0.03 * pu], aux: [9, 3.2], add: true });
    drawParticles(0.9, 330);
    drawOverlayBegin();
    if (PORTRAIT) {
      caps(TXT[lang].introTag, W / 2, 610, eOutCubic(ramp(u, 0.5, 0.7)), { center: true });
      title(TXT[lang].intro, TXT[lang].introIt, 108, W / 2, 668, W - 150, ramp(u, 0.45, 1.9), { center: true, leading: 1.0 });
    } else {
      caps(TXT[lang].introTag, W * 0.07, H * 0.33, eOutCubic(ramp(u, 0.5, 0.7)));
      title(TXT[lang].intro, TXT[lang].introIt, 100, W * 0.07, H * 0.39, W * 0.5, ramp(u, 0.45, 1.9), { leading: 1.0 });
    }
    return { fadeIn: 1 - eOutCubic(clamp(tt / 1.0)) };
  }

  function sceneTrace(u, dur, tt) {
    const k = eInOut(clamp(u / dur)), prog = eInOut(ramp(u, 0.55, dur - 1.2));
    setCamera({ dz: -120 * k, yaw: 0.10 - 0.16 * k, pitch: 0.06 - 0.05 * k, x: 0, y: 0 });
    const info = drawBG("m2", { zoom: PORTRAIT ? 1.0 : 1.0, cy: PORTRAIT ? 0.78 : 0.7, camx: 0.05 * (k - 0.5), camy: 0.03, top: 0.6, bot: 0.4, dim: 0.04, blur: 1.4, focus: 0.78, ref: 0.82, zb: 380 });
    drawRibbon(info, prog, { lift: 70 });
    drawParticles(0.8, 240);
    drawOverlayBegin();
    const lx = PORTRAIT ? 64 : W * 0.07, ly = PORTRAIT ? 140 : H * 0.2, v = Math.round(84 * speedProfile(prog));
    caps(TXT[lang].traceTag, lx, ly, eOutCubic(ramp(u, 0.15, 0.5)));
    const size = PORTRAIT ? 250 : 270, a = eOutCubic(ramp(u, 0.2, 0.6)), cell = measureStr("0", size, 400, false, false, -6) + 4;
    String(v).split("").forEach((ch, i) => plain(ch, lx + i * cell, ly + (PORTRAIT ? 300 : 320), size, a, { kern: -6 }));
    plain("km/h", lx + cell * String(v).length + 14, ly + (PORTRAIT ? 300 : 320), 44, eOutCubic(ramp(u, 0.35, 0.6)), { sans: true, weight: 500, kern: 2, color: "#bcd6f2" });
    plain(TXT[lang].traceSub, lx, ly + (PORTRAIT ? 372 : 392), 34, eOutCubic(ramp(u, 0.6, 0.6)), { sans: true, kern: 0.5, color: "#cce0f7" });
    return {};
  }

  function sceneDash(u, dur, tt) {
    const l = L(), T = TXT[lang], enter = eOutExpo(ramp(u, 0, 1.2)), prep = eInOut(ramp(u, 1.3, dur - 1.3));
    setCamera({ dz: -80 * prep, yaw: 0.07 * Math.sin(u * 0.8), pitch: -0.02 });
    drawBG("m1", { zoom: 1.18, cy: 0.62, camx: 0.02 * Math.sin(u * 0.6), top: 0.55, bot: 0.4, dim: 0.10, blur: 1.8, focus: 0.86, zb: 520 });
    drawParticles(0.9, 300);
    const pw = l.pw * (1 + 0.04 * prep), py = l.py - (1 - enter) * H * 0.9;
    const d = phone({ tex: tx("dashboard"), x: l.px, y: py, z: 0, w: pw, rx: 0.10 * (1 - enter) - 0.02, ry: -0.42 * (1 - enter) + 0.10 * Math.sin(u * 1.1), rz: 0.10 * (1 - enter), a: 1, sheen: 0.4 * Math.sin(u) });
    // les modules de l'interface se détachent du téléphone, au rythme de la musique
    const spread = eOutBack(ramp(u, 1.0, 0.9)), ex = prep * 0.35;
    const s = PORTRAIT ? 1 : 0.8;
    card("dashGauge", { x: l.px - 250 * s * spread, y: l.py - 250 * s * spread, z: 120 * spread, w: 480 * s, ry: 0.28, rz: -0.03, a: spread });
    card("dashWeather", { x: l.px + 260 * s * spread, y: l.py + 120 * s * spread, z: 170 * spread, w: 480 * s, ry: -0.30, rz: 0.03, a: spread });
    card("dashTiles", { x: l.px - 230 * s * spread, y: l.py + 470 * s * spread, z: 90 * spread, w: 440 * s, ry: 0.22, a: spread });
    drawOverlayBegin();
    caps(T.dashTag, l.x, l.tag, eOutCubic(ramp(u, 0.15, 0.5)));
    title(T.dash, T.dashIt, l.titleSize, l.x, l.titleTop, l.titleW, ramp(u, 0.12, 0.85));
    return { build: prep };
  }

  /* scène « fonction » : téléphone en orbite lente + cartes flottantes spécifiques */
  function sceneFeature(idx, bg, screen, u, dur, tt, deco) {
    const l = L(), S = TXT[lang].scenes[idx], k = u / dur;
    const enter = eOutExpo(ramp(u, 0.04, 0.85)), exit = eInOut(ramp(u, dur - 0.5, 0.5));
    const dir = idx % 2 ? -1 : 1, orbit = dir * (0.32 - 0.58 * k);
    setCamera({ yaw: orbit * 0.55, pitch: 0.035 - 0.05 * k, dz: 110 * (1 - eOutExpo(ramp(u, 0, 0.7))) - 90 * k - 70 * exit });
    drawBG(bg, { zoom: 1.12 + 0.2 * k, cy: 0.55, camx: -orbit * 0.2, top: 0.55, bot: 0.38, dim: 0.05, blur: 1.6, focus: 0.84, zb: 520 });
    drawParticles(0.85, 300);
    const py = l.py + (1 - enter) * H * 0.95 - exit * 50;
    phone({ tex: tx(screen), x: l.px, y: py, z: 0, w: l.pw, rx: 0.12 * (1 - enter), ry: -dir * 0.46 * (1 - enter) + 0.22 * Math.sin(u * 1.15 + idx), rz: 0.10 * (1 - enter) * dir, a: 1 - exit * 0.4, sheen: 0.6 * Math.sin(u * 0.9), zoom: 0.02 + 0.08 * k, pan: [0.02 * Math.sin(u * 0.7 + idx), -0.03 * k] });
    if (deco) deco(u, dur, l, py);
    drawOverlayBegin();
    caps(S.tag, l.x, l.tag, eOutCubic(ramp(u, 0.1, 0.4)));
    const w = 150 * eOutExpo(ramp(u, 0.15, 0.5));
    quad({ x: l.x + w / 2 - W / 2, y: H / 2 - (l.tag + 42), w, h: 4, mode: 1, tint: [0.3, 0.7, 1, 1], a: 1, ortho: true });
    const bottom = title(S.title, S.it, l.titleSize, l.x, l.titleTop, l.titleW, ramp(u, 0.12, 0.8));
    chips(S.chips, bottom, u, l);
    return {};
  }
  const down = (py, d) => py - d;                    // y vers le haut en monde : « d » positif = vers le bas de l'écran
  const decoReplay = (u, dur, l, py) => {
    const e = eOutBack(ramp(u, 0.9, 0.8)), s = PORTRAIT ? 1 : 0.8;
    card("hudTop", { x: l.px + 250 * s * e, y: down(py, -400 * s), z: 150 * e, w: 540 * s, ry: -0.26, rz: 0.03, a: e });
    card("replayBar", { x: l.px - 230 * s * e, y: down(py, 440 * s), z: 110 * e, w: 560 * s, ry: 0.24, rz: -0.02, a: e });
  };
  const decoMap = (u, dur, l, py) => {
    const e = eOutBack(ramp(u, 0.9, 0.8)), s = PORTRAIT ? 1 : 0.8;
    card("speedBar", { x: l.px - 210 * s * e, y: down(py, 440 * s), z: 140 * e, w: 580 * s, ry: 0.24, rz: -0.02, a: e });
  };
  const decoLock = (u, dur, l, py) => {
    const e = eOutBack(ramp(u, 0.9, 0.9)), s = PORTRAIT ? 1 : 0.8;
    card("lockWidget", { x: l.px - 190 * s * e, y: down(py, 330 * s), z: 150 * e, w: 520 * s, r: 520 * s * 0.07, ry: 0.22, rz: -0.025, a: e });
    watchObj({ x: l.px + 262 * s * e, y: down(py, 120 * s - (1 - e) * 160), z: 170 * e, w: 330 * s, ry: -0.30, rz: 0.10, a: Math.min(1, e * 2), sheen: 0.3 * Math.sin(u) });
  };
  const decoFall = (u, dur, l, py) => {
    const e = eOutBack(ramp(u, 0.9, 0.8)), s = PORTRAIT ? 1 : 0.8, ph = (u * 1.2) % 1;
    quad({ x: l.px, y: down(py, -40), z: -40, w: 900 * s, h: 900 * s, mode: 7, tint: [1, 0.25, 0.2, 0.6 * (1 - ph)], aux: [0.25 + 0.7 * ph, 7], add: true });
    card("fallCard", { x: l.px + 230 * s * e, y: down(py, 380 * s), z: 150 * e, w: 500 * s, ry: -0.3, rz: 0.02, a: e });
  };
  const decoGroups = (u, dur, l, py) => {
    const s = PORTRAIT ? 1 : 0.8;
    for (let i = 0; i < 3; i++) { const e = eOutBack(ramp(u, 0.8 + i * 0.18, 0.8));
      card(["rowsA", "rowsB", "rowsC"][i], { x: l.px + (250 - i * 22) * s * e, y: down(py, (-330 + i * 270) * s), z: (80 + i * 50) * e, w: 420 * s, ry: -0.3, rz: 0.02 * (i - 1), a: e }); }
  };
  const decoShare = (u, dur, l, py) => {
    const e = eOutBack(ramp(u, 0.9, 0.8)), s = PORTRAIT ? 1 : 0.8;
    const T = tx("share"); if (T) { const w = 330 * s, h = w * T.h / T.w, x = clamp(l.px - 235 * s * e, -(W / 2 - w / 2 - 16), W / 2); quad({ w: w * 1.3, h: h * 1.2, x, y: down(py, -20 * s), z: 130 * e, r: w * 0.07, mode: 4, aux: [w * 0.12, 0], a: e * 0.85, ry: 0.3 });
      quad({ tex: T, x, y: down(py, -20 * s), z: 130 * e, w, h, r: w * 0.07, ry: 0.3, rz: -0.05, a: e }); }
  };
  const decoDiscover = (u, dur, l, py) => {
    const e = eOutBack(ramp(u, 0.9, 0.8)), s = PORTRAIT ? 1 : 0.8;
    card("discSearch", { x: l.px - 220 * s * e, y: down(py, -330 * s), z: 130 * e, w: 460 * s, ry: 0.3, a: e });
    const T = tx("discovermap"); if (T) { const w = 290 * s, h = w * T.h / T.w; quad({ w: w * 1.3, h: h * 1.2, x: l.px + 250 * s * e, y: down(py, 90 * s), z: 150 * e, r: w * 0.08, mode: 4, aux: [w * 0.12, 0], a: e * 0.85, ry: -0.3 });
      quad({ tex: T, x: l.px + 250 * s * e, y: down(py, 90 * s), z: 150 * e, w, h, r: w * 0.08, ry: -0.3, rz: 0.05, a: e }); }
  };

  function sceneFinale(u, dur, tt) {
    const T = TXT[lang], l = L();
    setCamera({ dz: 140 * (1 - eOutExpo(ramp(u, 0, 1.6))) - 40 * ramp(u, 1.6, dur), yaw: 0.08 * Math.sin(u * 0.5) });
    drawBG("m5", { zoom: 1.12, cy: 0.5, camx: 0.02 * Math.sin(u * 0.5), top: 0.55, bot: 0.55, dim: 0.14, blur: 1.8, focus: 0.84, zb: 540 });
    drawParticles(0.9, 320);
    const w = PORTRAIT ? 400 : H * 0.285, cx = PORTRAIT ? 300 : H * 0.30, y0 = PORTRAIT ? -30 : -12;
    const items = [["speedmap", -1, 0.42, -0.06], ["model3d", 1, 0.42, 0.06], ["dashboard", 0, 0, 0]];
    items.forEach((it, i) => {
      const e = eOutExpo(ramp(u, 0.15 + i * 0.16, 1.2));
      phone({ tex: tx(it[0]), x: it[1] * cx * (0.6 + 0.4 * e), y: y0 + (1 - e) * H * 0.9 - (i === 2 ? 0 : 40) + Math.sin(u * 1.2 + i) * 6, z: it[1] === 0 ? 60 : -40, w: it[1] === 0 ? w * 1.12 : w, ry: -it[1] * 0.32 * e + 0.05 * Math.sin(u * 0.7 + i), rz: it[3] * e, a: 1, glow: it[1] === 0 ? 1 : 0.5 });
    });
    drawOverlayBegin();
    if (PORTRAIT) title(T.finale, T.finaleIt, 96, W / 2, 150, W - 120, ramp(u, 0.2, 1.2), { center: true });
    else title(T.finale, T.finaleIt, 76, W / 2, H * 0.06, W * 0.8, ramp(u, 0.2, 1.2), { center: true });
    const nums = [0, 0, 7, 174], mx = PORTRAIT ? 64 : W * 0.1, colW = (W - 2 * mx) / 4, y0b = PORTRAIT ? 1620 : H * 0.86;
    nums.forEach((nn, i) => {
      const p = ramp(u, 1.4 + i * 0.25, 1.4), al = eOutCubic(ramp(u, 1.3 + i * 0.25, 0.5)), x = mx + colW * i;
      quad({ x: x + (colW - 22) / 2 - W / 2, y: H / 2 - y0b, w: colW - 22, h: 2, mode: 1, tint: [1, 1, 1, 0.22], a: al, ortho: true });
      plain(String(Math.round(nn * eOutCubic(p))), x, y0b + (PORTRAIT ? 104 : 80), PORTRAIT ? 92 : 70, al, { kern: -3 });
      plain(T.stats[i], x, y0b + (PORTRAIT ? 148 : 114), PORTRAIT ? 25 : 21, al, { sans: true, color: "#c2d6f0" });
    });
    return {};
  }

  function sceneEnd(u, dur, tt) {
    const T = TXT[lang];
    setCamera({ dz: 100 * (1 - eOutExpo(ramp(u, 0, 2))), yaw: 0.04 * Math.sin(u * 0.4) });
    const sun = PORTRAIT ? [0.235, 0.36] : [0.866, 0.336];
    const info = drawBG(PORTRAIT ? "m7" : "hero", { zoom: 1.14 - 0.06 * ramp(u, 0, dur), cy: PORTRAIT ? 0.58 : 0.52, top: 0.7, bot: 0.78, dim: 0.34, blur: 1.2, focus: 0.9, zb: 560 });
    const so2 = onPhoto(info, sun[0], sun[1], 4);
    quad({ x: so2.x, y: so2.y, z: so2.z, w: 900 * so2.sc, h: 900 * so2.sc, mode: 5, tint: [1, 0.7, 0.36, 0.5], aux: [3.2, 0], add: true });
    drawParticles(0.9, 330);
    const e = eOutExpo(ramp(u, 0.2, 1.2)), S = PORTRAIT ? 200 : 150, cy = PORTRAIT ? H * 0.34 : H * 0.3;
    quad({ x: 0, y: H / 2 - cy, z: 30, w: S * 3.2, h: S * 3.2, mode: 5, tint: [0.2, 0.55, 1, 0.5 * e], aux: [3.6, 0], add: true });
    quad({ x: 0, y: H / 2 - cy - 18, z: 20, w: S * 1.3, h: S * 1.3, r: S * 0.3, mode: 4, aux: [S * 0.2, 0], a: e });
    quad({ tex: TEX.icon, x: 0, y: H / 2 - cy - (1 - e) * 40, z: 40, w: S, h: S, r: S * 0.225, a: e });
    drawOverlayBegin();
    const wsz = PORTRAIT ? 150 : 128, wy2 = cy + S / 2 + (PORTRAIT ? 210 : 190);
    lockup(W / 2, wy2 + (1 - eOutExpo(ramp(u, 0.35, 1.2))) * 40, wsz, eOutExpo(ramp(u, 0.35, 1)), { center: true });
    caps(T.tagline, W / 2, wy2 + 36, eOutCubic(ramp(u, 0.9, 0.8)), { center: true, size: 27 });
    const bp = eOutBack(ramp(u, 1.3, 0.8)), bs = PORTRAIT ? 28 : 24, kern = 4, bt = T.badge.toUpperCase(), bw = measureStr(bt, bs, 700, false, true, kern) + 86, bh = bs * 3.6, by = wy2 + 130;
    quad({ x: 0, y: H / 2 - (by + bh / 2), w: bw * (0.8 + 0.2 * bp), h: bh * (0.8 + 0.2 * bp), r: bh / 2, mode: 1, tint: [1, 1, 1, 1], a: Math.min(1, bp * 2), ortho: true });
    plain(bt, W / 2, by + bh / 2 + bs * 0.34, bs, Math.min(1, bp * 2), { weight: 700, sans: true, kern, center: true, color: "#050d17" });
    return {};
  }

  /* ───────────── ligne de temps ───────────── */
  const SLOTS = [[0, bar(2)], [bar(2), bar(4)], [bar(4), bar(6)], [bar(6), bar(8)], [bar(8), bar(10)], [bar(10), bar(12)], [bar(12), bar(14)], [bar(14), bar(16)], [bar(16), bar(18)], [bar(18), bar(20)], [bar(20), bar(24)], [bar(24), TOTAL]];
  function slotAt(tt) { for (let i = 0; i < SLOTS.length; i++) if (tt >= SLOTS[i][0] && tt < SLOTS[i][1]) return i; return SLOTS.length - 1; }
  const chapterOf = i => (i >= 3 && i <= 9 ? i - 2 : 0);
  function drawSlot(i, tt) {
    const u = tt - SLOTS[i][0], dur = SLOTS[i][1] - SLOTS[i][0];
    switch (i) {
      case 0: return sceneIntro(u, dur, tt);
      case 1: return sceneTrace(u, dur, tt);
      case 2: return sceneDash(u, dur, tt);
      case 3: return sceneFeature(0, "m2", "model3d", u, dur, tt, decoReplay);
      case 4: return sceneFeature(1, "m3", "speedmap", u, dur, tt, decoMap);
      case 5: return sceneFeature(2, "m4", "lock", u, dur, tt, decoLock);
      case 6: return sceneFeature(3, "m5", "fall", u, dur, tt, decoFall);
      case 7: return sceneFeature(4, "m6", "groups", u, dur, tt, decoGroups);
      case 8: return sceneFeature(5, "m1", "replay", u, dur, tt, decoShare);
      case 9: return sceneFeature(6, "m7", "discover", u, dur, tt, decoDiscover);
      case 10: return sceneFinale(u, dur, tt);
      default: return sceneEnd(u, dur, tt);
    }
  }

  /* HUD : marque, chapitre, progression « vitesse » */
  let gradTex = null;
  function ensureGrad() { if (gradTex) return; const c = document.createElement("canvas"); c.width = 256; c.height = 4; const x = c.getContext("2d"); const g = x.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, "#2d7bff"); g.addColorStop(0.34, "#2ec4ff"); g.addColorStop(0.68, "#ffd23f"); g.addColorStop(1, "#ff4d3d"); x.fillStyle = g; x.fillRect(0, 0, 256, 4); gradTex = makeTexture(c, { mip: false }); }
  function hud(tt, chapter, a) {
    ensureGrad(); const m = PORTRAIT ? 64 : W * 0.07, p = clamp(tt / TOTAL), wTot = W - 2 * m;
    quad({ x: 0, y: H / 2 - 31, w: wTot, h: 3, mode: 1, tint: [1, 1, 1, 0.16], a, ortho: true });
    quad({ tex: gradTex, x: -wTot / 2 + wTot * p / 2, y: H / 2 - 31, w: wTot * p, h: 6, rect: [0, 0, p, 1], a, ortho: true, mode: 0 });
    lockup(m, 94, 34, a);
    if (chapter) plain(String(chapter).padStart(2, "0") + " / 07", W - m, 92, 30, a, { right: true, color: "#bcd0ed" });
  }

  /* ───────────── image complète ───────────── */
  function renderFrame(tt) {
    curT = tt; drawOverlayBegin();
    const cur = slotAt(tt), HALF = 0.26;
    // intensité de la traversée (flou radial) autour de chaque coupe
    let warp = 0;
    for (let i = 1; i < SLOTS.length; i++) { const d = Math.abs(tt - SLOTS[i][0]); if (d < HALF) warp = Math.max(warp, 1 - d / HALF); }
    warp = Math.pow(warp, 1.2);
    // scène
    gl.bindFramebuffer(gl.FRAMEBUFFER, FB.ms.fbo); gl.viewport(0, 0, CW, CH);
    gl.clearColor(0.01, 0.02, 0.04, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.DEPTH_TEST);
    const res = drawSlot(cur, tt) || {};
    if (cur !== 11) hud(tt, chapterOf(cur), cur === 0 ? eOutCubic(ramp(tt, 1, 0.8)) : 1);
    if (res.fadeIn) { drawOverlayBegin(); quad({ x: 0, y: 0, w: W, h: H, mode: 1, tint: [0, 0, 0, 1], a: res.fadeIn, ortho: true }); }
    // balayage lumineux de la marque (dégradé de vitesse) à chaque changement de scène
    ensureGrad(); drawOverlayBegin();
    for (let i = 1; i < SLOTS.length; i++) { const d = tt - SLOTS[i][0];
      if (d >= -0.06 && d < 0.6) { const e = eOutCubic((d + 0.06) / 0.66), y = H * (1 - e), al = (1 - e);
        quad({ tex: gradTex, x: 0, y: H / 2 - y, w: W, h: 14, rect: [0, 0, 1, 1], a: al, add: true, ortho: true, mode: 0 });
        quad({ tex: gradTex, x: 0, y: H / 2 - y, w: W, h: 120, rect: [0, 0, 1, 1], a: al * 0.12, add: true, ortho: true, mode: 0 }); } }
    // flashs sur le « drop » et l'accent final
    let flash = 0; for (const f of [bar(6), bar(24)]) { const d = tt - f; if (d >= 0 && d < 0.5) flash = Math.max(flash, Math.pow(1 - d / 0.5, 2)); }
    let shock = [0, 0]; for (const f of [bar(6), bar(24)]) { const d = tt - f; if (d >= 0 && d < 0.9) shock = [d * 1.3, 1 - d / 0.9]; }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, FB.ms.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, FB.scene.fbo); gl.blitFramebuffer(0, 0, CW, CH, 0, 0, CW, CH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    const fade = tt > TOTAL - 1.1 ? clamp((tt - (TOTAL - 1.1)) / 1.1) : 0;
    postProcess(tt, warp, flash, shock, fade);
  }

  /* bloom + composition finale (flou radial, aberration, vignette, grain) */
  function postProcess(tt, warp, flash, shock, fade) {
    gl.disable(gl.BLEND); gl.bindVertexArray(fsVAO);
    // 1. zones lumineuses
    useProgram(P.bright); gl.bindFramebuffer(gl.FRAMEBUFFER, FB.bright.fbo); gl.viewport(0, 0, FB.bright.w, FB.bright.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, FB.scene.tex); gl.uniform1i(P.bright.u.uTex, 0); gl.uniform1f(P.bright.u.uThr, 0.86);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // 2. flou gaussien à trois échelles
    let src = FB.bright;
    for (let i = 0; i < 3; i++) {
      const A = FB["t" + i], B = FB["b" + i];
      useProgram(P.blur);
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo); gl.viewport(0, 0, A.w, A.h); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(P.blur.u.uTex, 0); gl.uniform2f(P.blur.u.uDir, 1 / src.w * (1 + i * 0.4), 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, B.fbo); gl.viewport(0, 0, B.w, B.h); gl.bindTexture(gl.TEXTURE_2D, A.tex); gl.uniform2f(P.blur.u.uDir, 0, 1 / A.h * (1 + i * 0.4)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      src = B;
    }
    // 3. composition à l'écran
    useProgram(P.post); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, CW, CH);
    const u = P.post.u;
    const tex = [[FB.scene.tex, "uScene"], [FB.b0.tex, "uB0"], [FB.b1.tex, "uB1"], [FB.b2.tex, "uB2"]];
    tex.forEach((e, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, e[0]); gl.uniform1i(u[e[1]], i); });
    gl.uniform1f(u.uBloom, 0.40 + 0.5 * flash); gl.uniform1f(u.uWarp, warp); gl.uniform1f(u.uFlash, flash * 0.55);
    gl.uniform1f(u.uTime, tt); gl.uniform2f(u.uRes, CW, CH); gl.uniform1f(u.uGrain, 0.055); gl.uniform2f(u.uShock, shock[0], shock[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (fade > 0) { /* fondu final au noir par-dessus */
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); useProgram(P.quad); gl.bindVertexArray(quadVAO);
      const q = P.quad.u; gl.uniformMatrix4fv(q.uMVP, false, m4.mul(m4.ortho(-1, 1, -1, 1), m4.trs(0, 0, 0, 0, 0, 0, 2, 2))); gl.uniform2f(q.uSize, 2, 2); gl.uniform1f(q.uRadius, 0);
      gl.uniform1f(q.uAlpha, 1); gl.uniform4f(q.uTint, 0, 0, 0, fade); gl.uniform4f(q.uRect, 0, 0, 1, 1); gl.uniform1i(q.uMode, 1); gl.uniform1f(q.uLod, 0); gl.uniform2f(q.uLight, 0, 1); gl.uniform2f(q.uAux, 0, 0); gl.uniform1f(q.uTime, 0);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  /* ───────────── cycle de vie ───────────── */
  function resize() {
    const r = hostEl.getBoundingClientRect(); if (!r.width || !r.height) return;
    PORTRAIT = r.height >= r.width * 1.05;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); let cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
    const maxPx = PORTRAIT ? 2.4e6 : 3.0e6; if (cw * ch > maxPx) { const s = Math.sqrt(maxPx / (cw * ch)); cw = Math.round(cw * s); ch = Math.round(ch * s); }
    CW = Math.max(16, cw & ~1); CH = Math.max(16, ch & ~1); canvas.width = CW; canvas.height = CH;
    if (PORTRAIT) { W = 1080; H = Math.round(1080 * r.height / r.width); } else { H = 1080; W = Math.round(1080 * r.width / r.height); }
    if (gl) { buildTargets(); WT.forEach(e => gl.deleteTexture(e.tex)); WT.clear(); if (ready) renderFrame(t); }
  }
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
    if (playing) {
      if (soundOn && !audio.paused && audio.readyState > 2) t = audio.currentTime; else t += dt;
      if (t >= TOTAL) { t = 0; if (soundOn) { audio.currentTime = 0; audio.play().catch(() => {}); } }
    }
    if (ready) { renderFrame(t); if (chapterCb) chapterCb(t, chapterOf(slotAt(t))); }
    requestAnimationFrame(loop);
  }
  const start = () => { if (running) return; running = true; lastNow = performance.now(); requestAnimationFrame(loop); };
  const stop = () => { running = false; };

  const api = {
    async init(opts) {
      canvas = opts.canvas; hostEl = opts.host; audio = opts.audio; chapterCb = opts.onFrame || null; readyCb = opts.onReady || null;
      reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      initGL();
      new ResizeObserver(resize).observe(hostEl); resize();
      new IntersectionObserver(es => es.forEach(e => {
        inView = e.isIntersecting;
        if (inView && !frozen) loadAll().then(() => { if (frozen) return; resize(); if (!reduce) playing = true; start(); if (readyCb) readyCb(); });
        else { playing = false; stop(); if (audio && !audio.paused) audio.pause(); }
      }), { threshold: 0.2 }).observe(hostEl);
      if (reduce) t = 14.6;
    },
    setLang(l) { lang = l; if (ready && !running) renderFrame(t); },
    get time() { return t; }, get total() { return TOTAL; }, get playing() { return playing; }, get sound() { return soundOn; },
    chapters: SLOTS.slice(3, 10).map(s => s[0]),
    seek(s) { t = clamp(s, 0, TOTAL - 0.05); if (soundOn) audio.currentTime = t; if (ready && !running) renderFrame(t); },
    toggleSound() { soundOn = !soundOn; if (soundOn) { audio.currentTime = t; audio.volume = 0.9; audio.play().then(() => { playing = true; start(); }).catch(() => { soundOn = false; }); } else audio.pause(); return soundOn; },
    togglePlay() { playing = !playing; if (soundOn) { playing ? audio.play().catch(() => {}) : audio.pause(); } if (playing) start(); return playing; },
    freeze(s) { frozen = true; playing = false; stop(); if (ready) { t = s; renderFrame(s); } },
    renderAt(s) { if (!ready) return; t = s; renderFrame(s); },
    ready() { return ready; },
    load() { return loadAll().then(() => { resize(); }); },
    engine: "webgl",
  };
  window.SnowFilm = api;
})();
