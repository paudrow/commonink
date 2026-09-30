// The Getting started note's cards (see onboarding.ts):
//   ::guide{step=watch}     the guide makes a demo edit here, for you to take back
//   ::guide{step=connect}   how to connect your own agent: the command to run locally, the Connected agents dialog online
//   ::guide{step=done}      how far along you are, then an offer to archive the note
import { api, type GuideState } from "../api.ts";
import { el } from "../dom.ts";
import { formatKeys } from "../keys.ts";
import { act, archiveNote, watchGuide } from "../onboarding.ts";
import { guideState } from "../../../src/core/guide.ts";
import { button, setButton, type WidgetEnv, type WidgetSpec } from "./core.ts";

/**
 * Builds a card's body; returns how to show the checklist's state in it. `live`: this is the checklist
 * the guide is working on, so its buttons do something.
 */
type View = (body: HTMLElement, env: WidgetEnv) => (s: GuideState | null, live: boolean) => void;

const text = () => el("p", { class: "qw-guide-text" });

const watch: View = (body, env) => {
  const say = text();
  const go = button("Show me", "play", async () => {
    setButton(go, "Writing…", null);
    await act("demo");
    env.focusEditor(); // so ⌘Z takes it back straight away
  }, "primary");
  body.append(el("div", { class: "qw-main" }, say, env.readOnly ? null : go));
  return (s, live) => {
    const done = s?.done.includes("watch");
    say.textContent = done
      ? "That's the deal: agents write, and you decide what stays."
      : s?.demo
        ? `There it is, just below, with the guide's name on it. Press ${formatKeys("Mod-z")} to take it back.`
        : "The guide will add a line to this note, the way an agent you connect would.";
    go.hidden = !live || !s || !!done || s.demo;
    if (!s?.demo) setButton(go, "Show me", "play");
  };
};

/** `s` quoted for a shell, if it needs it. */
const sh = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);

function copyable(code: string, block = false): HTMLElement {
  const copy = button("Copy", "copy", () => void navigator.clipboard.writeText(code).then(() => setButton(copy, "Copied", "check")));
  return el("div", { class: `qw-guide-code${block ? " is-block" : ""}` }, el(block ? "pre" : "code", {}, code), copy);
}

const connect: View = (body, env) => {
  const say = text();
  const how = el("div", { class: "qw-guide-how" });
  body.append(say, how);
  void api.info().then((info) => {
    if (info.mode === "cloud") {
      how.append(button("Connect an agent", "link", () => void import("../agentsPage.ts").then((m) => m.showAgents()), "primary"));
      return;
    }
    const bin = `${info.projectRoot}/bin/quire`;
    // The MCP server opens the default vault unless it's told which: say so when this isn't that one.
    const vault = info.vault && info.vault !== `${info.projectRoot}/vault` ? info.vault : null;
    const json = JSON.stringify({ mcpServers: { quire: { command: bin, args: ["mcp"], ...(vault ? { env: { QUIRE_VAULT: vault } } : {}) } } }, null, 2);
    how.append(
      el("p", { class: "qw-sub" }, "Claude Code: run this in a terminal."),
      copyable(`claude mcp add quire ${vault ? `-e QUIRE_VAULT=${sh(vault)} ` : ""}-- ${sh(bin)} mcp`),
      el("details", {}, el("summary", {}, "Claude Desktop, Cursor and other MCP clients"), el("p", { class: "qw-sub" }, "Add this server to the app's MCP settings (claude_desktop_config.json, .cursor/mcp.json…), then restart it."), copyable(json, true)),
    );
  }, () => {});
  return (s) => {
    const done = s?.done.includes("connect");
    say.textContent = done
      ? "Connected. Your agent's edits show up here as they happen, with its name on them."
      : "Give an agent your notes, and its edits land here live, like the guide's. This box ticks itself when its first one arrives.";
    how.hidden = !!done || !!env.readOnly;
  };
};

const done: View = (body, env) => {
  const say = text();
  const bar = el("span");
  const archive = button("Archive this note", "archive", () => archiveNote(env.note));
  body.append(el("div", { class: "qw-main" }, say, env.readOnly ? null : archive), el("div", { class: "qw-progress" }, bar));
  return (s, live) => {
    const total = s ? s.open.length + s.done.length : 0;
    bar.style.width = `${total ? (100 * s!.done.length) / total : 0}%`;
    say.textContent = !s ? "" : s.open.length ? `${s.done.length} of ${total} done.` : live ? "All done. Archive this note to tidy up: its links keep working, and you can bring it back from Archived." : "All done.";
    archive.hidden = !live || !s || s.open.length > 0;
  };
};

const VIEWS: Record<string, View> = { watch, connect, done };

export const guide: WidgetSpec = {
  name: "guide",
  title: "Guide",
  icon: "bot",
  hint: "Part of Getting started",
  keywords: "",
  fields: [],
  defaults: {},
  mount(body, env) {
    const view = VIEWS[env.args.step];
    if (!view) return () => {};
    const show = view(body, env);
    let gone = false;
    const stop = watchGuide((s) => {
      if (s?.path === env.note) return show(s, true);
      // Not the checklist the guide is on (archived, a copy, a viewer's): what this note says, without the buttons.
      void api.note(env.note).then(
        (n) => {
          const g = guideState(n.content);
          if (!gone) show(g && { path: n.path, ...g }, false);
        },
        () => !gone && show(null, false),
      );
    });
    return () => {
      gone = true;
      stop();
    };
  },
};
