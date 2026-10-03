import type { WidgetSpec } from "./core.ts";
import { guide } from "./guide.ts";
import { stopwatch } from "./stopwatch.ts";
import { streak } from "./streak.ts";
import { timer } from "./timer.ts";
import { view } from "./view.ts";

/**
 * Every `::name{…}` widget the editor knows how to render. Add new ones here. Lists, tasks, a month,
 * an agenda, today and another note's board are all `::view`, one kind each (view.ts).
 */
export const WIDGETS: Record<string, WidgetSpec> = { view, timer, stopwatch, streak, guide };

/** Widget ids inserted from the / menu whose settings should open as soon as they render. */
export const pendingConfig = new Set<string>();
