'use strict';

// =====================================================================
// データ
// =====================================================================

// ステータスは7種。すべて常時効果として戦闘に効く(コマンド選択や詠唱は無い)。
const STATS = [
  { key: 'hp',  label: 'HP',       base: (r) => 24 + r * 16, max: 280,
    effect: '0になると負ける' },
  { key: 'mp',  label: 'MP',       base: (r) => 10 + r * 8,  max: 150,
    effect: '魔力よろい。尽きるまで被ダメージを肩代わりする。多いほど長く保つ' },
  { key: 'atk', label: 'こうげき', base: (r) => 6 + r * 5,   max: 110,
    effect: '与えるダメージ' },
  { key: 'def', label: 'ぼうぎょ', base: (r) => 5 + r * 4,   max: 110,
    effect: '受けるダメージを減らす' },
  { key: 'int', label: 'かしこさ', base: (r) => 5 + r * 4,   max: 110,
    effect: '見切り。相手との差だけ与ダメージが増え、被ダメージが減る' },
  { key: 'spd', label: 'すばやさ', base: (r) => 6 + r * 4,   max: 110,
    effect: '高いほうが先に動く' },
  { key: 'dex', label: 'きようさ', base: (r) => 5 + r * 4,   max: 110,
    effect: '受け流し。一定確率で受けるダメージを大きく減らす' },
];

// ---- 常時効果のつまみ ----
const COMBAT = {
  // すべて「相手との比」で決まる。絶対値のしきい値だとランクによって
  // 効き方が変わってしまい、低ランクでは死に、高ランクでは効きすぎるため。
  spread:       0.10, // ダメージのばらつき(±10%)
  // 魔力よろい: 被ダメージのうちMPが肩代わりする割合。低いとMPが余ったまま
  // 戦闘が終わり、一定以上のMPが無意味になるので高めに取る。
  mpAbsorb:     0.55,
  insightSwing: 0.70, // 見切り: かしこさ比によるダメージ増減の振れ幅
  parryMax:     0.50, // 受け流し: きようさ比 × これ = 発生率(拮抗時はこの半分)
  parryMul:     0.35, // 受け流したときのダメージ倍率
  spdSwing:     1.50, // 追撃: すばやさ比による追加行動の起きやすさ
  spdExtraMax:  0.45,
  turnCap:      200,
};

// 系統補正。同ランクの総当たりで勝率がそろうよう数値探索で調整してある。
// MP補正だけは調整対象から外し、系統ごとの多寡をそのまま残している
// (MPが低い系統は魔力よろいが薄いという不利を負い、その埋め合わせは
//  他の6項目の底上げで行う。岩は他6項目の平均が 1.171 と最も高い)。
const FAMILIES = {
  fire:  { name: '炎', glyph: '炎', color: '#ff6b4a',   // 一撃が重いが打たれ弱い
           mod: { hp: 1.00, mp: 1.06, atk: 1.25, def: 0.95, int: 1.15, spd: 1.05, dex: 1.00 } },
  water: { name: '水', glyph: '水', color: '#4aa8ff',   // 魔力よろいが厚く粘る
           mod: { hp: 1.21, mp: 1.25, atk: 1.06, def: 1.11, int: 1.21, spd: 1.01, dex: 1.11 } },
  grass: { name: '草', glyph: '草', color: '#5fd07a',   // 守りとMPで長期戦向き
           mod: { hp: 1.18, mp: 1.20, atk: 1.03, def: 1.35, int: 1.18, spd: 1.13, dex: 1.13 } },
  // 岩はMPが薄い(0.81)。魔力よろいが短いという不利を負うぶん、
  // 他の6項目が他系統より一段高く積んである。
  rock:  { name: '岩', glyph: '岩', color: '#d0a24a',
           mod: { hp: 1.40, mp: 0.81, atk: 1.25, def: 1.35, int: 1.00, spd: 0.95, dex: 1.05 } },
  wind:  { name: '風', glyph: '風', color: '#7ee0d0',   // 追撃と受け流しで手数勝負
           mod: { hp: 1.06, mp: 1.05, atk: 1.16, def: 1.06, int: 1.16, spd: 1.51, dex: 1.41 } },
  dark:  { name: '闇', glyph: '闇', color: '#a76bff',   // 見切りで一方的に削る
           mod: { hp: 0.97, mp: 1.16, atk: 1.12, def: 0.97, int: 1.22, spd: 1.07, dex: 1.02 } },
  // 最終形態。素の補正は控えめだが、唯一すべての成長係数がSなので育てるほど突き放す。
  light: { name: '光', glyph: '光', color: '#ffd95c',
           mod: { hp: 0.98, mp: 0.91, atk: 0.98, def: 0.98, int: 0.98, spd: 0.98, dex: 0.98 } },
};

const BASE_FAMILIES = ['fire', 'water', 'grass', 'rock', 'wind'];

// =====================================================================
// スキル
// 合計値 = モンスターのレベル ÷ 2(切り捨て)。それを持っているスキルで割る。
// 1つに絞れば高レベル、2つ持てばその分1つあたりが下がる。上限はレベル10。
// =====================================================================

const SKILL_MAX = 10;

const SKILLS = {
  // ---- 素直な強化(ステータスに倍率が乗る) ----
  // 係数はスキル同士の総当たりで勝率がそろうよう数値探索で調整した。
  // 伸び幅がまちまちなのは、ダメージ式の中での効き方が違うため
  // (こうげきは二乗で効くので小さく、ぼうぎょは逓減するので大きく取る)。
  gouwan:  { name: '剛腕',   stat: 'atk', per: 0.013 },
  teppeki: { name: '鉄壁',   stat: 'def', per: 0.045 },
  idaten:  { name: '韋駄天', stat: 'spd', per: 0.030 },
  meikyou: { name: '明鏡',   stat: 'int', per: 0.030 },
  kyoku:   { name: '巨躯',   stat: 'hp',  per: 0.035 },
  masen:   { name: '魔泉',   stat: 'mp',  per: 0.055 },

  // ---- 特殊な振る舞い ----
  kaishin: { name: '会心',   k: 0.026, desc: (lv, k) => `${(lv * k * 100).toFixed(0)}% の確率で1.8倍のダメージ` },
  hangeki: { name: '反撃',   k: 0.032, desc: (lv, k) => `受け流したとき、こうげきの ${(lv * k * 100).toFixed(0)}% で反撃する` },
  kyushu:  { name: '吸収',   k: 0.036, desc: (lv, k) => `与えたダメージの ${(lv * k * 100).toFixed(0)}% だけHPが回復する` },
  // 毒は「付与確率」ではなく「毎ターンの削り量」がレベルで伸びる。
  // 確率側を伸ばすと、長期戦ではどのみち当たるので Lv.5 でほぼ満額になってしまう。
  dokuga:  { name: '毒牙',   k: 0.004, chance: 0.22,
             desc: (lv, k) => `22% の確率で毒。毒は毎ターン最大HPの ${(lv * k * 100).toFixed(1)}%` },
  fukutsu: { name: '不屈',   k: 0.085, desc: (lv, k) => `HPが1/4以下のあいだ こうげき +${(lv * k * 100).toFixed(0)}%` },
  // 「必ず先に動く」はレベルに関係なく効いてしまうので、確率で奪う形にした。
  sensei:  { name: '先制',   k: 0.016, grab: 0.09,
             desc: (lv, k) => `${(lv * 9)}% の確率ですばやさに関わらず先手を取り、追撃が出やすくなる(+${(lv * k * 100).toFixed(0)}%)` },
};

for (const [id, sk] of Object.entries(SKILLS)) {
  sk.id = id;
  if (sk.stat) {
    const label = STATS.find(st => st.key === sk.stat).label;
    sk.desc = (lv) => `${label} +${(lv * sk.per * 100).toFixed(0)}%`;
  } else {
    const raw = sk.desc;
    sk.desc = (lv) => raw(lv, sk.k);
  }
}

// 配合で親からスキルを受け継ぐ個数の割合
const SKILL_INHERIT = [0.20, 0.40, 0.40]; // 0個 / 1個 / 2個

// 4つめの文字列が成長係数(hp mp atk def int spd dex の順)。
// 5つめが「種族が本来よく持つスキル」3つ。配合で親から何も受け継がなかったとき、
// および野生・たまごの個体はここから1つ選ばれる。
// 同じ系統でも種ごとに違えてあるので、ヒノコとヴォルケインでは覚えるものが変わる。
const SPECIES = [
  ['fire',  1, 'ヒノコ',       'EECFDEE', 'gouwan kaishin idaten'],
  ['fire',  2, 'ボウフレア',   'DDBECDD', 'gouwan kaishin fukutsu'],
  ['fire',  3, 'サラマンド',   'CCADBCC', 'gouwan fukutsu dokuga'],
  ['fire',  4, 'イフリード',   'CBACABC', 'gouwan kaishin meikyou'],
  ['fire',  5, 'ヴォルケイン', 'AASBSAA', 'gouwan fukutsu kyoku'],
  ['water', 1, 'シズク',       'DCEEDEE', 'masen kyushu teppeki'],
  ['water', 2, 'アクアム',     'CBDDCDD', 'masen teppeki kyoku'],
  ['water', 3, 'リヴァイト',   'BACCBCC', 'masen kyushu meikyou'],
  ['water', 4, 'セイレーヌ',   'ASBBACB', 'masen meikyou sensei'],
  ['water', 5, 'ポセイドス',   'SSAASAA', 'masen kyushu kyoku'],
  ['grass', 1, 'フタバ',       'DDECDEE', 'teppeki kyoku kyushu'],
  ['grass', 2, 'ツタリング',   'CCEBCDD', 'teppeki dokuga hangeki'],
  ['grass', 3, 'ドリアード',   'BBDABCC', 'teppeki dokuga meikyou'],
  ['grass', 4, 'ユグドラ',     'AACSABB', 'teppeki kyoku kyushu'],
  ['grass', 5, 'ガイアルド',   'SSBSSAA', 'teppeki kyoku dokuga'],
  ['rock',  1, 'コイシ',       'CFDCFFE', 'kyoku teppeki fukutsu'],
  ['rock',  2, 'ロックル',     'BFCBEEE', 'kyoku fukutsu gouwan'],
  ['rock',  3, 'ゴーレット',   'AEBADDD', 'kyoku teppeki hangeki'],
  ['rock',  4, 'グラナイト',   'SDASCCC', 'kyoku gouwan fukutsu'],
  ['rock',  5, 'アダマス',     'SCSSBBB', 'kyoku teppeki gouwan'],
  ['wind',  1, 'ソヨカ',       'EEEEEBC', 'idaten sensei kaishin'],
  ['wind',  2, 'ウィンディ',   'EDDEDAB', 'idaten hangeki kaishin'],
  ['wind',  3, 'シルフィード', 'DCCDCSA', 'idaten sensei hangeki'],
  ['wind',  4, 'テンペスト',   'CBBCBSS', 'idaten kaishin gouwan'],
  ['wind',  5, 'ガルーダ',     'BAABASS', 'idaten sensei gouwan'],
  ['dark',  3, 'シャドウル',   'CBBCACC', 'meikyou dokuga kyushu'],
  ['dark',  4, 'ノクターン',   'CAACABB', 'meikyou kyushu sensei'],
  ['dark',  5, 'ニュクス',     'ASSASAA', 'meikyou dokuga kaishin'],
  ['light', 5, 'ルクスノヴァ', 'SSSSSSS', 'meikyou kyoku sensei'], // 唯一、全ステータスが最高位S
].map(([family, rank, name, grades, innate]) => ({
  id: family + rank, family, rank, name,
  growth: STATS.reduce((o, st, i) => (o[st.key] = grades[i], o), {}),
  innate: innate.split(' '),
}));

// 図鑑に出る一文。仕組みには一切影響しない。
const FLAVOR = {
  fire1: '燃え残りの灰から生まれる。触れると熱いが、火傷はしない。',
  fire2: '尾の火が消えているあいだは眠っている。眠りは短い。',
  fire3: '火の中を歩くのではない。歩いたところが火になる。',
  fire4: '怒りではなく、退屈で燃える。',
  fire5: '山がひとつ、立ち上がったもの。',
  water1: '水たまりの中で数を増やす。減るのも早い。',
  water2: '体の八割が水で、二割が意地。',
  water3: '川が曲がっているのは、これが通った跡だという。',
  water4: '声で水を動かす。歌ではない。',
  water5: '満ち引きに合わせて眠り、また起きる。',
  grass1: '双葉のうちは動かない。動きだしたら、もう双葉ではない。',
  grass2: '巻きついたものを離さない。離すのは枯れたときだけ。',
  grass3: '森が一本だけ、こちらを見返している。',
  grass4: '根が地脈に届いている。抜けば水が枯れる。',
  grass5: '立っているだけで、まわりが緑になる。',
  rock1: '道端にいる。蹴ると怒る。',
  rock2: '転がって移動する。止まるのは下手。',
  rock3: '誰かが積んだ形のまま、動きだした。',
  rock4: '割るには、同じだけの硬さがいる。',
  rock5: '何度も砕かれ、そのたびに密になった。',
  wind1: 'つかまえた者はいない。見た者は多い。',
  wind2: '通りすぎたあとに、においだけ残る。',
  wind3: '速すぎて、輪郭が二つに見える。',
  wind4: '近づく前に、空のほうが変わる。',
  wind5: '翼を広げると、その下だけ夜になる。',
  dark3: '影が先に動く。本体は後から追う。',
  dark4: '目を合わせた者から順に、その顔を忘れていく。',
  dark5: '光を吸っているのではない。光のほうが避けている。',
  light5: '闇を二つ重ねると、なぜか光になる。理由は誰も知らない。',
};
for (const sp of SPECIES) sp.flavor = FLAVOR[sp.id] || '';

// =====================================================================
// 成長係数(種族値)
// レベルアップでどれだけ伸びやすいかを F〜S の7段階で表す。
// 種ごとに固定で、遺伝や育て方では一切変わらない。
// 系統の得意不得意 + ランク補正で決まるため、低ランクの種は全体的に低くなる。
// =====================================================================

const GRADES = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];

// 1レベルあたりの伸びの倍率
const GRADE_MUL = { F: 0.45, E: 0.65, D: 0.85, C: 1.05, B: 1.3, A: 1.6, S: 1.95 };

// 異系統どうしの配合表(闇・光は特殊ルールで処理する)
const FUSION_TABLE = {
  'fire+water': 'wind',  'fire+grass': 'fire',  'fire+rock': 'rock',  'fire+wind': 'fire',
  'grass+water': 'grass', 'rock+water': 'water', 'water+wind': 'water',
  'grass+rock': 'grass', 'grass+wind': 'wind',
  'rock+wind': 'rock',
};

const AREAS = [
  { id: 1, name: 'はじまりの草原', rank: 1, gold: [10, 20],
    lore: '見晴らしがいいだけの草地。ここで転ぶようなら、この先はない。' },
  { id: 2, name: 'ぬかるみの沼',   rank: 2, gold: [22, 40],
    lore: '足を取られる。速さが意味を失う、最初の場所。' },
  { id: 3, name: '岩窟回廊',       rank: 3, gold: [45, 75],
    lore: '天井の裂け目から光が落ちてくる。音がよく響く。' },
  { id: 4, name: '嵐の尖塔',       rank: 4, gold: [80, 130],
    lore: '塔ではない。風がその形に立っているだけだ。' },
  { id: 5, name: '虚無の深淵',     rank: 5, gold: [150, 240],
    lore: '底がない。落ちた者の数は、誰も数えていない。' },
];

// ===== 商店 =====
// 金で買えるのは「材料と制御」だけ。ステータスそのものは売らない。
// 系統ごとの勝率も大会の相手も遺伝とレベルを基準に組んであるので、
// その外側から数値を足すと釣り合いが丸ごと崩れる。

// たまご。ランクが上がるほど高いが、遺伝は必ず0。
// 強さは配合で積むもので、金で買えるのは材料まで。
const EGG_PRICE = 60;
const EGG_TIERS = [
  { rank: 1, price: 60 },
  { rank: 2, price: 260 },
  { rank: 3, price: 950 },
];
const EGG_PICK_MUL = 2.5; // 系統を指定するときの倍率

// 配合の触媒。1回の配合につき1つずつ使える(使い切り)。
const ITEMS = {
  yamimaneki: { name: '闇招きの香', price: 320,
    desc: 'ランク3以上の異なる系統を配合したとき、25%の闇の発現を確実にする' },
  keishou:    { name: '継承の証',   price: 220,
    desc: '親からスキルを2つ受け継がせる(通常は20%で0個、40%で1個)' },
  keitou:     { name: '系統の錠',   price: 260,
    desc: '異なる系統を配合しても、子の系統を1匹目のほうに固定する' },
};

// 牧場の拡張。1段ごとに2匹分増える。
const BARN_STEPS = [500, 1200, 2800, 6400];
const BARN_BASE = 12;
const CAPTURE_RATE = 0.22;
const DARK_CHANCE = 0.25;
// 牧場の上限。あふれると育成が薄く分散して誰も育たなくなるので、
// 初期値は低く置き、金を払った分だけ広げられるようにしてある。
const ROSTER_CAP = BARN_BASE;
function rosterCap() { return BARN_BASE + (S && S.barn ? S.barn : 0) * 2; }
const PARTY_MAX = 3;   // 探索に連れて行ける数。野生も同数出る。

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
    // 指定がなければ、その種族がよく持つスキルを1つ覚えて生まれる
    skills: o.skills || [pick(sp.innate)],
    // ---- 系譜 ----
    name: o.name || null,        // つけた名前。無ければ種の名前で呼ぶ
    gen: o.gen || 1,             // 何代目か。配合するたびに1つ増える
    parents: o.parents || null,  // [{ name, sp }, { name, sp }]
    origin: o.origin || 'wild',  // wild / egg / fuse / start
  };
}

// 表示に使う呼び名。名前をつけていなければ種の名前。
function nameOf(m) { return m.name || spOf(m).name; }

// スキル合計値 = レベル ÷ 2。持っているスキルで割り、余りは先頭から配る。
function skillLevels(m) {
  const list = m.skills || [];
  if (!list.length) return [];
  const budget = Math.floor(m.level / 2);
  const base = Math.floor(budget / list.length);
  const rem = budget % list.length;
  return list.map((id, i) => ({
    id,
    skill: SKILLS[id],
    level: Math.min(SKILL_MAX, base + (i < rem ? 1 : 0)),
  }));
}

// レベル0のスキルはまだ発現していない
function activeSkills(m) {
  const out = {};
  for (const s of skillLevels(m)) {
    if (s.level > 0) out[s.id] = Math.max(out[s.id] || 0, s.level);
  }
  return out;
}

// 配合でのスキル習得: 親から0〜2個。2個なら両親から1つずつ、
// 1個ならどちらかの親から、0個なら子の種族が本来よく持つスキルから。
function inheritSkills(a, b, childSpecies, use) {
  const r = Math.random();
  // 継承の証を使えば、必ず両親から1つずつ受け継ぐ
  const n = (use && use.keishou) ? 2
    : r < SKILL_INHERIT[0] ? 0 : r < SKILL_INHERIT[0] + SKILL_INHERIT[1] ? 1 : 2;
  const from = (m) => (m.skills && m.skills.length) ? pick(m.skills) : null;

  let got = [];
  if (n === 2) got = [from(a), from(b)];
  else if (n === 1) got = [from(Math.random() < 0.5 ? a : b)];
  got = got.filter(Boolean);

  // 継承の証は金を払って使うものなので、両親から同じスキルを引いてしまったら
  // 引き直す。それでも2つにならないのは、両親のスキルが1種類しかないときだけ。
  if (use && use.keishou && new Set(got).size < 2) {
    const all = [...new Set([...(a.skills || []), ...(b.skills || [])])];
    if (all.length >= 2) {
      const first = got[0] || pick(all);
      got = [first, pick(all.filter(id => id !== first))];
    }
  }

  // 何も受け継げなかった場合は種族本来のスキルを1つ
  if (!got.length) got = [pick(childSpecies.innate)];
  return [...new Set(got)];
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
  const out = {};
  for (const st of STATS) {
    // HPとMPは伸び幅が大きい「量」のステータスなので、成長分を倍にする
    const pool = st.key === 'hp' || st.key === 'mp';
    // レベルぶんの伸びだけが成長係数(種族値)の影響を受ける。
    // 遺伝は係数と無関係にそのまま加算される。
    const growth = GRADE_MUL[sp.growth[st.key]];
    out[st.key] = Math.round(st.base(r) * mod[st.key])
      + m.gene * (pool ? 2 : 1)
      + Math.round(lv * growth * (pool ? 3 : 1));
  }
  return out;
}

function powerOf(m) {
  const s = statsOf(m);
  // HP・MPは量のステータスなので半分だけ数える
  return Math.round(s.hp / 2 + s.mp / 2 + s.atk + s.def + s.int + s.spd + s.dex);
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
// 闇が出うる組み合わせか(触媒の効き先を判定するのに使う)
function darkPossible(a, b) {
  const fa = spOf(a).family, fb = spOf(b).family;
  return fa !== fb && ra3(a) && ra3(b)
    && fa !== 'dark' && fb !== 'dark' && fa !== 'light' && fb !== 'light';
}
function ra3(m) { return spOf(m).rank >= 3; }

function fuseFamily(a, b, use) {
  const u = use || {};
  const fa = spOf(a).family, fb = spOf(b).family;
  const ra = spOf(a).rank, rb = spOf(b).rank;
  if (fa === 'dark' && fb === 'dark' && ra >= 4 && rb >= 4) return 'light';
  if (fa === 'light' || fb === 'light') return 'light';
  if (fa === 'dark' || fb === 'dark') return 'dark';
  if (fa === fb) return fa;
  // 系統の錠。異系統でも1匹目の系統を受け継ぐ(闇の抽選も起きない)
  if (u.keitou) return fa;
  if (ra >= 3 && rb >= 3 && (u.yamimaneki || Math.random() < DARK_CHANCE)) return 'dark';
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

function fuse(a, b, use) {
  const family = fuseFamily(a, b, use);
  const rank = fuseRank(a, b, family);
  const sp = speciesFor(family, rank);
  return makeMonster(sp.id, {
    gene: fuseGene(a, b),
    skills: inheritSkills(a, b, sp, use),
    // 系譜。代は「親の深いほう + 1」で数える。
    gen: Math.max(a.gen || 1, b.gen || 1) + 1,
    parents: [{ name: nameOf(a), sp: a.sp }, { name: nameOf(b), sp: b.sp }],
    origin: 'fuse',
  });
}

// 実行前に見せる予測。闇が出うる組み合わせは伏せる。
function previewFusion(a, b, use) {
  const u = use || {};
  const fa = spOf(a).family, fb = spOf(b).family;
  const ra = spOf(a).rank, rb = spOf(b).rank;
  // 触媒で確定するなら、もう「もしかしたら」ではない
  const surprise = darkPossible(a, b) && !u.yamimaneki && !u.keitou;

  // 予測表示では闇の抽選を外した確定ルートを示す
  let family;
  if (fa === 'dark' && fb === 'dark' && ra >= 4 && rb >= 4) family = 'light';
  else if (fa === 'light' || fb === 'light') family = 'light';
  else if (fa === 'dark' || fb === 'dark') family = 'dark';
  else if (fa === fb) family = fa;
  else if (u.keitou) family = fa;
  else if (u.yamimaneki && ra >= 3 && rb >= 3) family = 'dark';
  else family = FUSION_TABLE[fusionKey(fa, fb)];

  const rank = fuseRank(a, b, family);
  return { species: speciesFor(family, rank), gene: fuseGene(a, b), surprise };
}

// =====================================================================
// 戦闘・探索
// =====================================================================

// 戦闘用の状態を作る。ステータス強化系のスキルはここで数値に織り込む。
function combatant(m) {
  const s = statsOf(m);
  const sk = activeSkills(m);
  for (const [id, lv] of Object.entries(sk)) {
    const def = SKILLS[id];
    if (def.stat) s[def.stat] = Math.round(s[def.stat] * (1 + def.per * lv));
  }
  return { name: spOf(m).name, ...s, maxHp: s.hp, maxMp: s.mp, sk, poison: 0 };
}

// 1回の攻撃。7ステータスとスキルがすべて常時効果として噛み合う。
function strike(atk, dfn, log) {
  // 不屈: 追い詰められているあいだ こうげきが上がる
  let power = atk.atk;
  if (atk.sk.fukutsu && atk.hp <= atk.maxHp / 4) power *= 1 + atk.sk.fukutsu * SKILLS.fukutsu.k;

  // ぼうぎょ: こうげきとの比で軽減する(逓減するので硬さが無敵にならない)
  let dmg = power * power / (power + dfn.def);
  dmg *= 1 + ri(-100, 100) / 100 * COMBAT.spread;

  // 見切り: かしこさの比で通り方が変わる
  const intTotal = atk.int + dfn.int;
  dmg *= 1 + (intTotal ? (atk.int - dfn.int) / intTotal : 0) * COMBAT.insightSwing;
  dmg = Math.max(1, Math.round(dmg));

  // 会心: 一定確率で大きく入る
  const crit = atk.sk.kaishin && Math.random() < atk.sk.kaishin * SKILLS.kaishin.k;
  if (crit) dmg = Math.round(dmg * 1.8);

  // 受け流し: きようさの比に応じた確率で大きく軽減
  const dexTotal = atk.dex + dfn.dex;
  const parried = Math.random() < COMBAT.parryMax * (dexTotal ? dfn.dex / dexTotal : 0.5);
  if (parried) dmg = Math.max(1, Math.round(dmg * COMBAT.parryMul));

  // 魔力よろい: MPが残っていれば一部を肩代わりする
  let absorbed = 0;
  if (dfn.mp > 0) {
    absorbed = Math.min(dfn.mp, Math.round(dmg * COMBAT.mpAbsorb));
    dfn.mp -= absorbed;
    dmg -= absorbed;
  }

  dfn.hp -= dmg;

  let note = '';
  if (crit) note += ' [会心]';
  if (parried) note += ' [受け流し]';
  if (absorbed > 0) note += ` [MPが${absorbed}肩代わり]`;
  else if (dfn.mp <= 0) note += ' [MP切れ]';

  // 吸収: 与えたダメージの一部を回復する
  if (atk.sk.kyushu && dmg > 0) {
    const heal = Math.max(1, Math.round(dmg * atk.sk.kyushu * SKILLS.kyushu.k));
    atk.hp = Math.min(atk.maxHp, atk.hp + heal);
    note += ` [${heal}吸収]`;
  }

  // 反撃: 受け流しに成功したら、こうげきの一部を返す
  if (parried && dfn.sk.hangeki && atk.hp > 0) {
    const back = Math.max(1, Math.round(dfn.atk * dfn.sk.hangeki * SKILLS.hangeki.k));
    atk.hp -= back;
    note += ` [反撃${back}]`;
  }

  // 毒牙: 一定確率で毒を与える(毎ターン最大HPを削る)
  if (atk.sk.dokuga && !dfn.poison && Math.random() < SKILLS.dokuga.chance) {
    dfn.poison = atk.sk.dokuga; // 与えた側のレベルを覚えておき、削り量に使う
    note += ' [毒]';
  }

  log.push(`${atk.name} の攻撃 → ${dmg} ダメージ${note}(${dfn.name} 残り ${Math.max(0, dfn.hp)})`);
}

// モンスターでも、すでに組み立てた戦闘用の駒でも受け取る。
// 駒をそのまま渡すと、HPやMPが減った状態から続けて戦える(大会の勝ち抜き戦で使う)。
function asSide(x) {
  return (Array.isArray(x) ? x : [x]).map(c => (c.maxHp != null ? c : combatant(c)));
}

function battle(a, b) {
  const A = asSide(a);
  const B = asSide(b);
  const log = [];
  const living = (side) => side.filter(c => c.hp > 0);

  for (let round = 0; round < COMBAT.turnCap && living(A).length && living(B).length; round++) {
    // 行動順。すばやさを速度とする競争にしているので、
    // 先に動ける確率がすばやさの比とちょうど一致する(1対1のときの挙動と同じ)。
    const order = [
      ...living(A).map(c => ({ c, foes: B })),
      ...living(B).map(c => ({ c, foes: A })),
    ];
    for (const o of order) {
      const grabbed = o.c.sk.sensei && Math.random() < o.c.sk.sensei * SKILLS.sensei.grab;
      o.key = grabbed ? -Infinity : -Math.log(Math.random() || 1e-9) / Math.max(1, o.c.spd);
    }
    order.sort((x, y) => x.key - y.key);

    for (const o of order) {
      if (o.c.hp <= 0) continue;
      const foes = living(o.foes);
      if (!foes.length) break;

      // 毒: 行動する前に最大HPを削られる
      if (o.c.poison) {
        const tick = Math.max(1, Math.round(o.c.maxHp * o.c.poison * SKILLS.dokuga.k));
        o.c.hp -= tick;
        log.push(`${o.c.name} は毒で ${tick} のダメージ(残り ${Math.max(0, o.c.hp)})`);
        if (o.c.hp <= 0) { log.push(`${o.c.name} は倒れた`); continue; }
      }

      const target = pick(foes);
      strike(o.c, target, log);
      if (target.hp <= 0) { log.push(`${target.name} は倒れた`); continue; }

      // 追撃: 狙った相手よりすばやさが上回っているほど出やすい
      const spdTotal = o.c.spd + target.spd;
      let extra = clamp((o.c.spd - target.spd) / (spdTotal || 1) * COMBAT.spdSwing,
        0, COMBAT.spdExtraMax);
      if (o.c.sk.sensei) extra = Math.min(COMBAT.spdExtraMax, extra + o.c.sk.sensei * SKILLS.sensei.k);
      if (Math.random() < extra) {
        strike(o.c, target, log);
        if (target.hp <= 0) log.push(`${target.name} は倒れた`);
      }
    }
  }

  const hpLeft = (side) => side.reduce((t, c) => t + Math.max(0, c.hp), 0);
  const hpMax = (side) => side.reduce((t, c) => t + c.maxHp, 0);
  const aDown = !living(A).length, bDown = !living(B).length;
  if (!aDown && !bDown) {
    log.push('決着がつかず、消耗の少ないほうの判定勝ち');
    return { win: hpLeft(A) / hpMax(A) >= hpLeft(B) / hpMax(B), log, downed: A.filter(c => c.hp <= 0).length, A, B };
  }
  return { win: bDown && !aDown, log, downed: A.filter(c => c.hp <= 0).length, A, B };
}

function wildFor(area) {
  const sp = pick(speciesOfRank(area.rank));
  return makeMonster(sp.id, {
    level: Math.max(1, area.rank * 2 - 1),
    gene: (area.rank - 1) * 2,
  });
}

// 1回の探索を解決し、結果をまとめて返す(状態の書き換えは呼び出し側)。
// 野生はこちらと同数出るので、経験値を山分けしても1匹あたりの取り分は変わらない。
function explore(party, area, canCapture) {
  const team = Array.isArray(party) ? party : [party];
  const wilds = team.map(() => wildFor(area));
  const res = battle(team, wilds);
  const out = {
    wilds,
    win: res.win,
    log: res.log,
    downed: res.downed,
    exp: 0, gold: 0, levelUps: 0, captured: null, missedCapture: false,
  };
  const expOf = (w) => spOf(w).rank * 20 + w.level * 4;
  const total = wilds.reduce((t, w) => t + expOf(w), 0);
  if (res.win) {
    out.exp = total;
    out.gold = ri(area.gold[0], area.gold[1]);
    if (Math.random() < CAPTURE_RATE) {
      if (canCapture === false) out.missedCapture = true;
      else {
        const w = pick(wilds);
        out.captured = makeMonster(w.sp, { level: 1, gene: w.gene, skills: w.skills.slice(), origin: 'wild' });
      }
    }
  } else {
    out.exp = Math.floor(total / 3);
    out.gold = Math.floor(ri(area.gold[0], area.gold[1]) / 4);
  }
  return out;
}

function areaUnlocked(area, monsters) {
  if (area.rank <= 1) return true;
  return monsters.some(m => spOf(m).rank >= area.rank - 1);
}

// =====================================================================
// 大会
//
// 探索との違いはひとつだけで、「回戦のあいだHPとMPが持ち越される」こと。
// 倒れた仲間もその大会のあいだは戻らない。
// 1戦だけ強い編成では勝ち抜けないので、探索とは別の物差しがはたらく
// (一撃の重さより、削られにくさと立て直しの効くスキルが要る)。
// =====================================================================

// つまみ。相手は毎回戦まっさらな状態で出てくるのに対し、こちらは削られたまま
// 進むので、1回戦あたりの相手は探索の野生より弱く置かないと釣り合わない。
const CUP = {
  entry: 3,    // 出場できる数。相手も常にこの数だけ出てくる。
  // 回戦のあいだの回復。MPは休めば張り直せるが、傷は残る。
  // HPを丸ごと持ち越すと消耗が一方的に積もって誰も勝てず、逆に両方戻すと
  // ただの探索5連戦になる。MPだけ全快させると、系統ごとの差も縮んで収まった。
  heal:   0.25, // 回戦のあいだにHPが戻る割合(最大値に対して)
  mpHeal: 1.00, // 同じくMP
  lv0:   0.35, // 一回戦の相手のレベル(そのランクの上限に対する割合)
  lv1:   0.95, // 決勝の相手のレベル
  g0:    0.40, // 一回戦の相手の遺伝(こちらの平均に対する割合)
  // 決勝の相手はこちらと同じところまで配合を詰めてくる(遺伝 +0)。
  // それでも五分にならないのは、傷を持ち越すのがこちらだけだから。
  // ここを倍率での上乗せにすると、遺伝に上限が無いせいで代を重ねるほど
  // 差額まで膨らみ、育てるほど優勝しにくくなってしまう。
  geneEdge: 0,
};

// 配合を重ねきった個体の遺伝。相手の強さの基準に使う。
function geneCap(rank) { return (rank - 1) * 4; }

// 上の大会ほど回戦が多く、上の大会ほど難しい。同ランクを育てきった3匹での
// 優勝率は実測で 新芽52 / 沼地61 / 岩窟49 / 尖塔42 / 虚無31 %。
// 相手はこちらの編成に合わせて作られるので、この数字は何代重ねても変わらない。
const CUPS = [
  { id: 1, name: '新芽杯', rank: 1, rounds: 2, prize: 150 },
  { id: 2, name: '沼地杯', rank: 2, rounds: 3, prize: 420 },
  { id: 3, name: '岩窟杯', rank: 3, rounds: 4, prize: 1000 },
  { id: 4, name: '尖塔杯', rank: 4, rounds: 4, prize: 2200 },
  { id: 5, name: '虚無杯', rank: 5, rounds: 5, prize: 5000 },
];

// 各大会の決勝には、決まったマスターが待っている。
// 手持ちの1匹だけが固定で、残り2匹はその大会の相手と同じ作られ方をする。
// 強さそのものは他の相手と変わらない(こちらの編成に合わせて組まれる)ので、
// ライバルは難度ではなく「顔」を足すためのもの。
const RIVALS = {
  1: { name: 'ミル',   title: '草原の子',
       ace: 'grass1',
       before: '「その子、つよそう。……でもうちのフタバも、まけないよ」',
       again:  '「またきた! こんどはまけないから」',
       win:    '「……つよいね。どうやったら、そんなに強くなるの?」',
       lose:   '「やった! フタバ、すごいすごい!」',
       after:  'いちばん最初に会う子。フタバしか持っていないし、それでいいと思っている。' },
  2: { name: 'ガイ',   title: '沼守り',
       ace: 'water2',
       before: '「沼の水は重い。ここで走れると思うな」',
       again:  '「二度目だ。水のほうは、おまえを覚えているぞ」',
       win:    '「……沈まなかったか。行け」',
       lose:   '「浅かったな」',
       after:  '沼に人を通す仕事をしている。通す相手は自分で選ぶ。' },
  3: { name: 'ドロテ', title: '石工',
       ace: 'rock3',
       before: '「石は急がない。急ぐのはいつも、そっちだ」',
       again:  '「もう一度、叩いてみるか」',
       win:    '「割れたか。……いい打ち方だった」',
       lose:   '「削れなかったな」',
       after:  '岩窟の柱を積んだ本人。ゴーレットは積み残しから生まれたものだという。' },
  4: { name: 'セレン', title: '嵐読み',
       ace: 'wind4',
       before: '「風はもう読んだ。あなたがどう動くかも」',
       again:  '「今度こそ、読みきる」',
       win:    '「読み違えた。……久しぶりだ、この感じ」',
       lose:   '「読んだとおり」',
       after:  '尖塔がいつ崩れるかを見張っている。まだ崩れていない。' },
  5: { name: 'ノア',   title: '深淵の',
       ace: 'light5',
       before: '「ここまで来たか。……この子も、あなたと同じだけ代を重ねている」',
       again:  '「まだ足りない。もう一度、並んでみせろ」',
       win:    '「……越えたのか。ならば、この光はあなたのものだ」',
       lose:   '「深淵は、覗き返す」',
       after:  '闇を二つ重ねて光にした最初の一人。以来ずっと深淵の底に座っている。' },
};

function rivalOf(cup) { return RIVALS[cup.id] || null; }

function cupUnlocked(cup, monsters) {
  return monsters.some(m => spOf(m).rank >= cup.rank);
}

function roundName(i, total) {
  if (i === total - 1) return '決勝';
  if (i === total - 2) return '準決勝';
  return ['一回戦', '二回戦', '三回戦', '四回戦'][i] || `${i + 1}回戦`;
}

// 出場者の顔ぶれは、こちらの編成に合わせて決まる。
//
// 遺伝には上限が無い。上限まで育てたランク5どうしを配合するたびに +10 され、
// 5代目には遺伝60(総合力950前後)まで伸びる。相手を固定値で置くと、
// 数代重ねただけで置いていかれて大会が作業になってしまう。
// そこで「こちらの編成の平均」を基準にし、回戦が進むほどそこへ近づける。
//
// 下限は大会のランク相応の強さで、弱い個体で出ても相手は手を抜かない
// (わざと格下で出て賞金だけ取る、ができないようにするため)。
// レベルは相手自身のランクの上限で頭打ちになるので、格上の編成で
// 下位の大会に出れば、これまでどおり楽に勝てる。
function cupFoes(cup, i, party) {
  const team = party && party.length ? party : null;
  const avg = (f) => team ? team.reduce((s, m) => s + f(m), 0) / team.length : 0;
  const baseLv = Math.max(6 + cup.rank * 3, avg(m => m.level));
  const baseGene = Math.max(geneCap(cup.rank), avg(m => m.gene));

  const t = cup.rounds > 1 ? i / (cup.rounds - 1) : 1;
  const lvRate = CUP.lv0 + (CUP.lv1 - CUP.lv0) * t;
  // 一回戦は baseGene の g0 倍から始まり、決勝で baseGene + geneEdge になる
  const gene0 = baseGene * CUP.g0, gene1 = baseGene + CUP.geneEdge;
  const pool = speciesOfRank(cup.rank).filter(s => s.family !== 'light');
  // 決勝にはライバルが自分の1匹を連れてくる
  const rival = i === cup.rounds - 1 ? rivalOf(cup) : null;

  return Array.from({ length: CUP.entry }, (_, k) => {
    const sp = (rival && k === 0) ? speciesById(rival.ace) : pick(pool);
    const cap = maxLevelOf({ sp: sp.id });
    return makeMonster(sp.id, {
      level: clamp(Math.round(baseLv * lvRate), 1, cap),
      gene: Math.round(gene0 + (gene1 - gene0) * t),
      name: (rival && k === 0) ? `${rival.name}の${sp.name}` : null,
    });
  });
}

// 大会をひととおり解決して結果を返す(状態の書き換えは呼び出し側)。
function runCup(party, cup) {
  const team = Array.isArray(party) ? party : [party];
  const mine = team.map(combatant);
  const rounds = [];

  for (let i = 0; i < cup.rounds; i++) {
    const alive = mine.filter(c => c.hp > 0);
    if (!alive.length) break;

    const foes = cupFoes(cup, i, team);
    const res = battle(alive, foes);
    rounds.push({
      name: roundName(i, cup.rounds),
      foes,
      win: res.win,
      log: res.log,
      // 何匹残って次へ進んだか
      standing: mine.filter(c => c.hp > 0).map(c => ({ name: c.name, hp: Math.max(0, c.hp), maxHp: c.maxHp })),
    });
    if (!res.win) break;

    // 次の回戦へ。倒れた仲間は戻らないが、立っている者は少しだけ回復する。
    for (const c of mine) {
      if (c.hp <= 0) continue;
      c.hp = Math.min(c.maxHp, c.hp + Math.round(c.maxHp * CUP.heal));
      c.mp = Math.min(c.maxMp, c.mp + Math.round(c.maxMp * CUP.mpHeal));
      c.poison = 0; // 毒は回戦をまたがない
    }
  }

  const cleared = rounds.length === cup.rounds && rounds[rounds.length - 1].win;
  const won = rounds.filter(r => r.win).length;
  return {
    cup, rounds, cleared, won,
    // 決勝まで行ったかどうかで、ライバルの台詞が出るかが決まる
    metRival: rounds.length === cup.rounds,
    // 優勝すれば満額。途中敗退でも勝った回戦のぶんだけ持ち帰れる。
    gold: cleared ? cup.prize : Math.floor(cup.prize * 0.15 * won),
    exp: Math.round((cup.rank * 25 + 40) * (won + (cleared ? 2 : 0))),
    survivors: mine.filter(c => c.hp > 0).length,
  };
}

// =====================================================================
// 状態
// =====================================================================

const SAVE_KEY = 'monstermaster.v1';

let S = null;
let UI = {
  tab: 'ranch', picks: [], area: 1, party: [], result: null, open: null,
  cup: 1, cupTeam: [], cupResult: null,
  eggFamily: null, use: {},
  born: null, bornNew: false, // 直前に配合で生まれた子(配合タブに留まったまま結果を見せる)
  order: null,                // 表示順(uidの配列)。null なら次の描画で強さ順に並べ直す
};

function newState() {
  const fams = BASE_FAMILIES.slice();
  const starters = [];
  for (let i = 0; i < 3; i++) {
    const f = fams.splice(ri(0, fams.length - 1), 1)[0];
    starters.push(makeMonster(f + '1', { origin: 'start' }));
  }
  return {
    gold: 0,
    monsters: starters,
    dex: starters.reduce((d, m) => (d[m.sp] = true, d), {}),
    fuseCount: 0,
    exploreCount: 0,
    cups: {},      // 大会ID → { best: 到達した最高の回戦数, won: 優勝したか }
    cupCount: 0,
    rivals: {},    // 大会ID → { met: 決勝で会ったか, beaten: 勝ったか, losses: 負けた回数 }
    items: {},     // 触媒ID → 個数
    barn: 0,       // 牧場を広げた回数
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
    // スキル導入前のセーブデータには、種族本来のスキルを1つ持たせる
    for (const m of d.monsters) {
      m.skills = (m.skills || []).filter(id => SKILLS[id]);
      if (!m.skills.length) m.skills = [pick(speciesById(m.sp).innate)];
      // 系譜の導入前のセーブデータ。血筋は分からないので1代目として扱う。
      if (m.name === undefined) m.name = null;
      if (!m.gen) m.gen = 1;
      if (m.parents === undefined) m.parents = null;
      if (!m.origin) m.origin = 'wild';
    }
    return {
      gold: d.gold || 0,
      monsters: d.monsters,
      dex: d.dex || {},
      fuseCount: d.fuseCount || 0,
      exploreCount: d.exploreCount || 0,
      cups: d.cups || {},
      cupCount: d.cupCount || 0,
      rivals: d.rivals || {},
      items: d.items || {},
      barn: Math.min(BARN_STEPS.length, d.barn || 0),
    };
  } catch (e) { return null; }
}

// =====================================================================
// 行動(状態を変える操作)
// =====================================================================

// use に指定した触媒を消費して配合する。持っていないものは黙って無視する。
function doFuse(a, b, use) {
  const spent = {};
  for (const id of Object.keys(use || {})) {
    if (use[id] && ITEMS[id] && (S.items[id] || 0) > 0) {
      S.items[id]--;
      spent[id] = true;
    }
  }
  const child = fuse(a, b, spent);
  S.monsters = S.monsters.filter(m => m.uid !== a.uid && m.uid !== b.uid);
  S.monsters.push(child);
  S.fuseCount++;
  const isNew = discover(child.sp);
  return { child, isNew, spent };
}

function rosterFull() { return S.monsters.length >= rosterCap(); }

function doExplore(party, area) {
  const team = Array.isArray(party) ? party : [party];
  const out = explore(team, area, !rosterFull());
  S.gold += out.gold;

  // 経験値は参加した全員で山分け(倒れた仲間も受け取る)
  const share = Math.max(1, Math.floor(out.exp / team.length));
  out.gains = team.map(m => {
    const ups = gainExp(m, share);
    out.levelUps += ups;
    return { name: spOf(m).name, exp: share, ups };
  });

  if (out.captured) {
    S.monsters.push(out.captured);
    out.capturedIsNew = discover(out.captured.sp);
  }
  S.exploreCount++;
  return out;
}

function doCup(party, cup) {
  const team = Array.isArray(party) ? party : [party];
  const out = runCup(team, cup);
  S.gold += out.gold;

  const share = Math.max(1, Math.floor(out.exp / team.length));
  out.gains = team.map(m => {
    const ups = gainExp(m, share);
    out.levelUps = (out.levelUps || 0) + ups;
    return { name: spOf(m).name, exp: share, ups };
  });
  out.share = share;

  const rec = S.cups[cup.id] || { best: 0, won: false };
  out.newRecord = out.won > rec.best || (out.cleared && !rec.won);
  out.firstWin = out.cleared && !rec.won;
  S.cups[cup.id] = { best: Math.max(rec.best, out.won), won: rec.won || out.cleared };
  S.cupCount++;

  // ライバルとのやりとり。決勝まで行けなければ会えない。
  const rival = rivalOf(cup);
  if (rival) {
    const rr = S.rivals[cup.id] || { met: false, beaten: false, losses: 0 };
    out.rival = rival;
    out.rivalFirstMeet = out.metRival && !rr.met;
    out.rivalFirstWin = out.cleared && !rr.beaten;
    if (out.metRival && !out.cleared) rr.losses++;
    S.rivals[cup.id] = {
      met: rr.met || out.metRival,
      beaten: rr.beaten || out.cleared,
      losses: rr.losses,
    };
  }
  return out;
}

// 系統を選んだたまごは割高。遺伝は必ず0で、強さは配合で積むことになる。
function eggPrice(rank, family) {
  const tier = EGG_TIERS.find(t => t.rank === rank) || EGG_TIERS[0];
  return Math.round(tier.price * (family ? EGG_PICK_MUL : 1));
}

function doBuyEgg(rank, family) {
  const r = EGG_TIERS.some(t => t.rank === rank) ? rank : 1;
  const f = (family && BASE_FAMILIES.includes(family)) ? family : null;
  const price = eggPrice(r, f);
  if (S.gold < price || rosterFull()) return null;
  S.gold -= price;
  const m = makeMonster((f || pick(BASE_FAMILIES)) + r, { origin: 'egg' });
  S.monsters.push(m);
  const isNew = discover(m.sp);
  return { monster: m, isNew, price };
}

function doBuyItem(id) {
  const it = ITEMS[id];
  if (!it || S.gold < it.price) return null;
  S.gold -= it.price;
  S.items[id] = (S.items[id] || 0) + 1;
  return { item: it, count: S.items[id] };
}

function barnPrice() {
  return S.barn < BARN_STEPS.length ? BARN_STEPS[S.barn] : null;
}

function doExpandBarn() {
  const price = barnPrice();
  if (price == null || S.gold < price) return null;
  S.gold -= price;
  S.barn++;
  return { cap: rosterCap(), price };
}

// 名前をつける。空にすれば種の名前に戻る。
function doRename(mon, name) {
  const n = String(name == null ? '' : name).trim().slice(0, 12);
  mon.name = n || null;
  return mon.name;
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

// =====================================================================
// ドット絵
//
// 種ごとの姿を 15×15 の格子で生成する。画像ファイルは持たず、
// 種IDを種にした乱数から形を決めるので、同じ種はいつ見ても同じ姿になる。
// セーブにも何も足さない。
// =====================================================================

const SPRITE_N = 15;
const SPRITE_SCALE = 4; // 1マスあたりの実ピクセル

// 種ID → 乱数の種
function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 0=空 1=地 2=光(上端) 3=影(下端) 4=目
function spriteGrid(speciesId) {
  const sp = speciesById(speciesId);
  const R = seededRng(seedOf(speciesId));
  const N = SPRITE_N;
  const g = Array.from({ length: N }, () => new Array(N).fill(0));
  // 左右対称に置く。片側だけ決めて折り返す。
  const put = (x, y, v) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    g[y][x] = v; g[y][N - 1 - x] = v;
  };
  const mid = (N - 1) / 2;

  // --- 胴体 ---
  // ランクが上がるほど大きく、行ごとの幅を揺らして輪郭を崩す
  const top = 4 - Math.min(2, Math.floor(sp.rank / 2));
  const bottom = N - 2;
  const rad = (bottom - top) / 2;
  const maxHalf = 2.4 + sp.rank * 0.42;
  for (let y = top; y <= bottom; y++) {
    const ty = (y - (top + bottom) / 2) / rad;
    const base = Math.sqrt(Math.max(0, 1 - ty * ty)) * maxHalf;
    const half = Math.round(base * (0.72 + R() * 0.55));
    for (let x = 0; x <= half; x++) put(mid - x, y, 1);
  }

  // --- 系統ごとの付属物 ---
  const n = 1 + Math.floor(sp.rank / 2);
  if (sp.family === 'fire' || sp.family === 'light') {
    // 上へ噴く
    for (let i = 0; i <= n; i++) {
      const x = mid - i * 2;
      const h = 1 + Math.floor(R() * (2 + sp.rank * 0.5));
      for (let k = 0; k < h; k++) put(x, top - 1 - k, 1);
    }
  } else if (sp.family === 'grass') {
    // 左右対称の葉
    for (let i = 0; i < n + 1; i++) {
      put(mid - 1 - i, top - 1, 1);
      put(mid - 2 - i, top - 2, 1);
    }
  } else if (sp.family === 'water') {
    // 下へ伸びる鰭
    for (let i = 0; i < n + 1; i++) {
      const x = mid - i * 2 - 1;
      for (let k = 0; k < 1 + Math.floor(R() * 2); k++) put(x, bottom + 1 + k, 1);
    }
  } else if (sp.family === 'wind') {
    // 横へ張る翼
    for (let i = 0; i < n + 1; i++) {
      const y = mid - 1 + i;
      for (let k = 0; k < 2 + Math.floor(R() * 2); k++) put(1 + k, y, 1);
    }
  } else if (sp.family === 'rock') {
    // 角ばった突起
    for (let i = 0; i < n + 2; i++) {
      const y = top + 1 + Math.floor(R() * (bottom - top - 1));
      put(mid - Math.round(2 + R() * 3), y, 1);
    }
  } else {
    // 闇: 上へ伸びる角
    for (let i = 0; i < n + 1; i++) {
      const x = mid - 1 - i;
      put(x, top - 1, 1); if (i % 2 === 0) put(x - 1, top - 2, 1);
    }
  }

  // --- 陰影 ---
  // 上が空いていれば光、下が空いていれば影。ドット絵の立体感はこれだけで出る。
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y][x] !== 1) continue;
    if (y === 0 || g[y - 1][x] === 0) g[y][x] = 2;
    else if (y === N - 1 || g[y + 1][x] === 0) g[y][x] = 3;
  }

  // --- 目 ---
  // 胴体の上のほう。埋まっているマスにしか置かない。
  const eyeRow = top + 1 + Math.floor((bottom - top) * (0.22 + R() * 0.18));
  const wide = sp.rank >= 3 ? 2 : 1;
  for (let row = eyeRow; row <= eyeRow + 1; row++) {
    if (g[row] && g[row][mid - wide] && g[row][mid - wide] !== 4) {
      put(mid - wide, row, 4);
      break;
    }
  }
  return g;
}

// 生成した絵を data URL にして覚えておく。行の描き直しのたびに作らない。
const _spriteCache = {};
function spriteURL(speciesId) {
  if (speciesId in _spriteCache) return _spriteCache[speciesId];
  let url = null;
  try {
    const cv = document.createElement('canvas');
    if (cv.getContext) {                       // テスト用のDOM代替には canvas が無い
      const N = SPRITE_N, u = SPRITE_SCALE;
      cv.width = N * u; cv.height = N * u;
      const ctx = cv.getContext('2d');
      const c = FAMILIES[speciesById(speciesId).family].color;
      const tone = { 1: shadeColor(c, 1.0), 2: shadeColor(c, 1.32), 3: shadeColor(c, 0.62), 4: '#0b0f1a' };
      const g = spriteGrid(speciesId);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const v = g[y][x];
        if (!v) continue;
        ctx.fillStyle = tone[v];
        ctx.fillRect(x * u, y * u, u, u);
      }
      url = cv.toDataURL();
    }
  } catch (e) { url = null; }
  _spriteCache[speciesId] = url;
  return url;
}

function shadeColor(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16 & 255)},${f(n >> 8 & 255)},${f(n & 255)})`;
}

function emblem(m, size) {
  const f = famOf(m);
  const n = el('div', 'emblem' + (size ? ' ' + size : ''));
  n.style.setProperty('--fc', f.color);
  const url = spriteURL(m.sp);
  if (url) {
    n.classList.add('has-sprite');
    n.style.backgroundImage = `url(${url})`;
  } else {
    n.textContent = f.glyph; // canvas が使えない環境では系統の字に戻す
  }
  return n;
}

// 一覧は強さ順。ただし毎回並べ替えると、探索を連打している最中に
// レベルアップや捕獲で順位が入れ替わり、指の下で行がずれて誤タップになる。
// そのため並べ替えは節目(タブ切替・配合・購入・にがす)でだけ行い、
// 探索中は順序を保ったまま、新しい仲間を末尾に足していく。
function resort() { UI.order = null; }

function roster() {
  const byUid = new Map(S.monsters.map(m => [m.uid, m]));
  if (!UI.order) {
    UI.order = S.monsters.slice()
      .sort((a, b) => (powerOf(b) - powerOf(a)) || (a.uid - b.uid))
      .map(m => m.uid);
  } else {
    const kept = UI.order.filter(u => byUid.has(u));
    const seen = new Set(kept);
    for (const m of S.monsters) if (!seen.has(m.uid)) kept.push(m.uid);
    UI.order = kept;
  }
  return UI.order.map(u => byUid.get(u));
}

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
  name.appendChild(el('span', null, nameOf(m)));
  name.appendChild(el('span', 'rank', rankLabel(spOf(m).rank)));
  // 名前をつけていれば、種の名前は小さく添える
  if (m.name) name.appendChild(el('span', 'mon-species', spOf(m).name));
  main.appendChild(name);
  const cap = maxLevelOf(m);
  main.appendChild(el('div', 'mon-sub',
    `Lv.${m.level}${m.level >= cap ? '(最大)' : ''} ・ 遺伝 +${m.gene}` +
    ((m.gen || 1) > 1 ? ` ・ ${m.gen}代目` : '')));
  const sk = el('div', 'mon-skills');
  for (const s of skillLevels(m)) {
    sk.appendChild(el('span', 'chip-skill' + (s.level ? '' : ' is-dormant'),
      `${s.skill.name}${s.level || '—'}`));
  }
  main.appendChild(sk);
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

// その種がいちばん伸びるステータスを2つ、配合の判断材料として見せる
function topGrowth(sp, n) {
  return STATS.slice()
    .sort((a, b) => GRADES.indexOf(sp.growth[b.key]) - GRADES.indexOf(sp.growth[a.key]))
    .slice(0, n);
}

function growthLine(sp) {
  const line = el('div', 't3');
  line.appendChild(el('span', null, '成長 '));
  topGrowth(sp, 2).forEach((st, i) => {
    if (i) line.appendChild(el('span', null, ' ・ '));
    line.appendChild(el('span', null, st.label));
    line.appendChild(el('span', 'g g-' + sp.growth[st.key], sp.growth[st.key]));
  });
  return line;
}

function statBlock(m) {
  const s = statsOf(m);
  const f = famOf(m);
  const wrap = el('div', 'stats');
  for (const st of STATS) {
    const v = s[st.key];
    const g = spOf(m).growth[st.key];
    const r = el('div', 'stat-row');
    r.appendChild(el('span', 'k', st.label));
    r.appendChild(el('span', 'v', String(v)));
    r.appendChild(el('span', 'g g-' + g, g));
    const meter = el('div', 'meter');
    const fill = el('i');
    fill.style.width = clamp(v / st.max * 100, 4, 100) + '%';
    meter.style.setProperty('--fc', f.color);
    meter.appendChild(fill);
    r.appendChild(meter);
    wrap.appendChild(r);
  }
  return wrap;
}

// --------------------------------------------- 商店(牧場タブの中)
// 売っているのは材料と制御だけ。ステータスそのものは売らない。
function shopPanel() {
  const shop = el('div', 'panel');
  const sh = el('div', 'head');
  sh.appendChild(el('h2', null, '商店'));
  sh.appendChild(el('span', 'note', `${S.gold} G`));
  shop.appendChild(sh);

  // ---- たまご ----
  shop.appendChild(el('div', 'shop-label', 'たまご'));
  const fams = BASE_FAMILIES.filter(f => SPECIES.some(sp => sp.family === f && S.dex[sp.id]));
  if (UI.eggFamily && !fams.includes(UI.eggFamily)) UI.eggFamily = null;

  const chips = el('div', 'chips');
  const any = el('button', 'chip' + (UI.eggFamily ? '' : ' is-on'));
  any.appendChild(el('span', null, 'おまかせ'));
  any.addEventListener('click', () => { UI.eggFamily = null; render(); });
  chips.appendChild(any);
  for (const f of fams) {
    const b = el('button', 'chip' + (UI.eggFamily === f ? ' is-on' : ''));
    b.appendChild(el('span', null, FAMILIES[f].name));
    b.appendChild(el('span', 'r', `×${EGG_PICK_MUL}`));
    b.addEventListener('click', () => { UI.eggFamily = UI.eggFamily === f ? null : f; render(); });
    chips.appendChild(b);
  }
  shop.appendChild(chips);

  const eggs = el('div', 'shop-grid');
  for (const t of EGG_TIERS) {
    const price = eggPrice(t.rank, UI.eggFamily);
    const b = el('button', 'buy');
    b.appendChild(el('div', 'buy-name', `${rankLabel(t.rank)} のたまご`));
    b.appendChild(el('div', 'buy-price', `${price} G`));
    if (S.gold < price || rosterFull()) b.disabled = true;
    b.addEventListener('click', () => {
      const r = doBuyEgg(t.rank, UI.eggFamily);
      if (!r) return;
      toast(`${spOf(r.monster).name} がかえった!${r.isNew ? '(図鑑に登録)' : ''}`);
      resort(); save(); render();
    });
    eggs.appendChild(b);
  }
  shop.appendChild(eggs);
  shop.appendChild(el('p', 'hint',
    '遺伝は必ず 0。強さは配合で積むもので、金で買えるのは材料まで。' +
    '系統を指定できるのは図鑑に載っているものだけ。'));

  // ---- 触媒 ----
  shop.appendChild(el('div', 'shop-label', '配合の触媒'));
  for (const [id, it] of Object.entries(ITEMS)) {
    const have = S.items[id] || 0;
    const row = el('div', 'item-row');
    const main = el('div', 'item-main');
    const nm = el('div', 'item-name');
    nm.appendChild(el('span', null, it.name));
    if (have) nm.appendChild(el('span', 'item-have', `所持 ${have}`));
    main.appendChild(nm);
    main.appendChild(el('div', 'item-desc', it.desc));
    row.appendChild(main);
    const b = el('button', 'buy sm');
    b.appendChild(el('div', 'buy-price', `${it.price} G`));
    if (S.gold < it.price) b.disabled = true;
    b.addEventListener('click', () => {
      const r = doBuyItem(id);
      if (!r) return;
      toast(`${it.name} を買った(所持 ${r.count})`);
      save(); render();
    });
    row.appendChild(b);
    shop.appendChild(row);
  }
  shop.appendChild(el('p', 'hint', '配合タブで、1回の配合につき1つずつ使える。使うと無くなる。'));

  // ---- 牧場の拡張 ----
  shop.appendChild(el('div', 'shop-label', '牧場を広げる'));
  const price = barnPrice();
  const ex = el('button', 'btn ghost',
    price == null ? `これ以上は広げられない(${rosterCap()}匹)`
      : `${rosterCap()} → ${rosterCap() + 2} 匹 ・ ${price} G`);
  if (price == null || S.gold < price) ex.disabled = true;
  ex.addEventListener('click', () => {
    const r = doExpandBarn();
    if (!r) return;
    toast(`牧場を広げた(${r.cap}匹まで)`);
    save(); render();
  });
  shop.appendChild(ex);
  return shop;
}

// --------------------------------------------- 牧場
function viewRanch(view) {
  const head = el('div', 'head');
  head.appendChild(el('h2', null, '牧場'));
  head.appendChild(el('span', 'note', `${S.monsters.length} / ${rosterCap()} 匹 ・ 配合 ${S.fuseCount} 回`));
  view.appendChild(head);

  if (rosterFull()) {
    view.appendChild(el('p', 'hint',
      `牧場がいっぱい(${rosterCap()}匹)。これ以上は仲間にできない。配合するか、にがすか、牧場を広げよう。`));
  }

  view.appendChild(shopPanel());

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
    dh.appendChild(el('h2', null, nameOf(m)));
    dh.appendChild(el('span', 'note',
      `${m.name ? spOf(m).name + ' ・ ' : ''}${famOf(m).name}系 ・ ${rankLabel(spOf(m).rank)}`));
    d.appendChild(dh);
    d.appendChild(el('p', 'lore', spOf(m).flavor));
    d.appendChild(statBlock(m));

    // スキル(合計値はレベルの半分。複数持つとその分1つあたりが下がる)
    const budget = Math.floor(m.level / 2);
    const sh = el('div', 'head');
    sh.appendChild(el('h2', null, 'スキル'));
    sh.appendChild(el('span', 'note', `合計 ${budget}(Lv.${m.level} ÷ 2)`));
    d.appendChild(sh);
    const sl = el('div', 'skill-list');
    for (const s of skillLevels(m)) {
      const row = el('div', 'skill-row' + (s.level ? '' : ' is-dormant'));
      const head = el('div', 'sk-head');
      head.appendChild(el('span', 'sk-name', s.skill.name));
      head.appendChild(el('span', 'sk-lv', s.level ? `Lv.${s.level}` : '未発現'));
      row.appendChild(head);
      row.appendChild(el('div', 'sk-desc',
        s.level ? s.skill.desc(s.level) : `Lv.${(m.skills.length * 2)} で発現する`));
      sl.appendChild(row);
    }
    d.appendChild(sl);
    if (m.skills.length > 1) {
      d.appendChild(el('p', 'hint',
        `${m.skills.length}つ持っているので合計値を分け合っている。1つだけなら Lv.${Math.min(SKILL_MAX, budget)} まで伸びる。`));
    }

    const cap = maxLevelOf(m);
    d.appendChild(el('p', 'hint',
      m.level >= cap
        ? `Lv.${m.level}(上限)。これ以上は配合で上のランクへ。`
        : `Lv.${m.level} ・ 次のレベルまで ${expToNext(m) - m.exp} exp ・ 上限 Lv.${cap}`));
    d.appendChild(el('p', 'hint',
      '右のF〜Sは成長係数。レベルアップでの伸びやすさを表す種ごとの固定値で、遺伝や育て方では変わらない。'));

    // ---- 系譜 ----
    const gh = el('div', 'head');
    gh.appendChild(el('h2', null, '系譜'));
    gh.appendChild(el('span', 'note', `${m.gen || 1}代目`));
    d.appendChild(gh);

    const tree = el('div', 'lineage');
    if (m.parents && m.parents.length === 2) {
      for (const p of m.parents) {
        const sp = speciesById(p.sp);
        const row = el('div', 'lin-row');
        const em = el('div', 'emblem sm', sp ? FAMILIES[sp.family].glyph : '?');
        if (sp) em.style.setProperty('--fc', FAMILIES[sp.family].color);
        row.appendChild(em);
        const t = el('div', 'lin-main');
        t.appendChild(el('div', 'lin-name', p.name));
        if (sp && p.name !== sp.name) t.appendChild(el('div', 'lin-sub', sp.name));
        row.appendChild(t);
        tree.appendChild(row);
      }
    } else {
      const ORIGIN = {
        wild: 'この地で拾われた個体。親は分からない。',
        egg:  'たまごからかえった個体。親は分からない。',
        start: '最初から連れていた個体。ここから血が始まる。',
      };
      tree.appendChild(el('div', 'lin-none', ORIGIN[m.origin] || ORIGIN.wild));
    }
    d.appendChild(tree);

    // 名前をつける
    const nameBox = el('div', 'rename');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 12;
    input.placeholder = spOf(m).name;
    input.value = m.name || '';
    input.addEventListener('click', (ev) => ev.stopPropagation());
    const ok = el('button', 'btn ghost', '名前をつける');
    ok.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const before = nameOf(m);
      const after = doRename(m, input.value);
      save(); render();
      toast(after ? `${before} を ${after} と呼ぶことにした` : `名前を外した(${spOf(m).name})`);
    });
    nameBox.appendChild(input);
    nameBox.appendChild(ok);
    d.appendChild(nameBox);
    d.appendChild(el('p', 'hint',
      '名前をつけると、配合したときに子の系譜へ残る。空にすれば種の名前に戻る。'));

    if (S.monsters.length > 1) {
      const rel = el('button', 'btn ghost', 'にがす');
      rel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (doRelease(m)) {
          toast(`${nameOf(m)} をにがした`);
          UI.open = null;
          UI.picks = UI.picks.filter(u => u !== m.uid);
          resort();
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

  // 使う触媒。持っていないものは選べない。
  const use = {};
  for (const id of Object.keys(ITEMS)) {
    if (UI.use[id] && (S.items[id] || 0) > 0) use[id] = true;
    else UI.use[id] = false;
  }

  // プレビュー欄は常に描画する。2匹目を選んだ瞬間に生えてくると一覧が下にずれてしまうため。
  const ready = picked.length === 2;
  const pv = ready ? previewFusion(picked[0], picked[1], use) : null;
  const born = (!picked.length && UI.born != null)
    ? S.monsters.find(m => m.uid === UI.born) : null;
  const res = el('div', 'result');
  const txt = el('div', 'txt');

  if (ready) {
    res.appendChild(emblem({ sp: pv.species.id, level: 1, gene: pv.gene, uid: -1 }, 'lg'));
    txt.appendChild(el('div', 't1', `${pv.species.name}  ${rankLabel(pv.species.rank)}`));
    txt.appendChild(el('div', 't2',
      `${FAMILIES[pv.species.family].name}系 ・ 遺伝 +${pv.gene}` + (pv.surprise ? ' ・ まれに別の系統が出る' : '')));
    txt.appendChild(growthLine(pv.species));
    txt.appendChild(el('div', 't3',
      (use.keishou ? 'スキルを親から必ず2個受け継ぐ' : 'スキルは親から0〜2個ランダムに受け継ぐ') +
      `(${picked.map(p => p.skills.map(id => SKILLS[id].name).join('・')).join(' / ')})`));
  } else if (born) {
    // 配合直後。タブを移動しない代わりに、生まれた子をここで見せる。
    res.appendChild(emblem(born, 'lg'));
    txt.appendChild(el('div', 't1', `${spOf(born).name}  ${rankLabel(spOf(born).rank)} が生まれた`));
    txt.appendChild(el('div', 't2',
      `${famOf(born).name}系 ・ 遺伝 +${born.gene}` + (UI.bornNew ? ' ・ 新種発見!' : '')));
    txt.appendChild(growthLine(spOf(born)));
    txt.appendChild(el('div', 't3',
      `スキル ${born.skills.map(id => SKILLS[id].name).join('・')}`));
  } else {
    const ph = el('div', 'emblem lg', '?');
    ph.style.setProperty('--fc', '#7b86a8');
    res.appendChild(ph);
    txt.appendChild(el('div', 't1', picked.length === 1 ? 'あと1匹えらぶ' : '親を2匹えらぶ'));
    txt.appendChild(el('div', 't2', '同じランクどうしなら、ランクが1つ上がる'));
    txt.appendChild(el('div', 't3', 'スキルは親から0〜2個ランダムに受け継ぐ'));
  }
  res.appendChild(txt);
  panel.appendChild(res);
  view.appendChild(panel);

  if (S.monsters.length < 2) {
    view.appendChild(el('p', 'hint', 'モンスターが2匹以上いないと配合できない。探索かたまごで増やそう。'));
    setAction(null);
    return;
  }

  view.appendChild(el('p', 'hint',
    'レベルの高い親ほど「遺伝」が子に多く乗り、代を重ねるほど強くなる。'));

  // ---- 触媒 ----
  // 1つでも持っていれば出す。何も持っていないときに枠だけ出しても邪魔になる。
  if (Object.keys(ITEMS).some(id => (S.items[id] || 0) > 0)) {
    const cat = el('div', 'panel');
    const ch = el('div', 'head');
    ch.appendChild(el('h2', null, '触媒'));
    ch.appendChild(el('span', 'note', '配合1回につき1つずつ'));
    cat.appendChild(ch);
    for (const [id, it] of Object.entries(ITEMS)) {
      const have = S.items[id] || 0;
      if (!have) continue;
      const on = !!UI.use[id];
      const b = el('button', 'catalyst' + (on ? ' is-on' : ''));
      const main = el('div', 'item-main');
      const nm = el('div', 'item-name');
      nm.appendChild(el('span', null, it.name));
      nm.appendChild(el('span', 'item-have', `所持 ${have}`));
      main.appendChild(nm);
      main.appendChild(el('div', 'item-desc', it.desc));
      b.appendChild(main);
      b.appendChild(el('div', 'cat-mark', on ? '使う' : '—'));
      b.addEventListener('click', () => { UI.use[id] = !UI.use[id]; render(); });
      cat.appendChild(b);
    }
    view.appendChild(cat);
  }

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
    const r = doFuse(picked[0], picked[1], use);
    UI.picks = [];
    UI.born = r.child.uid;
    UI.bornNew = r.isNew;
    for (const id of Object.keys(r.spent)) UI.use[id] = false; // 使い切ったので外す
    resort(); // 親2匹が消えてどのみち並びが変わるので、ここで並べ直す
    const used = Object.keys(r.spent).map(id => ITEMS[id].name).join('・');
    toast(`${spOf(r.child).name} が生まれた!${r.isNew ? ' — 新種発見' : ''}` +
      (used ? `(${used}を使用)` : ''));
    save();
    render(); // 配合タブに留まる。続けて配合できるようにするため。
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
  view.appendChild(el('p', 'lore', area.lore));

  // 結果スロット(高さ固定・一覧より上)。中身が増減してもレイアウトが動かない。
  const out = el('div', 'panel result-slot');
  const r = UI.result;
  const oh = el('div', 'head');
  oh.appendChild(el('h2', null, !r ? '結果' : r.win ? '勝利' : '敗走'));
  if (r) oh.appendChild(el('span', 'note', r.wilds.map(w => spOf(w).name).join('・')));
  out.appendChild(oh);

  const log = el('div', 'log');
  if (!r) {
    log.appendChild(el('div', 'msg-dim', 'エリアと編成を選んで、下のボタンで送り出そう。'));
  } else {
    log.appendChild(el('div', r.win ? 'win' : 'lose',
      r.win ? `${r.wilds.length}匹の野生を打ち倒した`
            : `敗れて逃げ帰った${r.downed ? `(${r.downed}匹が倒れた)` : ''}`));
    log.appendChild(el('div', null,
      `経験値 +${r.exp} を ${r.gains.length}匹で山分け(1匹あたり +${r.gains[0].exp}) ・ ${r.gold} G`));
    if (r.levelUps > 0) {
      const ups = r.gains.filter(g => g.ups > 0).map(g => `${g.name}+${g.ups}`).join(' ');
      log.appendChild(el('div', 'get', `レベルアップ! ${ups}`));
    }
    if (r.captured) {
      log.appendChild(el('div', 'get',
        `${spOf(r.captured).name} が仲間になった!${r.capturedIsNew ? '(新種)' : ''}`));
    }
    if (r.missedCapture) {
      log.appendChild(el('div', null, '野生がなついたが、牧場がいっぱいで連れ帰れなかった。'));
    }
    for (const line of r.log.slice(-8)) log.appendChild(el('div', null, line));
  }
  out.appendChild(log);
  view.appendChild(out);

  // 編成(取得順で固定)。選んだ数だけ野生も出てくる。
  UI.party = UI.party.filter(u => S.monsters.some(m => m.uid === u));
  if (!UI.party.length && S.monsters.length) UI.party = [roster()[0].uid];
  const party = UI.party.map(u => S.monsters.find(m => m.uid === u));

  const panel = el('div', 'panel');
  const ph = el('div', 'head');
  ph.appendChild(el('h2', null, '編成'));
  ph.appendChild(el('span', 'note', `${party.length} / ${PARTY_MAX} 匹 ・ 野生も同数`));
  panel.appendChild(ph);

  const list = el('div', 'list');
  for (const m of roster()) {
    const idx = UI.party.indexOf(m.uid);
    list.appendChild(monRow(m, {
      selected: idx >= 0,
      badge: idx >= 0 ? String(idx + 1) : null,
      onClick: () => {
        if (idx >= 0) { if (UI.party.length > 1) UI.party.splice(idx, 1); }
        else if (UI.party.length < PARTY_MAX) UI.party.push(m.uid);
        else UI.party = [...UI.party.slice(1), m.uid];
        render();
      },
    }));
  }
  panel.appendChild(list);
  panel.appendChild(el('p', 'hint',
    `連れて行った数だけ野生も現れ、経験値は全員で山分けする。` +
    `取り分は1匹で行ったときと同じなので、まとめて育てるほど早い。`));
  view.appendChild(panel);

  // 連打するボタンは固定バーへ
  const go = el('button', 'btn primary', `${area.name} へ送り出す(${party.length}匹)`);
  go.addEventListener('click', () => {
    const team = UI.party.map(u => S.monsters.find(m => m.uid === u)).filter(Boolean);
    if (!team.length) return;
    UI.result = doExplore(team, area);
    save();
    render();
  });
  setAction(go);
}

// --------------------------------------------- 大会
function viewCup(view) {
  const head = el('div', 'head');
  head.appendChild(el('h2', null, '大会'));
  const wonCount = CUPS.filter(c => S.cups[c.id] && S.cups[c.id].won).length;
  head.appendChild(el('span', 'note', `優勝 ${wonCount} / ${CUPS.length}`));
  view.appendChild(head);

  const chips = el('div', 'chips');
  for (const c of CUPS) {
    const ok = cupUnlocked(c, S.monsters);
    const rec = S.cups[c.id];
    const b = el('button', 'chip' + (UI.cup === c.id ? ' is-on' : '') + (rec && rec.won ? ' is-won' : ''));
    if (!ok) b.disabled = true;
    b.appendChild(el('span', null, ok ? c.name : '？？？'));
    b.appendChild(el('span', 'r', rec && rec.won ? '優勝' : 'R' + c.rank));
    b.addEventListener('click', () => { UI.cup = c.id; UI.cupResult = null; render(); });
    chips.appendChild(b);
  }
  view.appendChild(chips);

  const cup = CUPS.find(c => c.id === UI.cup && cupUnlocked(c, S.monsters))
    || CUPS.filter(c => cupUnlocked(c, S.monsters)).pop() || CUPS[0];
  UI.cup = cup.id;
  const rec = S.cups[cup.id] || { best: 0, won: false };
  view.appendChild(el('div', 'area-desc',
    `${cup.rounds}回戦 ・ ${rankLabel(cup.rank)}の出場者 ・ 優勝賞金 ${cup.prize} G` +
    (rec.won ? ' ・ 優勝済み' : rec.best ? ` ・ 最高 ${rec.best}回戦突破` : '')));

  // 決勝で待っているマスター。会う前は名前を伏せておく。
  const rival = rivalOf(cup);
  const rr = S.rivals[cup.id] || { met: false, beaten: false, losses: 0 };
  if (rival) {
    const rp = el('div', 'panel');
    const card = el('div', 'rival');
    card.appendChild(el('div', 'face', rr.met ? rival.name.slice(0, 1) : '?'));
    const who = el('div', 'who');
    who.appendChild(el('div', 'rn', rr.met ? rival.name : '？？？'));
    who.appendChild(el('div', 'rt', rr.met ? rival.title : '決勝で待っている'));
    card.appendChild(who);
    if (rr.beaten) card.appendChild(el('div', 'rmark', '撃破'));
    else if (rr.losses) card.appendChild(el('div', 'rmark', `${rr.losses}敗`));
    rp.appendChild(card);
    rp.appendChild(el('div', 'line' + (rr.met ? '' : ' dim'),
      rr.met ? (rr.beaten ? rival.after : rival.again) : 'まだ会っていない。決勝まで勝ち上がれば分かる。'));
    view.appendChild(rp);
  }

  // 結果(高さ固定・一覧より上)
  const out = el('div', 'panel result-slot');
  const r = UI.cupResult;
  const oh = el('div', 'head');
  oh.appendChild(el('h2', null, !r ? '戦績' : r.cleared ? `${r.cup.name} 優勝` : '敗退'));
  if (r) oh.appendChild(el('span', 'note', `${r.won} / ${r.cup.rounds} 回戦`));
  out.appendChild(oh);

  const log = el('div', 'log');
  if (!r) {
    log.appendChild(el('div', 'msg-dim',
      '回戦のあいだ、傷は残ったままになる。1戦だけ強い編成では勝ち抜けない。'));
    log.appendChild(el('div', 'msg-dim',
      `MPは回戦ごとに戻るが、HPは最大値の${Math.round(CUP.heal * 100)}%しか戻らない。倒れた仲間は最後まで戻らない。`));
  } else {
    // 結果の枠は高さが固定なので、まず結末を出してから回戦を並べる
    log.appendChild(el('div', r.cleared ? 'win' : 'lose',
      r.cleared ? `優勝! 賞金 ${r.gold} G` : `${r.won}回戦で敗退 ・ ${r.gold} G`));
    if (r.firstWin) log.appendChild(el('div', 'get', `${r.cup.name} 初優勝`));
    // 決勝まで行ったときだけ、ライバルの台詞が出る
    if (r.rival && r.metRival) {
      log.appendChild(el('div', 'get', `${r.rival.name}(${r.rival.title})`));
      log.appendChild(el('div', null,
        r.rivalFirstMeet ? r.rival.before : r.cleared ? r.rival.win : r.rival.lose));
    }
    log.appendChild(el('div', null,
      `経験値 +${r.exp} を ${r.gains.length}匹で山分け(1匹あたり +${r.share})`));
    if (r.levelUps > 0) {
      const ups = r.gains.filter(g => g.ups > 0).map(g => `${g.name}+${g.ups}`).join(' ');
      log.appendChild(el('div', 'get', `レベルアップ! ${ups}`));
    }
    for (const rd of r.rounds) {
      log.appendChild(el('div', rd.win ? 'win' : 'lose',
        `${rd.name}: ${rd.foes.map(f => spOf(f).name).join('・')} ${rd.win ? 'に勝利' : 'に敗れた'}`));
      log.appendChild(el('div', null, rd.standing.length
        ? '残り ' + rd.standing.map(s => `${s.name} ${s.hp}/${s.maxHp}`).join(' ・ ')
        : '全滅'));
    }
  }
  out.appendChild(log);
  view.appendChild(out);

  // 編成。相手も同数出るので、欠けたまま出ると勝ち抜けない。
  UI.cupTeam = UI.cupTeam.filter(u => S.monsters.some(m => m.uid === u));
  const panel = el('div', 'panel');
  const ph = el('div', 'head');
  ph.appendChild(el('h2', null, '出場'));
  ph.appendChild(el('span', 'note', `${UI.cupTeam.length} / ${CUP.entry} 匹`));
  panel.appendChild(ph);

  const list = el('div', 'list');
  for (const m of roster()) {
    const idx = UI.cupTeam.indexOf(m.uid);
    list.appendChild(monRow(m, {
      selected: idx >= 0,
      badge: idx >= 0 ? String(idx + 1) : null,
      onClick: () => {
        if (idx >= 0) UI.cupTeam.splice(idx, 1);
        else if (UI.cupTeam.length < CUP.entry) UI.cupTeam.push(m.uid);
        else UI.cupTeam = [...UI.cupTeam.slice(1), m.uid];
        render();
      },
    }));
  }
  panel.appendChild(list);
  panel.appendChild(el('p', 'hint',
    `${CUP.entry}匹そろえないと出場できない。1匹に絞って育てた編成では勝ち抜けないので、` +
    `3匹とも上限まで育てて遺伝も詰めておくこと。`));
  view.appendChild(panel);

  const ready = UI.cupTeam.length === CUP.entry;
  const go = el('button', 'btn primary',
    ready ? `${cup.name} に出場する` : `あと${CUP.entry - UI.cupTeam.length}匹選ぶ`);
  if (!ready) go.disabled = true;
  go.addEventListener('click', () => {
    const team = UI.cupTeam.map(u => S.monsters.find(m => m.uid === u)).filter(Boolean);
    if (team.length !== CUP.entry) return;
    UI.cupResult = doCup(team, cup);
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
      if (known) {
        // その種が本来よく持つスキル。配合先を決める材料になる。
        cell.appendChild(el('div', 'ds', s.innate.map(id => SKILLS[id].name).join('・')));
      }
      grid.appendChild(cell);
      // 見つけた種にだけ一文が付く
      if (known && s.flavor) grid.appendChild(el('p', 'dex-flavor', `${s.name} — ${s.flavor}`));
    }
    sec.appendChild(grid);
    view.appendChild(sec);
  }

  view.appendChild(el('p', 'hint',
    '闇の系統は、ランク3以上どうしの異なる系統を配合したときにまれに現れる。'));

  // ステータスのはたらき(すべて常時効果。呪文の詠唱や消費はしない)
  const legend = el('div', 'panel');
  legend.appendChild(el('h2', null, 'ステータスのはたらき'));
  const ul = el('div', 'effects');
  for (const st of STATS) {
    const row = el('div', 'effect-row');
    row.appendChild(el('span', 'ek', st.label));
    row.appendChild(el('span', 'ev', st.effect));
    ul.appendChild(row);
  }
  legend.appendChild(ul);
  legend.appendChild(el('p', 'hint',
    'すべて常時発動。相手との比で効くので、どのランクでも同じように働く。'));
  view.appendChild(legend);

  // スキル一覧(Lv.10 のときの効果で書く)
  const skl = el('div', 'panel');
  const skh = el('div', 'head');
  skh.appendChild(el('h2', null, 'スキル'));
  skh.appendChild(el('span', 'note', `全${Object.keys(SKILLS).length}種 ・ 表記はLv.10`));
  skl.appendChild(skh);
  const skul = el('div', 'effects');
  for (const sk of Object.values(SKILLS)) {
    const row = el('div', 'effect-row');
    row.appendChild(el('span', 'ek', sk.name));
    row.appendChild(el('span', 'ev', sk.desc(SKILL_MAX)));
    skul.appendChild(row);
  }
  skl.appendChild(skul);
  skl.appendChild(el('p', 'hint',
    'スキルの合計値はレベルの半分。1つに絞れば高レベルになり、2つ持つと分け合う。' +
    '配合では親から0〜2個ランダムに受け継ぎ、何も継げなかったときは種族本来のスキルを覚える。' +
    '種族本来のスキルは上の図鑑に、種ごとに3つずつ書いてある。'))
  view.appendChild(skl);
}

// --------------------------------------------- 描画
function render() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  setAction(null);
  document.getElementById('hud-gold').textContent = String(S.gold);
  document.getElementById('hud-count').textContent = `${S.monsters.length}/${rosterCap()}`;

  for (const t of document.querySelectorAll('.tab')) {
    t.classList.toggle('is-on', t.dataset.tab === UI.tab);
  }

  if (UI.tab === 'ranch') viewRanch(view);
  else if (UI.tab === 'fuse') viewFuse(view);
  else if (UI.tab === 'explore') viewExplore(view);
  else if (UI.tab === 'cup') viewCup(view);
  else viewDex(view);
}

function init() {
  S = load() || newState();
  save();
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => {
      UI.tab = t.dataset.tab;
      UI.result = null;
      UI.cupResult = null;
      resort(); // タブを移るタイミングで強さ順に並べ直す
      render();
      document.getElementById('view').scrollIntoView({ block: 'start' });
    });
  }
  render();
}

if (typeof document !== 'undefined') init();
