// Save every note in Apple Notes as an HTML file, a folder per Notes folder, for Common Ink's
// importer: `commonink import ~/Desktop/AppleNotesExport`, or Import notes… in the app with the
// folder zipped (the AppleNotesExport folder is how the importer knows it's Apple Notes). Apple Notes has no export of its own, so this asks it
// for each note's HTML. Run it on a Mac (Notes will ask once to let it be controlled):
//
//   osascript -l JavaScript scripts/export-apple-notes.js
//
// Locked notes are skipped, and so is Recently Deleted. Pictures inside notes don't come along:
// Notes keeps them outside the note's HTML.
ObjC.import("Foundation");

function run() {
  const Notes = Application("Notes");
  const root = `${$.NSHomeDirectory().js}/Desktop/AppleNotesExport`;
  const files = $.NSFileManager.defaultManager;
  const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, "-").replace(/^[.\s]+/, "").trim().slice(0, 120) || "Untitled";
  const used = new Set();
  let saved = 0;
  let skipped = 0;
  for (const folder of Notes.folders()) {
    const name = safe(folder.name());
    if (name === "Recently Deleted") continue;
    const dir = `${root}/${name}`;
    files.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, $(), $());
    for (const note of folder.notes()) {
      if (note.passwordProtected()) {
        skipped++;
        continue;
      }
      const base = safe(note.name());
      let path = `${dir}/${base}.html`;
      for (let n = 2; used.has(path.toLowerCase()); n++) path = `${dir}/${base} ${n}.html`;
      used.add(path.toLowerCase());
      $(note.body()).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, $());
      saved++;
    }
  }
  return `Saved ${saved} notes to ${root}${skipped ? ` (${skipped} locked notes left out)` : ""}`;
}
