/* TARGET, мини-приложение в Telegram: показывает код для входа крупно.

   Откуда код: бот открывает эту страницу кнопкой «Открыть TARGET» с адресом
     https://…/#c=482913&exp=1763550000&n=Тимур
   Всё лежит во фрагменте (после #), он не уходит на сервер хостинга. Страница читает его первым делом,
   строго проверяет и сразу стирает из адресной строки (history.replaceState), оставляя только служебные
   параметры Telegram (tgWebApp…). SDK Telegram подключается уже после этого, поэтому код к нему не попадает.
   Чтобы код не пропал при перезагрузке страницы внутри Telegram, он живёт в sessionStorage до истечения.

   Сеть: никаких запросов, кроме шрифтов Google и самого SDK (это закреплено в CSP в index.html).
   Без Telegram (обычный браузер, предпросмотр) всё работает, вызовы SDK просто пропускаются. */
(function () {
  'use strict';

  const TTL = 300;                      // код живёт 5 минут
  const SDK = 'https://telegram.org/js/telegram-web-app.js';
  const KEY = 'target-miniapp-code';
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduce = !!(mq && mq.matches);

  /* ================= 1. код из адреса: прочитать, проверить, стереть ================= */
  function decode(s) {
    try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return null; }
  }
  function cleanName(s) {
    if (typeof s !== 'string') return '';
    s = s.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
      .replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, 32).join('').trim();
  }
  function validCode(c) { return typeof c === 'string' && /^\d{6}$/.test(c); }
  function validExp(e) {
    if (typeof e === 'number') e = String(e);
    if (typeof e !== 'string' || !/^\d{9,11}$/.test(e)) return null;
    const v = +e, now = Date.now() / 1000;
    // далёкое будущее или прошлое = мусор, а не код; ±2 суток прощают сбитые часы телефона
    return Math.abs(v - now) <= 172800 ? v : null;
  }

  function takeHash() {
    let raw = '';
    try { raw = String(location.hash || '').replace(/^#/, ''); } catch (e) { return null; }
    if (!raw) return null;
    const keep = [], got = {};
    if (raw.length <= 8192) {
      for (const part of raw.split(/[&?#]/)) {          // клиенты Telegram дописывают свои параметры через & (иногда через ? или #)
        if (!part) continue;
        const eq = part.indexOf('=');
        const k = eq < 0 ? part : part.slice(0, eq);
        if (/^tgWebApp[A-Za-z]+$/.test(k)) { keep.push(part); continue; }     // это нужно SDK Telegram
        if ((k === 'c' || k === 'exp' || k === 'n') && !Object.prototype.hasOwnProperty.call(got, k)) {
          got[k] = eq < 0 ? '' : decode(part.slice(eq + 1));
        }
      }
    }
    const rest = keep.join('&');
    if (rest !== raw) {
      try { history.replaceState(history.state, '', location.pathname + location.search + (rest ? '#' + rest : '')); }
      catch (e) { try { location.hash = rest; } catch (_) { /* ничего */ } }
    }
    const exp = validExp(got.exp);
    if (!validCode(got.c) || exp === null) return null;   // строго: нужны и код, и срок
    return { c: got.c, exp, n: cleanName(got.n) };
  }

  function store(v) {
    try {
      if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY);
    } catch (e) { /* хранилище недоступно: просто не переживём перезагрузку */ }
  }
  function restore() {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (!v || !validCode(v.c)) return null;
      const exp = validExp(v.exp);
      if (exp === null || exp < Date.now() / 1000 - 600) { store(null); return null; }
      return { c: v.c, exp, n: cleanName(v.n) };
    } catch (e) { return null; }
  }

  let data = takeHash();
  if (data) store(data); else data = restore();

  /* ================= 2. Telegram SDK (подключается после того, как код стёрт) ================= */
  let WA = null, inTg = false;
  const sdkReady = new Promise(resolve => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    try {
      const s = document.createElement('script');
      s.src = SDK;
      s.async = true;
      s.onload = () => { tgInit(); fin(); };
      s.onerror = fin;
      document.head.appendChild(s);
    } catch (e) { fin(); }
    setTimeout(fin, 1500);   // медленная сеть: показываем экран, SDK подхватится позже
  });

  function tgInit() {
    const T = window.Telegram && window.Telegram.WebApp;
    if (!T) return;
    WA = T;
    inTg = !!(T.platform && T.platform !== 'unknown') || !!T.initData;
    if (!inTg) return;                       // обычный браузер: SDK загрузился, но Telegram рядом нет
    document.documentElement.classList.add('tg');
    try { T.ready(); } catch (e) { /* ничего */ }
    try { T.expand(); } catch (e) { /* ничего */ }
    if (atLeast('6.1')) {
      try { T.setHeaderColor('#000000'); } catch (e) { /* ничего */ }
      try { T.setBackgroundColor('#000000'); } catch (e) { /* ничего */ }
    }
    if (atLeast('7.10') && typeof T.setBottomBarColor === 'function') {
      try { T.setBottomBarColor('#000000'); } catch (e) { /* ничего */ }
    }
    try { T.onEvent && T.onEvent('viewportChanged', () => Matrix && Matrix.resize()); } catch (e) { /* ничего */ }
    showClose();
  }
  function atLeast(v) {
    try { return !WA.isVersionAtLeast || WA.isVersionAtLeast(v); } catch (e) { return false; }
  }
  function haptic(kind, style) {
    if (!inTg || !WA || !WA.HapticFeedback || !atLeast('6.1')) return;
    try {
      if (kind === 'impact') WA.HapticFeedback.impactOccurred(style);
      else WA.HapticFeedback.notificationOccurred(style);
    } catch (e) { /* ничего */ }
  }
  function closeApp() {
    if (inTg && WA) { try { WA.close(); return; } catch (e) { /* ниже */ } }
    try { window.close(); } catch (e) { /* ничего */ }
  }

  /* ================= 3. светодиодная матрица на фоне ================= */
  const Matrix = (function () {
    const cv = document.getElementById('bg');
    if (!cv || !cv.getContext) return null;
    const ctx = cv.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const gap = document.createElement('canvas');
    gap.className = 'bg-gaps';
    gap.setAttribute('aria-hidden', 'true');
    cv.parentNode.insertBefore(gap, cv.nextSibling);
    const gctx = gap.getContext('2d');

    const CELL = [6, 14, 2];               // как «вытянутые клетки» на сайте: ширина, высота, зазор
    const STEP = 33;                       // ~30 кадров в секунду, клеток на телефоне всего пара тысяч
    const STATIC_T = 23;
    const BLOBS = [                        // медленно плывущие пятна света, разложены под вертикальный экран
      { x: .80, y: .10, r: .46, a: .17, sx: .21, sy: .17, p: 0 },
      { x: .10, y: .50, r: .34, a: .095, sx: .17, sy: .23, p: 2.1 },
      { x: .62, y: .95, r: .48, a: .10, sx: .19, sy: .13, p: 4.2 },
    ];
    const NB = BLOBS.length;
    const MAXR = 6, MAXS = 220;
    const RX = new Float32Array(MAXR * 5);   // волны текущего кадра: x, y, радиус, сила, 1/ширина²

    let W = 0, H = 0, dpr = 1, cols = 0, rows = 0, px = 0, py = 0, cw = 0, ch = 0, g = 0, wd = 0, hd = 0;
    let img = null, d = null, EX = null, EY = null, CV = null, VX = null, VY = null, FY = null, XC = null, YC = null;
    const rip = [];                        // волны: {x, y, t0, a, life, w, R}
    const sI = new Int32Array(MAXS), sS = new Float32Array(MAXS), sD = new Float32Array(MAXS), sP = new Float32Array(MAXS);
    let sN = 0, en = 1, enT = 1, raf = 0, last = -1e9;
    const t0 = performance.now();
    const now = () => (performance.now() - t0) / 1000;

    function layout() {
      W = window.innerWidth; H = window.innerHeight;
      if (!W || !H) return false;
      const nd = Math.min(window.devicePixelRatio || 1, 3);
      const ncw = Math.max(1, Math.round(CELL[0] * nd)), nch = Math.max(1, Math.round(CELL[1] * nd)), ng = Math.max(1, Math.round(CELL[2] * nd));
      const nwd = Math.ceil(W * nd), nhd = Math.ceil(H * nd);
      const npx = ncw + ng, npy = nch + ng;
      const nc = Math.ceil(nwd / npx) + 1, nr = Math.ceil(nhd / npy) + 1;
      if (img && nc === cols && nr === rows && npx === px && npy === py && nwd === wd && nhd === hd && nd === dpr) return true;
      dpr = nd; cw = ncw; ch = nch; g = ng; px = npx; py = npy; wd = nwd; hd = nhd; cols = nc; rows = nr;

      cv.width = cols; cv.height = rows;
      cv.style.width = (cols * px / dpr) + 'px'; cv.style.height = (rows * py / dpr) + 'px';
      img = ctx.createImageData(cols, rows); d = img.data; d.fill(255);
      EX = new Float32Array(cols * NB); EY = new Float32Array(rows * NB);
      CV = new Float32Array(cols); VX = new Float32Array(cols); XC = new Float32Array(cols);
      VY = new Float32Array(rows); FY = new Float32Array(rows); YC = new Float32Array(rows);
      for (let x = 0; x < cols; x++) {
        const nx = x / cols;
        CV[x] = .82 + .18 * ((x * 73 % 11) / 11);          // столбцы чуть разные, как у настоящей матрицы
        VX[x] = .5 * (nx - .5) * (nx - .5);
        XC[x] = (x * px + cw / 2) / dpr;                    // центр клетки в CSS-пикселях
      }
      for (let y = 0; y < rows; y++) {
        const ny = y / rows;
        FY[y] = .036 + .02 * (1 - ny);
        VY[y] = .32 * (ny - .45) * (ny - .45);
        YC[y] = (y * py + ch / 2) / dpr;
      }
      drawGaps();
      sN = 0;
      return true;
    }

    // сетка зазоров: рисуется один раз на размер экрана, ровно по тем же целым пикселям
    function drawGaps() {
      gap.width = wd; gap.height = hd;
      gap.style.width = (wd / dpr) + 'px'; gap.style.height = (hd / dpr) + 'px';
      const tile = document.createElement('canvas');
      tile.width = px; tile.height = py;
      const t = tile.getContext('2d');
      const gr = t.createLinearGradient(0, 0, 0, ch);
      gr.addColorStop(0, 'rgba(255,255,255,.045)');
      gr.addColorStop(.45, 'rgba(255,255,255,0)');
      gr.addColorStop(1, 'rgba(0,0,0,.12)');
      t.fillStyle = gr; t.fillRect(0, 0, cw, ch);
      t.fillStyle = '#020202';
      t.fillRect(cw, 0, g, py);
      t.fillRect(0, ch, px, g);
      gctx.clearRect(0, 0, wd, hd);
      gctx.fillStyle = gctx.createPattern(tile, 'repeat');
      gctx.fillRect(0, 0, wd, hd);
    }

    function render(s) {
      const aspect = H / W;
      for (let k = 0; k < NB; k++) {
        const b = BLOBS[k];
        const cx = b.x + Math.sin(s * b.sx + b.p) * .14, cy = b.y + Math.cos(s * b.sy + b.p) * .07;
        const ir = 1 / (b.r * b.r), ox = k * cols, oy = k * rows;
        for (let x = 0; x < cols; x++) { const dx = x / cols - cx; EX[ox + x] = b.a * Math.exp(-dx * dx * ir); }
        for (let y = 0; y < rows; y++) { const dy = (y / rows - cy) * aspect; EY[oy + y] = Math.exp(-dy * dy * ir); }
      }
      // волны: кольцо света расходится от точки и гаснет
      let nr = 0;
      for (let k = 0; k < rip.length;) {
        const r = rip[k], u = (s - r.t0) / r.life;
        if (u >= 1) { rip.splice(k, 1); continue; }
        if (u > 0) {
          const e = 1 - Math.pow(1 - u, 3), o = nr * 5;
          RX[o] = r.x; RX[o + 1] = r.y; RX[o + 2] = r.R * e; RX[o + 3] = r.a * Math.pow(1 - u, 1.6); RX[o + 4] = 1 / (r.w * r.w * (1 + u));
          nr++;
        }
        k++;
      }
      en += (enT - en) * .05;
      const e2 = en;
      let i = 0;
      for (let y = 0; y < rows; y++) {
        const e0 = EY[y], e1 = EY[rows + y], ee2 = EY[rows * 2 + y], fy = FY[y], vy = VY[y], yc = YC[y];
        for (let x = 0; x < cols; x++, i += 4) {
          let v = (fy + EX[x] * e0 + EX[cols + x] * e1 + EX[cols * 2 + x] * ee2) * CV[x] * e2;
          for (let q = 0; q < nr; q++) {
            const o = q * 5, dx = XC[x] - RX[o], dy = yc - RX[o + 1];
            const z = Math.sqrt(dx * dx + dy * dy) - RX[o + 2], zz = z * z * RX[o + 4];
            if (zz < 6) v += RX[o + 3] * Math.exp(-zz) * CV[x];
          }
          let c = v * (1 - VX[x] - vy) * 255;
          if (c > 255) c = 255;
          d[i] = c; d[i + 1] = c; d[i + 2] = c;
        }
      }
      if (!reduce) sparks(s);
      ctx.putImageData(img, 0, 0);
    }

    // живые клетки: редкие огоньки плавно вспыхивают и гаснут, иногда передавая свет соседу
    function sparks(s) {
      const N = cols * rows;
      let n = sN;
      for (let k = 0; k < n;) {
        if (s > sS[k] + sD[k]) { n--; sI[k] = sI[n]; sS[k] = sS[n]; sD[k] = sD[n]; sP[k] = sP[n]; } else k++;
      }
      sN = n;
      const target = Math.min(MAXS - 8, N * .02 * en) | 0;
      let want = Math.min(target - sN, 3);
      while (want-- > 0) {
        const idx = (Math.random() * N) | 0, du = .9 + Math.random() * 2.2, pk = .55 + Math.random() * .45;
        add(idx, s, du, pk);
        if (Math.random() < .4) {
          const x = idx % cols + ((Math.random() * 3) | 0) - 1, y = ((idx / cols) | 0) + ((Math.random() * 3) | 0) - 1;
          if (x >= 0 && y >= 0 && x < cols && y < rows) add(y * cols + x, s + du * .3, du * .85, pk * .7);
        }
      }
      const row = cols * 4, L = d.length;
      for (let k = 0; k < sN; k++) {
        const u = (s - sS[k]) / sD[k];
        if (u <= 0 || u >= 1) continue;
        const sn = Math.sin(Math.PI * u), e = sn * sn * sP[k] * (.55 + .45 * en), i = sI[k] * 4;
        d[i] += (238 - d[i]) * e; d[i + 1] += (238 - d[i + 1]) * e; d[i + 2] += (242 - d[i + 2]) * e;
        const h = e * .28, cx = sI[k] % cols;
        if (h > .02) {
          if (cx > 0) glow(i - 4, h);
          if (cx < cols - 1) glow(i + 4, h);
          if (i >= row) glow(i - row, h);
          if (i + row < L) glow(i + row, h);
        }
      }
    }
    function glow(q, h) { d[q] += (238 - d[q]) * h; d[q + 1] += (238 - d[q + 1]) * h; d[q + 2] += (242 - d[q + 2]) * h; }
    function add(idx, st, du, pk) {
      if (sN >= MAXS) return;
      sI[sN] = idx; sS[sN] = st; sD[sN] = du; sP[sN] = pk; sN++;
    }

    function frame(t) {
      raf = 0;
      if (reduce || document.hidden) return;
      raf = requestAnimationFrame(frame);
      if (t - last < STEP - 4) return;
      last = t;
      render(now());
    }
    function start() { if (!raf && !reduce && !document.hidden) raf = requestAnimationFrame(frame); }
    function still() { if (layout()) render(STATIC_T); }

    let rz = 0;
    function resize() {
      if (rz) return;
      rz = requestAnimationFrame(() => { rz = 0; if (layout()) render(reduce ? STATIC_T : now()); });
    }
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = -1e9; start(); } });

    if (layout()) render(reduce ? STATIC_T : 0);   // первый кадр сразу, без чёрной вспышки
    start();

    return {
      resize,
      // волна света из точки (CSS-пиксели экрана)
      ripple(x, y, a, life) {
        if (reduce || !W) return;
        if (rip.length >= MAXR) rip.shift();
        rip.push({ x, y, t0: now(), a: a == null ? .32 : a, life: life || 2.2, w: 22, R: Math.hypot(W, H) * 1.05 });
        start();
      },
      // общая яркость: 1 обычно, ниже, когда код истёк
      energy(v) { enT = v; if (reduce) { en = v; still(); } },
      motion() { if (reduce) still(); else { last = -1e9; start(); } },
    };
  })();

  /* ================= 4. экран ================= */
  const $ = id => document.getElementById(id);
  const app = $('app'), html = document.documentElement;
  const live = $('live');
  let state = 'none', timer = 0, copyT = 0, warned = false;

  function say(t) { if (live) { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 40); } }
  function center(el) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  function fmt(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function showClose() {
    if (!inTg) return;
    $('closeTop').hidden = false;
    if (state === 'none') $('closeNone').hidden = false;
    else $('closeCode').hidden = false;
    if (state === 'expired') $('closeCode').classList.add('pri');
  }

  function buildDigits(code) {
    const box = $('digits');
    box.textContent = '';
    for (let k = 0; k < 6; k++) {
      if (k === 3) { const dash = document.createElement('i'); dash.className = 'dash'; dash.setAttribute('aria-hidden', 'true'); box.appendChild(dash); }
      const cell = document.createElement('span');
      cell.className = 'dg';
      cell.style.setProperty('--i', String(k));
      cell.setAttribute('aria-hidden', 'true');
      const b = document.createElement('b');
      b.textContent = code[k];
      cell.appendChild(b);
      box.appendChild(cell);
    }
    box.setAttribute('aria-label', 'Код для входа: ' + code.split('').join(' ') + '. Нажмите, чтобы скопировать');
  }

  function tick() {
    if (!data) return;
    const left = data.exp - Date.now() / 1000;
    const tm = $('timer'), fg = $('ringFg');
    if (left <= 0) { expire(true); return; }
    if (left > TTL + 90) {
      // часы телефона сильно расходятся с сервером: честно не рисуем точный отсчёт
      tm.classList.add('skew');
      $('tLbl').textContent = 'действует несколько минут';
      $('tLeft').textContent = '';
      fg.style.strokeDashoffset = '0';
      return;
    }
    tm.classList.remove('skew');
    $('tLbl').textContent = 'действует ещё';
    $('tLeft').textContent = fmt(left);
    fg.style.strokeDashoffset = String(100 * (1 - Math.min(1, left / TTL)));
    tm.classList.toggle('low', left <= 30);
  }

  function expire(live) {
    if (state === 'expired') return;
    state = 'expired';
    clearInterval(timer); timer = 0;
    store(null);
    app.dataset.state = 'expired';
    $('codeTitle').textContent = 'Код истёк';
    $('codeSub').textContent = 'Нажмите „Войти через Telegram“ на сайте TARGET ещё раз, и бот пришлёт новый код.';
    $('tLbl').textContent = 'время вышло';
    $('tLeft').textContent = '0:00';
    $('timer').classList.remove('low', 'skew');
    $('ringFg').style.strokeDashoffset = '100';
    $('manual').hidden = true;
    $('codeNote').textContent = 'Этот код больше не подойдёт. Старые коды бот не принимает.';
    $('closeCode').classList.add('pri');
    if (Matrix) Matrix.energy(.42);
    if (live) { haptic('notify', 'warning'); say('Код истёк'); }
  }

  /* ---------- копирование ---------- */
  function legacyCopy(t) {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0'; ta.style.fontSize = '16px'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    let ok = false;
    try {
      ta.select(); ta.setSelectionRange(0, t.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  async function copy(from) {
    if (state !== 'code' || !data) return;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(data.c);
        ok = true;
      }
    } catch (e) { ok = false; }
    if (!ok) ok = legacyCopy(data.c);
    const btn = $('copy');
    if (!ok) {
      // копировать нельзя: показываем поле с кодом и выделяем его целиком
      const m = $('manual');
      m.value = data.c; m.hidden = false;
      try { m.focus({ preventScroll: true }); m.select(); m.setSelectionRange(0, data.c.length); } catch (e) { /* ничего */ }
      $('codeNote').textContent = 'Телефон не дал скопировать автоматически. Код выделен: нажмите на него и выберите «Скопировать».';
      haptic('notify', 'error');
      if (!warned) { warned = true; say('Скопировать не получилось, код выделен'); }
      return;
    }
    haptic('notify', 'success');
    say('Код скопирован');
    const r = (from || btn).getBoundingClientRect();
    btn.classList.remove('ok'); void btn.offsetWidth; btn.classList.add('ok');
    const dg = $('digits');
    dg.classList.remove('shine'); void dg.offsetWidth; dg.classList.add('shine');
    if (Matrix) Matrix.ripple(r.left + r.width / 2, r.top + r.height / 2, .36, 2.4);
    clearTimeout(copyT);
    copyT = setTimeout(() => btn.classList.remove('ok'), 2200);
  }

  /* ---------- запуск ---------- */
  function intro() {
    html.classList.remove('pre');
    app.classList.add('go-on');
    if (state === 'none') {
      const hero = $('hero');
      if (Matrix && !reduce && hero) {
        // эхолот: каждое кольцо вокруг прицела совпадает с волной по матрице
        const ping = hero.querySelector('.ping');
        const pong = () => { const [x, y] = center(hero); Matrix.ripple(x, y, .2, 3); };
        setTimeout(pong, 300);
        if (ping) ping.addEventListener('animationiteration', pong);
      }
      return;
    }
    const dg = $('digits');
    if (reduce) return;
    dg.classList.add('in');
    // каждая ячейка «щёлкает», когда откидывается на место
    if (state === 'code') for (let k = 0; k < 6; k++) setTimeout(() => haptic('impact', 'soft'), 140 + k * 75 + 420);
    setTimeout(() => {
      const logo = $('logo');
      logo.classList.add('lock');
      if (Matrix) { const [x, y] = center(dg); Matrix.ripple(x, y, state === 'expired' ? .14 : .34, 2.4); }
    }, 140 + 5 * 75 + 520);
    setTimeout(() => {
      dg.classList.remove('in');
      if (state === 'code') { dg.classList.remove('shine'); void dg.offsetWidth; dg.classList.add('shine'); }
    }, 2000);
  }

  function init() {
    html.classList.add('pre');
    if (data) {
      state = 'code';
      app.dataset.state = 'code';
      buildDigits(data.c);
      $('hello').textContent = data.n ? 'привет, ' + data.n : 'вход в TARGET';
      $('scrCode').hidden = false;
      if (data.exp - Date.now() / 1000 <= 0) expire(false);
      else { tick(); timer = setInterval(tick, 250); }
      say(state === 'expired' ? 'Код истёк' : 'Код для входа: ' + data.c.split('').join(' '));
    } else {
      state = 'none';
      app.dataset.state = 'none';
      $('scrNone').hidden = false;
    }
    if (inTg) showClose();

    $('copy').addEventListener('click', e => copy(e.currentTarget));
    const dg = $('digits');
    dg.addEventListener('click', () => copy(dg));
    dg.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(dg); } });
    for (const id of ['closeTop', 'closeCode', 'closeNone']) $(id).addEventListener('click', closeApp);

    // касание пустого места пускает по матрице волну
    document.addEventListener('pointerdown', e => {
      if (!Matrix || e.target.closest('button,input,.digits,a')) return;
      Matrix.ripple(e.clientX, e.clientY, .22, 1.8);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => { if (!document.hidden && state === 'code') tick(); });

    // ждём SDK (не дольше 1,5 с), чтобы анимация не прошла за заставкой Telegram
    sdkReady.then(() => requestAnimationFrame(() => requestAnimationFrame(intro)));
  }

  function onReduce() {
    reduce = !!(mq && mq.matches);
    if (Matrix) Matrix.motion();
  }
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', onReduce); else if (mq.addListener) mq.addListener(onReduce); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
