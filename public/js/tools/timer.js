'use strict';

/**
 * タイマー
 * - 部屋なし: この端末だけ
 * - 部屋: 主催者が操作し、全員の画面で同じ時刻に終了する（サーバー時刻基準）
 */
Party.register({
  id: 'timer',
  name: 'タイマー',
  icon: '⏱️',
  desc: 'ゲームや乾杯までのカウントダウン',
  room: true,
  render(root) {
    const { h } = Party;
    const MAX = 99 * 60 + 59; // 秒
    const room = Party.room;
    const inRoom = room.active;
    const canControl = !inRoom || room.isHost;
    const now = () => (inRoom ? room.now() : Date.now());

    // 状態: { status: idle|running|paused, duration(秒), endAt(ms), remaining(ms) }
    let model;
    if (inRoom) {
      model = room.room?.timer || null;
    } else {
      const duration = Number(Party.store.get('timer.duration', 180)) || 180;
      model = { status: 'idle', duration, endAt: 0, remaining: duration * 1000 };
    }

    let tick = 0;
    let alarm = 0;
    let lastBeepSec = -1;
    let alarmedFor = 0; // アラームを鳴らした endAt（同じ終了で何度も鳴らさない）

    const display = h('div', { class: 'timer-display', 'aria-live': 'off' });
    const ring = h('div', { class: 'timer-ring' }, display);
    const note = h('p', { class: 'muted small center' });
    const startBtn = h('button', { type: 'button', class: 'btn primary big', onclick: toggle });
    const resetBtn = h('button', { type: 'button', class: 'btn big', onclick: reset }, 'リセット');

    const fmt = (ms) => {
      const total = Math.ceil(ms / 1000);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const remainingNow = () => (!model ? 0 : model.status === 'running' ? Math.max(0, model.endAt - now()) : model.remaining);
    const isDone = () => !!model && model.status === 'running' && model.endAt <= now();

    const adjustButtons = [];
    const adjBtn = (label, delta) => {
      const b = h('button', { type: 'button', class: 'btn small', onclick: () => setDuration(model.duration + delta) }, label);
      adjustButtons.push(b);
      return b;
    };
    const presetBtn = (label, sec) => {
      const b = h('button', { type: 'button', class: 'btn small ghost', onclick: () => setDuration(sec) }, label);
      adjustButtons.push(b);
      return b;
    };

    // ---------- 操作 ----------
    function setDuration(sec) {
      if (!model || model.status === 'running') return;
      stopAlarm();
      const duration = Math.max(0, Math.min(MAX, sec));
      if (inRoom) {
        room.send({ t: 'timer.set', duration });
        return;
      }
      Party.store.set('timer.duration', duration);
      model = { status: 'idle', duration, endAt: 0, remaining: duration * 1000 };
      render();
    }

    function toggle() {
      Party.unlockAudio();
      if (!model) return;
      if (isDone()) {
        reset();
        return;
      }
      if (model.status === 'running') {
        if (inRoom) room.send({ t: 'timer.pause' });
        else {
          model = { ...model, status: 'paused', remaining: Math.max(0, model.endAt - Date.now()) };
          Party.keepAwake(false);
        }
      } else {
        if (model.remaining <= 0) return;
        if (inRoom) room.send({ t: 'timer.start' });
        else {
          model = { ...model, status: 'running', endAt: Date.now() + model.remaining };
          Party.keepAwake(true);
        }
      }
      render();
    }

    function reset() {
      stopAlarm();
      if (inRoom) {
        room.send({ t: 'timer.reset' });
        return;
      }
      Party.keepAwake(false);
      model = { status: 'idle', duration: model.duration, endAt: 0, remaining: model.duration * 1000 };
      render();
    }

    // ---------- 表示 ----------
    function render() {
      // 部屋なしのタイマーは端末の中だけにあるので、動いている間は自動更新の再読み込みを待ってもらう
      if (!inRoom && model && model.status !== 'idle') root.dataset.busy = 'true';
      else delete root.dataset.busy;
      if (!model) {
        display.textContent = '--:--';
        note.textContent = '接続中…';
        startBtn.disabled = resetBtn.disabled = true;
        return;
      }
      const done = isDone();
      const ms = remainingNow();
      display.textContent = done ? '00:00' : fmt(ms);
      const ratio = model.duration > 0 ? ms / (model.duration * 1000) : 0;
      ring.style.setProperty('--progress', `${(done ? 0 : ratio) * 360}deg`);
      ring.classList.toggle('done', done);
      startBtn.textContent = done ? 'ストップ' : { idle: 'スタート', running: '一時停止', paused: '再開' }[model.status];
      startBtn.disabled = !done && model.status === 'idle' && model.duration === 0;
      resetBtn.disabled = false;
      for (const b of adjustButtons) b.disabled = model.status === 'running';
      if (inRoom && !canControl) {
        note.textContent = done ? '時間です！' : { idle: '主催者がスタートするのを待っています', running: 'カウントダウン中', paused: '一時停止中' }[model.status];
      } else note.textContent = '';
    }

    function onTick() {
      if (model?.status === 'running') {
        const left = model.endAt - now();
        const sec = Math.ceil(left / 1000);
        if (sec <= 3 && sec >= 1 && sec !== lastBeepSec) {
          lastBeepSec = sec;
          Party.beep(660, 0.12, 0.2);
        }
        if (left <= 0 && alarmedFor !== model.endAt) {
          alarmedFor = model.endAt;
          startAlarm();
          if (!inRoom) Party.keepAwake(false);
        }
      }
      render();
    }

    function startAlarm() {
      stopAlarm();
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

    if (inRoom) {
      room.on((r) => {
        if (!r) return;
        const prev = model;
        model = r.timer;
        if (model.status !== 'running') stopAlarm();
        if (!prev || prev.endAt !== model.endAt) lastBeepSec = -1;
        render();
      });
      // 開いた時点ですでに終わっていたタイマーでは鳴らさない
      if (isDone()) alarmedFor = model.endAt;
    }

    const controls = h('div', { class: 'row center' }, startBtn, resetBtn);
    root.append(h('div', { class: 'card center-col' }, ring, canControl ? controls : null, note));
    if (canControl) {
      root.append(
        h(
          'div',
          { class: 'card' },
          h('h2', null, '時間を設定'),
          h('div', { class: 'row center wrap' }, presetBtn('30秒', 30), presetBtn('1分', 60), presetBtn('3分', 180), presetBtn('5分', 300), presetBtn('10分', 600), presetBtn('30分', 1800)),
          h('div', { class: 'row center wrap' }, adjBtn('−1分', -60), adjBtn('−10秒', -10), adjBtn('+10秒', 10), adjBtn('+1分', 60)),
        ),
      );
    }
    if (inRoom && !canControl) root.append(h('p', { class: 'muted small center' }, '音が鳴るように、画面をタップしておいてください'));

    render();
    tick = setInterval(onTick, 100);

    return () => {
      clearInterval(tick);
      stopAlarm();
    };
  },
});
