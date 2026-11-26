'use strict';

/**
 * ビンゴ
 * - 部屋なし: この端末だけで番号を引く（従来どおり）
 * - 部屋の主催者: 番号を引くと全員に配信。参加者のリーチ・ビンゴを一覧表示
 * - 部屋の参加者: 自分のビンゴカードに自動で印がつく
 */
(function () {
  const { h } = Party;
  const LETTERS = ['B', 'I', 'N', 'G', 'O'];
  const READINGS = { B: 'ビー', I: 'アイ', N: 'エヌ', G: 'ジー', O: 'オー' };
  const letterOf = (n) => LETTERS[Math.floor((n - 1) / 15)];
  /** 5x5 のビンゴの列（横5・縦5・斜め2）。マスの番号は行優先 0〜24 */
  const LINES = (() => {
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push([0, 1, 2, 3, 4].map((c) => i * 5 + c));
      lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + i));
    }
    lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
    return lines;
  })();
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function announce(n) {
    if (!('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(`${READINGS[letterOf(n)]}、${n}`);
      u.lang = 'ja-JP';
      speechSynthesis.speak(u);
    } catch {
      /* 非対応 */
    }
  }

  /** 番号ボール */
  function createBall(small = false) {
    const el = h('div', { class: `bingo-ball${small ? ' small' : ''}`, 'aria-live': 'polite' });
    let timer = 0;
    const show = (n, rolling = false) => {
      if (n == null) {
        el.replaceChildren(h('span', { class: 'bingo-num' }, '—'));
        el.dataset.letter = '';
      } else {
        el.replaceChildren(h('span', { class: 'bingo-letter-sm' }, letterOf(n)), h('span', { class: 'bingo-num' }, String(n)));
        el.dataset.letter = letterOf(n);
      }
      el.classList.toggle('rolling', rolling);
    };
    /** 抽選演出: candidates からランダム表示を繰り返し、最後に final を出す */
    const roll = (candidates, final, onDone, steps = 16) => {
      clearInterval(timer);
      let i = 0;
      timer = setInterval(() => {
        show(candidates.length ? candidates[Party.randInt(candidates.length)] : final, true);
        Party.beep(500 + i * 25, 0.03, 0.08, 'square');
        if (++i >= steps) {
          clearInterval(timer);
          show(final);
          el.classList.remove('pop');
          void el.offsetWidth;
          el.classList.add('pop');
          Party.beep(988, 0.2, 0.2, 'triangle');
          onDone?.();
        }
      }, 55);
    };
    return { el, show, roll, stop: () => clearInterval(timer) };
  }

  /** 1〜75 の一覧ボード */
  function createBoard() {
    const el = h('div', { class: 'bingo-board' });
    const cells = new Map();
    for (let r = 0; r < 5; r++) {
      el.append(h('div', { class: 'bingo-letter' }, LETTERS[r]));
      for (let c = 1; c <= 15; c++) {
        const n = r * 15 + c;
        const cell = h('div', { class: 'bingo-cell' }, String(n));
        cells.set(n, cell);
        el.append(cell);
      }
    }
    const update = (drawn) => {
      const set = new Set(drawn);
      const last = drawn[drawn.length - 1];
      for (const [n, cell] of cells) {
        cell.classList.toggle('hit', set.has(n));
        cell.classList.toggle('last', n === last);
      }
    };
    return { el, update };
  }

  /** 1列あたりの数・片側の行数（片側 4×10 = 40個、左右で 80個 > 74個） */
  const CHIP_H = 20; // 小さい番号の高さ（CSS の .stage-chip と合わせる）
  const STAGE_ROWS = 5; // 左右それぞれ見える行数。超えたら欄の中だけスクロール

  /**
   * 現在の番号（大きいボール）と、過去の番号を左右に小さく並べる表示
   * - 左に5行（ボールのすぐ左から外へ、端まで来たら下の行へ）→ 右に5行 →
   *   左の6行目〜 → 右の6行目〜 … と、5行ずつ左右交互に埋める
   * - 欄の高さは5行分。あふれたら左右の欄がいっしょにスクロールする（中央のボールは動かない）
   * - 新しい番号が出たら、自動で一番下（最新）を表示する
   */
  function createStage(small = false) {
    const ball = createBall(small);
    const left = h('div', { class: 'stage-side left', 'aria-label': 'これまでに出た番号' });
    const right = h('div', { class: 'stage-side right' });
    const el = h('div', { class: `bingo-stage${small ? ' small' : ''}` }, left, ball.el, right);
    let lastKey = '';
    let lastPrev = [];
    const chip = (n, i) => h('span', { class: 'stage-chip', 'data-letter': letterOf(n), title: `${i + 1}番目` }, String(n));

    // 左右のスクロールをそろえる
    let syncing = false;
    const sync = (from, to) => () => {
      if (syncing) return;
      syncing = true;
      to.scrollTop = from.scrollTop;
      requestAnimationFrame(() => (syncing = false));
    };
    left.addEventListener('scroll', sync(left, right), { passive: true });
    right.addEventListener('scroll', sync(right, left), { passive: true });

    const colsOf = () => Math.max(1, getComputedStyle(left).gridTemplateColumns.split(' ').filter(Boolean).length);

    /** prev: 今ボールに出ている番号より前に出た番号（出た順） */
    const update = (prev) => {
      lastPrev = prev;
      const cols = colsOf();
      const key = `${cols}:${prev.join(',')}`;
      if (key === lastKey) return;
      const [lastCols, lastList = ''] = lastKey.split(':');
      // 番号が増えた・列の数が変わった（画面に出た直後や向きの変更）ときは最新を表示する
      const toLatest = prev.length > lastList.split(',').filter(Boolean).length || String(cols) !== lastCols;
      lastKey = key;
      const page = cols * STAGE_ROWS; // 片側5行分
      const L = [];
      const R = [];
      prev.forEach((n, i) => (i % (page * 2) < page ? L : R).push(chip(n, i)));
      left.replaceChildren(...L);
      right.replaceChildren(...R);
      // 左右の行数をそろえて、いっしょにスクロールしたときに行がずれないようにする
      const rows = Math.max(1, Math.ceil(L.length / cols), Math.ceil(R.length / cols));
      left.style.gridTemplateRows = right.style.gridTemplateRows = `repeat(${rows}, ${CHIP_H}px)`;
      if (toLatest) left.scrollTop = right.scrollTop = left.scrollHeight;
    };

    // 画面の幅や向きが変わったら並べ直す
    new ResizeObserver(() => update(lastPrev)).observe(el);
    return { el, ball, update };
  }

  /** 1〜75 のうち、まだ出ていない番号 */
  const remainingOf = (drawn) => {
    const set = new Set(drawn);
    const pool = [];
    for (let n = 1; n <= 75; n++) if (!set.has(n)) pool.push(n);
    return pool;
  };

  /** ボールに出ている番号より前の番号。演出中は直前の番号もすでに「過去」に移す */
  const previousOf = (visible, rolling) => (rolling ? visible : visible.slice(0, -1));

  function speakToggle(key, fallback) {
    let on = Party.store.get(key, fallback);
    const label = h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: on,
        onchange(e) {
          on = e.target.checked;
          Party.store.set(key, on);
        },
      }),
      ' 番号を読み上げる',
    );
    return { el: label, get on() {
      return on;
    } };
  }

  /** これまでに出た番号（出た順・一覧表） */
  function createHistory({ withBoard = true } = {}) {
    const summary = h('summary', null);
    const list = h('ol', { class: 'history-order', reversed: true });
    const board = withBoard ? createBoard() : null;
    const el = h(
      'details',
      { class: 'card bingo-history' },
      summary,
      h('h3', null, '出た順（新しい順）'),
      list,
      board ? [h('h3', null, '番号の一覧'), board.el] : null,
    );
    let lastKey = '';
    const update = (drawn) => {
      summary.textContent = `📜 これまでに出た番号（${drawn.length}個）`;
      const key = drawn.join(',');
      if (key === lastKey) return;
      lastKey = key;
      list.replaceChildren(
        ...drawn
          .map((n, i) => h('li', { value: i + 1 }, h('span', { class: 'bingo-chip', 'data-letter': letterOf(n) }, `${letterOf(n)}${n}`)))
          .reverse(),
      );
      if (!drawn.length) list.append(h('li', { class: 'muted' }, 'まだ番号は出ていません'));
      board?.update(drawn);
    };
    update([]);
    return { el, update };
  }

  /** リーチ・ビンゴの一覧 */
  /**
   * prizes: 部屋の景品情報 { items, awards }（無ければ景品表示なし）
   * onPrize(cid): 主催者だけ。ビンゴした人の景品ルーレットを回す
   */
  /** 景品ルーレットの順番待ち（ビンゴになった順）と、ルーレット中かどうか */
  const prizeTurn = (prizes) => ({
    queue: prizes?.queue || [],
    busy: Party.room.now() < (prizes?.spinUntil || 0),
  });

  function standings(el, bingo, youId, prizes = null, onPrize = null) {
    const winners = bingo.winners || [];
    const awards = (prizes?.awards || []).filter((a) => a.round === bingo.round);
    const { queue, busy } = prizeTurn(prizes);
    const prizeOf = (w) => {
      const a = awards.find((x) => x.id === w.id);
      if (a) return h('span', { class: 'won-prize' }, `🎁 ${a.prize}`);
      const pos = queue.indexOf(w.id);
      if (pos < 0) return null;
      if (pos > 0) return h('span', { class: 'muted small waiting-prize' }, `⏳ 順番待ち（${pos + 1}番目）`);
      if (onPrize)
        return h(
          'button',
          {
            type: 'button',
            class: 'btn small ghost prize-btn',
            disabled: busy || null,
            title: 'ビンゴになった人のスマホで回せない場合に、主催者が代わりに回します',
            onclick: () => onPrize(w.id),
          },
          busy ? '⏳ ルーレット中' : '🎁 代わりに回す',
        );
      return h('span', { class: 'small waiting-prize now' }, busy ? '⏳ 次の番' : '🎁 ルーレットの番');
    };
    const reach = (bingo.reach || []).slice().sort((a, b) => b.lines - a.lines);
    const mark = (id, text) => (id === youId ? h('strong', { class: 'me' }, `${text}（あなた）`) : text);
    el.replaceChildren(
      h('h2', null, `🏆 ビンゴ ${winners.length}人`, h('span', { class: 'muted' }, ` / 参加 ${bingo.players}人`)),
      winners.length
        ? h(
            'ol',
            { class: 'winners' },
            winners.map((w) => h('li', null, mark(w.id, w.name), h('span', { class: 'muted' }, `  ${w.count}個目`), prizeOf(w))),
          )
        : h('p', { class: 'muted' }, 'まだビンゴの人はいません'),
      h('h2', null, `🔥 リーチ ${reach.length}人`),
      reach.length
        ? h(
            'div',
            { class: 'chips' },
            reach.map((r) => h('span', { class: 'chip reach' }, mark(r.id, r.name), r.lines > 1 ? ` ×${r.lines}` : '')),
          )
        : h('p', { class: 'muted' }, 'まだリーチの人はいません'),
    );
  }

  /** ルーレットの演出が終わる時刻に描き直す（ボタンを押せるように戻すため） */
  let refreshTimer = 0;
  function scheduleRefresh(prizes, redraw) {
    clearTimeout(refreshTimer);
    const wait = (prizes?.spinUntil || 0) - Party.room.now();
    if (wait > 0) refreshTimer = setTimeout(redraw, wait + 50);
  }

  // ---------------------------------------------------------------
  // 部屋なし（この端末だけ）
  // ---------------------------------------------------------------
  function renderLocal(root) {
    let drawn = Party.store.get('bingo.drawn', []);
    if (!Array.isArray(drawn)) drawn = [];
    drawn = drawn.filter((n) => Number.isInteger(n) && n >= 1 && n <= 75);
    let rolling = false;
    const save = () => Party.store.set('bingo.drawn', drawn);

    const stage = createStage();
    const ball = stage.ball;
    const board = createBoard();
    const countEl = h('div', { class: 'muted center' });
    const speak = speakToggle('bingo.speak', true);
    const history = createHistory({ withBoard: false });
    const drawBtn = h('button', { type: 'button', class: 'btn primary big', onclick: draw }, '次の番号');

    // 景品（この端末に保存）
    const loadPrizes = () => {
      const p = Party.store.get('bingo.prizes', null);
      const base = { items: [], awards: [], mode: 'all', size: 5 };
      if (!p || !Array.isArray(p.items)) return base;
      return { ...base, ...p, awards: Array.isArray(p.awards) ? p.awards : [], mode: p.mode === 'top' ? 'top' : 'all', size: Number(p.size) || 5 };
    };
    let prizes = loadPrizes();
    const savePrizes = () => Party.store.set('bingo.prizes', prizes);
    const prizeEl = Party.prizes.card({});
    function renderPrizes() {
      const left = prizes.items.reduce((s, it) => s + it.left, 0);
      Party.prizes.render(prizeEl, {
        ...prizes,
        editable: true,
        onLoad(items) {
          prizes = { ...prizes, items: items.map((it) => ({ name: it.name, total: it.count, left: it.count })), awards: [] };
          savePrizes();
          renderPrizes();
        },
        onClear() {
          prizes = { ...prizes, items: [], awards: [] };
          savePrizes();
          renderPrizes();
        },
        onMode(mode, size) {
          prizes = { ...prizes, mode, size };
          savePrizes();
          renderPrizes();
        },
        extra: left
          ? h(
              'div',
              { class: 'row center' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn primary',
                  onclick() {
                    const name = prompt('当たった人の名前（省略できます）', '');
                    if (name == null) return;
                    const spin = Party.prizes.pick(prizes.items, prizes.mode, prizes.size);
                    if (!spin) return;
                    Party.unlockAudio();
                    const prize = prizes.items[spin.index].name;
                    prizes.items[spin.index].left -= 1;
                    const winner = name.trim().slice(0, 20) || 'あなた';
                    prizes.awards.push({ name: winner, prize });
                    savePrizes();
                    Party.prizes.showSpin({ winner, prize, spin, isMe: false });
                    setTimeout(renderPrizes, spin.duration);
                  },
                },
                '🎁 景品ルーレットを回す',
              ),
            )
          : null,
      });
    }
    renderPrizes();
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

    function render() {
      board.update(drawn);
      countEl.textContent = `${drawn.length} / 75`;
      stage.update(previousOf(drawn, rolling));
      history.update(drawn);
      drawBtn.disabled = drawn.length >= 75 || rolling;
      undoBtn.disabled = !drawn.length || rolling;
      if (!rolling) ball.show(drawn[drawn.length - 1]);
    }

    function draw() {
      if (rolling) return;
      const remaining = [];
      for (let n = 1; n <= 75; n++) if (!drawn.includes(n)) remaining.push(n);
      if (!remaining.length) return;
      Party.unlockAudio();
      rolling = true;
      render();
      const n = remaining[Party.randInt(remaining.length)];
      ball.roll(remaining, n, () => {
        drawn.push(n);
        save();
        rolling = false;
        render();
        if (speak.on) announce(n);
      });
    }

    root.append(
      h('div', { class: 'card center-col' }, stage.el, countEl, h('div', { class: 'row center' }, drawBtn)),
      h('div', { class: 'card' }, board.el),
      history.el,
      prizeEl,
      h(
        'div',
        { class: 'row between wrap' },
        speak.el,
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
      h('p', { class: 'muted small center' }, 'ホームで「部屋」を作ると、参加者のスマホにビンゴカードを配れます'),
    );
    render();

    return () => {
      ball.stop();
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    };
  }

  // ---------------------------------------------------------------
  // 部屋の主催者
  // ---------------------------------------------------------------
  function renderHost(root) {
    const room = Party.room;
    let rolling = false;

    const stage = createStage();
    const ball = stage.ball;
    const board = createBoard();
    const countEl = h('div', { class: 'muted center' });
    const waitEl = h('p', { class: 'warn small center', hidden: true });
    const standingsEl = h('div', { class: 'card standings' });
    const history = createHistory({ withBoard: false });
    const prizeEl = Party.prizes.card({});
    const speak = speakToggle('bingo.speak', true);
    const drawBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn primary big',
        onclick() {
          Party.unlockAudio();
          if (room.send({ t: 'bingo.draw' })) drawBtn.disabled = true;
        },
      },
      '次の番号',
    );
    const undoBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn small ghost',
        onclick() {
          const drawn = room.room?.bingo.drawn || [];
          if (!drawn.length) return;
          const n = drawn[drawn.length - 1];
          if (confirm(`最後の番号（${letterOf(n)}${n}）を取り消しますか？\n参加者のカードからも印が消えます`)) room.send({ t: 'bingo.undo' });
        },
      },
      '1つ戻す',
    );
    const resetBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn small ghost danger',
        onclick() {
          if (confirm('新しいゲームを始めますか？\n番号をリセットし、参加者全員に新しいカードを配ります')) room.send({ t: 'bingo.reset' });
        },
      },
      '新しいゲーム',
    );

    function render(r) {
      if (!r) {
        countEl.textContent = '接続中…';
        drawBtn.disabled = true;
        return;
      }
      const all = r.bingo.drawn;
      const drawn = rolling ? all.slice(0, -1) : all;
      board.update(drawn);
      countEl.textContent = `${drawn.length} / 75`;
      stage.update(previousOf(drawn, rolling));
      const turn = prizeTurn(r.prizes);
      drawBtn.disabled = rolling || all.length >= 75 || room.status !== 'open' || turn.queue.length > 0;
      waitEl.hidden = !turn.queue.length;
      waitEl.textContent = `🎁 ビンゴの人が景品ルーレットを回し終わるまで、次の番号は引けません（あと${turn.queue.length}人）`;
      scheduleRefresh(r.prizes, () => render(room.room));
      undoBtn.disabled = rolling || !all.length;
      if (!rolling) ball.show(drawn[drawn.length - 1]);
      history.update(drawn);
      const prizes = r.prizes || { items: [], awards: [] };
      standings(standingsEl, r.bingo, null, prizes, (cid) => {
        Party.unlockAudio();
        room.send({ t: 'prize.spin', cid });
      });
      Party.prizes.render(prizeEl, {
        ...prizes,
        editable: true,
        onLoad: (items) => room.send({ t: 'prize.set', items }),
        onClear: () => room.send({ t: 'prize.clear' }),
        onMode: (mode, size) => room.send({ t: 'prize.mode', mode, size }),
      });
    }

    room.on((r, ev) => {
      if (ev?.type === 'bingo.draw') {
        rolling = true;
        render(r);
        ball.roll(remainingOf(r.bingo.drawn), ev.n, () => {
          rolling = false;
          render(room.room);
          if (speak.on) announce(ev.n);
        });
        return;
      }
      // ビンゴの通知は room.js が全員に出す。リーチは主催者にだけ小さく知らせる
      if (ev?.type === 'bingo.mark' && !ev.newBingo?.length && ev.newReach?.length) Party.toast(`🔥 リーチ: ${ev.newReach.join('、')}`);
      if (ev?.type === 'bingo.reset') Party.toast('新しいゲームを始めました');
      if (ev?.type === 'prize.spin') Party.prizes.showSpin({ winner: ev.winner, prize: ev.prize, spin: ev.spin, isMe: false });
      render(r);
    });

    root.append(
      h('div', { class: 'card center-col' }, stage.el, countEl, h('div', { class: 'row center' }, drawBtn), waitEl),
      standingsEl,
      prizeEl,
      h('div', { class: 'card' }, board.el),
      history.el,
      h('div', { class: 'row between wrap' }, speak.el, h('div', { class: 'row' }, undoBtn, resetBtn)),
    );
    render(room.room);

    return () => {
      ball.stop();
      clearTimeout(refreshTimer);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    };
  }

  // ---------------------------------------------------------------
  // 部屋の参加者
  // ---------------------------------------------------------------
  function renderGuest(root) {
    const room = Party.room;
    let rolling = false;
    let wasBingo = null;
    let wasReach = null;
    let cardKey = '';
    const cells = new Map(); // 番号 → マスの要素
    const pending = new Set(); // 送信済みでサーバーの反映待ちの印

    const stage = createStage(true);
    const ball = stage.ball;
    const countEl = h('div', { class: 'muted small center' });
    const statusEl = h('div', { class: 'my-status' });
    let spinRequested = false;
    let waitedInLine = false;
    const spinBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn primary big my-prize-btn',
        hidden: true,
        onclick() {
          Party.unlockAudio();
          if (room.send({ t: 'prize.spin' })) {
            spinRequested = true;
            spinBtn.disabled = true;
          }
        },
      },
      '🎁 景品ルーレットを回す',
    );
    const cardEl = h('div', { class: 'paper-card' });
    let gridEl = null;
    let linesSvg = null;
    let cardCells = []; // 25マス（行優先）
    const history = createHistory();
    const standingsEl = h('div', { class: 'card standings' });
    const prizeEl = Party.prizes.card({});
    const speak = speakToggle('bingo.speakGuest', false);

    /** 演出中の最新番号はまだ「出ていない」扱い */
    const visibleDrawn = () => {
      const all = room.room?.bingo.drawn || [];
      return rolling ? all.slice(0, -1) : all;
    };
    const markedSet = () => new Set([...(room.you?.marks || []), ...pending]);

    function tap(n, cell) {
      if (n === 0 || markedSet().has(n)) return;
      if (!visibleDrawn().includes(n)) {
        Party.toast('まだ出ていない番号です');
        cell.classList.remove('shake');
        void cell.offsetWidth;
        cell.classList.add('shake');
        return;
      }
      if (!room.send({ t: 'bingo.mark', n })) return;
      pending.add(n);
      Party.unlockAudio();
      // 紙を押し抜く音（低い「ポン」＋紙の音）
      Party.beep(180, 0.09, 0.3, 'sine');
      Party.beep(1200, 0.03, 0.06, 'square', 0.02);
      Party.vibrate(30);
      cell.classList.remove('punch-anim');
      void cell.offsetWidth;
      cell.classList.add('punch-anim');
      render(room.room);
    }

    function buildCard(card) {
      cells.clear();
      cardCells = card.map((n, i) => {
        const free = n === 0;
        const cell = h(
          'button',
          {
            type: 'button',
            class: `bc-cell${free ? ' free hit' : ''}`,
            'data-col': LETTERS[i % 5],
            'aria-label': free ? 'FREE' : `${letterOf(n)}${n}`,
            onclick: () => tap(n, cell),
          },
          h('span', { class: 'bc-num' }, free ? 'FREE' : String(n)),
        );
        if (!free) cells.set(n, cell);
        return cell;
      });
      linesSvg = document.createElementNS(SVG_NS, 'svg');
      linesSvg.setAttribute('class', 'pc-lines');
      linesSvg.setAttribute('aria-hidden', 'true');
      gridEl = h('div', { class: 'pc-grid' }, cardCells, linesSvg);
      cardEl.replaceChildren(
        h(
          'div',
          { class: 'pc-inner' },
          h('div', { class: 'pc-head' }, LETTERS.map((l) => h('span', { class: 'pc-letter', 'data-letter': l }, l))),
          gridEl,
          h('div', { class: 'pc-foot' }, 'PARTY BINGO'),
        ),
      );
    }

    /** そろった列に金色の線を引く */
    function drawLines(marked) {
      if (!gridEl || !linesSvg) return;
      const full = LINES.filter((line) => line.every((i) => cardCells[i].classList.contains('free') || marked.has(Number(cardCells[i].textContent))));
      const gw = gridEl.clientWidth;
      const gh = gridEl.clientHeight;
      linesSvg.setAttribute('viewBox', `0 0 ${gw} ${gh}`);
      const center = (i) => {
        const c = cardCells[i];
        return [c.offsetLeft + c.offsetWidth / 2, c.offsetTop + c.offsetHeight / 2];
      };
      linesSvg.replaceChildren(
        ...full.map((line) => {
          const [x1, y1] = center(line[0]);
          const [x2, y2] = center(line[4]);
          const el = document.createElementNS(SVG_NS, 'line');
          el.setAttribute('x1', x1);
          el.setAttribute('y1', y1);
          el.setAttribute('x2', x2);
          el.setAttribute('y2', y2);
          return el;
        }),
      );
    }

    function render(r) {
      const card = room.you?.card;
      if (!r || !card) {
        cardKey = '';
        cardEl.replaceChildren(h('p', { class: 'muted center' }, r ? 'カードを準備しています…' : '接続中…'));
        return;
      }
      const key = `${r.bingo.round}:${card.join(',')}`;
      if (key !== cardKey) {
        cardKey = key;
        pending.clear();
        buildCard(card);
      }
      for (const n of room.you.marks || []) pending.delete(n);
      const marked = markedSet();
      for (const [n, cell] of cells) {
        const hit = marked.has(n);
        cell.classList.toggle('hit', hit);
        cell.setAttribute('aria-pressed', String(hit));
      }
      drawLines(marked);

      const drawn = visibleDrawn();
      countEl.textContent = `${drawn.length} / 75`;
      stage.update(previousOf(drawn, rolling));
      history.update(drawn);
      if (!rolling) ball.show(drawn[drawn.length - 1]);

      const myId = room.you.id;
      const win = r.bingo.winners.find((w) => w.id === myId);
      const reach = r.bingo.reach.find((x) => x.id === myId);
      statusEl.className = `my-status${win ? ' bingo' : reach ? ' reach' : ''}`;
      statusEl.textContent = win ? `🎉 ビンゴ！（${win.rank}位）` : reach ? `🔥 リーチ！${reach.lines > 1 ? ` ×${reach.lines}` : ''}` : '';
      // ビンゴになったら、自分で景品ルーレットを回せる
      const prizeState = r.prizes || { items: [], awards: [] };
      const awarded = prizeState.awards.some((a) => a.id === myId && a.round === r.bingo.round);
      const prizesLeft = prizeState.items.reduce((s, it) => s + it.left, 0);
      const turn = prizeTurn(prizeState);
      const myPos = turn.queue.indexOf(myId);
      const canSpin = !!win && !awarded && prizesLeft > 0 && myPos >= 0;
      const myTurn = canSpin && myPos === 0 && !turn.busy;
      if (!canSpin) spinRequested = false;
      spinBtn.hidden = !canSpin;
      spinBtn.disabled = !myTurn || spinRequested || room.status !== 'open';
      spinBtn.textContent = myPos > 0 ? `⏳ 順番待ち（あと${myPos}人）` : turn.busy ? '⏳ ルーレット中…' : '🎁 景品ルーレットを回す';
      spinBtn.classList.toggle('waiting', !myTurn);
      // 順番待ちのあと、前の人のルーレットが終わって回せるようになったら知らせる
      if (myPos > 0) waitedInLine = true;
      if (myTurn && waitedInLine) {
        waitedInLine = false;
        Party.prizes.close(); // 前の人の結果の画面を閉じて、ボタンを押せるようにする
        Party.vibrate([100, 50, 100]);
        Party.beep(880, 0.12, 0.2, 'triangle');
        Party.beep(1175, 0.18, 0.2, 'triangle', 0.12);
        Party.toast('🎁 あなたの番です！ 景品ルーレットを回しましょう');
      }
      scheduleRefresh(prizeState, () => render(room.room));
      const prizes = r.prizes || { items: [], awards: [] };
      standings(standingsEl, r.bingo, myId, prizes);
      Party.prizes.render(prizeEl, { ...prizes, youId: myId });
      prizeEl.hidden = !prizes.items.length;

      if (wasReach === false && reach && !win) {
        Party.vibrate([80, 40, 80]);
        Party.toast('🔥 リーチ！');
      }
      wasBingo = !!win;
      wasReach = !!reach;
    }

    room.on((r, ev) => {
      if (ev?.type === 'bingo.draw') {
        rolling = true;
        render(r);
        ball.roll(remainingOf(r.bingo.drawn), ev.n, () => {
          rolling = false;
          render(room.room);
          if (speak.on) announce(ev.n);
        });
        return;
      }
      if (ev?.type === 'bingo.reset') {
        wasBingo = wasReach = null;
        Party.toast('新しいゲーム！ カードが配り直されました');
      }
      if (ev?.type === 'prize.spin') {
        Party.prizes.showSpin({ winner: ev.winner, prize: ev.prize, spin: ev.spin, isMe: ev.cid === room.you?.id });
      }
      render(r);
    });

    root.append(
      h('div', { class: 'guest-top' }, stage.el, countEl, statusEl, spinBtn),
      h(
        'div',
        { class: 'card' },
        h('p', { class: 'muted small center' }, '出た番号を見つけたら、カードのマスをタップして印をつけましょう'),
        cardEl,
      ),
      history.el,
      standingsEl,
      prizeEl,
      h('div', { class: 'row center' }, speak.el),
    );
    render(room.room);

    // 画面の幅が変わったら金色の線を引き直す
    const resize = new ResizeObserver(() => drawLines(markedSet()));
    resize.observe(cardEl);

    return () => {
      ball.stop();
      resize.disconnect();
      clearTimeout(refreshTimer);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    };
  }

  Party.register({
    id: 'bingo',
    name: 'ビンゴ',
    icon: '🅱️',
    desc: '1〜75の抽選マシン（読み上げ対応）',
    room: true,
    render(root) {
      if (!Party.room.active) return renderLocal(root);
      return Party.room.isHost ? renderHost(root) : renderGuest(root);
    },
  });
})();
