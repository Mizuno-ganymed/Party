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
  const SIDE_COLS = 4;
  const SIDE_CAP = 40;

  /**
   * 現在の番号（大きいボール）と、過去の番号を左右に小さく並べる表示
   * 左側: ボールのすぐ左から外側（画面の端）へ向かって並べ、端まで来たら下の行へ
   * 左側が埋まったら、右側にボールのすぐ右から同じように並べる
   */
  function createStage(small = false) {
    const ball = createBall(small);
    const left = h('div', { class: 'stage-side left', 'aria-label': 'これまでに出た番号' });
    const right = h('div', { class: 'stage-side right' });
    const el = h('div', { class: `bingo-stage${small ? ' small' : ''}` }, left, ball.el, right);
    let lastKey = '';
    const chip = (n, i) => h('span', { class: 'stage-chip', 'data-letter': letterOf(n), title: `${i + 1}番目` }, String(n));
    /** prev: 今ボールに出ている番号より前に出た番号（出た順） */
    const update = (prev) => {
      const key = prev.join(',');
      if (key === lastKey) return;
      lastKey = key;
      left.replaceChildren(...prev.slice(0, SIDE_CAP).map((n, i) => chip(n, i)));
      right.replaceChildren(...prev.slice(SIDE_CAP).map((n, i) => chip(n, i + SIDE_CAP)));
    };
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
  function standings(el, bingo, youId, prizes = null, onPrize = null) {
    const winners = bingo.winners || [];
    const awards = (prizes?.awards || []).filter((a) => a.round === bingo.round);
    const prizesLeft = (prizes?.items || []).reduce((s, it) => s + it.left, 0);
    const prizeOf = (w) => {
      const a = awards.find((x) => x.id === w.id);
      if (a) return h('span', { class: 'won-prize' }, `🎁 ${a.prize}`);
      if (onPrize && prizesLeft > 0)
        return h('button', { type: 'button', class: 'btn small primary prize-btn', onclick: () => onPrize(w.id) }, '🎁 景品ルーレット');
      return null;
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

  function celebrate(text) {
    Party.fanfare();
    Party.vibrate([120, 60, 120, 60, 240]);
    const banner = h('div', { class: 'celebrate', role: 'alert' }, text);
    document.body.append(banner);
    setTimeout(() => banner.remove(), 3500);
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
      return p && Array.isArray(p.items) ? { items: p.items, awards: Array.isArray(p.awards) ? p.awards : [] } : { items: [], awards: [] };
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
          prizes = { items: items.map((it) => ({ name: it.name, total: it.count, left: it.count })), awards: [] };
          savePrizes();
          renderPrizes();
        },
        onClear() {
          prizes = { items: [], awards: [] };
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
                    const spin = Party.prizes.pick(prizes.items);
                    if (!spin) return;
                    Party.unlockAudio();
                    const prize = spin.items[spin.target].name;
                    prizes.items.find((it) => it.name === prize && it.left > 0).left -= 1;
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
      drawBtn.disabled = rolling || all.length >= 75 || room.status !== 'open';
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
      if (ev?.type === 'bingo.mark') {
        if (ev.newBingo?.length) celebrate(`🎉 ビンゴ！ ${ev.newBingo.join('、')}`);
        else if (ev.newReach?.length) Party.toast(`🔥 リーチ: ${ev.newReach.join('、')}`);
      }
      if (ev?.type === 'bingo.reset') Party.toast('新しいゲームを始めました');
      if (ev?.type === 'prize.spin') Party.prizes.showSpin({ winner: ev.winner, prize: ev.prize, spin: ev.spin, isMe: false });
      render(r);
    });

    root.append(
      h('div', { class: 'card center-col' }, stage.el, countEl, h('div', { class: 'row center' }, drawBtn)),
      standingsEl,
      prizeEl,
      h('div', { class: 'card' }, board.el),
      history.el,
      h('div', { class: 'row between wrap' }, speak.el, h('div', { class: 'row' }, undoBtn, resetBtn)),
    );
    render(room.room);

    return () => {
      ball.stop();
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
    const cardEl = h('div', { class: 'bingo-card' });
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
      Party.beep(880, 0.06, 0.15, 'triangle');
      Party.vibrate(30);
      cell.classList.add('flash');
      render(room.room);
    }

    function buildCard(card) {
      cells.clear();
      cardEl.replaceChildren(
        ...LETTERS.map((l) => h('div', { class: 'bc-head', 'data-letter': l }, l)),
        ...card.map((n) => {
          const free = n === 0;
          const cell = h(
            'button',
            {
              type: 'button',
              class: `bc-cell${free ? ' free hit' : ''}`,
              'aria-label': free ? 'FREE' : `${letterOf(n)}${n}`,
              onclick: () => tap(n, cell),
            },
            free ? 'FREE' : String(n),
          );
          if (!free) cells.set(n, cell);
          return cell;
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
      const prizes = r.prizes || { items: [], awards: [] };
      standings(standingsEl, r.bingo, myId, prizes);
      Party.prizes.render(prizeEl, { ...prizes, youId: myId });
      prizeEl.hidden = !prizes.items.length;

      if (wasBingo === false && win) celebrate('🎉 ビンゴ！ 主催者に知らせましょう');
      else if (wasReach === false && reach && !win) {
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
      if (ev?.type === 'bingo.mark' && ev.newBingo?.length) {
        const meNow = r?.bingo.winners.some((w) => w.id === room.you?.id) && !wasBingo;
        if (!meNow) Party.toast(`🎉 ${ev.newBingo.join('、')} がビンゴ！`);
      }
      render(r);
    });

    root.append(
      h('div', { class: 'guest-top' }, stage.el, countEl, statusEl),
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

    return () => {
      ball.stop();
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
