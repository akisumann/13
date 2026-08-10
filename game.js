'use strict';

// ===== 定数 =====
const MAP_W = 48;
const MAP_H = 27;
const TILE = 20;
const VIEW_RADIUS = 8;
const FINAL_FLOOR = 13;

const T = { WALL: 0, FLOOR: 1, STAIRS: 2 };

// ===== ユーティリティ =====
function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr[ri(0, arr.length - 1)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }

// ===== 敵データ =====
const ENEMY_TYPES = [
  { name: '大ネズミ',   char: 'r', color: '#b08968', hp: 5,  atk: 2, xp: 2,  minFloor: 1,  erratic: false },
  { name: 'コウモリ',   char: 'b', color: '#9d8189', hp: 4,  atk: 2, xp: 2,  minFloor: 1,  erratic: true },
  { name: 'ゴブリン',   char: 'g', color: '#74c69d', hp: 8,  atk: 3, xp: 4,  minFloor: 2,  erratic: false },
  { name: 'スケルトン', char: 's', color: '#e9ecef', hp: 12, atk: 4, xp: 6,  minFloor: 4,  erratic: false },
  { name: 'オーク',     char: 'o', color: '#80b918', hp: 16, atk: 5, xp: 9,  minFloor: 6,  erratic: false },
  { name: 'ウォーグ',   char: 'w', color: '#adb5bd', hp: 20, atk: 6, xp: 12, minFloor: 8,  erratic: false },
  { name: 'トロル',     char: 'T', color: '#52b788', hp: 30, atk: 8, xp: 18, minFloor: 10, erratic: false },
  { name: '死霊',       char: 'W', color: '#c77dff', hp: 24, atk: 9, xp: 20, minFloor: 11, erratic: false },
];

const BOSS_TYPE = { name: '十三階の主', char: '&', color: '#ff4d6d', hp: 66, atk: 11, xp: 0, boss: true, erratic: false };

// ===== ゲーム状態 =====
let game = null;
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');

function newGame() {
  game = {
    floor: 1,
    player: {
      x: 0, y: 0,
      hp: 20, maxHp: 20,
      baseAtk: 3, def: 0,
      level: 1, xp: 0, xpNext: 12,
      potions: 1, gold: 0,
      swordBonus: 0, swordName: 'こぶし',
    },
    map: null, rooms: null,
    enemies: [], items: [],
    explored: null, visible: null,
    messages: [],
    turn: 0,
    over: false, won: false,
  };
  buildFloor();
  log(`ダンジョン13へようこそ。地下${FINAL_FLOOR}階の主を倒すのだ。`, 'sys');
  refresh();
}

// ===== マップ生成 =====
function buildFloor() {
  const map = [];
  for (let y = 0; y < MAP_H; y++) map.push(new Array(MAP_W).fill(T.WALL));

  const rooms = [];
  const maxRooms = ri(9, 13);
  for (let i = 0; i < 200 && rooms.length < maxRooms; i++) {
    const w = ri(4, 9), h = ri(3, 6);
    const x = ri(1, MAP_W - w - 2), y = ri(1, MAP_H - h - 2);
    const r = { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) };
    if (rooms.some(o => r.x <= o.x + o.w && o.x <= r.x + r.w && r.y <= o.y + o.h && o.y <= r.y + r.h)) continue;
    rooms.push(r);
    for (let ry = y; ry < y + h; ry++)
      for (let rx = x; rx < x + w; rx++) map[ry][rx] = T.FLOOR;
  }

  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    if (Math.random() < 0.5) {
      carveH(map, a.cx, b.cx, a.cy);
      carveV(map, a.cy, b.cy, b.cx);
    } else {
      carveV(map, a.cy, b.cy, a.cx);
      carveH(map, a.cx, b.cx, b.cy);
    }
  }

  game.map = map;
  game.rooms = rooms;
  game.enemies = [];
  game.items = [];
  game.explored = map.map(row => row.map(() => false));
  game.visible = map.map(row => row.map(() => false));

  game.player.x = rooms[0].cx;
  game.player.y = rooms[0].cy;

  const isBossFloor = game.floor >= FINAL_FLOOR;
  if (!isBossFloor) {
    const last = rooms[rooms.length - 1];
    map[last.cy][last.cx] = T.STAIRS;
  }

  // 敵の配置(最初の部屋以外)
  const enemyCount = isBossFloor ? 4 : Math.min(4 + game.floor, 14);
  for (let i = 0; i < enemyCount; i++) {
    const spot = randomFloorSpot(1);
    if (!spot) break;
    const pool = ENEMY_TYPES.filter(t => t.minFloor <= game.floor && t.minFloor >= game.floor - 6);
    const t = pick(pool.length ? pool : ENEMY_TYPES);
    game.enemies.push(makeEnemy(t, spot.x, spot.y));
  }
  if (isBossFloor) {
    const last = rooms[rooms.length - 1];
    game.enemies.push(makeEnemy(BOSS_TYPE, last.cx, last.cy));
  }

  // アイテムの配置
  const itemCount = ri(3, 5);
  for (let i = 0; i < itemCount; i++) {
    const spot = randomFloorSpot(0);
    if (!spot) break;
    game.items.push(makeItem(spot.x, spot.y));
  }
}

function carveH(map, x1, x2, y) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) map[y][x] = T.FLOOR;
}
function carveV(map, y1, y2, x) {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) map[y][x] = T.FLOOR;
}

function randomFloorSpot(skipRooms) {
  for (let tries = 0; tries < 300; tries++) {
    const r = game.rooms[ri(skipRooms, game.rooms.length - 1)];
    const x = ri(r.x, r.x + r.w - 1), y = ri(r.y, r.y + r.h - 1);
    if (game.map[y][x] !== T.FLOOR) continue;
    if (x === game.player.x && y === game.player.y) continue;
    if (game.enemies.some(e => e.x === x && e.y === y)) continue;
    if (game.items.some(it => it.x === x && it.y === y)) continue;
    return { x, y };
  }
  return null;
}

function makeEnemy(t, x, y) {
  const scale = t.boss ? 0 : game.floor - t.minFloor;
  const hp = t.hp + scale * 2;
  return {
    name: t.name, char: t.char, color: t.color,
    x, y, hp, maxHp: hp,
    atk: t.atk + Math.floor(scale / 2),
    xp: t.xp + scale,
    erratic: t.erratic, boss: !!t.boss,
    awake: false,
  };
}

function makeItem(x, y) {
  const roll = Math.random();
  if (roll < 0.42) return { x, y, type: 'potion', char: '!', color: '#ef476f', name: '回復薬' };
  if (roll < 0.65) return { x, y, type: 'gold', char: '$', color: '#ffd166', name: '金貨', amount: ri(5, 15) + game.floor * 2 };
  if (roll < 0.78) {
    const bonus = 1 + Math.floor(game.floor / 3) + ri(0, 1);
    const names = ['短剣', '長剣', '戦斧', '魔剣'];
    const name = names[clamp(Math.floor(game.floor / 4), 0, names.length - 1)] + `+${bonus}`;
    return { x, y, type: 'sword', char: '/', color: '#8ecae6', name, bonus };
  }
  if (roll < 0.92) return { x, y, type: 'shield', char: ']', color: '#a3b18a', name: '盾のかけら' };
  return { x, y, type: 'elixir', char: '¤', color: '#c77dff', name: '生命の秘薬' };
}

// ===== 視界 =====
function los(x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    if (!(x === x0 && y === y0) && game.map[y][x] === T.WALL) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return true;
}

function computeVisible() {
  const p = game.player;
  game.visible = game.map.map(row => row.map(() => false));
  for (let y = Math.max(0, p.y - VIEW_RADIUS); y <= Math.min(MAP_H - 1, p.y + VIEW_RADIUS); y++) {
    for (let x = Math.max(0, p.x - VIEW_RADIUS); x <= Math.min(MAP_W - 1, p.x + VIEW_RADIUS); x++) {
      if (dist(p.x, p.y, x, y) > VIEW_RADIUS) continue;
      if (los(p.x, p.y, x, y)) {
        game.visible[y][x] = true;
        game.explored[y][x] = true;
      }
    }
  }
}

// ===== 戦闘・成長 =====
function playerAtk() { return game.player.baseAtk + game.player.swordBonus; }

function attackEnemy(e) {
  const dmg = Math.max(1, playerAtk() + ri(-1, 2));
  e.hp -= dmg;
  e.awake = true;
  if (e.hp <= 0) {
    log(`${e.name}を倒した!`, 'good');
    game.enemies = game.enemies.filter(x => x !== e);
    if (e.boss) {
      game.won = true;
      game.over = true;
      log('十三階の主は塵となって消えた……ダンジョン13を制覇した!', 'sys');
      return;
    }
    gainXp(e.xp);
  } else {
    log(`${e.name}に${dmg}のダメージ。(残りHP ${e.hp})`);
  }
}

function gainXp(xp) {
  const p = game.player;
  p.xp += xp;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = p.level * 12;
    p.maxHp += 6;
    p.baseAtk += 1;
    p.hp = Math.min(p.maxHp, p.hp + Math.floor(p.maxHp / 2));
    log(`レベル${p.level}に上がった!最大HPと攻撃力が上昇。`, 'good');
  }
}

function enemyAttack(e) {
  const dmg = Math.max(1, e.atk + ri(-1, 1) - game.player.def);
  game.player.hp -= dmg;
  log(`${e.name}の攻撃!${dmg}のダメージを受けた。`, 'bad');
  if (game.player.hp <= 0) {
    game.player.hp = 0;
    game.over = true;
    log(`あなたは地下${game.floor}階で力尽きた…… Rキーでリスタート。`, 'bad');
  }
}

// ===== 敵ターン =====
function enemiesAct() {
  const p = game.player;
  for (const e of game.enemies) {
    if (game.over) return;
    const d = dist(e.x, e.y, p.x, p.y);
    if (!e.awake && d <= VIEW_RADIUS && los(e.x, e.y, p.x, p.y)) {
      e.awake = true;
      if (e.boss) log('十三階の主がこちらに気づいた……!', 'sys');
    }
    if (!e.awake) {
      if (Math.random() < 0.3) stepRandom(e);
      continue;
    }
    if (d === 1) { enemyAttack(e); continue; }
    if (e.erratic && Math.random() < 0.4) { stepRandom(e); continue; }
    stepToward(e, p.x, p.y);
  }
}

function passable(x, y) {
  return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && game.map[y][x] !== T.WALL;
}
function occupied(x, y) {
  return game.enemies.some(e => e.x === x && e.y === y) ||
         (game.player.x === x && game.player.y === y);
}

function stepToward(e, tx, ty) {
  const dx = Math.sign(tx - e.x), dy = Math.sign(ty - e.y);
  const cands = Math.abs(tx - e.x) >= Math.abs(ty - e.y)
    ? [[dx, 0], [0, dy], [dx, dy]]
    : [[0, dy], [dx, 0], [dx, dy]];
  for (const [mx, my] of cands) {
    if (mx === 0 && my === 0) continue;
    const nx = e.x + mx, ny = e.y + my;
    if (passable(nx, ny) && !occupied(nx, ny)) { e.x = nx; e.y = ny; return; }
  }
}

function stepRandom(e) {
  const [mx, my] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
  const nx = e.x + mx, ny = e.y + my;
  if (passable(nx, ny) && !occupied(nx, ny)) { e.x = nx; e.y = ny; }
}

// ===== プレイヤー行動 =====
function playerMove(dx, dy) {
  const p = game.player;
  const nx = p.x + dx, ny = p.y + dy;
  if (!passable(nx, ny)) return false;
  const target = game.enemies.find(e => e.x === nx && e.y === ny);
  if (target) { attackEnemy(target); return true; }
  p.x = nx; p.y = ny;
  pickupAt(nx, ny);
  if (game.map[ny][nx] === T.STAIRS) log('下り階段がある。「>」で降りられる。', 'sys');
  return true;
}

function pickupAt(x, y) {
  const it = game.items.find(i => i.x === x && i.y === y);
  if (!it) return;
  game.items = game.items.filter(i => i !== it);
  const p = game.player;
  switch (it.type) {
    case 'potion':
      p.potions++;
      log('回復薬を拾った。(Qで飲む)', 'item');
      break;
    case 'gold':
      p.gold += it.amount;
      log(`金貨を${it.amount}枚拾った。`, 'item');
      break;
    case 'sword':
      if (it.bonus > p.swordBonus) {
        p.swordBonus = it.bonus;
        p.swordName = it.name;
        log(`${it.name}を装備した!攻撃力+${it.bonus}。`, 'item');
      } else {
        log(`${it.name}を見つけたが、今の武器のほうが強い。`, 'dim');
      }
      break;
    case 'shield':
      p.def += 1;
      log('盾のかけらを組み込んだ。防御+1。', 'item');
      break;
    case 'elixir':
      p.maxHp += 4;
      p.hp = p.maxHp;
      log('生命の秘薬を飲み干した!最大HP+4、全回復!', 'item');
      break;
  }
}

function quaffPotion() {
  const p = game.player;
  if (p.potions <= 0) { log('回復薬を持っていない。', 'dim'); return false; }
  if (p.hp >= p.maxHp) { log('HPは満タンだ。', 'dim'); return false; }
  p.potions--;
  const heal = ri(8, 12) + p.level;
  p.hp = Math.min(p.maxHp, p.hp + heal);
  log(`回復薬を飲んだ。HPが${heal}回復。`, 'good');
  return true;
}

function descend() {
  const p = game.player;
  if (game.map[p.y][p.x] !== T.STAIRS) { log('ここに階段はない。', 'dim'); return false; }
  game.floor++;
  buildFloor();
  if (game.floor >= FINAL_FLOOR) {
    log(`地下${game.floor}階 —— 最深部。空気が重い。主がどこかに潜んでいる。`, 'sys');
  } else {
    log(`地下${game.floor}階に降りた。`, 'sys');
  }
  return true;
}

// ===== ターン進行 =====
function endTurn() {
  game.turn++;
  const p = game.player;
  if (game.turn % 6 === 0 && p.hp < p.maxHp && !game.over) p.hp++;
  enemiesAct();
  refresh();
}

function refresh() {
  computeVisible();
  render();
  renderUI();
}

// ===== 描画 =====
function render() {
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '16px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!game.explored[y][x]) continue;
      const vis = game.visible[y][x];
      const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
      const t = game.map[y][x];
      if (t === T.WALL) {
        ctx.fillStyle = vis ? '#4a4e69' : '#22223b';
        ctx.fillText('#', px, py);
      } else if (t === T.STAIRS) {
        ctx.fillStyle = vis ? '#ffd166' : '#7f6a2c';
        ctx.fillText('>', px, py);
      } else {
        ctx.fillStyle = vis ? '#3a3f58' : '#1d2033';
        ctx.fillText('·', px, py);
      }
    }
  }

  for (const it of game.items) {
    if (!game.visible[it.y][it.x]) continue;
    ctx.fillStyle = it.color;
    ctx.fillText(it.char, it.x * TILE + TILE / 2, it.y * TILE + TILE / 2);
  }

  for (const e of game.enemies) {
    if (!game.visible[e.y][e.x]) continue;
    ctx.fillStyle = e.color;
    ctx.fillText(e.char, e.x * TILE + TILE / 2, e.y * TILE + TILE / 2);
    if (e.hp < e.maxHp) {
      const bx = e.x * TILE + 3, by = e.y * TILE + 1, bw = TILE - 6;
      ctx.fillStyle = '#2b2d42';
      ctx.fillRect(bx, by, bw, 2);
      ctx.fillStyle = '#ef476f';
      ctx.fillRect(bx, by, bw * (e.hp / e.maxHp), 2);
    }
  }

  const p = game.player;
  ctx.fillStyle = '#ffb703';
  ctx.fillText('@', p.x * TILE + TILE / 2, p.y * TILE + TILE / 2);

  if (game.over) {
    ctx.fillStyle = 'rgba(5, 6, 10, 0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
    ctx.fillStyle = game.won ? '#ffd166' : '#ef476f';
    ctx.fillText(game.won ? '制覇! 十三階の主を討ち取った!' : 'ゲームオーバー', canvas.width / 2, canvas.height / 2 - 24);
    ctx.font = '16px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#d8dee9';
    ctx.fillText(
      `到達: 地下${game.floor}階  レベル${game.player.level}  金貨${game.player.gold}枚  ${game.turn}ターン`,
      canvas.width / 2, canvas.height / 2 + 18);
    ctx.fillText('Rキーでもう一度挑戦', canvas.width / 2, canvas.height / 2 + 48);
  }
}

function renderUI() {
  const p = game.player;
  document.getElementById('st-floor').textContent = `B${game.floor}`;
  document.getElementById('st-hp').textContent = `${p.hp} / ${p.maxHp}`;
  document.getElementById('st-level').textContent = p.level;
  document.getElementById('st-xp').textContent = `${p.xp} / ${p.xpNext}`;
  document.getElementById('st-atk').textContent = `${playerAtk()}(${p.swordName})`;
  document.getElementById('st-def').textContent = p.def;
  document.getElementById('st-potions').textContent = p.potions;
  document.getElementById('st-gold').textContent = p.gold;

  const ratio = p.hp / p.maxHp;
  const fill = document.getElementById('hpbar-fill');
  fill.style.width = `${ratio * 100}%`;
  fill.style.background = ratio > 0.5 ? '#57cc99' : ratio > 0.25 ? '#ffd166' : '#ef476f';
}

function log(text, kind) {
  game.messages.push({ text, kind: kind || '' });
  if (game.messages.length > 80) game.messages.shift();
  const el = document.getElementById('log');
  el.innerHTML = game.messages
    .map(m => `<div class="${m.kind ? 'msg-' + m.kind : ''}">${m.text}</div>`)
    .join('');
  el.scrollTop = el.scrollHeight;
}

// ===== 入力 =====
const MOVE_KEYS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0],
};

document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;

  if (game.over) {
    if (key === 'r') newGame();
    return;
  }

  let acted = false;
  if (key in MOVE_KEYS || ev.key in MOVE_KEYS) {
    const [dx, dy] = MOVE_KEYS[key] || MOVE_KEYS[ev.key];
    acted = playerMove(dx, dy);
    ev.preventDefault();
  } else if (key === ' ' || key === '.') {
    acted = true;
    ev.preventDefault();
  } else if (key === 'q') {
    acted = quaffPotion();
  } else if (ev.key === '>' || ev.key === 'Enter') {
    acted = descend();
  }

  if (acted && !game.over) endTurn();
  else refresh();
});

newGame();
