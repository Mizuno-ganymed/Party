'use strict';

/**
 * 景品（ビンゴの景品ルーレット）
 *
 * Party.prizes
 *   .parse(text)          テキスト → [{ name, count }]
 *   .readFile(file)       ファイルを文字列として読む（UTF-8 / Shift_JIS 自動判別）
 *   .pick(items)          残っている景品から1つ選ぶ（個数が多いほど当たりやすい）→ spin
 *   .card(opts)           景品一覧のカード
 *   .showSpin(opts)       全画面でルーレットを回して結果を表示
 */
(function () {
  const { h } = Party;
  const TAU = Math.PI * 2;
  const POINTER = Math.PI * 1.5;

  // ---------- 読み込み ----------
  function parse(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    const items = [];
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      // 「商品名,個数」「商品名<TAB>個数」「商品名、3個」など。末尾が数字でなければ個数は1
      const m = line.match(/^(.*?)\s*[,，、\t]\s*(\d+)\s*(?:個|本|枚|名|人分|セット|点)?\s*$/);
      let name = (m ? m[1] : line).replace(/^["']|["']$/g, '').trim();
      const count = m ? Number(m[2]) : 1;
      // 1行目の見出し（「商品名,個数」など）は読み飛ばす
      if (i === 0 && !m && /[,，\t]/.test(line) && /(数|count|qty)/i.test(line)) return;
      name = name.slice(0, 40);
      if (name && count > 0) items.push({ name, count: Math.min(999, count) });
    });
    return items.slice(0, 100);
  }

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      // Windows の Excel などで保存した CSV は Shift_JIS のことが多い
      return new TextDecoder('shift_jis').decode(buf);
    }
  }

  /**
   * 各景品のうち、いまルーレットにのっている個数（サーバーの prizesOnWheel と同じ）
   * all: 残っている全部 / top: 一覧の上から size 個分（当たったら次が補充される）
   */
  function onWheel(items, mode = 'all', size = 5) {
    if (mode !== 'top') return items.map((it) => it.left);
    let slots = size;
    return items.map((it) => {
      const n = Math.min(it.left, slots);
      slots -= n;
      return n;
    });
  }

  /** ルーレットにのっている景品から1つ選ぶ → spin（index は items 内の位置） */
  function pick(items, mode = 'all', size = 5) {
    const counts = onWheel(items, mode, size);
    const avail = items.map((it, i) => ({ name: it.name, n: counts[i], i })).filter((x) => x.n > 0);
    const units = avail.reduce((s, x) => s + x.n, 0);
    if (!units) return null;
    let r = Party.randInt(units);
    let target = 0;
    while (r >= avail[target].n) r -= avail[target++].n;
    return {
      items: avail.map((x) => ({ name: x.name, left: x.n })),
      target,
      index: avail[target].i,
      offset: 0.15 + Math.random() * 0.7,
      duration: 5000,
    };
  }

  // ---------- 一覧カード ----------
  /**
   * opts: { items, awards, mode, size, editable, youId, onLoad(items), onClear(), onMode(mode, size), extra }
   */
  function card(opts) {
    const el = h('section', { class: 'card prize-card' });
    render(el, opts);
    return el;
  }

  function render(el, { items = [], awards = [], mode = 'all', size = 5, editable = false, youId = null, onLoad, onClear, onMode, extra = null }) {
    // 内容が変わっていなければ描き直さない（入力中の貼り付け欄を消さないため）
    const key = JSON.stringify([items, awards, mode, size, editable, youId, !!extra]);
    if (el._prizeKey === key) return;
    el._prizeKey = key;
    const left = items.reduce((s, it) => s + it.left, 0);
    const total = items.reduce((s, it) => s + it.total, 0);

    const counts = onWheel(items, mode, size);
    const list = items.length
      ? h(
          'ul',
          { class: 'prize-list' },
          items.map((it, i) =>
            h(
              'li',
              { class: [it.left ? '' : 'gone', counts[i] ? 'on-wheel' : ''].join(' ') },
              h('span', { class: 'prize-name' }, it.name),
              counts[i] ? h('span', { class: 'wheel-badge', title: 'いまルーレットにのっている数' }, `🎡 ${counts[i]}`) : null,
              h('span', { class: 'prize-count' }, `${it.left} / ${it.total}`),
            ),
          ),
        )
      : h('p', { class: 'muted small' }, editable ? 'まだ景品が登録されていません' : '景品はまだ登録されていません');

    const modeText = mode === 'top' ? `ルーレット: 一覧の上から ${size}個（当たったら次の景品を補充）` : 'ルーレット: 残っている景品をすべてのせる';
    let modeEl = items.length || editable ? h('p', { class: 'muted small prize-mode-text' }, '🎡 ', modeText) : null;
    if (editable && onMode) {
      modeEl = h(
        'div',
        { class: 'prize-mode' },
        h('div', { class: 'field-label' }, 'ルーレットにのせる景品（主催者のみ設定）'),
        Party.segmented(
          [
            ['all', 'すべてのせる'],
            ['top', '上から順に'],
          ],
          mode,
          (v) => onMode(v, size),
        ),
        mode === 'top'
          ? h(
              'div',
              { class: 'row' },
              h('span', null, '一覧の上から'),
              Party.stepper({ value: size, min: 1, max: 20, label: 'ルーレットにのせる数', onChange: (v) => onMode('top', v) }),
              h('span', null, '個'),
            )
          : null,
        h('p', { class: 'muted small' }, mode === 'top' ? '当選者が出るたびに、一覧の次の景品が1個ずつ補充されます' : '残っている景品をすべてのせます（個数が多いほど当たりやすい）'),
      );
    }

    const awardList = awards.length
      ? h(
          'div',
          { class: 'prize-awards' },
          h('h3', null, '当たった景品'),
          h(
            'ul',
            null,
            awards
              .slice()
              .reverse()
              .map((a) => h('li', { class: a.id && a.id === youId ? 'me' : '' }, `${a.name}${a.id && a.id === youId ? '（あなた）' : ''} → `, h('strong', null, a.prize))),
          ),
        )
      : null;

    let tools = null;
    if (editable) {
      const fileInput = h('input', {
        type: 'file',
        accept: '.txt,.csv,.tsv,text/plain,text/csv',
        hidden: true,
        async onchange() {
          const file = fileInput.files?.[0];
          fileInput.value = '';
          if (!file) return;
          load(await readFile(file));
        },
      });
      const textarea = h('textarea', {
        class: 'input prize-text',
        rows: 5,
        placeholder: 'Nintendo Switch,1\nAmazonギフト券 3000円,2\nお菓子セット,5',
      });
      const load = (text) => {
        const parsed = parse(text);
        if (!parsed.length) {
          Party.toast('景品が見つかりませんでした');
          return;
        }
        const sum = parsed.reduce((s, it) => s + it.count, 0);
        const preview = parsed
          .slice(0, 8)
          .map((it) => `・${it.name} ×${it.count}`)
          .join('\n');
        const more = parsed.length > 8 ? `\n…ほか${parsed.length - 8}種類` : '';
        const warn = items.length ? '\n\n※ 今の景品一覧と当選の記録は置き換わります' : '';
        if (!confirm(`${parsed.length}種類・合計${sum}個の景品を登録します。\n\n${preview}${more}${warn}`)) return;
        onLoad(parsed);
        textarea.value = '';
      };
      tools = h(
        'div',
        { class: 'prize-tools' },
        h(
          'div',
          { class: 'row wrap' },
          h('button', { type: 'button', class: 'btn small', onclick: () => fileInput.click() }, '📄 ファイルから読み込む'),
          items.length
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'btn small ghost danger',
                  onclick() {
                    if (confirm('景品一覧と当選の記録を消しますか？')) onClear();
                  },
                },
                'クリア',
              )
            : null,
          fileInput,
        ),
        h(
          'details',
          { class: 'prize-paste' },
          h('summary', null, '貼り付けて登録'),
          textarea,
          h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn small', onclick: () => load(textarea.value) }, '登録')),
        ),
        h('p', { class: 'muted small' }, '1行に1つ「商品名,個数」（個数を省くと1個）。.txt / .csv に対応（Excel の CSV も可）'),
      );
    }

    // replaceChildren は null を文字列にしてしまうので取り除く
    el.replaceChildren(
      ...[
        h('h2', null, '🎁 景品', items.length ? h('span', { class: 'muted' }, ` 残り ${left} / ${total}個`) : null),
        modeEl,
        list,
        extra,
        awardList,
        tools,
      ].filter(Boolean),
    );
  }

  // ---------- ルーレット ----------
  function drawWheel(ctx, size, items, rotation) {
    const c = size / 2;
    const R = c - 10;
    const total = items.reduce((s, it) => s + it.left, 0);
    ctx.clearRect(0, 0, size, size);
    let a = rotation;
    items.forEach((it, i) => {
      const w = (it.left / total) * TAU;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, a, a + w);
      ctx.closePath();
      ctx.fillStyle = Party.COLORS[(i + (items.length > 1 && i === items.length - 1 && i % Party.COLORS.length === 0 ? 2 : 0)) % Party.COLORS.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
      if (w > 0.12) {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(a + w / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,.4)';
        ctx.shadowBlur = 4;
        const fs = Math.max(14, Math.min(34, w * R * 0.4));
        ctx.font = `bold ${fs}px system-ui, sans-serif`;
        let text = it.name;
        const maxW = R * 0.66;
        if (ctx.measureText(text).width > maxW) {
          while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
          text += '…';
        }
        ctx.fillText(text, R - 18, 0);
        ctx.restore();
      }
      a += w;
    });
    ctx.beginPath();
    ctx.arc(c, c, 28, 0, TAU);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(c - 20, 0);
    ctx.lineTo(c + 20, 0);
    ctx.lineTo(c, 46);
    ctx.closePath();
    ctx.fillStyle = '#222';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fill();
  }

  let current = null;

  /** opts: { winner, prize, spin, isMe } */
  function showSpin({ winner, prize, spin, isMe }) {
    current?.close();
    const SIZE = 560;
    const canvas = h('canvas', { class: 'prize-wheel', width: SIZE, height: SIZE });
    const ctx = canvas.getContext('2d');
    const result = h('div', { class: 'prize-result', 'aria-live': 'polite' });
    const closeBtn = h('button', { type: 'button', class: 'btn', disabled: true, onclick: () => close() }, '閉じる');
    const overlay = h(
      'div',
      { class: 'modal-overlay prize-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': '景品ルーレット' },
      h(
        'div',
        { class: 'modal center-col' },
        h('strong', null, `🎁 ${winner} さんの景品ルーレット`),
        canvas,
        result,
        h('div', { class: 'row center' }, closeBtn),
      ),
    );
    document.body.append(overlay);

    const total = spin.items.reduce((s, it) => s + it.left, 0);
    let before = 0;
    for (let i = 0; i < spin.target; i++) before += spin.items[i].left;
    const targetAngle = ((before + spin.items[spin.target].left * spin.offset) / total) * TAU;
    let end = POINTER - targetAngle;
    while (end < TAU * 7) end += TAU;
    const t0 = performance.now();
    let raf = 0;
    let lastTick = 0;
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / spin.duration);
      const rot = end * (1 - Math.pow(1 - t, 4));
      drawWheel(ctx, SIZE, spin.items, rot);
      const tick = Math.floor(rot / (TAU / Math.max(8, spin.items.length)));
      if (tick !== lastTick) {
        lastTick = tick;
        Party.beep(1400, 0.03, 0.06, 'square');
      }
      if (t < 1) {
        raf = requestAnimationFrame(frame);
        return;
      }
      result.replaceChildren(h('div', { class: 'muted small' }, `${winner} さん`), h('div', { class: 'prize-won' }, `🎉 ${prize}`));
      result.classList.add('pop');
      closeBtn.disabled = false;
      Party.fanfare();
      Party.vibrate(isMe ? [120, 60, 120, 60, 240] : [60, 40, 60]);
    };
    raf = requestAnimationFrame(frame);

    function close() {
      cancelAnimationFrame(raf);
      overlay.remove();
      if (current === api) current = null;
    }
    const api = { close };
    current = api;
    return api;
  }

  Party.prizes = { parse, readFile, onWheel, pick, card, render, showSpin };
})();
