'use strict';

/**
 * スコアボード
 * - 部屋なし: この端末に保存
 * - 部屋の主催者: 変更を全員に配信
 * - 部屋の参加者: 見るだけ
 */
Party.register({
  id: 'scoreboard',
  name: 'スコアボード',
  icon: '🏆',
  desc: 'ゲームの得点をみんなで記録',
  room: true,
  render(root) {
    const { h } = Party;
    const room = Party.room;
    const inRoom = room.active;
    const canEdit = !inRoom || room.isHost;

    const normalize = (p) =>
      Array.isArray(p) ? p.filter((x) => x && typeof x.name === 'string').map((x) => ({ name: x.name, score: Number(x.score) || 0 })) : [];

    let players = inRoom ? normalize(room.room?.scoreboard.players) : normalize(Party.store.get('scoreboard.players', []));
    let step = Number(Party.store.get('scoreboard.step', 1)) || 1;
    let sorted = Party.store.get('scoreboard.sorted', inRoom && !canEdit);

    /** 変更を保存（部屋なら配信） */
    let pending = 0; // 送信済みで、まだ配信が戻ってきていない変更の数
    let lastSend = 0;
    function commit() {
      if (inRoom && room.send({ t: 'score.set', players })) {
        pending++;
        lastSend = Date.now();
      }
      else Party.store.set('scoreboard.players', players);
      render();
    }

    const listEl = h('div', { class: 'score-list' });
    const emptyEl = h('div', { class: 'card center-col' });
    const addInput = h('input', {
      type: 'text',
      class: 'input',
      placeholder: 'プレイヤー名 / チーム名',
      maxlength: 20,
      enterkeyhint: 'done',
      onkeydown(e) {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          addPlayer();
        }
      },
    });

    function addPlayer() {
      const name = addInput.value.trim().slice(0, 20);
      if (!name) return;
      if (players.some((p) => p.name === name)) {
        Party.toast('同じ名前がすでにあります');
        return;
      }
      players.push({ name, score: 0 });
      addInput.value = '';
      commit();
    }

    function addNames(names) {
      let added = 0;
      for (const name of names) {
        const n = name.slice(0, 20);
        if (n && !players.some((p) => p.name === n)) {
          players.push({ name: n, score: 0 });
          added++;
        }
      }
      if (!added) Party.toast('追加できる名前がありません');
      commit();
    }

    const fromMembers = () => addNames(Party.members.get());
    const fromRoom = () => addNames((room.room?.members || []).filter((m) => !m.host).map((m) => m.name));

    function change(player, delta) {
      player.score += delta;
      Party.beep(delta > 0 ? 880 : 440, 0.06, 0.12);
      commit();
    }

    function editScore(player) {
      const v = prompt(`${player.name} の得点`, String(player.score));
      if (v == null) return;
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      player.score = Math.round(n);
      commit();
    }

    function render() {
      const view = sorted ? players.slice().sort((a, b) => b.score - a.score) : players;
      const scores = players.map((p) => p.score);
      const max = Math.max(...scores);
      const hasLeader = players.length > 1 && max > Math.min(...scores);

      listEl.replaceChildren(
        ...view.map((p) => {
          const leader = hasLeader && p.score === max;
          const scoreEl = canEdit
            ? h('button', { type: 'button', class: 'score-value', title: 'タップして直接入力', onclick: () => editScore(p) }, String(p.score))
            : h('span', { class: 'score-value' }, String(p.score));
          return h(
            'div',
            { class: `score-row${leader ? ' leader' : ''}${canEdit ? '' : ' readonly'}` },
            h('span', { class: 'score-name' }, leader ? '👑 ' : '', p.name),
            canEdit ? h('button', { type: 'button', class: 'btn icon', 'aria-label': `${p.name} −${step}`, onclick: () => change(p, -step) }, '−') : null,
            scoreEl,
            canEdit ? h('button', { type: 'button', class: 'btn icon primary', 'aria-label': `${p.name} +${step}`, onclick: () => change(p, step) }, '+') : null,
            canEdit
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn icon ghost',
                    'aria-label': `${p.name}を削除`,
                    onclick() {
                      if (!confirm(`${p.name} を削除しますか？`)) return;
                      players = players.filter((x) => x !== p);
                      commit();
                    },
                  },
                  '×',
                )
              : null,
          );
        }),
      );

      emptyEl.hidden = players.length > 0;
      if (!canEdit) {
        emptyEl.replaceChildren(h('p', { class: 'muted' }, room.room ? '主催者がプレイヤーを追加するのを待っています' : '接続中…'));
        return;
      }
      const memberCount = Party.members.get().length;
      const roomCount = inRoom ? (room.room?.members || []).filter((m) => !m.host).length : 0;
      emptyEl.replaceChildren(
        h('p', { class: 'muted' }, 'プレイヤーを追加してください'),
        h(
          'div',
          { class: 'row center wrap' },
          roomCount ? h('button', { type: 'button', class: 'btn primary', onclick: fromRoom }, `入室者(${roomCount}人)から作成`) : null,
          memberCount ? h('button', { type: 'button', class: roomCount ? 'btn' : 'btn primary', onclick: fromMembers }, `共有メンバー(${memberCount}人)から作成`) : null,
        ),
      );
    }

    if (inRoom) {
      room.on((r, ev) => {
        if (!r) return;
        if (ev?.type === 'score' && pending > 0) pending--;
        // 切断などで戻ってこなかった変更は、しばらくしたら諦めてサーバーの状態に合わせる
        if (pending > 0 && Date.now() - lastSend > 3000) pending = 0;
        // 連打中に古い配信で手元の新しい得点を上書きしないよう、反映待ちが無いときだけ採用
        if (pending === 0) players = normalize(r.scoreboard.players);
        if (ev?.type === 'score' && !canEdit) Party.beep(760, 0.05, 0.08);
        render();
      });
    }

    const sortToggle = h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: sorted,
        onchange(e) {
          sorted = e.target.checked;
          Party.store.set('scoreboard.sorted', sorted);
          render();
        },
      }),
      ' 順位順',
    );

    if (!canEdit) {
      root.append(h('div', { class: 'row end' }, sortToggle), emptyEl, listEl, h('p', { class: 'muted small center' }, '得点は主催者が更新します'));
      render();
      return;
    }

    root.append(
      h(
        'div',
        { class: 'row between wrap' },
        Party.segmented(
          [1, 5, 10, 100].map((s) => [s, `±${s}`]),
          step,
          (v) => {
            step = v;
            Party.store.set('scoreboard.step', step);
            render();
          },
        ),
        sortToggle,
      ),
      emptyEl,
      listEl,
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'row' }, addInput, h('button', { type: 'button', class: 'btn', onclick: addPlayer }, '追加')),
        h(
          'div',
          { class: 'row end wrap' },
          inRoom ? h('button', { type: 'button', class: 'btn small ghost', onclick: fromRoom }, '🏠 入室者を追加') : null,
          h('button', { type: 'button', class: 'btn small ghost', onclick: fromMembers }, '共有メンバーを追加'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn small ghost',
              onclick() {
                if (!players.length || !confirm('全員の得点を0に戻しますか？')) return;
                players.forEach((p) => (p.score = 0));
                commit();
              },
            },
            '得点リセット',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn small ghost danger',
              onclick() {
                if (!players.length || !confirm('プレイヤーを全員削除しますか？')) return;
                players = [];
                commit();
              },
            },
            '全員削除',
          ),
        ),
      ),
    );

    render();
  },
});
