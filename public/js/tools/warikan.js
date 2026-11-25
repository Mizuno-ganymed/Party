'use strict';

Party.register({
  id: 'warikan',
  name: '割り勘',
  icon: '💴',
  desc: '端数処理・傾斜つきの割り勘計算',
  render(root) {
    const { h } = Party;
    const memberCount = Party.members.get().length;
    const saved = Party.store.get('warikan.settings', {});
    const s = {
      total: Number(saved.total) || 0,
      people: Number(saved.people) || (memberCount >= 2 ? memberCount : 4),
      unit: Number(saved.unit) || 100,
      extraPeople: Number(saved.extraPeople) || 0,
      extra: Number(saved.extra) || 0,
    };
    const save = () => Party.store.set('warikan.settings', s);
    const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;

    const out = h('div', { class: 'warikan-result' });

    const moneyInput = (key, placeholder) =>
      h('input', {
        type: 'number',
        inputmode: 'numeric',
        class: 'input money',
        min: 0,
        placeholder,
        value: s[key] ? String(s[key]) : '',
        oninput(e) {
          s[key] = Math.max(0, Number(e.target.value) || 0);
          save();
          calc();
        },
      });

    const peopleStepper = Party.stepper({
      value: s.people,
      min: 1,
      max: 999,
      label: '人数',
      onChange(v) {
        s.people = v;
        save();
        calc();
      },
    });

    const unitSelect = h(
      'select',
      {
        class: 'input',
        onchange(e) {
          s.unit = Number(e.target.value);
          save();
          calc();
        },
      },
      [1, 10, 100, 500, 1000].map((u) => h('option', { value: String(u), selected: u === s.unit || null }, `${u.toLocaleString()}円単位`)),
    );

    const extraStepper = Party.stepper({
      value: s.extraPeople,
      min: 0,
      max: 999,
      label: '多めに払う人数',
      onChange(v) {
        s.extraPeople = v;
        save();
        calc();
      },
    });

    function line(label, value, cls = '') {
      return h('div', { class: `wk-line ${cls}` }, h('span', null, label), h('strong', null, value));
    }

    function plan(title, base, note) {
      const normal = s.people - s.extraPeople;
      return h(
        'div',
        { class: 'card wk-plan' },
        h('h3', null, title),
        s.extraPeople > 0
          ? [line(`多め ${s.extraPeople}人`, `${yen(base + s.extra)} / 人`, 'big'), line(`その他 ${normal}人`, `${yen(base)} / 人`, 'big')]
          : line('1人あたり', yen(base), 'big'),
        note,
      );
    }

    function calc() {
      const { total, people, unit, extra } = s;
      const extraPeople = Math.min(s.extraPeople, people);
      if (extraPeople !== s.extraPeople) {
        s.extraPeople = extraPeople;
        extraStepper.setValue(extraPeople);
      }
      if (!total) {
        out.replaceChildren(h('p', { class: 'muted center' }, '合計金額を入力してください'));
        return;
      }
      const rest = total - extraPeople * extra;
      if (rest < 0) {
        out.replaceChildren(h('p', { class: 'warn center' }, '上乗せ額が合計金額を超えています'));
        return;
      }
      const perHead = rest / people;
      const up = Math.ceil(perHead / unit) * unit;
      const down = Math.floor(perHead / unit) * unit;
      const collect = (base) => base * people + extraPeople * extra;
      const surplus = collect(up) - total;
      const shortage = total - collect(down);

      const plans = [
        plan(
          '切り上げ',
          up,
          h('div', null, line('集金額', yen(collect(up))), line('おつり（余り）', yen(surplus), surplus > 0 ? 'accent' : '')),
        ),
      ];
      if (down !== up) {
        plans.push(
          plan(
            '切り捨て（不足分は幹事が負担）',
            down,
            h('div', null, line('集金額', yen(collect(down))), line('幹事の追加負担', yen(shortage), 'accent')),
          ),
        );
      }
      out.replaceChildren(h('p', { class: 'muted center' }, `ちょうど割ると 1人 ${perHead.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}円`), ...plans);
    }

    root.append(
      h(
        'div',
        { class: 'card form' },
        Party.field('合計金額（円）', moneyInput('total', '例: 32000')),
        Party.field('人数', peopleStepper),
        Party.field('端数', unitSelect),
        h(
          'details',
          { class: 'sub', open: s.extraPeople > 0 || null },
          h('summary', null, '傾斜をつける（上司・先輩が多めに払う）'),
          Party.field('多めに払う人数', extraStepper),
          Party.field('1人あたりの上乗せ額（円）', moneyInput('extra', '例: 2000')),
        ),
      ),
      out,
    );

    calc();
  },
});
