// =====================================================================
// かけっこ — 単体で動く部分
//
// このファイルはゲーム本体を一切参照しない。
// 走者は「4つの値」だけで表す。
//
//   { id: 'a1', name: 'ぽち', family: 'grass', up: 'spd' }
//
//   id     … 見分けがつけばなんでもいい
//   name   … 実況に出る名前
//   family … 区間の相性に使う系統(fire/water/grass/rock/wind/dark/light)
//   up     … 区間の相性に使う得意ステータス(hp/mp/atk/def/int/spd/dex、無しは null)
//
// 走りの中身は全部この4つと運だけで決まる。レベルも遺伝も見ない。
// 状態(makeが返すもの)はただのオブジェクトと配列なので、
// JSON.stringify でそのまま保存でき、読み戻して続きから走らせられる。
//
//   const r = Race.make(runners);
//   while (!r.over) Race.step(r);
//
// 乱数は差し替えられる。Race.step(r, { rnd }) に0〜1を返す関数を渡すと、
// 同じ種を使うかぎり同じレースになる(検証や再生に使う)。
// =====================================================================
(function (root) {
  'use strict';

  const RACE = {
    tickMs: 320,
    goal: 100,
    step: [2.2, 5.4],   // 1歩の進み。全員このくらい。
    eventP: 0.15,       // 何かが起きる割合。有利も不利も同じ確率で引く。
    slots: 6,
    legs: 4,            // 走路を何区間に割るか
    good: 1.35,         // 系統が合う区間での進み
    bad:  0.70,         // 系統が合わない区間での進み
    natGood: 1.18,      // 性格が合う区間での進み
    natBad:  0.85,      // 性格が合わない区間での進み
  };

  // 区間。走るたびに4つを引き直すので、有利な系統も毎回変わる。
  // どの系統も「得意」に1回・「苦手」に1回ずつ出てくるので、
  // たくさん走らせれば誰も得をしない。
  // 系統だけでなく、性格の得意ステータスも見る。
  // こちらも7つのステータスが「得意」に1回・「苦手」に1回ずつ出てくる。
  const LEGS = [
    { id: 'meadow', name: '草原',     good: 'grass', bad: 'rock',  ng: 'spd', nb: 'hp',  c: '#5fd07a' },
    { id: 'stream', name: '水路',     good: 'water', bad: 'fire',  ng: 'mp',  nb: 'atk', c: '#4aa8ff' },
    { id: 'scree',  name: '岩場',     good: 'rock',  bad: 'wind',  ng: 'def', nb: 'spd', c: '#d0a24a' },
    { id: 'gale',   name: '風道',     good: 'wind',  bad: 'grass', ng: 'dex', nb: 'def', c: '#7ee0d0' },
    { id: 'ember',  name: '火床',     good: 'fire',  bad: 'water', ng: 'atk', nb: 'mp',  c: '#ff6b4a' },
    { id: 'gloom',  name: '暗がり',   good: 'dark',  bad: 'light', ng: 'int', nb: 'dex', c: '#a76bff' },
    { id: 'glare',  name: '陽だまり', good: 'light', bad: 'dark',  ng: 'hp',  nb: 'int', c: '#ffd95c' },
  ];

  // 出来事。進みの増減と、そのときの言い回し。
  // 誰がどれを引くかは完全に運。
  const EVENTS = [
    { d:  6, t: 'ぐんと伸びた' },
    { d:  4, t: '外から追い上げた' },
    { d:  3, t: '前に出た' },
    { d: -3, t: 'よそ見をした' },
    { d: -4, t: 'つまずいた' },
    { d: -6, t: '立ち止まってしまった' },
  ];

  // 得意ステータスごとの走り方(描写だけ。進みには効かない)
  const STYLE = {
    spd: 'ぴょんぴょん跳ねながら', dex: '小刻みに', atk: '突っ込むように',
    hp:  'どっしりと',           def: 'のしのしと', int: '様子を見ながら',
    mp:  'ふわふわと',           null: 'まっすぐに',
  };

  // 表示用の名前。単体で使うときのために持っている。
  // 呼ぶ側が自前の名前を持っているならそちらを使えばいい。
  const LABEL = {
    fam:  { fire:'炎', water:'水', grass:'草', rock:'岩', wind:'風', dark:'闇', light:'光' },
    stat: { hp:'HP', mp:'MP', atk:'こうげき', def:'ぼうぎょ', int:'かしこさ', spd:'すばやさ', dex:'きようさ' },
  };

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

  // いま何区間目にいるか
  function legAt(x) {
    return clamp(Math.floor(x / (RACE.goal / RACE.legs)), 0, RACE.legs - 1);
  }

  function shuffled(list, rnd) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 区間との相性。+1が得意、-1が苦手、0が普通。系統と性格で別々に数える。
  function fitOf(leg, family, up) {
    if (!leg) return { plus: 0, minus: 0 };
    const plus  = (leg.good === family ? 1 : 0) + (up && leg.ng === up ? 1 : 0);
    const minus = (leg.bad  === family ? 1 : 0) + (up && leg.nb === up ? 1 : 0);
    return { plus, minus };
  }

  // 走者の一覧から1レース分の状態を作る。2匹に満たなければ null。
  // opt.legs に区間の配列を渡すと、引き直さずにそれを使う(決め打ちで試すとき用)。
  function make(runners, opt) {
    opt = opt || {};
    const rnd = opt.rnd || Math.random;
    const slots = opt.slots || RACE.slots;
    const lanes = shuffled(runners, rnd).slice(0, slots).map(r => ({
      id: r.id, name: r.name, family: r.family, up: r.up || null, x: 0, leg: 0,
    }));
    if (lanes.length < 2) return null;
    const legs = (opt.legs || shuffled(LEGS, rnd)).slice(0, RACE.legs);
    return { lanes, legs, done: [], over: false, note: 'よーい' };
  }

  // 1歩進める。状態は書き換える。
  // 返り値は { note, finished: [{ id, place }] }。
  // finished は今の1歩でゴールした者だけ(順位つき)。
  function step(r, opt) {
    opt = opt || {};
    const rnd = opt.rnd || Math.random;
    const finished = [];
    if (!r || r.over) return { note: r ? r.note : '', finished };
    let note = null;
    const reached = [];

    for (const lane of r.lanes) {
      if (r.done.includes(lane.id)) continue;
      let d = RACE.step[0] + rnd() * (RACE.step[1] - RACE.step[0]);
      // いる区間との相性。走るたびに区間が変わるので、毎回ちがう顔ぶれが伸びる。
      const leg = (r.legs || [])[legAt(lane.x)];
      if (leg) {
        if (leg.good === lane.family) d *= RACE.good;
        else if (leg.bad === lane.family) d *= RACE.bad;
        // 性格の効きは系統より小さい。両方そろうといちばん伸びる。
        if (lane.up && leg.ng === lane.up) d *= RACE.natGood;
        else if (lane.up && leg.nb === lane.up) d *= RACE.natBad;
      }
      if (rnd() < RACE.eventP) {
        const ev = EVENTS[Math.floor(rnd() * EVENTS.length)];
        d += ev.d;
        if (!note) note = `${lane.name} が ${ev.t}`;
      }
      lane.x = Math.max(0, lane.x + d);
      // 区間をまたいだら知らせる
      const now = legAt(lane.x);
      if (now !== lane.leg) {
        lane.leg = now;
        const nl = (r.legs || [])[now];
        if (nl && !note) {
          const { plus, minus } = fitOf(nl, lane.family, lane.up);
          if (plus > minus) note = `${lane.name} が ${nl.name} に入った(${plus > 1 ? '大得意' : '得意'})`;
          else if (minus > plus) note = `${lane.name} が ${nl.name} に入った(${minus > 1 ? '大の苦手' : '苦手'})`;
        }
      }
      if (lane.x >= RACE.goal) reached.push(lane);
    }

    // 同じ歩でゴールした者の順位。踏み込んだ距離が大きいほうを上にする。
    // ここを並び順のままにすると、上のレーンが同着をぜんぶ持っていってしまう。
    reached.sort((a, b) => (b.x - a.x) || (rnd() - 0.5));
    for (const lane of reached) {
      lane.x = RACE.goal;
      r.done.push(lane.id);
      const place = r.done.length;
      finished.push({ id: lane.id, place });
      note = `${place}着 ${lane.name}`;
    }
    if (note) r.note = note;
    if (r.done.length >= r.lanes.length) {
      r.over = true;
      const first = r.lanes.find(l => l.id === r.done[0]);
      if (first) r.note = `${first.name} の勝ち`;
    }
    return { note: r.note, finished };
  }

  // 走者から見た区間の一言(「得意」「大の苦手」など)。無関係なら null。
  function fitLabel(leg, family, up) {
    const { plus, minus } = fitOf(leg, family, up);
    if (plus > minus) return plus > 1 ? '大得意' : '得意';
    if (minus > plus) return minus > 1 ? '大の苦手' : '苦手';
    return null;
  }

  const API = {
    RACE, LEGS, EVENTS, STYLE, LABEL,
    legAt, make, step, fitOf, fitLabel, shuffled,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Race = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
