'use strict';

Party.register({
  id: 'timer',
  name: 'タイマー',
  icon: '⏱️',
  desc: 'ゲームや乾杯までのカウントダウン',
  render(root) {
    const { h } = Party;
    const MAX = 99 * 60 + 59; // 秒

    let duration = Number(Party.store.get('timer.duration', 180)) || 180; // 秒
    let remainingMs = duration * 1000;
    let endAt = 0;
    let state = 'idle'; // idle | running | paused | done
    let tick = 0;
    let alarm = 0;
    let lastBeepSec = -1;

    const display = h('div', { class: 'timer-display', 'aria-live': 'off' });
    const ring = h('div', { class: 'timer-ring' }, display);
    const startBtn = h('button', { type: 'button', class: 'btn primary big', onclick: toggle });
    const resetBtn = h('button', { type: 'button', class: 'btn big', onclick: reset }, 'リセット');

    const fmt = (ms) => {
      const total = Math.ceil(ms / 1000);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const adjustButtons = [];
    const adjBtn = (label, delta) => {
      const b = h('button', { type: 'button', class: 'btn small', onclick: () => setDuration(duration + delta) }, label);
      adjustButtons.push(b);
      return b;
    };
    const presetBtn = (label, sec) => {
      const b = h('button', { type: 'button', class: 'btn small ghost', onclick: () => setDuration(sec) }, label);
      adjustButtons.push(b);
      return b;
    };

    function setDuration(sec) {
      if (state === 'running') return;
      stopAlarm();
      duration = Math.max(0, Math.min(MAX, sec));
      Party.store.set('timer.duration', duration);
      remainingMs = duration * 1000;
      state = 'idle';
      render();
    }

    function render() {
      const ms = state === 'running' ? Math.max(0, endAt - Date.now()) : remainingMs;
      display.textContent = state === 'done' ? '00:00' : fmt(ms);
      const ratio = duration > 0 ? ms / (duration * 1000) : 0;
      ring.style.setProperty('--progress', `${(state === 'done' ? 0 : ratio) * 360}deg`);
      ring.classList.toggle('done', state === 'done');
      startBtn.textContent = { idle: 'スタート', running: '一時停止', paused: '再開', done: 'ストップ' }[state];
      startBtn.disabled = state === 'idle' && duration === 0;
      for (const b of adjustButtons) b.disabled = state === 'running';
    }

    function toggle() {
      Party.unlockAudio();
      if (state === 'idle' || state === 'paused') {
        if (remainingMs <= 0) return;
        endAt = Date.now() + remainingMs;
        state = 'running';
        lastBeepSec = -1;
        Party.keepAwake(true);
        clearInterval(tick);
        tick = setInterval(onTick, 100);
      } else if (state === 'running') {
        remainingMs = Math.max(0, endAt - Date.now());
        state = 'paused';
        clearInterval(tick);
        Party.keepAwake(false);
      } else if (state === 'done') {
        reset();
        return;
      }
      render();
    }

    function onTick() {
      const left = endAt - Date.now();
      const sec = Math.ceil(left / 1000);
      if (sec <= 3 && sec >= 1 && sec !== lastBeepSec) {
        lastBeepSec = sec;
        Party.beep(660, 0.12, 0.2);
      }
      if (left <= 0) {
        clearInterval(tick);
        remainingMs = 0;
        state = 'done';
        startAlarm();
      }
      render();
    }

    function startAlarm() {
      let n = 0;
      const ring = () => {
        Party.beep(1046, 0.18, 0.25, 'square');
        Party.beep(1318, 0.25, 0.25, 'square', 0.2);
        Party.vibrate([200, 100, 200]);
        if (++n >= 8) stopAlarm();
      };
      ring();
      alarm = setInterval(ring, 900);
    }

    function stopAlarm() {
      clearInterval(alarm);
      alarm = 0;
    }

    function reset() {
      clearInterval(tick);
      stopAlarm();
      Party.keepAwake(false);
      remainingMs = duration * 1000;
      state = 'idle';
      render();
    }

    root.append(
      h('div', { class: 'card center-col' }, ring, h('div', { class: 'row center' }, startBtn, resetBtn)),
      h(
        'div',
        { class: 'card' },
        h('h2', null, '時間を設定'),
        h('div', { class: 'row center wrap' }, presetBtn('30秒', 30), presetBtn('1分', 60), presetBtn('3分', 180), presetBtn('5分', 300), presetBtn('10分', 600), presetBtn('30分', 1800)),
        h('div', { class: 'row center wrap' }, adjBtn('−1分', -60), adjBtn('−10秒', -10), adjBtn('+10秒', 10), adjBtn('+1分', 60)),
      ),
    );

    render();

    return () => {
      clearInterval(tick);
      stopAlarm();
    };
  },
});
