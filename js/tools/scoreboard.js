'use strict';

Party.register({
  id: 'scoreboard',
  name: 'スコアボード',
  icon: '🏆',
  desc: 'ゲームの得点をみんなで記録',
  render(root) {
    const { h } = Party;
    const load = () => {
      const p = Party.store.get('scoreboard.players', []);
      return Array.isArray(p) ? p.filter((x) => x && typeof x.name === 'string').map((x) => ({ name: x.name, score: Number(x.score) || 0 })) : [];
    };
    let players = load();
    let step = Number(Party.store.get('scoreboard.step', 1)) || 1;
    let sorted = Party.store.get('scoreboard.sorted', false);

    const save = () => Party.store.set('scoreboard.players', players);
    const listEl = h('div', { class: 'score-list' });
    const emptyEl = h('div', { class: 'card center-col' });
    const addInput = h('input', {
      type: 'text',
      class: 'input',
      placeholder: 'プレイヤー名 / チーム名',
      enterkeyhint: 'done',
      onkeydown(e) {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          addPlayer();
        }
      },
    });

    function addPlayer() {
      const name = addInput.value.trim();
      if (!name) return;
      if (players.some((p) => p.name === name)) {
        Party.toast('同じ名前がすでにあります');
        return;
      }
      players.push({ name, score: 0 });
      addInput.value = '';
      save();
      render();
    }

    function fromMembers() {
      const names = Party.members.get();
      for (const name of names) if (!players.some((p) => p.name === name)) players.push({ name, score: 0 });
      save();
      render();
    }

    function change(player, delta) {
      player.score += delta;
      save();
      Party.beep(delta > 0 ? 880 : 440, 0.06, 0.12);
      render();
    }

    function editScore(player) {
      const v = prompt(`${player.name} の得点`, String(player.score));
      if (v == null) return;
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      player.score = n;
      save();
      render();
    }

    function render() {
      const view = sorted ? players.slice().sort((a, b) => b.score - a.score) : players;
      const scores = players.map((p) => p.score);
      const max = Math.max(...scores);
      const hasLeader = players.length > 1 && max > Math.min(...scores);

      listEl.replaceChildren(
        ...view.map((p) =>
          h(
            'div',
            { class: `score-row${hasLeader && p.score === max ? ' leader' : ''}` },
            h('span', { class: 'score-name' }, hasLeader && p.score === max ? '👑 ' : '', p.name),
            h('button', { type: 'button', class: 'btn icon', 'aria-label': `${p.name} −${step}`, onclick: () => change(p, -step) }, '−'),
            h('button', { type: 'button', class: 'score-value', title: 'タップして直接入力', onclick: () => editScore(p) }, String(p.score)),
            h('button', { type: 'button', class: 'btn icon primary', 'aria-label': `${p.name} +${step}`, onclick: () => change(p, step) }, '+'),
            h(
              'button',
              {
                type: 'button',
                class: 'btn icon ghost',
                'aria-label': `${p.name}を削除`,
                onclick() {
                  if (!confirm(`${p.name} を削除しますか？`)) return;
                  players = players.filter((x) => x !== p);
                  save();
                  render();
                },
              },
              '×',
            ),
          ),
        ),
      );

      const memberCount = Party.members.get().length;
      emptyEl.hidden = players.length > 0;
      emptyEl.replaceChildren(
        h('p', { class: 'muted' }, 'プレイヤーを追加してください'),
        memberCount
          ? h('button', { type: 'button', class: 'btn primary', onclick: fromMembers }, `共有メンバー(${memberCount}人)から作成`)
          : null,
      );
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
        h(
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
        ),
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
          h('button', { type: 'button', class: 'btn small ghost', onclick: fromMembers }, '共有メンバーを追加'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn small ghost',
              onclick() {
                if (!players.length || !confirm('全員の得点を0に戻しますか？')) return;
                players.forEach((p) => (p.score = 0));
                save();
                render();
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
                save();
                render();
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
