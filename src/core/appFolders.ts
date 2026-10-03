// The folders the app makes and finds by name. Each keeps its name and can't be deleted, or the app
// would stop finding what's in it; the notes in it can still be moved, renamed or deleted one by
// one. No Node imports: the web app uses this too.
import { CONFIG, USERS } from "./schema.ts";
import { TEMPLATES } from "./templates.ts";
import { PEOPLE } from "./contacts.ts";
import { EVENTS } from "./eventNotes.ts";
import { VIEWS } from "./views.ts";

/** Where daily notes go: Journal/YYYY-MM-DD.md. */
export const JOURNAL = "Journal";

/** Each of the app's folders, and what it's for, as a reason reads. */
const APP_FOLDERS: Record<string, string> = {
  [CONFIG]: "this workspace's settings live",
  [USERS]: "each person's settings live",
  [TEMPLATES]: "templates live",
  [PEOPLE]: "contacts live",
  [EVENTS]: "this workspace's events live",
  [JOURNAL]: "daily notes go",
  Archive: "archived notes go",
  [VIEWS]: "saved views live",
};

/** Is `folder` one the app makes and finds by name? */
export const isAppFolder = (folder: string) => Object.hasOwn(APP_FOLDERS, folder.replace(/^\/+|\/+$/g, ""));

/** Why `folder` can't be renamed (it keeps its name) or deleted, or null if it can. */
export function appFolderRefusal(folder: string, doing: "rename" | "delete"): string | null {
  const dir = folder.replace(/^\/+|\/+$/g, "");
  if (!isAppFolder(dir)) return null;
  const why = `${dir} is where ${APP_FOLDERS[dir]}`;
  if (dir === "Archive") return `${why}, so it ${doing === "rename" ? "keeps its name" : "can't be deleted"}; unarchive or delete its notes instead`;
  return doing === "rename" ? `${why}, so it keeps its name; its notes can still be moved one by one` : `${why}, so it can't be deleted; its notes can still be deleted one by one`;
}
