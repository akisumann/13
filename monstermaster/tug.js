// =====================================================================
// 綱引き — 遊びのふたつめ
//
// play.js の枠に乗っている。走者は かけっこ と同じ4つの値だけ。
//
// かけっこが「めいめい前に進む」遊びなら、こちらは「1本の綱が
// どちらかに寄っていく」遊び。見るところが1か所しかないので、
// 走路とは違う手ざわりになる。
//
// 綱は寄るほど寄りやすい(勢いがつく)。均衡したまま延々続けても
// 見ていて退屈なので、傾いたら一気に行くようにしてある。
// どちらに傾くかは運と足場の相性だけで、強さは見ていない。
//
// ただし勢いがつく遊びで足場をひとつに固定すると、引く前に勝負が
// 決まってしまう(実測で100%)。だから足場は何度も変わる。
// かけっこが走路を4つに割るのに対して、綱引きは時間を4つに割る。
// 前半で押されても、次の足場が向いていれば返せる。
// =====================================================================
(function (root) {
  'use strict';

  const Play = root.Play ||
    (typeof require !== 'undefined' ? require('./play.js') : null);

  const TUG = {
    tickMs: 700,
    goal: 100,       // 綱がここまで寄ったら決着
    slots: 8,        // 出られるのは両側合わせてこの数まで
    pull: [0.35, 1.65], // 1匹の引き。振れ幅が狭いと、足場の相性だけで
                        // 決まってしまう(引き合いは人数で均されるため)。
    gain: 20,        // 引きの差が綱をどれだけ動かすか
    lean: 0.16,      // 寄ったぶんだけ寄りやすくなる割合(勢い)
    lock: 15,        // ここまで寄ってから勢いがつく。最初からだと一方的になる。
    hurry: 30,       // 長引くほど勢いが増す。見ていて焦れないように。
    eventP: 0.16,
    stint: 4,        // 何歩ごとに足場が変わるか
    grounds: 4,      // 引いてくる足場の数(順に回る)
    good: 1.12, bad: 0.90,        // 足場と系統の相性(勢いが増幅するので控えめ)
    natGood: 1.06, natBad: 0.95,  // 足場と性格の相性
  };

  // 足場。1回ごとに1つ引く。かけっこの区間と同じ形なので、
  // 相性の数え方も見出しの作り方も枠のものがそのまま使える。
  const GROUNDS = [
    { id: 'mud',   name: '泥ねば',   good: 'water', bad: 'wind',  ng: 'hp',  nb: 'spd', c: '#6a7a5a' },
    { id: 'sand',  name: '砂地',     good: 'rock',  bad: 'water', ng: 'def', nb: 'mp',  c: '#d0a24a' },
    { id: 'turf',  name: '芝',       good: 'grass', bad: 'fire',  ng: 'spd', nb: 'atk', c: '#5fd07a' },
    { id: 'slab',  name: '石畳',     good: 'fire',  bad: 'grass', ng: 'atk', nb: 'def', c: '#ff6b4a' },
    { id: 'gust',  name: '吹きさらし',good: 'wind', bad: 'dark',  ng: 'dex', nb: 'int', c: '#7ee0d0' },
    { id: 'dusk',  name: '夕闇',     good: 'dark',  bad: 'light', ng: 'int', nb: 'dex', c: '#a76bff' },
    { id: 'noon',  name: '真昼',     good: 'light', bad: 'rock',  ng: 'mp',  nb: 'hp',  c: '#ffd95c' },
  ];

  // 出来事。どちらに転ぶかは完全に運で、有利も不利も同数。
  const EVENTS = [
    { d:  7, t: 'が 足をそろえた' },
    { d:  5, t: 'が ぐっと腰を落とした' },
    { d:  4, t: 'が 一気に引いた' },
    { d: -4, t: 'の足が滑った' },
    { d: -5, t: 'が 前のめりになった' },
    { d: -7, t: 'が 手をゆるめた' },
  ];

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const sideName = (side) => side.map(m => m.name).join('・');

  function start(runners, opt) {
    opt = opt || {};
    const rnd = opt.rnd || Math.random;
    const pool = Play.shuffled(runners, rnd).slice(0, opt.slots || TUG.slots);
    if (pool.length < 2) return null;
    // 人数は必ず同じにする。余った1匹は見物にまわす。
    const half = Math.floor(pool.length / 2);
    const sides = [pool.slice(0, half), pool.slice(half, half * 2)];
    // 足場は4つ引いて順に回る。ひとつに固定すると引く前に決まってしまう。
    const grounds = opt.grounds || Play.shuffled(GROUNDS, rnd).slice(0, TUG.grounds);
    return { sides, grounds, at: 0, pos: 0, done: [], over: false, note: 'よーい' };
  }

  // いまの足場。stint 歩ごとに次へ移り、一巡したらまた最初に戻る。
  const groundAt = (at, n) => Math.floor(at / TUG.stint) % n;
  const groundOf = (r) => r.grounds[groundAt(r.at, r.grounds.length)];

  // 片側の引き。1匹ずつ引いて足す。足場との相性だけが偏りを生む。
  function pullOf(side, ground, rnd) {
    let t = 0;
    for (const m of side) {
      t += Play.roll(rnd, TUG.pull[0], TUG.pull[1]) * Play.fitMul(ground, m.family, m.up, TUG);
    }
    return t / Math.max(1, side.length);   // 人数差では強くならない
  }

  function step(r, opt) {
    opt = opt || {};
    const rnd = opt.rnd || Math.random;
    const finished = [];
    if (!r || r.over) return { note: r ? r.note : '', finished };

    const ground = groundOf(r);
    const a = pullOf(r.sides[0], ground, rnd);
    const b = pullOf(r.sides[1], ground, rnd);
    let move = (a - b) * TUG.gain;
    let note = null;
    const was = groundAt(r.at, r.grounds.length);
    r.at++;
    // 足場が変わる。押されていても、ここから返せる。
    const now = groundAt(r.at, r.grounds.length);
    if (now !== was) note = `足場が ${r.grounds[now].name} に変わった`;

    if (rnd() < TUG.eventP) {
      const ev = EVENTS[Math.floor(rnd() * EVENTS.length)];
      const who = rnd() < 0.5 ? 0 : 1;
      const m = Play.pickOf(r.sides[who], rnd);
      move += ev.d * (who === 0 ? 1 : -1);
      if (m) note = `${m.name} ${ev.t}`;
    }

    // 寄ったぶんだけ寄りやすい。均衡が続くと見ていて退屈なので。
    // 勢いがつくのは、はっきり傾いてから。長引くほど強くなる。
    const lean = Math.abs(r.pos) > TUG.lock
      ? r.pos * TUG.lean * (1 + r.at / TUG.hurry) : 0;
    r.pos = clamp(r.pos + move + lean, -TUG.goal, TUG.goal);
    if (!note) {
      const lead = r.pos > 6 ? 0 : r.pos < -6 ? 1 : -1;
      note = lead < 0 ? '綱が動かない'
        : `${sideName(r.sides[lead])} が じりじり引いている`;
    }

    if (Math.abs(r.pos) >= TUG.goal) {
      const won = r.pos > 0 ? 0 : 1;
      r.over = true;
      r.done = r.sides[won].map(m => m.id);
      for (const m of r.sides[won]) finished.push({ id: m.id, place: 1 });
      for (const m of r.sides[1 - won]) finished.push({ id: m.id, place: 2 });
      note = `${sideName(r.sides[won])} の勝ち`;
    }
    r.note = note;
    return { note, finished };
  }

  // 絵の指示。綱が1本あって、結び目がどちらかに寄っていく。
  function paint(r) {
    const won = r.over ? (r.pos > 0 ? 0 : 1) : -1;
    return {
      conds: r.grounds.map((g, i) => ({
        ...Play.condLabel(g),
        on: i === groundAt(r.at, r.grounds.length),
      })),
      pos: r.pos / TUG.goal * 50 + 50,   // 0〜100(50が真ん中)
      sides: r.sides.map((side, i) => ({
        ids: side.map(m => m.id),
        names: side.map(m => m.name),
        won: won === i,
      })),
    };
  }

  const API = { TUG, GROUNDS, EVENTS, start, step, paint, pullOf, groundOf, groundAt };

  Play.register({
    id: 'tug', name: '綱引き', note: '寄りだすと一気に行く。強さは関係ない。',
    min: 2, max: TUG.slots, tickMs: TUG.tickMs, kind: 'bar',
    start, step, paint,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Tug = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
