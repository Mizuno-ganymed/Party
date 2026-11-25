'use strict';

Party.register({
  id: 'order',
  name: '順番決め',
  icon: '🔢',
  desc: '発表順や席順をランダムに決定',
  render(root) {
    const { h } = Party;
    let lastOrder = null;

    const list = h('ol', { class: 'order-list' });
    const msg = h('p', { class: 'muted center' });
    const copyBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn ghost',
        hidden: true,
        onclick: () => lastOrder && Party.copy(lastOrder.map((n, i) => `${i + 1}. ${n}`).join('\n')),
      },
      '📋 結果をコピー',
    );

    function make() {
      const members = Party.members.get();
      msg.textContent = '';
      if (members.length < 2) {
        msg.textContent = '2人以上のメンバーを登録してください';
        return;
      }
      lastOrder = Party.shuffle(members);
      list.replaceChildren(
        ...lastOrder.map((name, i) =>
          h(
            'li',
            { style: { animationDelay: `${i * 90}ms` } },
            h('span', { class: 'order-num' }, String(i + 1)),
            h('span', { class: 'order-name' }, name),
          ),
        ),
      );
      lastOrder.forEach((_, i) => Party.beep(600 + i * 40, 0.06, 0.12, 'triangle', i * 0.09));
      copyBtn.hidden = false;
    }

    root.append(
      h('div', { class: 'row center' }, h('button', { type: 'button', class: 'btn primary big', onclick: make }, '順番を決める')),
      msg,
      list,
      h('div', { class: 'row center' }, copyBtn),
      Party.memberEditor(),
    );
  },
});
