// A short resolution/quality trial distinguishes a rendering bottleneck from a
// frame-rate cap or main-thread bottleneck. Samples are frame intervals, not GPU time.
export function createQualityController({ apply, initial = 'high' }) {
  let mode = 'auto', level = initial, changedAt = 0, samples = [], slowWindows = 0;
  let previous = null, baseline = 0, locked = false;
  const change = (next, now) => { level = next; changedAt = now; samples = []; apply(next); };
  return {
    get state() { return { mode, level, probing: previous !== null, locked }; },
    select(value, now) {
      mode = ['auto', 'high', 'medium', 'low'].includes(value) ? value : 'auto';
      previous = null; locked = false; slowWindows = 0;
      change(mode === 'auto' ? initial : mode, now);
    },
    resetSamples(now) { samples = []; slowWindows = 0; changedAt = now; },
    observe(ms, now, hidden = false) {
      if (hidden || ms > 100 || ms <= 0) { samples = []; return; }
      if (mode !== 'auto' || locked || now - changedAt < 2000) return;
      samples.push(ms);
      if (samples.length < 60) return;
      const mean = samples.reduce((a,b) => a+b, 0) / samples.length; samples = [];
      if (previous !== null) {
        if (mean < baseline * .85) slowWindows = 0;
        else { change(previous, now); locked = true; }
        previous = null;
      } else if (mean > 24) {
        if (++slowWindows < 2) return;
        const next = level === 'high' ? 'medium' : level === 'medium' ? 'low' : null;
        if (next) { baseline = mean; previous = level; change(next, now); }
        else locked = true;
      } else slowWindows = 0;
    },
  };
}
