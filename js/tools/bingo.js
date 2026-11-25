'use strict';

Party.register({
  id: 'bingo',
  name: 'ビンゴ',
  icon: '🅱️',
  desc: '1〜75の抽選マシン（読み上げ対応）',
  render(root) {
    const { h } = Party;
    const LETTERS = ['B', 'I', 'N', 'G', 'O'];
    const READINGS = { B: 'ビー', I: 'アイ', N: 'エヌ', G: 'ジー', O: 'オー' };
    const letterOf = (n) => LETTERS[Math.floor((n - 1) / 15)];

    let drawn = Party.store.get('bingo.drawn', []);
    if (!Array.isArray(drawn)) drawn = [];
    drawn = drawn.filter((n) => Number.isInteger(n) && n >= 1 && n <= 75);
    let speak = Party.store.get('bingo.speak', true);
    let rolling = false;
    let timer = 0;

    const save = () => Party.store.set('bingo.drawn', drawn);

    const ball = h('div', { class: 'bingo-ball', 'aria-live': 'polite' });
    const countEl = h('div', { class: 'muted center' });
    const recentEl = h('div', { class: 'bingo-recent' });
    const board = h('div', { class: 'bingo-board' });
    const drawBtn = h('button', { type: 'button', class: 'btn primary big', onclick: draw }, '次の番号');
    const cells = new Map();

    for (let r = 0; r < 5; r++) {
      board.append(h('div', { class: 'bingo-letter' }, LETTERS[r]));
      for (let c = 1; c <= 15; c++) {
        const n = r * 15 + c;
        const cell = h('div', { class: 'bingo-cell' }, String(n));
        cells.set(n, cell);
        board.append(cell);
      }
    }

    function showBall(n, final) {
      if (n == null) {
        ball.replaceChildren(h('span', { class: 'bingo-num' }, '—'));
        ball.dataset.letter = '';
        return;
      }
      ball.replaceChildren(h('span', { class: 'bingo-letter-sm' }, letterOf(n)), h('span', { class: 'bingo-num' }, String(n)));
      ball.dataset.letter = letterOf(n);
      ball.classList.toggle('rolling', !final);
    }

    function render() {
      const last = drawn[drawn.length - 1];
      for (const [n, cell] of cells) {
        cell.classList.toggle('hit', drawn.includes(n));
        cell.classList.toggle('last', n === last);
      }
      countEl.textContent = `${drawn.length} / 75`;
      recentEl.replaceChildren(
        ...drawn
          .slice(-8)
          .reverse()
          .slice(1)
          .map((n) => h('span', { class: 'bingo-chip', 'data-letter': letterOf(n) }, `${letterOf(n)}${n}`)),
      );
      drawBtn.disabled = drawn.length >= 75 || rolling;
      undoBtn.disabled = !drawn.length || rolling;
      if (!rolling) showBall(last, true);
    }

    function announce(n) {
      if (!speak || !('speechSynthesis' in window)) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(`${READINGS[letterOf(n)]}、${n}`);
        u.lang = 'ja-JP';
        speechSynthesis.speak(u);
      } catch {
        /* 非対応 */
      }
    }

    function draw() {
      if (rolling) return;
      const remaining = [];
      for (let n = 1; n <= 75; n++) if (!drawn.includes(n)) remaining.push(n);
      if (!remaining.length) return;
      Party.unlockAudio();
      rolling = true;
      render();
      let i = 0;
      timer = setInterval(() => {
        showBall(remaining[Party.randInt(remaining.length)], false);
        Party.beep(500 + i * 25, 0.03, 0.08, 'square');
        if (++i >= 16) {
          clearInterval(timer);
          const n = remaining[Party.randInt(remaining.length)];
          drawn.push(n);
          save();
          rolling = false;
          render();
          ball.classList.remove('pop');
          void ball.offsetWidth;
          ball.classList.add('pop');
          Party.beep(988, 0.2, 0.2, 'triangle');
          announce(n);
        }
      }, 55);
    }

    const undoBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn small ghost',
        onclick() {
          if (!drawn.length) return;
          const n = drawn[drawn.length - 1];
          if (!confirm(`最後の番号（${letterOf(n)}${n}）を取り消しますか？`)) return;
          drawn.pop();
          save();
          render();
        },
      },
      '1つ戻す',
    );

    root.append(
      h('div', { class: 'card center-col' }, ball, countEl, h('div', { class: 'row center' }, drawBtn), recentEl),
      h('div', { class: 'card' }, board),
      h(
        'div',
        { class: 'row between wrap' },
        h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: speak,
            onchange(e) {
              speak = e.target.checked;
              Party.store.set('bingo.speak', speak);
            },
          }),
          ' 番号を読み上げる',
        ),
        h(
          'div',
          { class: 'row' },
          undoBtn,
          h(
            'button',
            {
              type: 'button',
              class: 'btn small ghost danger',
              onclick() {
                if (!drawn.length || !confirm('ビンゴをリセットしますか？')) return;
                drawn = [];
                save();
                render();
              },
            },
            'リセット',
          ),
        ),
      ),
    );

    render();

    return () => {
      clearInterval(timer);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    };
  },
});
