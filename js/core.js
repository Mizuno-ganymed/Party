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
        h('div', { class: 'row end' }, clearBtn),
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
    wantAwake = on;
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
    e.preventDefault();
    installPrompt = e;
    if (!location.hash.replace(/^#\/?/, '')) route(); // ホーム表示中ならボタンを出す
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

  /** ホームに出す「アプリとして追加」案内 */
  function installBanner() {
    if (isStandalone() || store.get('installDismissed', false)) return null;
    let body;
    if (installPrompt) {
      body = h(
        'button',
        {
          type: 'button',
          class: 'btn primary',
          async onclick() {
            const p = installPrompt;
            installPrompt = null;
            p.prompt();
            await p.userChoice.catch(() => null);
            route();
          },
        },
        '📲 ホーム画面に追加',
      );
    } else if (isIOS()) {
      body = h('span', null, 'Safari の共有ボタン（□↑）→「ホーム画面に追加」で、アプリのように使えます');
    } else {
      return null;
    }
    const banner = h(
      'div',
      { class: 'install-banner' },
      h('span', { class: 'install-text' }, h('strong', null, 'アプリとして使う'), ' オフラインでも動きます'),
      body,
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

  function renderHome(main) {
    main.append(
      installBanner(),
      h('p', { class: 'lead' }, 'パーティや飲み会で使える便利ツール集。メンバーを一度登録すれば、すべてのツールで使えます。'),
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
          ),
        ),
      ),
    );
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
    keepAwake(false);

    const id = location.hash.replace(/^#\/?/, '');
    const tool = tools.find((t) => t.id === id);
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
      renderHome(main);
    }
    window.scrollTo(0, 0);
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
    unlockAudio,
    vibrate,
    keepAwake,
    COLORS: ['#ff5c8a', '#ffb84d', '#4dd4ac', '#5aa9ff', '#a77bff', '#ff7a45', '#2ec4d6', '#e85dd8', '#8bd346', '#f25f5c'],
  };

  document.addEventListener('DOMContentLoaded', start);
})();
