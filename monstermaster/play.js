// =====================================================================
// 遊び — その枠
//
// かけっこ・綱引き・かくれんぼは、どれもこの枠の上に乗っている。
// 枠が決めているのは3つだけ。
//
//   1. 走者は4つの値でしかない   { id, name, family, up }
//      レベルも遺伝も渡さない。だから遊びは強さで決まりようがない。
//   2. 状態はただのデータ        JSON にして保存し、読み戻して続けられる
//   3. 描き方は「絵の指示」で返す 遊びの側は DOM を知らない
//
// 遊びを1つ足すには、この形のものを register するだけでいい。
//
//   { id, name, note, min, max, tickMs, kind,
//     start(runners, opt) -> 状態,
//     step(state, opt)    -> { note, finished: [{ id, place }] },
//     paint(state)        -> 絵の指示 }
//
// kind は描き方の種類。'lanes'(走路) / 'bar'(綱) / 'spots'(隠れ場) の
// どれかを選ぶ。同じ kind なら、描く側に手を入れずに増やせる。
// =====================================================================
(function (root) {
  'use strict';

  const PLAYS = {};
  const ORDER = [];

  // 表示用の名前。遊びだけを持ち出したときのために自前で持っている。
  const LABEL = {
    fam:  { fire:'炎', water:'水', grass:'草', rock:'岩', wind:'風', dark:'闇', light:'光' },
    stat: { hp:'HP', mp:'MP', atk:'こうげき', def:'ぼうぎょ', int:'かしこさ', spd:'すばやさ', dex:'きようさ' },
  };

  function register(def) {
    if (!def || !def.id || PLAYS[def.id]) return null;
    for (const k of ['start', 'step', 'paint']) {
      if (typeof def[k] !== 'function') return null;
    }
    PLAYS[def.id] = def;
    ORDER.push(def.id);
    return def;
  }

  const list = () => ORDER.map(id => PLAYS[id]);
  const of = (id) => PLAYS[id] || null;

  // --- どの遊びでも使う道具 ---

  function shuffled(items, rnd) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const pickOf = (items, rnd) => items[Math.floor(rnd() * items.length)];
  const roll = (rnd, lo, hi) => lo + rnd() * (hi - lo);

  // 「場」との相性。場は { good, bad, ng, nb } を持つ。
  // good/bad は系統、ng/nb はステータス。合わせて何段得か損かを数える。
  function fitOf(cond, family, up) {
    if (!cond) return { plus: 0, minus: 0 };
    const plus  = (cond.good === family ? 1 : 0) + (up && cond.ng === up ? 1 : 0);
    const minus = (cond.bad  === family ? 1 : 0) + (up && cond.nb === up ? 1 : 0);
    return { plus, minus };
  }

  function fitLabel(cond, family, up) {
    const { plus, minus } = fitOf(cond, family, up);
    if (plus > minus) return plus > 1 ? '大得意' : '得意';
    if (minus > plus) return minus > 1 ? '大の苦手' : '苦手';
    return null;
  }

  // 相性を進みの倍率にする。効き幅は遊びごとに渡す。
  function fitMul(cond, family, up, mul) {
    let d = 1;
    if (!cond) return d;
    if (cond.good === family) d *= mul.good;
    else if (cond.bad === family) d *= mul.bad;
    if (up && cond.ng === up) d *= mul.natGood;
    else if (up && cond.nb === up) d *= mul.natBad;
    return d;
  }

  // 場の見出し(「岩場 / 岩↑ ぼうぎょ↑ / 風↓ すばやさ↓」)
  function condLabel(cond) {
    return {
      name: cond.name, c: cond.c,
      up:   `${LABEL.fam[cond.good]}↑ ${LABEL.stat[cond.ng]}↑`,
      down: `${LABEL.fam[cond.bad]}↓ ${LABEL.stat[cond.nb]}↓`,
    };
  }

  // 走者を4つの値に均す。余計なものが混ざっていても捨てる。
  const runnerOf = (r) => ({ id: r.id, name: r.name, family: r.family, up: r.up || null });

  // --- 遊びを回す ---

  function start(id, runners, opt) {
    const p = of(id);
    if (!p) return null;
    opt = opt || {};
    const rnd = opt.rnd || Math.random;
    const rs = (runners || []).filter(r => r && r.id != null).map(runnerOf);
    if (rs.length < p.min) return null;
    const st = p.start(rs, { ...opt, rnd });
    if (st) st.play = id;
    return st;
  }

  function step(state, opt) {
    const p = state && of(state.play);
    if (!p || state.over) return { note: state ? state.note : '', finished: [] };
    opt = opt || {};
    return p.step(state, { ...opt, rnd: opt.rnd || Math.random });
  }

  function paint(state) {
    const p = state && of(state.play);
    if (!p) return null;
    const d = p.paint(state);
    d.kind = p.kind;
    d.note = state.note;
    d.over = !!state.over;
    return d;
  }

  const API = {
    LABEL, register, list, of, start, step, paint,
    shuffled, pickOf, roll, fitOf, fitLabel, fitMul, condLabel, runnerOf,
    ids: () => ORDER.slice(),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Play = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
