/**
 * パーティツール: 部屋サーバー（Cloudflare Workers + Durable Objects）
 *
 * - POST /api/rooms              部屋を作成 → { code, hostToken }
 * - GET  /api/rooms/:code        部屋の存在確認 → { exists }
 * - GET  /api/rooms/:code/ws     WebSocket 接続（?cid=端末ID&name=名前&token=主催者トークン）
 *
 * 部屋ごとに 1 つの Durable Object が状態を持ち、接続中の全員に配信する。
 * 操作（番号を引く・得点変更など）は主催者トークンを持つ接続だけが行える。
 * 最後の操作から 24 時間たち、誰も接続していない部屋は自動で削除する。
 */
import { DurableObject } from 'cloudflare:workers';

const CODE_RE = /^\d{6}$/;
const ROOM_TTL = 24 * 60 * 60 * 1000;
const MAX_MEMBERS = 300;
const MAX_MESSAGE = 32 * 1024;
const ROOM_TOOLS = ['', 'bingo', 'scoreboard', 'roulette', 'teams', 'order', 'timer'];

// ---------- ユーティリティ ----------
function randInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

const cleanName = (v) => cleanText(v, 20);
const cleanId = (v) => (/^[A-Za-z0-9_-]{8,64}$/.test(String(v)) ? String(v) : '');
const cleanList = (arr, max, len = 30) =>
  Array.isArray(arr) ? arr.slice(0, max).map((x) => cleanText(x, len)).filter(Boolean) : [];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// ---------- ビンゴ ----------
const LINES = (() => {
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push([0, 1, 2, 3, 4].map((c) => i * 5 + c)); // 横
    lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + i)); // 縦
  }
  lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]); // 斜め
  return lines;
})();

/** 5x5 のカード（行優先、中央は 0 = FREE） */
function newCard() {
  const card = new Array(25);
  for (let col = 0; col < 5; col++) {
    const pool = Array.from({ length: 15 }, (_, i) => col * 15 + i + 1);
    for (let row = 0; row < 5; row++) card[row * 5 + col] = pool.splice(randInt(pool.length), 1)[0];
  }
  card[12] = 0;
  return card;
}

/** 印をつけたマス（＋中央の FREE）でビンゴ・リーチを数える */
function cardStatus(card, markedSet) {
  let bingo = 0;
  let reach = 0;
  for (const line of LINES) {
    const marked = line.filter((i) => card[i] === 0 || markedSet.has(card[i])).length;
    if (marked === 5) bingo++;
    else if (marked === 4) reach++;
  }
  return { bingo, reach };
}

// ---------- Worker 本体 ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/rooms' && request.method === 'POST') {
      for (let i = 0; i < 20; i++) {
        const code = String(100000 + randInt(900000));
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.create(code);
        if (res.ok) return json({ code, hostToken: res.hostToken });
      }
      return json({ error: '部屋を作成できませんでした。もう一度お試しください' }, 503);
    }

    const m = pathname.match(/^\/api\/rooms\/([^/]+)(\/ws)?$/);
    if (m) {
      const code = m[1];
      if (!CODE_RE.test(code)) return json({ error: '部屋番号は6桁の数字です' }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      if (m[2]) {
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket で接続してください' }, 426);
        return stub.fetch(request);
      }
      if (request.method === 'GET') return json({ exists: await stub.exists() });
      return json({ error: 'Method Not Allowed' }, 405);
    }

    if (pathname.startsWith('/api/')) return json({ error: 'Not Found' }, 404);

    // 静的ファイルに一致しなかったパスはトップページへ
    return Response.redirect(new URL('/', url).href, 302);
  },
};

// ---------- 部屋（Durable Object） ----------
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = null;
    this.hostToken = null;
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) ?? null;
      this.hostToken = (await ctx.storage.get('hostToken')) ?? null;
    });
  }

  // --- RPC ---
  async create(code) {
    if (this.state) return { ok: false };
    this.hostToken = randomToken();
    this.state = {
      code,
      createdAt: Date.now(),
      tool: '',
      members: {},
      bingo: { round: 1, drawn: [], cards: {}, marks: {}, winners: [] },
      scoreboard: { players: [] },
      results: {},
      timer: { status: 'idle', duration: 180, endAt: 0, remaining: 180000 },
      seq: 0,
    };
    await this.ctx.storage.put({ state: this.state, hostToken: this.hostToken });
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
    return { ok: true, hostToken: this.hostToken };
  }

  async exists() {
    return !!this.state;
  }

  // --- WebSocket 接続 ---
  async fetch(request) {
    if (!this.state) return new Response('room not found', { status: 404 });
    const url = new URL(request.url);
    const cid = cleanId(url.searchParams.get('cid'));
    if (!cid) return new Response('bad client id', { status: 400 });
    const token = url.searchParams.get('token') || '';
    const isHost = !!token && token === this.hostToken;
    const name = cleanName(url.searchParams.get('name')) || (isHost ? '主催者' : 'ゲスト');

    const { 0: client, 1: server } = new WebSocketPair();
    const members = this.state.members;
    if (!members[cid] && Object.keys(members).length >= MAX_MEMBERS) {
      this.ctx.acceptWebSocket(server);
      server.close(4429, 'room is full');
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ cid, isHost });

    members[cid] = { name, host: isHost || !!members[cid]?.host, joinedAt: members[cid]?.joinedAt ?? Date.now() };
    if (!isHost && !this.state.bingo.cards[cid]) this.state.bingo.cards[cid] = newCard();
    await this.save();
    this.broadcast(null);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (!this.state) {
      ws.close(4404, 'room closed');
      return;
    }
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() || {};

    if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', now: Date.now() }));
      return;
    }
    if (msg.t === 'rename') {
      const name = cleanName(msg.name);
      if (name && this.state.members[att.cid]) {
        this.state.members[att.cid].name = name;
        await this.save();
        this.broadcast(null);
      }
      return;
    }
    if (msg.t === 'bingo.mark') {
      // 参加者が自分のカードのマスをタップして印をつける
      const event = this.mark(att.cid, Number(msg.n));
      if (event === undefined) return;
      await this.save();
      this.broadcast(event);
      return;
    }
    if (!att.isHost) {
      ws.send(JSON.stringify({ t: 'error', message: '主催者だけが操作できます' }));
      return;
    }

    const event = this.apply(msg);
    if (event === undefined) return;
    await this.save();
    this.broadcast(event);
  }

  /** 主催者の操作を状態に反映し、配信するイベントを返す（無効なら undefined） */
  apply(msg) {
    const s = this.state;
    switch (msg.t) {
      case 'nav': {
        const tool = String(msg.tool ?? '');
        if (!ROOM_TOOLS.includes(tool)) return undefined;
        s.tool = tool;
        return { type: 'nav', tool };
      }

      case 'bingo.draw': {
        const drawn = new Set(s.bingo.drawn);
        const remaining = [];
        for (let n = 1; n <= 75; n++) if (!drawn.has(n)) remaining.push(n);
        if (!remaining.length) return undefined;
        const n = remaining[randInt(remaining.length)];
        s.bingo.drawn.push(n);
        return { type: 'bingo.draw', n };
      }

      case 'bingo.undo': {
        if (!s.bingo.drawn.length) return undefined;
        const n = s.bingo.drawn.pop();
        // 取り消した番号の印も外す
        for (const [cid, marks] of Object.entries(this.marks())) s.bingo.marks[cid] = marks.filter((x) => x !== n);
        this.updateWinners();
        return { type: 'bingo.undo', n };
      }

      case 'bingo.reset': {
        s.bingo.round += 1;
        s.bingo.drawn = [];
        s.bingo.winners = [];
        s.bingo.reach = {};
        s.bingo.marks = {};
        for (const cid of Object.keys(s.bingo.cards)) s.bingo.cards[cid] = newCard();
        return { type: 'bingo.reset' };
      }

      case 'score.set': {
        if (!Array.isArray(msg.players)) return undefined;
        const seen = new Set();
        s.scoreboard.players = msg.players
          .slice(0, 50)
          .map((p) => ({ name: cleanName(p?.name), score: Number(p?.score) }))
          .filter((p) => p.name && Number.isFinite(p.score) && !seen.has(p.name) && seen.add(p.name))
          .map((p) => ({ name: p.name, score: Math.max(-1e9, Math.min(1e9, Math.round(p.score))) }));
        return { type: 'score' };
      }

      case 'result': {
        const id = ++s.seq;
        if (msg.kind === 'roulette') {
          const items = cleanList(msg.items, 100);
          const target = Number(msg.target);
          if (items.length < 2 || !Number.isInteger(target) || target < 0 || target >= items.length) return undefined;
          const offset = Math.min(0.85, Math.max(0.15, Number(msg.offset) || 0.5));
          const duration = Math.min(8000, Math.max(1000, Number(msg.duration) || 4500));
          s.results.roulette = { id, items, target, offset, duration, winner: items[target], at: Date.now() };
        } else if (msg.kind === 'teams') {
          if (!Array.isArray(msg.teams)) return undefined;
          const teams = msg.teams.slice(0, 50).map((t) => cleanList(t, 200));
          s.results.teams = { id, teams, at: Date.now() };
        } else if (msg.kind === 'order') {
          const order = cleanList(msg.order, 300);
          if (!order.length) return undefined;
          s.results.order = { id, order, at: Date.now() };
        } else {
          return undefined;
        }
        return { type: 'result', kind: msg.kind, id };
      }

      case 'timer.set': {
        if (s.timer.status === 'running') return undefined;
        const duration = Math.max(0, Math.min(99 * 60 + 59, Math.round(Number(msg.duration) || 0)));
        s.timer = { status: 'idle', duration, endAt: 0, remaining: duration * 1000 };
        return { type: 'timer' };
      }

      case 'timer.start': {
        const t = s.timer;
        if (t.status === 'running' || t.remaining <= 0) return undefined;
        t.status = 'running';
        t.endAt = Date.now() + t.remaining;
        return { type: 'timer' };
      }

      case 'timer.pause': {
        const t = s.timer;
        if (t.status !== 'running') return undefined;
        t.remaining = Math.max(0, t.endAt - Date.now());
        t.status = t.remaining > 0 ? 'paused' : 'idle';
        if (t.status === 'idle') t.remaining = t.duration * 1000;
        return { type: 'timer' };
      }

      case 'timer.reset': {
        const t = s.timer;
        s.timer = { status: 'idle', duration: t.duration, endAt: 0, remaining: t.duration * 1000 };
        return { type: 'timer' };
      }

      default:
        return undefined;
    }
  }

  marks() {
    const b = this.state.bingo;
    if (!b.marks) b.marks = {};
    return b.marks;
  }

  /** 参加者の印つけ。出ていない番号・カードにない番号は無視 */
  mark(cid, n) {
    const b = this.state.bingo;
    const card = b.cards[cid];
    if (!card || !Number.isInteger(n) || n < 1 || n > 75) return undefined;
    if (!card.includes(n) || !b.drawn.includes(n)) return undefined;
    const marks = this.marks();
    const mine = marks[cid] || (marks[cid] = []);
    if (mine.includes(n)) return undefined;
    mine.push(n);
    const { newBingo, newReach } = this.updateWinners();
    return { type: 'bingo.mark', newBingo, newReach };
  }

  /** 各カードのビンゴ・リーチを判定し、新しく達成した人を返す */
  updateWinners() {
    const b = this.state.bingo;
    const marks = this.marks();
    const markedOf = (cid) => new Set(marks[cid] || []);
    const prevWinners = new Set(b.winners.map((w) => w.cid));
    const prevReach = b.reach || {};
    const reach = {};
    const newBingo = [];
    const newReach = [];

    for (const [cid, card] of Object.entries(b.cards)) {
      const st = cardStatus(card, markedOf(cid));
      if (st.bingo > 0) {
        if (!prevWinners.has(cid)) {
          b.winners.push({ cid, count: b.drawn.length });
          newBingo.push(this.nameOf(cid));
        }
      } else if (st.reach > 0) {
        reach[cid] = st.reach;
        if (!prevReach[cid]) newReach.push(this.nameOf(cid));
      }
    }
    // 取り消しでビンゴでなくなった人を外す
    b.winners = b.winners.filter((w) => b.cards[w.cid] && cardStatus(b.cards[w.cid], markedOf(w.cid)).bingo > 0);
    b.reach = reach;
    return { newBingo, newReach };
  }

  nameOf(cid) {
    return this.state.members[cid]?.name || 'ゲスト';
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* すでに閉じている */
    }
    if (this.state) this.broadcast(null, ws);
  }

  async webSocketError(ws) {
    if (this.state) this.broadcast(null, ws);
  }

  // --- 保存・配信 ---
  async save() {
    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
  }

  openSockets(exclude) {
    return this.ctx.getWebSockets().filter((ws) => ws !== exclude && ws.readyState === WebSocket.OPEN);
  }

  publicState(online) {
    const s = this.state;
    const b = s.bingo;
    return {
      code: s.code,
      tool: s.tool,
      members: Object.entries(s.members)
        .map(([id, m]) => ({ id, name: m.name, host: m.host, online: online.has(id) }))
        .sort((a, c) => Number(c.host) - Number(a.host) || Number(c.online) - Number(a.online)),
      bingo: {
        round: b.round,
        drawn: b.drawn,
        players: Object.keys(b.cards).length,
        winners: b.winners.map((w, i) => ({ id: w.cid, name: this.nameOf(w.cid), rank: i + 1, count: w.count })),
        reach: Object.entries(b.reach || {}).map(([id, lines]) => ({ id, name: this.nameOf(id), lines })),
      },
      scoreboard: s.scoreboard,
      results: s.results,
      timer: s.timer,
    };
  }

  broadcast(event, exclude) {
    const sockets = this.openSockets(exclude);
    const online = new Set(sockets.map((ws) => ws.deserializeAttachment()?.cid));
    const room = this.publicState(online);
    const now = Date.now();
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() || {};
      try {
        ws.send(
          JSON.stringify({
            t: 'state',
            now,
            room,
            event,
            you: {
              id: att.cid,
              isHost: !!att.isHost,
              card: this.state.bingo.cards[att.cid] || null,
              marks: this.state.bingo.marks?.[att.cid] || [],
            },
          }),
        );
      } catch {
        /* 切断済み */
      }
    }
  }

  async alarm() {
    if (!this.state) return;
    if (this.openSockets().length) {
      await this.ctx.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000);
      return;
    }
    this.state = null;
    this.hostToken = null;
    await this.ctx.storage.deleteAll();
  }
}
