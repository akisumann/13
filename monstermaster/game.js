'use strict';

// =====================================================================
// データ
// =====================================================================

const FAMILIES = {
  fire:  { name: '炎', glyph: '炎', color: '#ff6b4a', mod: { hp: 0.95, atk: 1.20, def: 0.90, spd: 1.00 } },
  water: { name: '水', glyph: '水', color: '#4aa8ff', mod: { hp: 1.15, atk: 1.00, def: 1.05, spd: 0.95 } },
  grass: { name: '草', glyph: '草', color: '#5fd07a', mod: { hp: 1.05, atk: 0.90, def: 1.20, spd: 1.00 } },
  rock:  { name: '岩', glyph: '岩', color: '#d0a24a', mod: { hp: 1.20, atk: 1.05, def: 1.15, spd: 0.75 } },
  wind:  { name: '風', glyph: '風', color: '#7ee0d0', mod: { hp: 0.90, atk: 1.00, def: 0.90, spd: 1.35 } },
  dark:  { name: '闇', glyph: '闇', color: '#a76bff', mod: { hp: 1.00, atk: 1.15, def: 1.00, spd: 1.10 } },
  light: { name: '光', glyph: '光', color: '#ffd95c', mod: { hp: 1.10, atk: 1.10, def: 1.10, spd: 1.10 } },
};

const BASE_FAMILIES = ['fire', 'water', 'grass', 'rock', 'wind'];

const SPECIES = [
  ['fire',  1, 'ヒノコ'],     ['fire',  2, 'ボウフレア'], ['fire',  3, 'サラマンド'],
  ['fire',  4, 'イフリード'], ['fire',  5, 'ヴォルケイン'],
  ['water', 1, 'シズク'],     ['water', 2, 'アクアム'],   ['water', 3, 'リヴァイト'],
  ['water', 4, 'セイレーヌ'], ['water', 5, 'ポセイドス'],
  ['grass', 1, 'フタバ'],     ['grass', 2, 'ツタリング'], ['grass', 3, 'ドリアード'],
  ['grass', 4, 'ユグドラ'],   ['grass', 5, 'ガイアルド'],
  ['rock',  1, 'コイシ'],     ['rock',  2, 'ロックル'],   ['rock',  3, 'ゴーレット'],
  ['rock',  4, 'グラナイト'], ['rock',  5, 'アダマス'],
  ['wind',  1, 'ソヨカ'],     ['wind',  2, 'ウィンディ'], ['wind',  3, 'シルフィード'],
  ['wind',  4, 'テンペスト'], ['wind',  5, 'ガルーダ'],
  ['dark',  3, 'シャドウル'], ['dark',  4, 'ノクターン'], ['dark',  5, 'ニュクス'],
  ['light', 5, 'ルクスノヴァ'],
].map(([family, rank, name]) => ({ id: family + rank, family, rank, name }));

// 異系統どうしの配合表(闇・光は特殊ルールで処理する)
const FUSION_TABLE = {
  'fire+water': 'wind',  'fire+grass': 'fire',  'fire+rock': 'rock',  'fire+wind': 'fire',
  'grass+water': 'grass', 'rock+water': 'water', 'water+wind': 'water',
  'grass+rock': 'grass', 'grass+wind': 'wind',
  'rock+wind': 'rock',
};

const AREAS = [
  { id: 1, name: 'はじまりの草原', rank: 1, gold: [10, 20] },
  { id: 2, name: 'ぬかるみの沼',   rank: 2, gold: [22, 40] },
  { id: 3, name: '岩窟回廊',       rank: 3, gold: [45, 75] },
  { id: 4, name: '嵐の尖塔',       rank: 4, gold: [80, 130] },
  { id: 5, name: '虚無の深淵',     rank: 5, gold: [150, 240] },
];

const EGG_PRICE = 60;
const CAPTURE_RATE = 0.22;
const DARK_CHANCE = 0.25;
const ROSTER_CAP = 12; // 牧場の上限。あふれると育成が薄く分散して誰も育たなくなる。

// =====================================================================
// ユーティリティ
// =====================================================================

function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr[ri(0, arr.length - 1)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function speciesById(id) { return SPECIES.find(s => s.id === id); }

// その系統でランクr以下の最も近い種を返す(闇は3〜、光は5のみ)
function speciesFor(family, rank) {
  const pool = SPECIES.filter(s => s.family === family);
  let best = pool[0];
  for (const s of pool) {
    if (s.rank <= rank && s.rank >= best.rank) best = s;
    if (best.rank > rank && s.rank < best.rank) best = s;
  }
  return best;
}

function speciesOfRank(rank) {
  const pool = SPECIES.filter(s => s.rank === rank);
  return pool.length ? pool : SPECIES.filter(s => s.rank === 1);
}

// =====================================================================
// モンスター
// =====================================================================

let _uid = 1;

function makeMonster(speciesId, opts) {
  const o = opts || {};
  const sp = speciesById(speciesId);
  return {
    uid: o.uid || _uid++,
    sp: sp.id,
    level: o.level || 1,
    exp: 0,
    gene: o.gene || 0,
  };
}

function spOf(m) { return speciesById(m.sp); }
function famOf(m) { return FAMILIES[spOf(m).family]; }
function maxLevelOf(m) { return 6 + spOf(m).rank * 3; }
function expToNext(m) { return m.level * 3 + 10; }

function statsOf(m) {
  const sp = spOf(m);
  const mod = FAMILIES[sp.family].mod;
  const r = sp.rank;
  const lv = m.level - 1;
  return {
    hp:  Math.round((24 + r * 16) * mod.hp)  + m.gene * 2 + lv * 3,
    atk: Math.round((6 + r * 5) * mod.atk)   + m.gene + lv,
    def: Math.round((5 + r * 4) * mod.def)   + m.gene + lv,
    spd: Math.round((6 + r * 4) * mod.spd)   + m.gene + lv,
  };
}

function powerOf(m) {
  const s = statsOf(m);
  return Math.round(s.hp / 2 + s.atk + s.def + s.spd);
}

// 経験値を与え、上がったレベル数を返す
function gainExp(m, amount) {
  const cap = maxLevelOf(m);
  if (m.level >= cap) { m.exp = 0; return 0; }
  m.exp += amount;
  let ups = 0;
  while (m.level < cap && m.exp >= expToNext(m)) {
    m.exp -= expToNext(m);
    m.level++;
    ups++;
  }
  if (m.level >= cap) m.exp = 0;
  return ups;
}

// =====================================================================
// 配合
// =====================================================================

function fusionKey(a, b) { return [a, b].sort().join('+'); }

// 子の系統。ランダム要素(闇の発現)があるので確定ではない。
function fuseFamily(a, b) {
  const fa = spOf(a).family, fb = spOf(b).family;
  const ra = spOf(a).rank, rb = spOf(b).rank;
  if (fa === 'dark' && fb === 'dark' && ra >= 4 && rb >= 4) return 'light';
  if (fa === 'light' || fb === 'light') return 'light';
  if (fa === 'dark' || fb === 'dark') return 'dark';
  if (fa === fb) return fa;
  if (ra >= 3 && rb >= 3 && Math.random() < DARK_CHANCE) return 'dark';
  return FUSION_TABLE[fusionKey(fa, fb)];
}

// 同ランクどうしなら1つ上がる、というのが唯一の昇格ルート
function fuseRank(a, b, childFamily) {
  const ra = spOf(a).rank, rb = spOf(b).rank;
  let r = Math.max(ra, rb);
  if (ra === rb) r += 1;
  r = clamp(r, 1, 5);
  if (childFamily === 'dark') r = Math.max(r, 3);
  if (childFamily === 'light') r = 5;
  return r;
}

function fuseGene(a, b) {
  return Math.floor((a.gene + b.gene) / 2) + Math.floor((a.level + b.level) / 4);
}

function fuse(a, b) {
  const family = fuseFamily(a, b);
  const rank = fuseRank(a, b, family);
  const sp = speciesFor(family, rank);
  return makeMonster(sp.id, { gene: fuseGene(a, b) });
}

// 実行前に見せる予測。闇が出うる組み合わせは伏せる。
function previewFusion(a, b) {
  const fa = spOf(a).family, fb = spOf(b).family;
  const ra = spOf(a).rank, rb = spOf(b).rank;
  const surprise = fa !== fb && fa !== 'dark' && fb !== 'dark'
    && fa !== 'light' && fb !== 'light' && ra >= 3 && rb >= 3;

  // 予測表示では闇の抽選を外した確定ルートを示す
  let family;
  if (fa === 'dark' && fb === 'dark' && ra >= 4 && rb >= 4) family = 'light';
  else if (fa === 'light' || fb === 'light') family = 'light';
  else if (fa === 'dark' || fb === 'dark') family = 'dark';
  else if (fa === fb) family = fa;
  else family = FUSION_TABLE[fusionKey(fa, fb)];

  const rank = fuseRank(a, b, family);
  return { species: speciesFor(family, rank), gene: fuseGene(a, b), surprise };
}

// =====================================================================
// 戦闘・探索
// =====================================================================

function battle(a, b) {
  const A = { name: spOf(a).name, ...statsOf(a) };
  const B = { name: spOf(b).name, ...statsOf(b) };
  const log = [];
  let first = A.spd >= B.spd;

  for (let turn = 0; turn < 60 && A.hp > 0 && B.hp > 0; turn++) {
    const atk = first ? A : B, dfn = first ? B : A;
    const dmg = Math.max(1, atk.atk - Math.floor(dfn.def / 2) + ri(-2, 2));
    dfn.hp -= dmg;
    log.push(`${atk.name} の攻撃 → ${dmg} ダメージ(${dfn.name} 残り ${Math.max(0, dfn.hp)})`);
    first = !first;
  }
  return { win: B.hp <= 0 && A.hp > 0, log };
}

function wildFor(area) {
  const sp = pick(speciesOfRank(area.rank));
  return makeMonster(sp.id, {
    level: Math.max(1, area.rank * 2 - 1),
    gene: (area.rank - 1) * 2,
  });
}

// 1回の探索を解決し、結果をまとめて返す(状態の書き換えは呼び出し側)
function explore(mon, area, canCapture) {
  const wild = wildFor(area);
  const res = battle(mon, wild);
  const out = {
    wild,
    win: res.win,
    log: res.log,
    exp: 0, gold: 0, levelUps: 0, captured: null, missedCapture: false,
  };
  if (res.win) {
    out.exp = spOf(wild).rank * 20 + wild.level * 4;
    out.gold = ri(area.gold[0], area.gold[1]);
    if (Math.random() < CAPTURE_RATE) {
      if (canCapture === false) out.missedCapture = true;
      else out.captured = makeMonster(wild.sp, { level: 1, gene: wild.gene });
    }
  } else {
    out.exp = Math.floor((spOf(wild).rank * 20) / 3);
    out.gold = Math.floor(ri(area.gold[0], area.gold[1]) / 4);
  }
  return out;
}

function areaUnlocked(area, monsters) {
  if (area.rank <= 1) return true;
  return monsters.some(m => spOf(m).rank >= area.rank - 1);
}

// =====================================================================
// 状態
// =====================================================================

const SAVE_KEY = 'monstermaster.v1';

let S = null;
let UI = { tab: 'ranch', picks: [], area: 1, sortie: null, result: null, open: null };

function newState() {
  const fams = BASE_FAMILIES.slice();
  const starters = [];
  for (let i = 0; i < 3; i++) {
    const f = fams.splice(ri(0, fams.length - 1), 1)[0];
    starters.push(makeMonster(f + '1'));
  }
  return {
    gold: 0,
    monsters: starters,
    dex: starters.reduce((d, m) => (d[m.sp] = true, d), {}),
    fuseCount: 0,
    exploreCount: 0,
  };
}

function discover(speciesId) {
  if (S.dex[speciesId]) return false;
  S.dex[speciesId] = true;
  return true;
}

function save() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...S, uid: _uid }));
  } catch (e) { /* プライベートモード等では黙って諦める */ }
}

function load() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.monsters) || !d.monsters.length) return null;
    if (d.monsters.some(m => !speciesById(m.sp))) return null;
    _uid = d.uid || (Math.max(...d.monsters.map(m => m.uid)) + 1);
    return {
      gold: d.gold || 0,
      monsters: d.monsters,
      dex: d.dex || {},
      fuseCount: d.fuseCount || 0,
      exploreCount: d.exploreCount || 0,
    };
  } catch (e) { return null; }
}

// =====================================================================
// 行動(状態を変える操作)
// =====================================================================

function doFuse(a, b) {
  const child = fuse(a, b);
  S.monsters = S.monsters.filter(m => m.uid !== a.uid && m.uid !== b.uid);
  S.monsters.push(child);
  S.fuseCount++;
  const isNew = discover(child.sp);
  return { child, isNew };
}

function rosterFull() { return S.monsters.length >= ROSTER_CAP; }

function doExplore(mon, area) {
  const out = explore(mon, area, !rosterFull());
  S.gold += out.gold;
  out.levelUps = gainExp(mon, out.exp);
  if (out.captured) {
    S.monsters.push(out.captured);
    out.capturedIsNew = discover(out.captured.sp);
  }
  S.exploreCount++;
  return out;
}

function doBuyEgg() {
  if (S.gold < EGG_PRICE || rosterFull()) return null;
  S.gold -= EGG_PRICE;
  const m = makeMonster(pick(BASE_FAMILIES) + '1');
  S.monsters.push(m);
  const isNew = discover(m.sp);
  return { monster: m, isNew };
}

function doRelease(mon) {
  if (S.monsters.length <= 1) return false;
  S.monsters = S.monsters.filter(m => m.uid !== mon.uid);
  return true;
}

// =====================================================================
// UI
// =====================================================================

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function rankLabel(r) { return '★' + r; }

function emblem(m, size) {
  const f = famOf(m);
  const n = el('div', 'emblem' + (size ? ' ' + size : ''), f.glyph);
  n.style.setProperty('--fc', f.color);
  return n;
}

// 一覧は必ず取得順で並べる。強さ順にすると育成やレベルアップで行が入れ替わり、
// 連打しているときに指の下でボタンがずれて誤タップの原因になる。
function roster() { return S.monsters.slice().sort((a, b) => a.uid - b.uid); }

// 連打する主要ボタンを画面下の固定バーへ置く
function setAction(node) {
  const bar = document.getElementById('action-bar');
  bar.innerHTML = '';
  if (node) bar.appendChild(node);
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function monRow(m, opts) {
  const o = opts || {};
  const row = el('button', 'mon' + (o.selected ? ' is-sel' : ''));
  row.appendChild(emblem(m));

  const main = el('div', 'mon-main');
  const name = el('div', 'mon-name');
  name.appendChild(el('span', null, spOf(m).name));
  name.appendChild(el('span', 'rank', rankLabel(spOf(m).rank)));
  main.appendChild(name);
  const cap = maxLevelOf(m);
  main.appendChild(el('div', 'mon-sub',
    `Lv.${m.level}${m.level >= cap ? '(最大)' : ''} ・ 遺伝 +${m.gene}`));
  row.appendChild(main);

  if (o.badge) {
    row.appendChild(el('div', 'pick-badge', o.badge));
  } else {
    const p = el('div', 'mon-power');
    p.appendChild(el('span', 'v', String(powerOf(m))));
    p.appendChild(el('span', 'k', '総合'));
    row.appendChild(p);
  }
  if (o.onClick) row.addEventListener('click', o.onClick);
  return row;
}

function statBlock(m) {
  const s = statsOf(m);
  const f = famOf(m);
  const wrap = el('div', 'stats');
  const rows = [['HP', s.hp, 260], ['こうげき', s.atk, 90], ['ぼうぎょ', s.def, 80], ['すばやさ', s.spd, 90]];
  for (const [k, v, max] of rows) {
    const r = el('div', 'stat-row');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v', String(v)));
    const meter = el('div', 'meter');
    const fill = el('i');
    fill.style.width = clamp(v / max * 100, 4, 100) + '%';
    meter.style.setProperty('--fc', f.color);
    meter.appendChild(fill);
    r.appendChild(meter);
    wrap.appendChild(r);
  }
  return wrap;
}

// --------------------------------------------- 牧場
function viewRanch(view) {
  const head = el('div', 'head');
  head.appendChild(el('h2', null, '牧場'));
  head.appendChild(el('span', 'note', `${S.monsters.length} / ${ROSTER_CAP} 匹 ・ 配合 ${S.fuseCount} 回`));
  view.appendChild(head);

  if (rosterFull()) {
    view.appendChild(el('p', 'hint',
      `牧場がいっぱい(${ROSTER_CAP}匹)。これ以上は仲間にできない。配合するか、にがして空きを作ろう。`));
  }

  const shop = el('div', 'panel');
  const sh = el('div', 'head');
  sh.appendChild(el('h2', null, 'たまご'));
  sh.appendChild(el('span', 'note', `${EGG_PRICE} G`));
  shop.appendChild(sh);
  shop.appendChild(el('p', 'hint', 'ランク1のモンスターが1匹かえる。配合の材料が尽きたらここで補充する。'));
  const canBuy = S.gold >= EGG_PRICE && !rosterFull();
  const buy = el('button', 'btn primary',
    rosterFull() ? '牧場がいっぱい'
      : S.gold >= EGG_PRICE ? 'たまごをかえす'
      : `所持金が足りない(${S.gold} / ${EGG_PRICE} G)`);
  if (!canBuy) buy.disabled = true;
  buy.addEventListener('click', () => {
    const r = doBuyEgg();
    if (!r) return;
    toast(`${spOf(r.monster).name} がかえった!${r.isNew ? '(図鑑に登録)' : ''}`);
    save(); render();
  });
  shop.appendChild(buy);
  view.appendChild(shop);

  const list = el('div', 'list');
  for (const m of roster()) {
    const open = UI.open === m.uid;
    list.appendChild(monRow(m, {
      selected: open,
      onClick: () => { UI.open = open ? null : m.uid; render(); },
    }));
    if (!open) continue;

    const d = el('div', 'panel');
    const dh = el('div', 'head');
    dh.appendChild(el('h2', null, spOf(m).name));
    dh.appendChild(el('span', 'note', `${famOf(m).name}系 ・ ${rankLabel(spOf(m).rank)}`));
    d.appendChild(dh);
    d.appendChild(statBlock(m));
    const cap = maxLevelOf(m);
    d.appendChild(el('p', 'hint',
      m.level >= cap
        ? `Lv.${m.level}(上限)。これ以上は配合で上のランクへ。`
        : `Lv.${m.level} ・ 次のレベルまで ${expToNext(m) - m.exp} exp ・ 上限 Lv.${cap}`));
    if (S.monsters.length > 1) {
      const rel = el('button', 'btn ghost', 'にがす');
      rel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (doRelease(m)) {
          toast(`${spOf(m).name} をにがした`);
          UI.open = null;
          UI.picks = UI.picks.filter(u => u !== m.uid);
          save(); render();
        }
      });
      d.appendChild(rel);
    }
    list.appendChild(d);
  }
  view.appendChild(list);
}

// --------------------------------------------- 配合
function viewFuse(view) {
  const head = el('div', 'head');
  head.appendChild(el('h2', null, '配合'));
  head.appendChild(el('span', 'note', '2匹 → 1匹'));
  view.appendChild(head);

  const picked = UI.picks.map(u => S.monsters.find(m => m.uid === u)).filter(Boolean);
  UI.picks = picked.map(m => m.uid);

  const panel = el('div', 'panel');
  const slots = el('div', 'fuse-slots');
  for (let i = 0; i < 2; i++) {
    const m = picked[i];
    const s = el('div', 'slot' + (m ? ' filled' : ''));
    if (m) {
      s.appendChild(emblem(m, 'sm'));
      s.appendChild(el('div', 'nm', spOf(m).name));
      s.appendChild(el('div', 'em', `${rankLabel(spOf(m).rank)} Lv.${m.level}`));
      s.style.borderColor = famOf(m).color;
    } else {
      s.appendChild(el('div', 'ph', `親 ${i + 1} をえらぶ`));
    }
    slots.appendChild(s);
    if (i === 0) slots.appendChild(el('div', 'plus', '＋'));
  }
  panel.appendChild(slots);

  // プレビュー欄は常に描画する。2匹目を選んだ瞬間に生えてくると一覧が下にずれてしまうため。
  const ready = picked.length === 2;
  const pv = ready ? previewFusion(picked[0], picked[1]) : null;
  const res = el('div', 'result');
  if (ready) {
    res.appendChild(emblem({ sp: pv.species.id, level: 1, gene: pv.gene, uid: -1 }, 'lg'));
    const txt = el('div', 'txt');
    txt.appendChild(el('div', 't1', `${pv.species.name}  ${rankLabel(pv.species.rank)}`));
    txt.appendChild(el('div', 't2',
      `${FAMILIES[pv.species.family].name}系 ・ 遺伝 +${pv.gene}` + (pv.surprise ? ' ・ まれに別の系統が出る' : '')));
    res.appendChild(txt);
  } else {
    const ph = el('div', 'emblem lg', '?');
    ph.style.setProperty('--fc', '#7b86a8');
    res.appendChild(ph);
    const txt = el('div', 'txt');
    txt.appendChild(el('div', 't1', '親を2匹えらぶ'));
    txt.appendChild(el('div', 't2', '同じランクどうしなら、ランクが1つ上がる'));
    res.appendChild(txt);
  }
  panel.appendChild(res);
  view.appendChild(panel);

  if (S.monsters.length < 2) {
    view.appendChild(el('p', 'hint', 'モンスターが2匹以上いないと配合できない。探索かたまごで増やそう。'));
    setAction(null);
    return;
  }

  view.appendChild(el('p', 'hint',
    'レベルの高い親ほど「遺伝」が子に多く乗り、代を重ねるほど強くなる。'));

  const list = el('div', 'list');
  for (const m of roster()) {
    const idx = UI.picks.indexOf(m.uid);
    list.appendChild(monRow(m, {
      selected: idx >= 0,
      badge: idx >= 0 ? String(idx + 1) : null,
      onClick: () => {
        if (idx >= 0) UI.picks.splice(idx, 1);
        else if (UI.picks.length < 2) UI.picks.push(m.uid);
        else UI.picks = [UI.picks[1], m.uid];
        render();
      },
    }));
  }
  view.appendChild(list);

  const go = el('button', 'btn primary', ready ? '配合する(親は2匹とも消える)' : '親を2匹えらぶ');
  if (!ready) go.disabled = true;
  go.addEventListener('click', () => {
    const r = doFuse(picked[0], picked[1]);
    UI.picks = [];
    UI.open = r.child.uid;
    toast(`${spOf(r.child).name} が生まれた!${r.isNew ? ' — 新種発見' : ''}`);
    save();
    UI.tab = 'ranch';
    render();
  });
  setAction(go);
}

// --------------------------------------------- 探索
function viewExplore(view) {
  const head = el('div', 'head');
  head.appendChild(el('h2', null, '探索'));
  head.appendChild(el('span', 'note', `${S.exploreCount} 回`));
  view.appendChild(head);

  // エリアは横スクロールのチップ1行にして、結果を画面内に収める
  const chips = el('div', 'chips');
  for (const a of AREAS) {
    const ok = areaUnlocked(a, S.monsters);
    const b = el('button', 'chip' + (UI.area === a.id ? ' is-on' : ''));
    if (!ok) b.disabled = true;
    b.appendChild(el('span', null, ok ? a.name : '？？？'));
    b.appendChild(el('span', 'r', 'R' + a.rank));
    b.addEventListener('click', () => { UI.area = a.id; render(); });
    chips.appendChild(b);
  }
  view.appendChild(chips);

  const area = AREAS.find(a => a.id === UI.area && areaUnlocked(a, S.monsters)) || AREAS[0];
  UI.area = area.id;
  view.appendChild(el('div', 'area-desc',
    `${rankLabel(area.rank)}の野生 ・ ${area.gold[0]}〜${area.gold[1]} G ・ 勝つと${Math.round(CAPTURE_RATE * 100)}%で仲間になる`));

  // 結果スロット(高さ固定・一覧より上)。中身が増減してもレイアウトが動かない。
  const out = el('div', 'panel result-slot');
  const r = UI.result;
  const oh = el('div', 'head');
  oh.appendChild(el('h2', null, !r ? '結果' : r.win ? '勝利' : '敗走'));
  if (r) oh.appendChild(el('span', 'note', `${r.monName} vs ${spOf(r.wild).name}`));
  out.appendChild(oh);

  const log = el('div', 'log');
  if (!r) {
    log.appendChild(el('div', 'msg-dim', 'エリアと出撃するモンスターを選んで、下のボタンで送り出そう。'));
  } else {
    log.appendChild(el('div', r.win ? 'win' : 'lose',
      r.win ? `${spOf(r.wild).name} を打ち倒した` : `${spOf(r.wild).name} に敗れて逃げ帰った`));
    log.appendChild(el('div', null, `経験値 +${r.exp} ・ ${r.gold} G を獲得`));
    if (r.levelUps > 0) log.appendChild(el('div', 'get', `レベルが ${r.levelUps} 上がった!`));
    if (r.captured) {
      log.appendChild(el('div', 'get',
        `${spOf(r.captured).name} が仲間になった!${r.capturedIsNew ? '(新種)' : ''}`));
    }
    if (r.missedCapture) {
      log.appendChild(el('div', null,
        `${spOf(r.wild).name} はなついたが、牧場がいっぱいで連れ帰れなかった。`));
    }
    for (const line of r.log.slice(-8)) log.appendChild(el('div', null, line));
  }
  out.appendChild(log);
  view.appendChild(out);

  // 出撃するモンスター(取得順で固定)
  const sortie = S.monsters.find(m => m.uid === UI.sortie) || S.monsters[0];
  UI.sortie = sortie ? sortie.uid : null;

  const panel = el('div', 'panel');
  const ph = el('div', 'head');
  ph.appendChild(el('h2', null, '出撃するモンスター'));
  ph.appendChild(el('span', 'note', sortie ? spOf(sortie).name : ''));
  panel.appendChild(ph);

  const list = el('div', 'list');
  for (const m of roster()) {
    list.appendChild(monRow(m, {
      selected: m.uid === UI.sortie,
      onClick: () => { UI.sortie = m.uid; render(); },
    }));
  }
  panel.appendChild(list);
  view.appendChild(panel);

  // 連打するボタンは固定バーへ
  const go = el('button', 'btn primary', `${area.name} へ送り出す`);
  go.addEventListener('click', () => {
    const mon = S.monsters.find(m => m.uid === UI.sortie);
    if (!mon) return;
    UI.result = doExplore(mon, area);
    UI.result.monName = spOf(mon).name;
    save();
    render();
  });
  setAction(go);
}

// --------------------------------------------- 図鑑
function viewDex(view) {
  const found = Object.keys(S.dex).filter(k => S.dex[k]).length;
  const head = el('div', 'head');
  head.appendChild(el('h2', null, '図鑑'));
  head.appendChild(el('span', 'note', `${found} / ${SPECIES.length} 種`));
  view.appendChild(head);

  for (const key of Object.keys(FAMILIES)) {
    const pool = SPECIES.filter(s => s.family === key);
    if (!pool.length) continue;
    const f = FAMILIES[key];
    const sec = el('div', 'dex-fam');
    sec.style.setProperty('--fc', f.color);
    const anyFound = pool.some(s => S.dex[s.id]);
    sec.appendChild(el('h3', null, anyFound ? `${f.name} 系` : '？ 系'));

    const grid = el('div', 'dex-grid');
    for (const s of pool) {
      const known = !!S.dex[s.id];
      const cell = el('div', 'dex-cell' + (known ? '' : ' unknown'));
      const em = el('div', 'emblem sm', known ? f.glyph : '?');
      em.style.setProperty('--fc', f.color);
      cell.appendChild(em);
      cell.appendChild(el('div', 'dn', known ? s.name : '？？？'));
      cell.appendChild(el('div', 'dr', rankLabel(s.rank)));
      grid.appendChild(cell);
    }
    sec.appendChild(grid);
    view.appendChild(sec);
  }

  view.appendChild(el('p', 'hint',
    '闇の系統は、ランク3以上どうしの異なる系統を配合したときにまれに現れる。'));
}

// --------------------------------------------- 描画
function render() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  setAction(null);
  document.getElementById('hud-gold').textContent = String(S.gold);
  document.getElementById('hud-count').textContent = `${S.monsters.length}/${ROSTER_CAP}`;

  for (const t of document.querySelectorAll('.tab')) {
    t.classList.toggle('is-on', t.dataset.tab === UI.tab);
  }

  if (UI.tab === 'ranch') viewRanch(view);
  else if (UI.tab === 'fuse') viewFuse(view);
  else if (UI.tab === 'explore') viewExplore(view);
  else viewDex(view);
}

function init() {
  S = load() || newState();
  save();
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => {
      UI.tab = t.dataset.tab;
      UI.result = null;
      render();
      document.getElementById('view').scrollIntoView({ block: 'start' });
    });
  }
  render();
}

if (typeof document !== 'undefined') init();
