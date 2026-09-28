import type { WidgetSpec } from "./core.ts";
import { calendar } from "./calendar.ts";
import { kanban } from "./kanban.ts";
import { query } from "./query.ts";
import { stopwatch } from "./stopwatch.ts";
import { tasks } from "./tasks.ts";
import { timer } from "./timer.ts";

/** Every `::name{…}` widget the editor knows how to render. Add new ones here. */
export const WIDGETS: Record<string, WidgetSpec> = { tasks, query, calendar, timer, stopwatch, kanban };

/** Widget ids inserted from the / menu whose settings should open as soon as they render. */
export const pendingConfig = new Set<string>();
