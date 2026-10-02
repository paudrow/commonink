//   ::timer{duration=25m label="Focus" sound=off id=k3x9q}
import { el } from "../dom.ts";
import { clock, formatDuration, parseDuration } from "./args.ts";
import { button, setButton, type WidgetSpec } from "./core.ts";
import { allStates, chime, loadState, saveState, subscribe, unlockAudio } from "./store.ts";

export interface TimerState {
  kind: "timer";
  status: "idle" | "running" | "paused" | "done";
  duration: number;
  remaining: number;
  endsAt?: number;
  label?: string;
  note?: string;
  sound?: boolean;
}

const DEFAULT_MS = 5 * 60_000;

export const timer: WidgetSpec = {
  name: "timer",
  title: "Timer",
  icon: "timer",
  hint: "Countdown with a chime",
  keywords: "timer countdown pomodoro alarm",
  defaults: { duration: "5m" },
  fields: [
    { key: "label", label: "Title", type: "text", placeholder: "Tea, Focus, Standup…" },
    { key: "duration", label: "Duration", type: "duration", placeholder: "25m", presets: ["1m", "5m", "10m", "15m", "25m", "45m", "1h"] },
    { key: "sound", label: "Chime when done", type: "toggle", off: "off" },
  ],

  mount(body, env, card) {
    const argMs = () => parseDuration(env.args.duration) ?? DEFAULT_MS;
    const idle = (): TimerState => ({ kind: "timer", status: "idle", duration: argMs(), remaining: argMs() });
    const id = env.args.id;
    let state: TimerState = (id && loadState<TimerState>(id)) || idle();
    if (state.status === "idle" && state.duration !== argMs()) state = idle();

    const time = el("div", { class: "qw-clock" });
    const sub = el("div", { class: "qw-sub" });
    const primary = button("Start", "play", () => toggle(), "primary");
    const reset = button("Reset", "reset", () => commit(idle()));
    const plus = button("+1m", null, () => addMinute());
    const bar = el("span");
    body.append(
      el("div", { class: "qw-main" }, el("div", { class: "qw-readout" }, time, sub), el("div", { class: "qw-actions" }, primary, reset, plus)),
      el("div", { class: "qw-progress" }, bar),
    );

    function commit(next: TimerState) {
      env.withId((wid) => {
        state = { ...next, label: env.args.label, note: env.note, sound: env.args.sound !== "off" };
        saveState(wid, state);
      });
      render();
    }
    function toggle() {
      unlockAudio();
      const now = Date.now();
      if (state.status === "running") commit({ ...state, status: "paused", remaining: Math.max(0, state.endsAt! - now), endsAt: undefined });
      else if (state.status === "paused") commit({ ...state, status: "running", endsAt: now + state.remaining });
      else commit({ kind: "timer", status: "running", duration: argMs(), remaining: argMs(), endsAt: now + argMs() });
    }
    function addMinute() {
      unlockAudio();
      const now = Date.now();
      if (state.status === "running") commit({ ...state, endsAt: state.endsAt! + 60_000, duration: state.duration + 60_000 });
      else if (state.status === "paused") commit({ ...state, remaining: state.remaining + 60_000, duration: state.duration + 60_000 });
      else if (state.status === "done") commit({ kind: "timer", status: "running", duration: 60_000, remaining: 60_000, endsAt: now + 60_000 });
    }

    let shown = "";
    function render() {
      const now = Date.now();
      const remaining = state.status === "running" ? Math.max(0, state.endsAt! - now) : state.status === "done" ? 0 : state.remaining;
      const total = state.duration || argMs();
      const text = clock(remaining);
      if (text !== shown) time.textContent = shown = text;
      bar.style.width = `${Math.min(100, Math.max(0, (1 - remaining / total) * 100))}%`;
      card.dataset.status = state.status;
      const labels = { idle: ["Start", "play"], running: ["Pause", "pause"], paused: ["Resume", "play"], done: ["Restart", "reset"] } as const;
      const [label, ico] = labels[state.status];
      setButton(primary, label, ico);
      reset.disabled = state.status === "idle";
      plus.disabled = state.status === "idle";
      sub.textContent =
        state.status === "running"
          ? `Ends at ${new Date(state.endsAt!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : state.status === "paused"
            ? "Paused"
            : state.status === "done"
              ? "Time’s up"
              : `${formatDuration(total)}${env.args.sound === "off" ? " · silent" : ""}`;
    }

    render();
    const tick = window.setInterval(render, 250);
    const unsub = id
      ? subscribe(id, () => {
          state = loadState<TimerState>(id) ?? idle();
          render();
        })
      : () => {};
    return () => {
      clearInterval(tick);
      unsub();
    };
  },
};

/** One watcher for every running timer, so they chime even when their note isn't open. */
export function watchTimers(onDone: (state: TimerState) => void) {
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of allStates()) {
      if (s?.kind !== "timer" || s.status !== "running" || s.endsAt > now) continue;
      const fresh = loadState<TimerState>(id);
      if (fresh?.status !== "running") continue; // another tab got there first
      saveState(id, { ...fresh, status: "done", remaining: 0, endsAt: undefined });
      if (fresh.sound !== false) chime();
      onDone(fresh);
    }
  }, 400);
}
