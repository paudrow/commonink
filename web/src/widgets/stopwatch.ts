//   ::stopwatch{label="5k run" id=p0x2m}
import { el } from "../dom.ts";
import { clock } from "./args.ts";
import { button, setButton, type WidgetSpec } from "./core.ts";
import { loadState, saveState, subscribe } from "./store.ts";

interface StopwatchState {
  kind: "stopwatch";
  running: boolean;
  startedAt?: number;
  elapsed: number; // accumulated before startedAt
  laps: number[]; // total time at each lap
}

const fresh = (): StopwatchState => ({ kind: "stopwatch", running: false, elapsed: 0, laps: [] });

export const stopwatch: WidgetSpec = {
  name: "stopwatch",
  title: "Stopwatch",
  icon: "stopwatch",
  hint: "Count up, with laps",
  keywords: "stopwatch count up laps track time",
  defaults: {},
  fields: [{ key: "label", label: "Label", type: "text", placeholder: "Run, Meeting, Deep work…" }],

  mount(body, env, card) {
    const id = env.args.id;
    let state: StopwatchState = (id && loadState<StopwatchState>(id)) || fresh();

    const time = el("div", { class: "qw-clock" });
    const sub = el("div", { class: "qw-sub" });
    const primary = button("Start", "play", () => toggle(), "primary");
    const lap = button("Lap", "flag", () => addLap());
    const reset = button("Reset", "reset", () => commit(fresh()));
    const laps = el("ol", { class: "qw-laps", reversed: true });
    body.append(
      el("div", { class: "qw-main" }, el("div", { class: "qw-readout" }, time, sub), el("div", { class: "qw-actions" }, primary, lap, reset)),
      laps,
    );

    const total = (now = Date.now()) => state.elapsed + (state.running ? now - state.startedAt! : 0);
    function commit(next: StopwatchState) {
      env.withId((wid) => {
        state = next;
        saveState(wid, state);
      });
      render();
      kick();
    }
    function toggle() {
      const now = Date.now();
      commit(state.running ? { ...state, running: false, elapsed: total(now), startedAt: undefined } : { ...state, running: true, startedAt: now });
    }
    function addLap() {
      if (state.running) commit({ ...state, laps: [...state.laps, total()] });
    }

    let lapsShown = -1;
    function render() {
      time.textContent = clock(total(), true);
      card.dataset.status = state.running ? "running" : state.elapsed ? "paused" : "idle";
      setButton(primary, state.running ? "Pause" : state.elapsed ? "Resume" : "Start", state.running ? "pause" : "play");
      lap.disabled = !state.running;
      reset.disabled = state.running || !state.elapsed;
      sub.textContent = state.running ? "Running" : state.elapsed ? "Paused" : "Ready";
      if (lapsShown !== state.laps.length) {
        lapsShown = state.laps.length;
        const rows = state.laps
          .map((t, i) => ({ n: i + 1, split: t - (state.laps[i - 1] ?? 0), t }))
          .reverse()
          .slice(0, 6)
          .map((l) => el("li", {}, el("span", { class: "lap-n" }, `Lap ${l.n}`), el("span", { class: "lap-split" }, `+${clock(l.split, true)}`), el("span", { class: "lap-total" }, clock(l.t, true))));
        laps.replaceChildren(...rows);
        laps.hidden = !rows.length;
        env.remeasure();
      }
    }

    let frame = 0;
    const loop = () => {
      render();
      frame = state.running ? requestAnimationFrame(loop) : 0;
    };
    loop();
    const unsub = id
      ? subscribe(id, () => {
          state = loadState<StopwatchState>(id) ?? fresh();
          if (!frame) loop();
        })
      : () => {};
    function kick() {
      if (state.running && !frame) loop();
    }
    const poll = window.setInterval(kick, 500); // e.g. started from another tab
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(poll);
      unsub();
    };
  },
};
