'use strict';

/**
 * 部屋（複数端末での共有）
 *
 * Party.room
 *   .active / .code / .isHost / .room（共有状態） / .you（自分の情報・ビンゴカード）
 *   .create(name) / .join(code, name) / .leave()
 *   .send(msg)       主催者の操作を送る
 *   .on(fn)          状態更新を購読（画面遷移で自動解除）: fn(room, event)
 *   .now()           サーバー時刻（ミリ秒）
 *   .homeCard(opts)  ホーム画面用の UI
 */
(function () {
  const { h, store, toast } = Party;

  const listeners = new Set();
  let ws = null;
  let current = store.get('room.current', null); // { code, name }
  let room = null;
  let you = null;
  let status = 'closed'; // closed | connecting | open
  let clockOffset = 0;
  let retry = 0;
  let retryTimer = 0;
  let pingTimer = 0;

  const tokens = () => store.get('room.tokens', {});

  function clientId() {
    let id = store.get('clientId', '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      store.set('clientId', id);
    }
    return id;
  }

  const formatCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;
  const inviteUrl = (code) => `${location.origin}${location.pathname}#/join/${code}`;

  function notify(event) {
    updateBadge();
    for (const fn of listeners) {
      try {
        fn(room, event);
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ---------- 接続 ----------
  function connect() {
    clearTimeout(retryTimer);
    if (!current) return;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    status = 'connecting';
    updateBadge();
    const params = new URLSearchParams({ cid: clientId(), name: current.name || '' });
    const token = tokens()[current.code];
    if (token) params.set('token', token);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let first = true;
    const socket = new WebSocket(`${proto}//${location.host}/api/rooms/${current.code}/ws?${params}`);
    ws = socket;

    socket.onopen = () => {
      status = 'open';
      retry = 0;
      updateBadge();
      clearInterval(pingTimer);
      // 接続維持（サーバー側では自動応答されるので負荷にならない）
      pingTimer = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('ping'), 25000);
    };

    socket.onmessage = (e) => {
      if (e.data === 'pong') return;
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.now) clockOffset = msg.now - Date.now();
      if (msg.t === 'state') {
        const prevTool = room?.tool;
        room = msg.room;
        you = msg.you;
        const ev = msg.event || null;
        // 参加者は主催者の画面切り替えについていく（接続直後は今の画面に合わせる）
        if (!you.isHost && ((ev?.type === 'nav' && ev.tool !== prevTool) || (first && room.tool))) followHost(room.tool);
        const wasFirst = first;
        first = false;
        notify(ev);
        if (ev?.type === 'bingo.mark' && ev.newBingo?.length) announceBingo(ev);
        if (wasFirst && you.isHost) Party.syncNav();
      } else if (msg.t === 'error') {
        toast(msg.message);
      }
    };

    socket.onclose = async (e) => {
      if (ws !== socket) return;
      ws = null;
      clearInterval(pingTimer);
      status = 'closed';
      updateBadge();
      if (!current) return;
      if (e.code === 4404 || e.code === 4429) {
        toast(e.code === 4429 ? '部屋が満員です' : '部屋が終了しました');
        leave();
        return;
      }
      // 部屋がまだあるか確認してから再接続
      if (retry >= 2 && navigator.onLine) {
        const exists = await roomExists(current.code).catch(() => null);
        if (exists === false) {
          toast('部屋が見つかりません（終了した可能性があります）');
          leave();
          return;
        }
      }
      const delay = Math.min(10000, 1000 * 2 ** retry++);
      retryTimer = setTimeout(connect, delay);
    };
  }

  /** ビンゴが出たら、部屋の全員に知らせる（どの画面を開いていても） */
  function announceBingo(ev) {
    const myId = you?.id;
    const ids = ev.newBingoIds || [];
    const others = ev.newBingo.filter((_, i) => ids[i] !== myId);
    if (myId && ids.includes(myId)) {
      const prizesLeft = (room?.prizes?.items || []).reduce((s, it) => s + it.left, 0);
      Party.celebrate('🎉 ビンゴ！', prizesLeft ? '景品ルーレットを回しましょう' : '主催者に知らせましょう');
    } else if (others.length) {
      Party.celebrate(`🎉 ${others.join('、')} さんが\nビンゴ！`, location.hash.startsWith('#/bingo') ? '' : 'ビンゴの画面で確認できます');
    }
  }

  function followHost(tool) {
    const target = tool ? `#/${tool}` : '#/';
    if (location.hash !== target && !(target === '#/' && !location.hash)) {
      location.hash = target;
      if (tool) toast('主催者の画面に切り替えました');
    }
  }

  function send(msg, quiet = false) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    if (!quiet && msg.t !== 'ping') toast('接続中です。少し待ってからもう一度お試しください');
    return false;
  }

  async function roomExists(code) {
    const res = await fetch(`/api/rooms/${code}`, { cache: 'no-store' });
    if (res.status === 400) return false;
    if (!res.ok) throw new Error('server error');
    return (await res.json()).exists;
  }

  async function create(name) {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '部屋を作成できませんでした');
    const t = tokens();
    t[data.code] = data.hostToken;
    store.set('room.tokens', t);
    enter(data.code, name);
  }

  async function join(code, name) {
    code = String(code).replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) throw new Error('部屋番号は6桁の数字です');
    if (!(await roomExists(code))) throw new Error('その部屋番号は見つかりません');
    enter(code, name);
  }

  function enter(code, name) {
    if (current?.code !== code) {
      room = null;
      you = null;
    }
    current = { code, name };
    store.set('room.current', current);
    retry = 0;
    connect();
    Party.keepAwake(false);
    Party.refresh();
  }

  function leave() {
    const wasActive = !!current;
    current = null;
    room = null;
    you = null;
    store.set('room.current', null);
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    if (ws) {
      const s = ws;
      ws = null;
      s.onclose = null;
      s.close(1000, 'leave');
    }
    status = 'closed';
    updateBadge();
    if (wasActive) {
      Party.keepAwake(false);
      Party.refresh();
    }
  }

  // オンライン復帰・画面復帰ですぐ再接続
  const reconnectSoon = () => {
    if (current && status === 'closed') {
      retry = 0;
      connect();
    }
  };
  window.addEventListener('online', reconnectSoon);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectSoon();
  });

  // ---------- ヘッダーのバッジ ----------
  function updateBadge() {
    const badge = document.querySelector('.room-badge');
    if (!badge) return;
    badge.hidden = !current;
    if (!current) return;
    badge.dataset.status = status;
    badge.textContent = `🏠 ${current.code}`;
    badge.title = status === 'open' ? '部屋に接続中' : '再接続しています…';
  }

  // ---------- ホーム画面の部屋カード ----------
  function qrSvg(text) {
    if (typeof qrcode !== 'function') return null;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const wrap = h('div', { class: 'qr' });
      wrap.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
      return wrap;
    } catch {
      return null;
    }
  }

  function memberChips() {
    const wrap = h('div', { class: 'chips' });
    const render = () => {
      const list = room?.members || [];
      wrap.replaceChildren(
        ...list.map((m) =>
          h(
            'span',
            { class: `chip room-member${m.online ? ' online' : ''}` },
            h('span', { class: 'dot', 'aria-label': m.online ? '接続中' : '未接続' }),
            h('span', { class: 'chip-label' }, m.host ? `👑 ${m.name}` : m.name),
          ),
        ),
      );
      if (!list.length) wrap.append(h('span', { class: 'muted' }, '接続中…'));
    };
    listeners.add(render);
    render();
    return wrap;
  }

  function homeCard({ joinCode } = {}) {
    if (current && (!joinCode || joinCode === current.code)) return inRoomCard();
    return lobbyCard(joinCode);
  }

  function inRoomCard() {
    const code = current.code;
    const isHost = Party.room.isHost;
    const url = inviteUrl(code);
    const onlineCount = h('span', { class: 'muted' });
    const updateCount = () => {
      const list = room?.members || [];
      onlineCount.textContent = list.length ? `${list.filter((m) => m.online).length}人が接続中` : '';
    };
    listeners.add(updateCount);
    updateCount();

    return h(
      'section',
      { class: 'card room-card in-room' },
      h(
        'div',
        { class: 'row between wrap' },
        h('div', null, h('div', { class: 'muted small' }, isHost ? 'あなたが主催者の部屋' : '参加中の部屋'), h('div', { class: 'room-code' }, formatCode(code))),
        onlineCount,
      ),
      isHost
        ? h(
            'div',
            { class: 'invite' },
            qrSvg(url),
            h(
              'div',
              { class: 'invite-body' },
              h('p', { class: 'muted small' }, 'QRコードを読み取るか、部屋番号を伝えて入室してもらいましょう。'),
              h(
                'div',
                { class: 'row wrap' },
                h('button', { type: 'button', class: 'btn small', onclick: () => Party.copy(url) }, '🔗 招待リンクをコピー'),
                navigator.share
                  ? h(
                      'button',
                      {
                        type: 'button',
                        class: 'btn small',
                        onclick: () => navigator.share({ title: 'パーティツール', text: `部屋番号 ${code} で入室してね`, url }).catch(() => {}),
                      },
                      '共有',
                    )
                  : null,
              ),
              h('p', { class: 'muted small' }, '主催者がツールを開くと、参加者の画面も同じツールに切り替わります。'),
            ),
          )
        : h('p', { class: 'muted small' }, '主催者の操作に合わせて画面が切り替わります。このままお待ちください。'),
      memberChips(),
      h(
        'div',
        { class: 'row end' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn small ghost danger',
            onclick() {
              if (confirm(isHost ? '部屋から退室しますか？\n（同じ端末からなら、部屋番号で再入室すると主催者に戻れます）' : '部屋から退室しますか？')) leave();
            },
          },
          '退室する',
        ),
      ),
    );
  }

  function lobbyCard(joinCode) {
    const nameInput = h('input', {
      type: 'text',
      class: 'input',
      placeholder: 'あなたの名前',
      maxlength: 20,
      value: store.get('room.name', ''),
      autocomplete: 'nickname',
    });
    const codeInput = h('input', {
      type: 'text',
      class: 'input code-input',
      placeholder: '部屋番号（6桁）',
      inputmode: 'numeric',
      maxlength: 7,
      value: joinCode || '',
      autocomplete: 'off',
      onkeydown(e) {
        if (e.key === 'Enter' && !e.isComposing) doJoin();
      },
    });
    const err = h('p', { class: 'warn small', hidden: true });
    const buttons = [];

    const getName = () => {
      const name = nameInput.value.trim().slice(0, 20);
      if (!name) {
        showError('名前を入力してください');
        nameInput.focus();
        return null;
      }
      store.set('room.name', name);
      return name;
    };
    function showError(message) {
      err.textContent = message;
      err.hidden = !message;
    }
    async function busy(fn) {
      buttons.forEach((b) => (b.disabled = true));
      showError('');
      try {
        await fn();
      } catch (e) {
        showError(e.message || '接続できませんでした');
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    }
    function doJoin() {
      const name = getName();
      if (name) busy(() => join(codeInput.value, name));
    }
    function doCreate() {
      const name = getName();
      if (name) busy(() => create(name));
    }

    const joinBtn = h('button', { type: 'button', class: 'btn primary', onclick: doJoin }, '入室');
    const createBtn = h('button', { type: 'button', class: 'btn', onclick: doCreate }, '＋ 新しい部屋を作る');
    buttons.push(joinBtn, createBtn);

    const card = h(
      'section',
      { class: 'card room-card' },
      h('strong', null, '🏠 部屋で遊ぶ'),
      h('p', { class: 'muted small' }, '部屋番号で入室した人どうしで、ビンゴ・スコア・抽選結果・タイマーをそれぞれのスマホで共有できます。'),
      current ? h('p', { class: 'warn small' }, `入室すると、今の部屋（${current.code}）から移動します`) : null,
      Party.field('名前', nameInput),
      h('div', { class: 'row' }, codeInput, joinBtn),
      h('div', { class: 'or' }, 'または'),
      createBtn,
      err,
    );
    if (joinCode) setTimeout(() => (nameInput.value ? joinBtn : nameInput).focus(), 50);
    return card;
  }

  Party.room = {
    get active() {
      return !!current;
    },
    get code() {
      return current?.code || null;
    },
    get isHost() {
      return !!current && !!tokens()[current.code];
    },
    get room() {
      return room;
    },
    get you() {
      return you;
    },
    get status() {
      return status;
    },
    now: () => Date.now() + clockOffset,
    create,
    join,
    leave,
    send,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    _clearListeners() {
      listeners.clear();
    },
    homeCard,
    formatCode,
  };

  document.addEventListener('DOMContentLoaded', () => {
    updateBadge();
    if (current) connect();
  });
})();
