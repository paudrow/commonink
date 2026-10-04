// Sharing a note or folder with people outside the workspace, by email or by link. Only hosted
// workspaces can (CommandHost.sharing); locally there's no one else to share with.
import { VaultError } from "../paths.ts";
import { bool, command, num, str, type CommandHost, type Sharing } from "./types.ts";

const sharingOf = (h: CommandHost): Sharing => {
  if (!h.sharing) throw new VaultError("Sharing is only in hosted workspaces: there's no one else to share a local vault with");
  return h.sharing;
};
const TARGET = {
  path: str({ pos: 0, label: "note", describe: "The note (path, name or ID)" }),
  folder: str({ describe: "Or a folder: the share covers everything in it" }),
} as const;

export const sharing = [
  command({
    cli: "share list",
    mcp: "list_shares",
    was: { cli: ["shares"] },
    route: "GET /shares",
    title: "List shares",
    summary: "Who a note or folder is shared with outside the workspace, or everything it shares",
    description: "Who a note or folder is shared with outside the workspace (people and links, with roles and expiry), or everything the workspace shares.",
    examples: ["commonink share list 'Plan for Sam'", "commonink share list --folder Projects", "commonink share list"],
    readOnly: true,
    needs: "sharing",
    args: TARGET,
    run: async (h, a) => {
      const text = await sharingOf(h).list({ path: a.path, folder: a.folder });
      return { text, data: text };
    },
  }),
  command({
    cli: "share",
    mcp: "share_note",
    route: "POST /shares",
    title: "Share note",
    summary: "Share a note or folder with someone outside the workspace, or by link",
    description:
      "Share a note or folder with someone outside the workspace by email (people without an account get it when they sign in " +
      "with that email), or with anyone who has the link. Only share what the user asked to share, with whom they said.",
    examples: ["commonink share 'Plan for Sam' --email sam@example.com --role viewer", "commonink share --folder Projects --link --role viewer --expires-in-days 7"],
    needs: "sharing",
    openWorld: true,
    args: {
      ...TARGET,
      email: str({ describe: "The person's email address" }),
      link: bool({ describe: "Share with anyone who has the link instead" }),
      role: str({ required: true, enum: ["viewer", "editor"] }),
      expires_in_days: num({ min: 1, max: 365, describe: "Stop sharing after this many days" }),
    },
    run: async (h, a) => {
      const text = await sharingOf(h).share({ path: a.path, folder: a.folder, email: a.email, link: a.link, role: a.role as "viewer" | "editor", expiresInDays: a.expires_in_days });
      return { text, data: text };
    },
  }),
  command({
    cli: "unshare",
    mcp: "unshare_note",
    route: "POST /shares/remove",
    title: "Stop sharing",
    summary: "Stop one share: that person, or the link, loses access at once",
    description: "Stop one share (its id from list_shares): that person, or the link, loses access at once.",
    examples: ["commonink unshare k3m9x2p7"],
    destructive: true,
    needs: "sharing",
    args: { id: str({ required: true, pos: 0, describe: "The share's id from list_shares (commonink share list)" }) },
    run: async (h, a) => {
      const text = await sharingOf(h).unshare(a.id);
      return { text, data: text };
    },
  }),
];
