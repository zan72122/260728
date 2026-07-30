'use strict';
(function(){
const G = window.G;
const A = { ctx: null, muted: false };
G.audio = A;

function now(){ return A.ctx.currentTime; }

A.unlock = function(){
  if (A.ctx) {
    if (A.ctx.state === 'suspended') A.ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = A.ctx = new AC();

  A.master = ctx.createGain();
  A.master.gain.value = A.muted ? 0 : 0.9;
  A.master.connect(ctx.destination);

  A.sfx = ctx.createGain();
  A.sfx.gain.value = 1;
  A.sfx.connect(A.master);

  A.mus = ctx.createGain();
  A.mus.gain.value = 0.55;
  A.mus.connect(A.master);
  // music-box space: feedback delay
  const dl = ctx.createDelay(1); dl.delayTime.value = 0.38;
  const fb = ctx.createGain(); fb.gain.value = 0.3;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  const wet = ctx.createGain(); wet.gain.value = 0.4;
  A.mus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(A.master);

  const len = ctx.sampleRate | 0;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  A.noiseBuf = buf;

  startBGM();
};

A.setMuted = m => { A.muted = m; if (A.master) A.master.gain.value = m ? 0 : 0.9; };
A.toggle = () => A.setMuted(!A.muted);

A.tone = function(o){
  if (!A.ctx) return;
  const t = o.t || now();
  const osc = A.ctx.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  const dur = o.dur || 0.2;
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(o.dest || A.sfx);
  osc.start(t); osc.stop(t + dur + 0.06);
};

A.noiseHit = function(o){
  if (!A.ctx) return;
  const t = o.t || now();
  const src = A.ctx.createBufferSource();
  src.buffer = A.noiseBuf; src.loop = true;
  const bp = A.ctx.createBiquadFilter();
  bp.type = o.type || 'bandpass';
  bp.frequency.setValueAtTime(o.f || 800, t);
  const dur = o.dur || 0.2;
  if (o.sweep) bp.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
  bp.Q.value = o.q || 1;
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.vol || 0.15, t + (o.attack || 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(A.sfx);
  src.start(t); src.stop(t + dur + 0.06);
};

/* ------- one-shot sfx ------- */
A.pop = () => { A.tone({ f: 540, slide: 270, vol: 0.22, dur: 0.12 }); };
A.pat = () => {
  A.noiseHit({ f: 420, q: 1.2, vol: 0.16, dur: 0.09 });
  A.tone({ f: 170, slide: 120, vol: 0.18, dur: 0.1 });
};
A.poof = () => { A.noiseHit({ f: 1400, sweep: 3400, q: 0.8, vol: 0.1, dur: 0.25 }); };
A.ping = () => {
  if (!A.ctx) return;
  A.tone({ f: 880, vol: 0.14, dur: 0.25 });
  A.tone({ f: 1318, vol: 0.07, dur: 0.3, t: now() + 0.07 });
};
A.shimmer = () => { A.tone({ f: G.pick([1568, 1760, 2093, 2349]), vol: 0.04, dur: 0.4 }); };
A.wind = () => { A.noiseHit({ f: 380, sweep: 900, q: 0.5, vol: 0.09, dur: 1.6, attack: 0.5 }); };
A.drip = () => { A.tone({ f: G.rand(750, 1150), slide: 500, vol: 0.06, dur: 0.14 }); };
A.splash = () => {
  if (!A.ctx) return;
  A.noiseHit({ f: 900, sweep: 300, q: 0.7, vol: 0.28, dur: 0.5 });
  for (let i = 0; i < 4; i++) {
    A.tone({ f: G.rand(600, 1300), slide: 400, vol: 0.05, dur: 0.15, t: now() + 0.1 + i * 0.07 });
  }
};
A.sparkleBurst = () => {
  if (!A.ctx) return;
  const ns = [1046, 1318, 1568, 2093, 2637];
  for (let i = 0; i < 5; i++) A.tone({ f: ns[i], vol: 0.06, dur: 0.5, t: now() + i * 0.06 });
};
A.chime = () => {
  if (!A.ctx) return;
  const ns = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  for (let i = 0; i < ns.length; i++) {
    const t = now() + i * 0.13;
    A.tone({ f: ns[i], vol: 0.16, dur: 1.0, t });
    A.tone({ f: ns[i] * 2.76, vol: 0.035, dur: 0.4, t });
  }
};

/* ------- sun hold loop ------- */
A.sunStart = function(){
  if (!A.ctx || A.sunNodes) return;
  const o1 = A.ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = 196;
  const o2 = A.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 197.8;
  const g = A.ctx.createGain(); g.gain.value = 0;
  g.gain.setTargetAtTime(0.045, now(), 0.15);
  o1.connect(g); o2.connect(g); g.connect(A.sfx);
  o1.start(); o2.start();
  A.sunNodes = { o1, o2, g };
};
A.sunStop = function(){
  if (!A.sunNodes) return;
  const n = A.sunNodes; A.sunNodes = null;
  n.g.gain.setTargetAtTime(0, now(), 0.12);
  setTimeout(() => { try { n.o1.stop(); n.o2.stop(); } catch(e){} }, 500);
};

/* ------- wash loop ------- */
A.washStart = function(){
  if (!A.ctx || A.washNodes) return;
  const src = A.ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
  const bp = A.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = 0.9;
  const lfo = A.ctx.createOscillator(); lfo.frequency.value = 0.9;
  const lg = A.ctx.createGain(); lg.gain.value = 260;
  lfo.connect(lg); lg.connect(bp.frequency);
  const g = A.ctx.createGain(); g.gain.value = 0;
  src.connect(bp); bp.connect(g); g.connect(A.sfx);
  src.start(); lfo.start();
  A.washNodes = { src, lfo, g };
};
A.washLevel = v => {
  if (A.washNodes) A.washNodes.g.gain.setTargetAtTime(G.clamp(v, 0, 1) * 0.45, now(), 0.08);
};
A.washStop = function(){
  if (!A.washNodes) return;
  const n = A.washNodes; A.washNodes = null;
  n.g.gain.setTargetAtTime(0, now(), 0.1);
  setTimeout(() => { try { n.src.stop(); n.lfo.stop(); } catch(e){} }, 500);
};

/* ------- BGM: gentle music box ------- */
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
function startBGM(){
  if (A.bgmTimer) return;
  let beat = 0, idx = 2;
  A.bgmTimer = setInterval(() => {
    if (!A.ctx || A.ctx.state !== 'running') return;
    beat++;
    if (Math.random() < 0.5) {
      idx = G.clamp(idx + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.75 ? 1 : 2), 0, SCALE.length - 1);
      const f = SCALE[idx];
      A.tone({ f, vol: 0.055, dur: 1.3, dest: A.mus });
      A.tone({ f: f * 4, vol: 0.009, dur: 0.4, dest: A.mus });
    }
    if (beat % 16 === 0) {
      const f = G.pick([130.8, 164.8, 196.0]);
      A.tone({ f, type: 'triangle', vol: 0.04, dur: 2.6, attack: 0.4, dest: A.mus });
      A.tone({ f: f * 1.5, type: 'sine', vol: 0.02, dur: 2.6, attack: 0.6, dest: A.mus });
    }
  }, 340);
}
})();
