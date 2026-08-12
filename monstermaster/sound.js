// =====================================================================
// 音 — 単体で動く部分
//
// 音声ファイルは1つも使わない。全部その場で作る。
// このファイルもゲーム本体を参照しない。鳴らし方はこれだけ。
//
//   Sfx.play('hit');
//
// 音の中身は VOICES の表にある。1つの音は「小さな音の粒」の並びで、
// 粒には形(波か雑音か)・高さ・長さ・大きさ・頭出しの遅れしか無い。
//
//   { w:'triangle', f:[520, 380], t:0.06, g:0.18, at:0 }
//
//   w  … 波の形。'noise' なら雑音(打撃や足音に使う)
//   f  … 高さ[始まり, 終わり](Hz)。雑音のときは濾しの高さ
//   t  … 長さ(秒)
//   g  … 大きさ(0〜1)。ここに master を掛けたものが実際の音量
//   at … 鳴り始めるまでの遅れ(秒)。和音や連打はこれでずらす
//
// AudioContext は最初に鳴らすときまで作らない(自動再生の制限のため、
// 押した指のついでに起こす)。無い環境では黙って何もしない。
// =====================================================================
(function (root) {
  'use strict';

  const SOUND = {
    master: 0.22,   // 全体の音量。控えめに。
    ramp: 0.008,    // 立ち上がり(秒)。0にすると「プツ」と鳴る。
    tail: 0.0001,   // 消えたとみなす音量
  };

  // 音の表。増やすときはここに足すだけでいい。
  const VOICES = {
    // --- 画面 ---
    tab:  [{ w: 'triangle', f: [520, 470],   t: 0.04, g: 0.40 }],
    pick: [{ w: 'square',   f: [880, 880],   t: 0.03, g: 0.28 }],
    // --- 探索 ---
    tap:  [{ w: 'triangle', f: [420, 300],   t: 0.07, g: 0.64 }],
    // 打撃。雑音の「どす」と低い胴鳴りを重ねる。のそのそした戦いに合わせて鈍く。
    hit:  [{ w: 'noise',    f: [1400, 400],  t: 0.09, g: 0.80 },
           { w: 'triangle', f: [180, 90],    t: 0.13, g: 0.72 }],
    // 会心。同じ形で一段高く、後ろに芯を足す。
    crit: [{ w: 'noise',    f: [2600, 700],  t: 0.10, g: 0.96 },
           { w: 'sawtooth', f: [300, 110],   t: 0.18, g: 0.64 },
           { w: 'square',   f: [1320, 990],  t: 0.07, g: 0.40, at: 0.03 }],
    // 受け流し。金属をはじいた感じ。
    parry:[{ w: 'square',   f: [1980, 1560], t: 0.05, g: 0.44 },
           { w: 'sine',     f: [2640, 2200], t: 0.10, g: 0.24, at: 0.02 }],
    // 毒。ゆっくり沈む。
    pois: [{ w: 'sine',     f: [330, 180],   t: 0.34, g: 0.40 }],
    // 倒れる。
    down: [{ w: 'sawtooth', f: [240, 60],    t: 0.44, g: 0.64 }],
    win:  [{ w: 'triangle', f: [523, 523],   t: 0.10, g: 0.60 },
           { w: 'triangle', f: [659, 659],   t: 0.10, g: 0.60, at: 0.09 },
           { w: 'triangle', f: [784, 784],   t: 0.22, g: 0.64, at: 0.18 }],
    lose: [{ w: 'triangle', f: [392, 392],   t: 0.14, g: 0.52 },
           { w: 'triangle', f: [311, 311],   t: 0.30, g: 0.52, at: 0.13 }],
    // レベルアップ。上がりきるまで4段。
    level:[{ w: 'square',   f: [440, 440],   t: 0.06, g: 0.36 },
           { w: 'square',   f: [554, 554],   t: 0.06, g: 0.36, at: 0.06 },
           { w: 'square',   f: [659, 659],   t: 0.06, g: 0.36, at: 0.12 },
           { w: 'square',   f: [880, 880],   t: 0.20, g: 0.44, at: 0.18 }],
    // --- 配合と商店 ---
    // 配合。低いところから一気に上がって、上でひとつ光る。
    fuse: [{ w: 'sine',     f: [180, 900],   t: 0.50, g: 0.56 },
           { w: 'triangle', f: [1320, 1320], t: 0.24, g: 0.40, at: 0.44 }],
    // たまごが割れる。
    egg:  [{ w: 'noise',    f: [3200, 1200], t: 0.06, g: 0.64 },
           { w: 'triangle', f: [990, 1480],  t: 0.16, g: 0.48, at: 0.05 }],
    coin: [{ w: 'square',   f: [988, 988],   t: 0.05, g: 0.40 },
           { w: 'square',   f: [1319, 1319], t: 0.12, g: 0.40, at: 0.05 }],
    // --- かけっこ ---
    // 合図の笛。
    whis: [{ w: 'square',   f: [1560, 2100], t: 0.10, g: 0.36 },
           { w: 'square',   f: [2100, 1870], t: 0.16, g: 0.36, at: 0.10 }],
    // 1着でゴール。
    goal: [{ w: 'triangle', f: [784, 784],   t: 0.08, g: 0.52 },
           { w: 'triangle', f: [1047, 1047], t: 0.22, g: 0.56, at: 0.07 }],
    // --- にわの物音 ---
    // どれも「気配」なので、押して鳴る音より一段小さくしてある。
    // 高さは性格で動かすので(pitch)、ここでは素の高さだけ持つ。
    rustle:[{ w: 'noise',    f: [4000, 1500], t: 0.10, g: 0.28 }],
    splash:[{ w: 'noise',    f: [2200, 500],  t: 0.14, g: 0.34 },
            { w: 'sine',     f: [700, 300],   t: 0.10, g: 0.20, at: 0.02 }],
    pebble:[{ w: 'noise',    f: [3000, 900],  t: 0.05, g: 0.30 },
            { w: 'triangle', f: [900, 600],   t: 0.06, g: 0.22, at: 0.01 }],
    // 低いところを濾した雑音はほとんど残らないので、その分だけ強く取る
    crackl:[{ w: 'noise',    f: [2600, 800],  t: 0.04, g: 0.48 },
            { w: 'noise',    f: [1800, 600],  t: 0.05, g: 0.40, at: 0.07 }],
    hop:   [{ w: 'triangle', f: [420, 780],   t: 0.09, g: 0.30 }],
    // 洞窟。同じ音を少し遅らせて重ね、奥行きを出す。
    drip:  [{ w: 'sine',     f: [1400, 700],  t: 0.14, g: 0.26 },
            { w: 'sine',     f: [900, 520],   t: 0.18, g: 0.14, at: 0.10 }],
    toy:   [{ w: 'triangle', f: [600, 900],   t: 0.06, g: 0.30 },
            { w: 'triangle', f: [500, 760],   t: 0.05, g: 0.20, at: 0.10 }],
    chew:  [{ w: 'noise',    f: [900, 300],   t: 0.05, g: 0.72 },
            { w: 'noise',    f: [800, 260],   t: 0.05, g: 0.62, at: 0.09 },
            { w: 'noise',    f: [860, 280],   t: 0.05, g: 0.50, at: 0.18 }],
    wood:  [{ w: 'triangle', f: [340, 200],   t: 0.08, g: 0.30 },
            { w: 'noise',    f: [1500, 500],  t: 0.03, g: 0.20 }],
    chime: [{ w: 'sine',     f: [1760, 1760], t: 0.30, g: 0.24 },
            { w: 'sine',     f: [2640, 2640], t: 0.22, g: 0.10, at: 0.01 }],
    chirp: [{ w: 'square',   f: [1200, 1600], t: 0.04, g: 0.24 },
            { w: 'square',   f: [1500, 1100], t: 0.05, g: 0.20, at: 0.05 }],
    hum:   [{ w: 'sine',     f: [300, 380],   t: 0.16, g: 0.22 }],
    snore: [{ w: 'sine',     f: [180, 120],   t: 0.34, g: 0.24 }],
    // 大会優勝。いちばん長い音はこれだけ。
    cheer:[{ w: 'triangle', f: [523, 523],   t: 0.12, g: 0.56 },
           { w: 'triangle', f: [659, 659],   t: 0.12, g: 0.56, at: 0.11 },
           { w: 'triangle', f: [784, 784],   t: 0.12, g: 0.60, at: 0.22 },
           { w: 'triangle', f: [1047, 1047], t: 0.40, g: 0.64, at: 0.33 },
           { w: 'square',   f: [1568, 1568], t: 0.34, g: 0.28, at: 0.36 }],
  };

  let on = true;
  let ac = null, bus = null, noise = null;

  // 鳴らす直前まで作らない。押した指のついでに起こす。
  function context() {
    if (ac) return ac;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ac = new AC();
      bus = ac.createGain();
      bus.gain.value = SOUND.master;
      bus.connect(ac.destination);
    } catch (e) { ac = null; }
    return ac;
  }

  function noiseBuffer(c) {
    if (noise) return noise;
    const n = Math.floor(c.sampleRate * 0.5);
    noise = c.createBuffer(1, n, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  }

  // 表を実際に鳴らす粒に均す。音を出さずに中身だけ見たいときにも使える。
  // opt.pitch で高さを、opt.gain で大きさをまとめて動かせる。
  function plan(name, opt) {
    const v = VOICES[name];
    if (!v) return null;
    opt = opt || {};
    const p = opt.pitch || 1, g = opt.gain === undefined ? 1 : opt.gain;
    return v.map(s => ({
      w: s.w,
      f0: s.f[0] * p, f1: s.f[1] * p,
      t: s.t, g: s.g * g, at: s.at || 0,
    }));
  }

  // 音の終わりまでの長さ(秒)
  function lengthOf(name) {
    const v = plan(name);
    return v ? v.reduce((t, s) => Math.max(t, s.at + s.t), 0) : 0;
  }

  function play(name, opt) {
    const steps = plan(name, opt);
    if (!steps || !on) return null;
    const c = context();
    if (!c) return steps;              // 音の出ない環境。中身だけ返す。
    if (c.state === 'suspended' && c.resume) c.resume();
    // opt.at を渡すと、その秒数だけ先に予約する(いまのところ書き出しの検分用)
    const t0 = c.currentTime + 0.001 + (opt && opt.at || 0);
    for (const s of steps) {
      const at = t0 + s.at;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(s.g, at + SOUND.ramp);
      gain.gain.exponentialRampToValueAtTime(SOUND.tail, at + s.t);
      gain.connect(bus);
      let src;
      if (s.w === 'noise') {
        src = c.createBufferSource();
        src.buffer = noiseBuffer(c);
        // 雑音は濾しの高さを動かして「どす」から「しゃっ」まで作り分ける
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(s.f0, at);
        f.frequency.exponentialRampToValueAtTime(Math.max(40, s.f1), at + s.t);
        src.connect(f); f.connect(gain);
      } else {
        src = c.createOscillator();
        src.type = s.w;
        src.frequency.setValueAtTime(s.f0, at);
        if (s.f1 !== s.f0) src.frequency.exponentialRampToValueAtTime(Math.max(20, s.f1), at + s.t);
        src.connect(gain);
      }
      src.start(at);
      src.stop(at + s.t + 0.02);
    }
    return steps;
  }

  const API = {
    SOUND, VOICES, plan, play, lengthOf,
    names: () => Object.keys(VOICES),
    isOn: () => on,
    setOn: (v) => { on = !!v; return on; },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Sfx = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
