'use strict';

Party.register({
  id: 'order',
  name: '順番決め',
  icon: '🔢',
  desc: '発表順や席順をランダムに決定',
  room: true,
  render(root) {
    const { h } = Party;
    const room = Party.room;
    const inRoom = room.active;
    const isGuest = inRoom && !room.isHost;
    let lastId = inRoom ? room.room?.results.order?.id ?? 0 : 0;
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
      const order = Party.shuffle(members);
      if (inRoom) {
        room.send({ t: 'result', kind: 'order', order });
        return;
      }
      show(order, true);
    }

    function show(order, animate) {
      lastOrder = order;
      list.classList.toggle('no-anim', !animate);
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
      if (animate) lastOrder.forEach((_, i) => Party.beep(600 + i * 40, 0.06, 0.12, 'triangle', i * 0.09));
      copyBtn.hidden = false;
    }

    if (inRoom) {
      const initial = room.room?.results.order;
      if (initial) show(initial.order, false);
      room.on((r, ev) => {
        const res = r?.results.order;
        if (res && res.id !== lastId) {
          lastId = res.id;
          show(res.order, ev?.type === 'result');
        }
        if (isGuest) msg.textContent = !r ? '接続中…' : res ? '' : '主催者が順番を決めるのを待っています';
      });
    }

    if (isGuest) {
      msg.textContent = room.room ? (lastOrder ? '' : '主催者が順番を決めるのを待っています') : '接続中…';
      root.append(msg, list, h('div', { class: 'row center' }, copyBtn));
      return;
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
