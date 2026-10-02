// Which notes are archived. No imports, so the web app can share it.

/**
 * Archiving moves a note under Archive/, keeping its original path: Archive/Projects/Old plan.md.
 * A workspace that already keeps its own archive folder at the top (a numbered one like "4. Archive",
 * or "Archives") archives into that instead, and everything in either counts as archived.
 */
export const ARCHIVE = "Archive/";
/** A top-level archive folder: Archive or Archives, after any number and punctuation ("4. Archive", "90-99 Archives"). */
const ARCHIVE_DIR = /^[\d ._-]*archives?\/?$/i;
export const isArchiveFolder = (dir: string) => ARCHIVE_DIR.test(dir);
/** The archive folder a path is under ("4. Archive/"), or null if it isn't archived. */
export const archiveRootOf = (p: string): string | null => {
  const slash = p.indexOf("/");
  return slash > 0 && isArchiveFolder(p.slice(0, slash)) ? p.slice(0, slash + 1) : null;
};
export const isArchived = (p: string) => archiveRootOf(p) !== null;
/** Where an archived note lived before: its path without the archive folder. */
export const homeOf = (p: string) => p.slice(archiveRootOf(p)?.length ?? 0);
