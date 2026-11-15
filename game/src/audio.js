// Procedural sound: every effect is synthesised with WebAudio, no audio files. One shared
// noise buffer, one master gain. Created lazily on the first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(dur, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur);
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind) {
      if (kind === 'shotgun') noise(0.28, 900, 0.9);
      else if (kind === 'smg') noise(0.09, 1800, 0.5);
      else if (kind === 'pistol') noise(0.12, 1400, 0.6);
      else noise(0.14, 1100, 0.7);
      tone(160, 0.08, 0.25, 'square', 60);
    },
    enemyShot() {
      noise(0.1, 900, 0.18);
    },
    reload() {
      tone(900, 0.05, 0.15, 'square');
      setTimeout(() => tone(600, 0.05, 0.15, 'square'), 160);
    },
    dry() {
      tone(1400, 0.04, 0.12, 'square');
    },
    hit(kill) {
      tone(kill ? 1320 : 990, 0.07, 0.2, 'sine');
      if (kill) setTimeout(() => tone(1760, 0.09, 0.2, 'sine'), 70);
    },
    hurt() {
      tone(220, 0.15, 0.3, 'sawtooth', 110);
    },
    beep() {
      tone(1180, 0.09, 0.25, 'sine');
    },
    plantDone() {
      tone(880, 0.12, 0.25, 'sine');
      setTimeout(() => tone(1174, 0.16, 0.25, 'sine'), 120);
    },
    explosion() {
      noise(0.9, 300, 1.0);
      tone(70, 0.7, 0.6, 'sine', 30);
    },
    win() {
      tone(523, 0.14, 0.25, 'sine');
      setTimeout(() => tone(784, 0.22, 0.25, 'sine'), 140);
    },
    lose() {
      tone(392, 0.16, 0.25, 'sine');
      setTimeout(() => tone(262, 0.28, 0.25, 'sine'), 160);
    },
    click() {
      tone(700, 0.04, 0.15, 'square');
    },
    setMuted(m) {
      if (master) master.gain.value = m ? 0 : 0.35;
    },
  };
}
