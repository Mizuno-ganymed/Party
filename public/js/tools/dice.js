'use strict';

Party.register({
  id: 'dice',
  name: 'サイコロ・コイン',
  icon: '🎲',
  desc: '何面ダイスでも複数個まとめて',
  render(root) {
    const { h } = Party;
    const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    const saved = Party.store.get('dice.settings', {});
    let count = Number(saved.count) || 2;
    let sides = Number(saved.sides) || 6;
    let rolling = false;
    let timer = 0;
    const history = [];

    const save = () => Party.store.set('dice.settings', { count, sides });

    const tray = h('div', { class: 'dice-tray', 'aria-live': 'polite' });
    const total = h('div', { class: 'dice-total' });
    const historyEl = h('ul', { class: 'history' });

    function dieEl(value) {
      if (sides === 6) {
        const pips = PIPS[value];
        return h(
          'div',
          { class: 'die d6', 'aria-label': String(value) },
          Array.from({ length: 9 }, (_, i) => h('span', { class: pips.includes(i) ? 'pip on' : 'pip' })),
        );
      }
      return h('div', { class: 'die', 'aria-label': String(value) }, String(value));
    }

    const rollOnce = () => Array.from({ length: count }, () => Party.randInt(sides) + 1);

    function show(values, final) {
      tray.replaceChildren(...values.map(dieEl));
      tray.classList.toggle('rolling', !final);
      total.textContent = final && values.length > 1 ? `合計 ${values.reduce((a, b) => a + b, 0)}` : '';
    }

    function addHistory(text) {
      history.unshift(text);
      history.length = Math.min(history.length, 10);
      historyEl.replaceChildren(...history.map((t) => h('li', null, t)));
    }

    function roll() {
      if (rolling) return;
      Party.unlockAudio();
      rolling = true;
      let n = 0;
      clearInterval(timer);
      timer = setInterval(() => {
        show(rollOnce(), false);
        Party.beep(300 + Math.random() * 300, 0.03, 0.08, 'square');
        if (++n >= 10) {
          clearInterval(timer);
          const values = rollOnce();
          show(values, true);
          Party.beep(880, 0.15, 0.2, 'triangle');
          Party.vibrate(40);
          const sum = values.reduce((a, b) => a + b, 0);
          addHistory(`🎲 ${count}d${sides}: ${values.join(', ')}${values.length > 1 ? ` (計${sum})` : ''}`);
          rolling = false;
        }
      }, 60);
    }

    const coinEl = h('div', { class: 'coin' }, '?');
    function flip() {
      Party.unlockAudio();
      const heads = Party.randInt(2) === 0;
      coinEl.classList.remove('flip');
      void coinEl.offsetWidth;
      coinEl.classList.add('flip');
      coinEl.textContent = '';
      setTimeout(() => {
        coinEl.textContent = heads ? '表' : '裏';
        coinEl.classList.toggle('tails', !heads);
        Party.beep(heads ? 988 : 659, 0.15, 0.2, 'triangle');
        addHistory(`🪙 コイン: ${heads ? '表' : '裏'}`);
      }, 600);
    }

    const sidesSelect = h(
      'select',
      {
        class: 'input',
        onchange() {
          sides = Number(sidesSelect.value);
          save();
          show(Array(count).fill(1), true);
        },
      },
      [4, 6, 8, 10, 12, 20, 100].map((s) => h('option', { value: String(s), selected: s === sides || null }, `${s}面`)),
    );

    root.append(
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'row center wrap' },
          Party.field(
            '個数',
            Party.stepper({
              value: count,
              min: 1,
              max: 10,
              label: '個数',
              onChange(v) {
                count = v;
                save();
                show(Array(count).fill(1), true);
              },
            }),
          ),
          Party.field('種類', sidesSelect),
        ),
        tray,
        total,
        h('div', { class: 'row center' }, h('button', { type: 'button', class: 'btn primary big', onclick: roll }, 'ふる')),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', null, 'コイントス'),
        h('div', { class: 'coin-wrap' }, coinEl),
        h('div', { class: 'row center' }, h('button', { type: 'button', class: 'btn big', onclick: flip }, '投げる')),
      ),
      h('div', { class: 'card' }, h('h2', null, '履歴'), historyEl),
    );

    show(Array(count).fill(1), true);
    return () => clearInterval(timer);
  },
});
