'use strict';

Party.register({
  id: 'roulette',
  name: 'ルーレット',
  icon: '🎯',
  desc: 'メンバーから1人を抽選',
  render(root) {
    const { h } = Party;
    const TAU = Math.PI * 2;
    const POINTER = Math.PI * 1.5; // 真上
    const SIZE = 600;
    const C = SIZE / 2;
    const R = C - 12;

    const excluded = new Set();
    let pendingExclude = null;
    let items = [];
    let rotation = 0;
    let spinning = false;
    let raf = 0;

    const canvas = h('canvas', { class: 'wheel', width: SIZE, height: SIZE, 'aria-label': 'ルーレット' });
    const ctx = canvas.getContext('2d');
    const result = h('div', { class: 'result', 'aria-live': 'polite' });
    const info = h('p', { class: 'muted center' });

    const removeChk = h('input', {
      type: 'checkbox',
      checked: Party.store.get('roulette.remove', false),
      onchange: () => Party.store.set('roulette.remove', removeChk.checked),
    });
    const spinBtn = h('button', { type: 'button', class: 'btn primary big', onclick: spin }, 'スタート');
    const resetBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn small ghost',
        onclick() {
          excluded.clear();
          pendingExclude = null;
          result.textContent = '';
          update();
        },
      },
      '除外をリセット',
    );

    const candidates = () => Party.members.get().filter((m) => !excluded.has(m));
    const mod = (a, m) => ((a % m) + m) % m;
    const indexAt = (rot, n) => Math.floor(mod(POINTER - rot, TAU) / (TAU / n));

    function colorFor(i, n) {
      const len = Party.COLORS.length;
      // 最後と最初が同じ色で隣り合わないように
      if (n > 1 && i === n - 1 && i % len === 0) return Party.COLORS[2];
      return Party.COLORS[i % len];
    }

    function fitText(text, maxWidth) {
      if (ctx.measureText(text).width <= maxWidth) return text;
      let t = text;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
      return t + '…';
    }

    function draw() {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const n = items.length;
      if (!n) {
        ctx.beginPath();
        ctx.arc(C, C, R, 0, TAU);
        ctx.fillStyle = 'rgba(128,128,128,.2)';
        ctx.fill();
        ctx.fillStyle = 'rgba(128,128,128,.9)';
        ctx.font = 'bold 32px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('メンバーを追加してください', C, C);
        return;
      }
      const seg = TAU / n;
      const fontSize = Math.max(16, Math.min(44, seg * R * 0.42));
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      for (let i = 0; i < n; i++) {
        const a0 = rotation + i * seg;
        ctx.beginPath();
        ctx.moveTo(C, C);
        ctx.arc(C, C, R, a0, a0 + seg);
        ctx.closePath();
        ctx.fillStyle = colorFor(i, n);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.save();
        ctx.translate(C, C);
        ctx.rotate(a0 + seg / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,.35)';
        ctx.shadowBlur = 4;
        ctx.fillText(fitText(items[i], R * 0.62), R - 22, 0);
        ctx.restore();
      }
      // 中心
      ctx.beginPath();
      ctx.arc(C, C, 34, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
      // 針
      ctx.beginPath();
      ctx.moveTo(C - 22, 0);
      ctx.lineTo(C + 22, 0);
      ctx.lineTo(C, 52);
      ctx.closePath();
      ctx.fillStyle = '#222';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fill();
    }

    function update() {
      if (spinning) return;
      items = candidates();
      draw();
      resetBtn.hidden = excluded.size === 0 && !pendingExclude;
      spinBtn.disabled = items.length < 2;
      const all = Party.members.get().length;
      info.textContent =
        items.length < 2
          ? '2人以上のメンバーを登録してください'
          : excluded.size
            ? `候補 ${items.length}人（${excluded.size}人除外中）`
            : `候補 ${items.length}人`;
      if (all === 0) info.textContent = '下の「メンバー」から参加者を登録してください';
    }

    function spin() {
      if (spinning) return;
      Party.unlockAudio();
      if (pendingExclude) {
        excluded.add(pendingExclude);
        pendingExclude = null;
      }
      update();
      if (items.length < 2) return;

      const n = items.length;
      const seg = TAU / n;
      const target = Party.randInt(n);
      const offset = (target + 0.15 + Math.random() * 0.7) * seg;
      rotation = mod(rotation, TAU);
      const start = rotation;
      let end = POINTER - offset;
      while (end < start + TAU * 6) end += TAU;

      const duration = 4200 + Math.random() * 1200;
      const t0 = performance.now();
      let lastIdx = indexAt(rotation, n);
      spinning = true;
      spinBtn.disabled = true;
      result.textContent = '';
      result.classList.remove('pop');

      const frame = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 4);
        rotation = start + (end - start) * eased;
        draw();
        const idx = indexAt(rotation, n);
        if (idx !== lastIdx) {
          lastIdx = idx;
          Party.beep(1400, 0.03, 0.08, 'square');
        }
        if (t < 1) {
          raf = requestAnimationFrame(frame);
          return;
        }
        spinning = false;
        const winner = items[indexAt(rotation, n)];
        result.textContent = `🎉 ${winner}`;
        void result.offsetWidth;
        result.classList.add('pop');
        Party.fanfare();
        Party.vibrate([60, 40, 60]);
        if (removeChk.checked) pendingExclude = winner;
        update();
      };
      raf = requestAnimationFrame(frame);
    }

    root.append(
      h('div', { class: 'wheel-wrap' }, canvas),
      result,
      h('div', { class: 'row center' }, spinBtn),
      info,
      h(
        'div',
        { class: 'row center wrap' },
        h('label', { class: 'check' }, removeChk, ' 当たった人を次から外す'),
        resetBtn,
      ),
      Party.memberEditor(),
    );

    Party.members.onChange(update);
    update();

    return () => cancelAnimationFrame(raf);
  },
});
