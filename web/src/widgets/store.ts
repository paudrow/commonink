// Runtime state for widgets, keyed by the widget's id. Lives in localStorage so a running timer
// survives scrolling it out of view, switching notes and reloads, and stays in sync across tabs.

const PREFIX = "quire.w.";
const listeners = new Map<string, Set<() => void>>();

export function loadState<T>(id: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveState(id: string, state: unknown) {
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(state));
  } catch {}
  emit(id);
}

export function subscribe(id: string, fn: () => void): () => void {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(fn);
  return () => listeners.get(id)?.delete(fn);
}

function emit(id: string) {
  listeners.get(id)?.forEach((fn) => fn());
}

export function allStates(): Array<[string, any]> {
  const out: Array<[string, any]> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) {
        const v = loadState(key.slice(PREFIX.length));
        if (v) out.push([key.slice(PREFIX.length), v]);
      }
    }
  } catch {}
  return out;
}

window.addEventListener("storage", (e) => {
  if (e.key?.startsWith(PREFIX)) emit(e.key.slice(PREFIX.length));
});

// ------------------------------------------------------------------ sound

let audio: AudioContext | null = null;

/** Call from a click handler so the browser lets us play the chime later. */
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {}
}

export function chime() {
  unlockAudio();
  if (!audio) return;
  const t0 = audio.currentTime + 0.02;
  [0, 0.22, 0.44, 0.9, 1.12, 1.34].forEach((dt, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = i % 3 === 2 ? 1318.5 : 987.8;
    gain.gain.setValueAtTime(0.0001, t0 + dt);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.2);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t0 + dt);
    osc.stop(t0 + dt + 0.22);
  });
}
