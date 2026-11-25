'use strict';

/**
 * パーティツール共通コア
 * - ツール登録 / ハッシュルーティング
 * - localStorage 保存
 * - 共有メンバーリスト
 * - DOM ヘルパー、乱数、サウンド、画面スリープ防止 など
 */
(function () {
  const tools = [];
  const PREFIX = 'party:';

  // ---------- DOM ヘルパー ----------
  function append(el, children) {
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) append(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
  }

  /** h('div', {class: 'x', onclick: fn}, child1, child2, ...) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') {
          el.addEventListener(k.slice(2), v);
        } else if (k === 'class') {
          el.className = v;
        } else if (k === 'style' && typeof v === 'object') {
          for (const [prop, val] of Object.entries(v)) {
            if (prop.startsWith('--')) el.style.setProperty(prop, val);
            else el.style[prop] = val;
          }
        } else if (k === 'value' || k === 'checked' || k === 'hidden') {
          el[k] = v;
        } else {
          el.setAttribute(k, v === true ? '' : String(v));
        }
      }
    }
    append(el, children);
    return el;
  }

  // ---------- 保存 ----------
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch {
        /* プライベートモード等では保存しない */
      }
    },
  };

  // ---------- 乱数（暗号論的乱数で偏りなし） ----------
  function randInt(n) {
    if (n <= 1) return 0;
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    let x;
    do {
      crypto.getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return x % n;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 共有メンバー ----------
  const memberListeners = new Set();
  const members = {
    get() {
      const list = store.get('members', []);
      return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
    },
    set(list) {
      store.set('members', list);
      for (const fn of memberListeners) fn(list);
    },
    onChange(fn) {
      memberListeners.add(fn);
      return () => memberListeners.delete(fn);
    },
  };

  function parseNames(text) {
    return text
      .split(/[\n,、，\t]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** 共有メンバー編集 UI */
  function memberEditor({ title = 'メンバー', open } = {}) {
    const chips = h('div', { class: 'chips' });
    const count = h('span', { class: 'muted' });
    const input = h('input', {
      type: 'text',
      class: 'input',
      placeholder: '名前を入力（カンマ・改行で複数可）',
      enterkeyhint: 'done',
      onkeydown(e) {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          add();
        }
      },
      onpaste(e) {
        const text = e.clipboardData?.getData('text') || '';
        if (/[\n,、，\t]/.test(text)) {
          e.preventDefault();
          add(text);
        }
      },
    });

    function add(text = input.value) {
      const names = parseNames(text);
      if (!names.length) return;
      const list = members.get();
      for (const n of names) if (!list.includes(n)) list.push(n);
      members.set(list);
      input.value = '';
      input.focus();
    }

    function render() {
      const list = members.get();
      count.textContent = `${list.length}人`;
      chips.replaceChildren(
        ...list.map((name) =>
          h(
            'span',
            { class: 'chip' },
            h('span', { class: 'chip-label' }, name),
            h(
              'button',
              {
                type: 'button',
                class: 'chip-x',
                'aria-label': `${name}を削除`,
                onclick: () => members.set(members.get().filter((n) => n !== name)),
              },
              '×',
            ),
          ),
        ),
      );
      if (!list.length) chips.append(h('span', { class: 'muted' }, 'まだ誰もいません'));
    }

    const clearBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn small ghost',
        onclick() {
          if (members.get().length && confirm('メンバーを全員削除しますか？')) members.set([]);
        },
      },
      '全員削除',
    );

    members.onChange(render);
    render();

    // 部屋の主催者は入室者をまとめて追加できる
    const room = window.Party?.room;
    const roomBtn =
      room?.active && room.isHost
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn small',
              onclick() {
                const names = (room.room?.members || []).filter((m) => !m.host).map((m) => m.name);
                if (!names.length) {
                  toast('まだ参加者が入室していません');
                  return;
                }
                add(names.join('\n'));
              },
            },
            '🏠 入室者を追加',
          )
        : null;

    const isOpen = open ?? members.get().length < 2;
    return h(
      'details',
      { class: 'card members', open: isOpen || null },
      h('summary', null, h('strong', null, `👥 ${title}`), ' ', count),
      h(
        'div',
        { class: 'members-body' },
        chips,
        h(
          'div',
          { class: 'row' },
          input,
          h('button', { type: 'button', class: 'btn', onclick: () => add() }, '追加'),
        ),
        h('div', { class: 'row end' }, roomBtn, clearBtn),
      ),
    );
  }

  // ---------- フォーム部品 ----------
  /** − [n] + の数値入力 */
  function stepper({ value, min = 0, max = 999, step = 1, onChange, label }) {
    const clamp = (v) => Math.min(max, Math.max(min, v));
    const input = h('input', {
      type: 'number',
      inputmode: 'numeric',
      class: 'input stepper-input',
      value: String(value),
      min,
      max,
      'aria-label': label,
    });
    const set = (v) => {
      v = Math.round(Number(v));
      if (!Number.isFinite(v)) v = min;
      v = clamp(v);
      input.value = String(v);
      onChange?.(v);
    };
    input.addEventListener('change', () => set(input.value));
    const wrap = h(
      'div',
      { class: 'stepper' },
      h('button', { type: 'button', class: 'btn icon', 'aria-label': '減らす', onclick: () => set(Number(input.value) - step) }, '−'),
      input,
      h('button', { type: 'button', class: 'btn icon', 'aria-label': '増やす', onclick: () => set(Number(input.value) + step) }, '+'),
    );
    wrap.setValue = (v) => (input.value = String(clamp(v)));
    return wrap;
  }

  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
  }

  /** セグメント切替ボタン */
  function segmented(options, value, onChange) {
    const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
    const render = () => {
      wrap.replaceChildren(
        ...options.map(([v, label]) =>
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(v === value),
              class: v === value ? 'active' : '',
              onclick() {
                value = v;
                render();
                onChange(v);
              },
            },
            label,
          ),
        ),
      );
    };
    render();
    return wrap;
  }

  // ---------- トースト / クリップボード ----------
  let toastTimer = 0;
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('コピーしました');
  }

  // ---------- サウンド ----------
  let audioCtx = null;
  let soundOn = store.get('sound', true);

  function audio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  /** iOS 等ではユーザー操作中に一度鳴らす準備が必要 */
  function unlockAudio() {
    audio();
  }

  function beep(freq = 880, duration = 0.15, volume = 0.2, type = 'sine', delay = 0) {
    if (!soundOn) return;
    try {
      const ctx = audio();
      if (!ctx) return;
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    } catch {
      /* 音が出せない環境では無視 */
    }
  }

  function fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, 0.18, 'triangle', i * 0.1));
  }

  /** 画面いっぱいのお祝い表示（効果音・バイブつき） */
  function celebrate(text, sub = '') {
    fanfare();
    vibrate([120, 60, 120, 60, 240]);
    document.querySelectorAll('.celebrate').forEach((el) => el.remove());
    const banner = h('div', { class: 'celebrate', role: 'alert' }, h('div', null, text), sub ? h('div', { class: 'celebrate-sub' }, sub) : null);
    document.body.append(banner);
    setTimeout(() => banner.remove(), 4000);
  }

  function vibrate(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* 非対応 */
    }
  }

  function updateSoundBtn() {
    const btn = document.querySelector('.sound-btn');
    btn.textContent = soundOn ? '🔊' : '🔇';
    btn.title = soundOn ? 'サウンド: オン' : 'サウンド: オフ';
  }

  // ---------- 画面スリープ防止 ----------
  let wakeLock = null;
  let wantAwake = false;
  async function keepAwake(on) {
    // 部屋に入っている間は常に画面を点けたままにする
    wantAwake = on || !!window.Party?.room?.active;
    on = wantAwake;
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
        if (!wantAwake) await wakeLock?.release();
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      /* 非対応・拒否 */
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantAwake) keepAwake(true);
  });

  // ---------- PWA（ホーム画面に追加・オフライン） ----------
  let installPrompt = null;
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () =>
    /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.addEventListener('beforeinstallprompt', (e) => {
    // ボタンを押したときにこのイベントでインストール画面を開く
    e.preventDefault();
    installPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    toast('ホーム画面に追加しました');
  });

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker の登録に失敗:', e));
    });
  }

  /** 今の端末・ブラウザの種類 */
  function detectBrowser() {
    const ua = navigator.userAgent;
    if (/\bLine\//i.test(ua)) return 'line';
    if (/Instagram|FBAN|FBAV|FB_IAB|Twitter|MicroMessenger|KAKAOTALK|YJApp/i.test(ua)) return 'inapp';
    if (isIOS()) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
    if (/Android/i.test(ua)) return /SamsungBrowser/i.test(ua) ? 'samsung' : 'android';
    return 'desktop';
  }

  const SHARE_ICON = '□↑';
  const GUIDES = {
    'ios-safari': {
      title: 'iPhone / iPad（Safari）',
      steps: [
        `画面下（iPad は右上）の 共有ボタン［${SHARE_ICON}］をタップ`,
        'メニューを下にスクロールして「ホーム画面に追加」をタップ',
        '右上の「追加」をタップ',
      ],
      note: '「ホーム画面に追加」が見当たらないときは、メニューの一番下の「アクションを編集」から追加できます。',
    },
    'ios-other': {
      title: 'iPhone / iPad（Chrome など）',
      steps: [`アドレスバーの右にある 共有ボタン［${SHARE_ICON}］をタップ`, '「ホーム画面に追加」をタップ', '「追加」をタップ'],
      note: 'うまくいかないときは、Safari でこのページを開いてから追加してください。',
    },
    android: {
      title: 'Android（Chrome）',
      steps: ['右上の ⋮（メニュー）をタップ', '「ホーム画面に追加」または「アプリをインストール」をタップ', '「インストール」または「追加」をタップ'],
    },
    samsung: {
      title: 'Android（Samsung Internet）',
      steps: ['画面下の ≡（メニュー）をタップ', '「ページを追加」→「ホーム画面」をタップ', '「追加」をタップ'],
    },
    desktop: {
      title: 'パソコン（Chrome / Edge）',
      steps: ['アドレスバーの右にある インストールアイコン（⊕ や 🖥）をクリック', '「インストール」をクリック'],
      note: 'Safari（Mac）は メニューの「ファイル」→「Dock に追加」です。',
    },
  };

  /** ホーム画面に追加する方法の案内を表示 */
  function showInstallGuide() {
    const kind = detectBrowser();
    const close = () => overlay.remove();
    const stepsOf = (g) =>
      h(
        'div',
        { class: 'guide-block' },
        h('h3', null, g.title),
        h('ol', { class: 'guide-steps' }, g.steps.map((s) => h('li', null, s))),
        g.note ? h('p', { class: 'muted small' }, g.note) : null,
      );

    let main;
    if (kind === 'line' || kind === 'inapp') {
      const url = new URL(location.href);
      if (kind === 'line') url.searchParams.set('openExternalBrowser', '1');
      main = h(
        'div',
        { class: 'guide-block' },
        h('h3', null, kind === 'line' ? 'LINE の中で開いています' : 'アプリの中で開いています'),
        h('p', null, 'この画面からはホーム画面に追加できません。Safari（iPhone）または Chrome（Android）で開いてから追加してください。'),
        kind === 'line'
          ? h('a', { class: 'btn primary', href: url.href }, 'Safari / Chrome で開く')
          : h('p', { class: 'muted small' }, '画面の右上（または右下）のメニューから「ブラウザで開く」を選んでください。'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => copy(location.origin + location.pathname) }, '🔗 URL をコピー'),
      );
    } else {
      main = stepsOf(GUIDES[kind]);
    }
    const others = Object.entries(GUIDES)
      .filter(([k]) => k !== kind)
      .map(([, g]) => stepsOf(g));

    const overlay = h(
      'div',
      {
        class: 'modal-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'ホーム画面に追加する方法',
        onclick(e) {
          if (e.target === overlay) close();
        },
      },
      h(
        'div',
        { class: 'modal' },
        h(
          'div',
          { class: 'row between' },
          h('strong', null, '📲 ホーム画面に追加する方法'),
          h('button', { type: 'button', class: 'chip-x', 'aria-label': '閉じる', onclick: close }, '×'),
        ),
        h('p', { class: 'muted small' }, '追加すると、アイコンからすぐ開けて、電波がなくても使えます。'),
        main,
        h('details', { class: 'guide-others' }, h('summary', null, 'ほかの端末・ブラウザの場合'), others),
        h('div', { class: 'row center' }, h('button', { type: 'button', class: 'btn', onclick: close }, '閉じる')),
      ),
    );
    document.body.append(overlay);
  }

  /** 追加ボタンの動作: 可能ならインストール画面、無理なら手順を表示 */
  async function install() {
    if (installPrompt) {
      const p = installPrompt;
      installPrompt = null;
      try {
        await p.prompt();
        await p.userChoice;
        return;
      } catch {
        /* 手順の表示に切り替える */
      }
    }
    showInstallGuide();
  }

  /** ホームに出す「アプリとして追加」案内 */
  function installBanner() {
    if (isStandalone() || store.get('installDismissed', false)) return null;
    const kind = detectBrowser();
    const sub =
      kind === 'line' || kind === 'inapp'
        ? 'LINE などのアプリ内では追加できません。ボタンから Safari / Chrome で開けます'
        : 'アイコンからすぐ開けて、電波がなくても使えます';
    const banner = h(
      'div',
      { class: 'install-banner' },
      h('span', { class: 'install-text' }, h('strong', null, 'アプリとして使う'), h('span', { class: 'muted small' }, sub)),
      h('button', { type: 'button', class: 'btn primary', onclick: install }, '📲 ホーム画面に追加'),
      h(
        'button',
        {
          type: 'button',
          class: 'chip-x',
          'aria-label': '閉じる',
          onclick() {
            store.set('installDismissed', true);
            banner.remove();
          },
        },
        '×',
      ),
    );
    return banner;
  }

  // ---------- ルーティング ----------
  let cleanup = null;

  function renderHome(main, joinCode) {
    const inRoom = window.Party.room?.active;
    append(main, [
      installBanner(),
      inRoom ? null : h('p', { class: 'lead' }, 'パーティや飲み会で使える便利ツール集。メンバーを一度登録すれば、すべてのツールで使えます。'),
      window.Party.room?.homeCard({ joinCode }),
      memberEditor({ open: false }),
      h(
        'nav',
        { class: 'tool-grid' },
        tools.map((t) =>
          h(
            'a',
            { class: 'tool-card', href: `#/${t.id}` },
            h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, t.icon),
            h('span', { class: 'tool-name' }, t.name),
            h('span', { class: 'tool-desc' }, t.desc),
            inRoom && t.room ? h('span', { class: 'tool-badge' }, '部屋で共有') : null,
          ),
        ),
      ),
      isStandalone()
        ? null
        : h('div', { class: 'row center home-footer' }, h('button', { type: 'button', class: 'btn small ghost', onclick: install }, '📲 ホーム画面に追加する方法')),
    ]);
  }

  function route() {
    if (cleanup) {
      try {
        cleanup();
      } catch (e) {
        console.error(e);
      }
      cleanup = null;
    }
    memberListeners.clear();
    window.Party.room?._clearListeners();
    keepAwake(false);

    const [id, arg] = location.hash.replace(/^#\/?/, '').split('/');
    const tool = tools.find((t) => t.id === id);
    const joinCode = id === 'join' && /^\d{6}$/.test(arg || '') ? arg : undefined;
    const main = document.getElementById('app');
    main.replaceChildren();

    document.querySelector('.back-btn').hidden = !tool;
    document.querySelector('.app-title a').textContent = tool ? `${tool.icon} ${tool.name}` : '🎉 パーティツール';
    document.title = tool ? `${tool.name} | パーティツール` : 'パーティツール';

    if (tool) {
      const view = h('section', { class: `tool tool-${tool.id}` });
      main.append(view);
      cleanup = tool.render(view) || null;
    } else {
      renderHome(main, joinCode);
    }
    syncNav();
    window.scrollTo(0, 0);
  }

  /** 主催者が共有ツールを開いたら、参加者の画面も切り替える */
  function syncNav() {
    const room = window.Party.room;
    if (!room?.active || !room.isHost || room.status !== 'open') return;
    const id = location.hash.replace(/^#\/?/, '').split('/')[0];
    const tool = tools.find((t) => t.id === id);
    if (tool?.room && room.room?.tool !== tool.id) room.send({ t: 'nav', tool: tool.id }, true);
  }

  function start() {
    const soundBtn = document.querySelector('.sound-btn');
    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      store.set('sound', soundOn);
      updateSoundBtn();
      if (soundOn) beep(880, 0.08);
    });
    updateSoundBtn();
    // 最初のタップで音を出せるようにしておく（参加者の画面は自分で操作しないため）
    document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
    window.addEventListener('hashchange', route);
    route();
  }

  registerServiceWorker();

  window.Party = {
    register(tool) {
      tools.push(tool);
    },
    h,
    store,
    randInt,
    shuffle,
    members,
    memberEditor,
    stepper,
    field,
    segmented,
    toast,
    copy,
    beep,
    fanfare,
    celebrate,
    unlockAudio,
    vibrate,
    keepAwake,
    refresh: () => route(),
    syncNav: () => syncNav(),
    COLORS: ['#ff5c8a', '#ffb84d', '#4dd4ac', '#5aa9ff', '#a77bff', '#ff7a45', '#2ec4d6', '#e85dd8', '#8bd346', '#f25f5c'],
  };

  document.addEventListener('DOMContentLoaded', start);
})();
