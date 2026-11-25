'use strict';

Party.register({
  id: 'teams',
  name: 'チーム分け',
  icon: '🤝',
  desc: 'メンバーをランダムにチーム分け',
  render(root) {
    const { h } = Party;
    const saved = Party.store.get('teams.settings', {});
    let mode = saved.mode === 'size' ? 'size' : 'count';
    let value = Number(saved.value) || 2;
    let lastTeams = null;

    const save = () => Party.store.set('teams.settings', { mode, value });
    const stepper = Party.stepper({
      value,
      min: 1,
      max: 50,
      label: '数',
      onChange(v) {
        value = v;
        save();
      },
    });
    const unit = h('span', { class: 'muted' });
    const updateUnit = () => (unit.textContent = mode === 'count' ? 'チーム' : '人ずつ');
    updateUnit();

    const resultBox = h('div', { class: 'team-grid' });
    const copyBtn = h('button', { type: 'button', class: 'btn ghost', hidden: true, onclick: copyResult }, '📋 結果をコピー');
    const msg = h('p', { class: 'muted center' });

    const teamName = (i) => `チーム${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) + 1 : ''}`;

    function make() {
      const list = Party.members.get();
      msg.textContent = '';
      if (list.length < 2) {
        msg.textContent = '2人以上のメンバーを登録してください';
        return;
      }
      let k = mode === 'count' ? value : Math.ceil(list.length / value);
      k = Math.max(1, Math.min(list.length, k));
      const teams = Array.from({ length: k }, () => []);
      Party.shuffle(list).forEach((name, i) => teams[i % k].push(name));
      lastTeams = Party.shuffle(teams); // 人数の多いチームが常に先頭にならないように
      render();
      Party.beep(660, 0.1);
      Party.beep(990, 0.15, 0.2, 'sine', 0.08);
    }

    function render() {
      resultBox.replaceChildren(
        ...lastTeams.map((members, i) =>
          h(
            'div',
            { class: 'team-card', style: { '--team': Party.COLORS[i % Party.COLORS.length], animationDelay: `${i * 70}ms` } },
            h('div', { class: 'team-head' }, teamName(i), h('span', { class: 'muted' }, ` ${members.length}人`)),
            h('ul', null, members.map((m) => h('li', null, m))),
          ),
        ),
      );
      copyBtn.hidden = false;
    }

    function copyResult() {
      if (!lastTeams) return;
      Party.copy(lastTeams.map((m, i) => `${teamName(i)}: ${m.join('、')}`).join('\n'));
    }

    root.append(
      h(
        'div',
        { class: 'card' },
        Party.segmented(
          [
            ['count', 'チーム数で分ける'],
            ['size', '1チームの人数で分ける'],
          ],
          mode,
          (v) => {
            mode = v;
            updateUnit();
            save();
          },
        ),
        h('div', { class: 'row center' }, stepper, unit),
        h('div', { class: 'row center' }, h('button', { type: 'button', class: 'btn primary big', onclick: make }, 'チームを分ける')),
      ),
      msg,
      resultBox,
      h('div', { class: 'row center' }, copyBtn),
      Party.memberEditor(),
    );
  },
});
