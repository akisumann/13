// =====================================================================
// かくれんぼ — 遊びのみっつめ
//
// play.js の枠に乗っている。走者は かけっこ と同じ4つの値だけ。
//
// 1匹が鬼になり、残りが隠れ場に散る。鬼は1歩に1か所ずつのぞいて回り、
// 見つかった順に抜けていく。**最後まで見つからなかった者が勝ち**なので、
// 順位は見つかった順の逆になる。
//
// 隠れ場にも系統と性格の相性がある。合っている場所ほど見つかりにくいが、
// 鬼がどこをのぞくかは運なので、うまく隠れても引きが悪ければ見つかる。
//
// 見ている側に隠れ場の中身は見せない。それを見せたら遊びが終わる。
// 分かるのは「鬼がいまどこを見ているか」と「誰が見つかったか」だけ。
// =====================================================================
(function (root) {
  'use strict';

  const Play = root.Play ||
    (typeof require !== 'undefined' ? require('./play.js') : null);

  const HIDE = {
    tickMs: 800,
    slots: 7,        // 鬼を入れてこの数まで
    find: 0.40,      // のぞかれた隠れ場で見つかる割合
    move: 0.18,      // 1歩のあいだに隠れ場を移る割合
    moveFast: 0.34,  // すばやさ・きようさ自慢はよく動く
    spots: 4,        // 7つのうち、毎回この数だけ引く
    recent: 2,       // 直前にのぞいた場所は、しばらく選ばない
    limit: 60,       // これだけ経っても残っていたら逃げ切り
    good: 1.45, bad: 0.72,        // 隠れ場と系統の相性(見つかりにくさ)
    natGood: 1.20, natBad: 0.86,  // 隠れ場と性格の相性
  };

  // 隠れ場。かけっこの区間と同じで、7つのうち4つを毎回引き直す。
  // どの系統も「向いている」に1回・「向いていない」に1回ずつ出てくるので、
  // 何度も遊べば誰も得をしない。1回ごとには、向いた場所が引かれるかで変わる。
  const SPOTS = [
    { id: 'bush',  name: '茂み',   good: 'grass', bad: 'fire',  ng: 'dex', nb: 'atk', c: '#5fd07a' },
    { id: 'water', name: '水ぎわ', good: 'water', bad: 'rock',  ng: 'mp',  nb: 'def', c: '#4aa8ff' },
    { id: 'rocks', name: '岩陰',   good: 'rock',  bad: 'wind',  ng: 'def', nb: 'spd', c: '#d0a24a' },
    { id: 'ash',   name: '灰かぶり', good: 'fire', bad: 'water', ng: 'atk', nb: 'mp',  c: '#ff6b4a' },
    { id: 'eaves', name: '軒下',   good: 'wind',  bad: 'grass', ng: 'spd', nb: 'hp',  c: '#7ee0d0' },
    { id: 'hole',  name: '洞',     good: 'dark',  bad: 'light', ng: 'int', nb: 'dex', c: '#a76bff' },
    { id: 'light', name: '灯りの下', good: 'light', bad: 'dark', ng: 'hp',  nb: 'int', c: '#ffd95c' },
  ];

  // 隠れ場は好みで選ぶ。にわで器具に寄っていくのと同じ理屈で、
  // 向いている場所があれば7割でそちらを選ぶ。系統と性格はここで効く。
  function chooseSpot(spots, m, rnd) {
    const mine = spots.filter(s => {
      const f = Play.fitOf(s, m.family, m.up);
      return f.plus > f.minus;
    });
    return Play.pickOf(mine.length && rnd() < 0.7 ? mine : spots, rnd);
  }

  const FOUND = ['見つかった', '引っぱり出された', '笑ってしまった'];
  const MOVED = ['そっと移った', '場所を変えた', '忍び足で抜けた'];

  function start(runners, opt) {
    opt = opt || {};
    const rnd = opt.rnd || Math.random;
    const pool = Play.shuffled(runners, rnd).slice(0, opt.slots || HIDE.slots);
    if (pool.length < 2) return null;
    const spots = (opt.spots || Play.shuffled(SPOTS, rnd)).slice(0, HIDE.spots);
    const seeker = pool[0];
    const hiders = pool.slice(1).map(m => ({
      ...m, spot: chooseSpot(spots, m, rnd).id, found: false,
    }));
    return {
      spots, seeker, hiders, at: -1, seen: [], order: [], turn: 0,
      done: [], over: false, note: `${seeker.name} が鬼`,
    };
  }

  // 見つかりにくさ。合っている隠れ場ほど見つからない。
  const hideMul = (spot, m) => Play.fitMul(spot, m.family, m.up, HIDE);

  function step(r, opt) {
    opt = opt || {};
    const rnd = opt.rnd || Math.random;
    const finished = [];
    if (!r || r.over) return { note: r ? r.note : '', finished };
    r.turn++;

    // 鬼がのぞく場所を選ぶ。直前に見たところは選ばない。
    const fresh = r.spots.filter(s => !r.seen.includes(s.id));
    const target = Play.pickOf(fresh.length ? fresh : r.spots, rnd);
    r.at = r.spots.findIndex(s => s.id === target.id);
    r.seen = [target.id, ...r.seen].slice(0, HIDE.recent);

    let note = `${r.seeker.name} が ${target.name} をのぞいた`;
    let snd = null;

    // そこにいる者を見つける
    for (const h of r.hiders) {
      if (h.found || h.spot !== target.id) continue;
      if (rnd() >= HIDE.find / hideMul(target, h)) continue;
      h.found = true;
      r.order.push(h.id);
      note = `${h.name} が ${target.name} で ${Play.pickOf(FOUND, rnd)}`;
      snd = 'chirp';
    }

    // 見つかっていない者は動くことがある。動くと見つかる場所も変わる。
    for (const h of r.hiders) {
      if (h.found) continue;
      const quick = h.up === 'spd' || h.up === 'dex';
      if (rnd() >= (quick ? HIDE.moveFast : HIDE.move)) continue;
      const others = r.spots.filter(s => s.id !== h.spot && s.id !== target.id);
      if (!others.length) continue;
      h.spot = chooseSpot(others, h, rnd).id;
      if (!snd) note = `だれかが ${Play.pickOf(MOVED, rnd)}`;
    }

    const left = r.hiders.filter(h => !h.found);
    // 残り1匹になったら、その子が逃げ切り。時間切れなら残り全員が逃げ切り。
    if (left.length <= 1 || r.turn >= HIDE.limit) {
      r.over = true;
      for (const h of left) finished.push({ id: h.id, place: 1 });
      // 見つかった順の逆が順位。先に見つかるほど下。
      r.order.slice().reverse().forEach((id, i) => {
        finished.push({ id, place: left.length + i + 1 });
      });
      r.done = finished.slice().sort((a, b) => a.place - b.place).map(f => f.id);
      const names = left.map(h => h.name).join('・');
      note = left.length ? `${names} が逃げ切り` : `${r.seeker.name} が全員見つけた`;
      snd = null;
    }
    r.note = note;
    return { note, finished, snd };
  }

  // 絵の指示。隠れ場を並べて、鬼がいまどこにいるかだけ見せる。
  // 誰がどこにいるかは出さない(見えたら遊びにならない)。
  function paint(r) {
    const placeOf = (id) => {
      const i = r.done.indexOf(id);
      return i < 0 ? 0 : i + 1;
    };
    return {
      seeker: { id: r.seeker.id, name: r.seeker.name },
      spots: r.spots.map((s, i) => ({
        id: s.id, name: s.name, c: s.c, on: i === r.at, seen: r.seen.includes(s.id),
      })),
      left: r.hiders.filter(h => !h.found).length,
      hiders: r.hiders.map(h => ({
        id: h.id, name: h.name, found: h.found, place: placeOf(h.id),
      })),
    };
  }

  const API = { HIDE, SPOTS, start, step, paint, hideMul, chooseSpot };

  Play.register({
    id: 'hide', name: 'かくれんぼ', note: '最後まで見つからなかった者が勝ち。',
    min: 3, max: HIDE.slots, tickMs: HIDE.tickMs, kind: 'spots',
    start, step, paint,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Hide = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
