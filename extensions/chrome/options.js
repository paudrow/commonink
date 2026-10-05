// Settings: which Common Ink server captures go to. Chrome asks the person before the extension may reach a new one.
import { hostPattern, loadSettings, serverOrigin } from "./lib.js";

const input = document.getElementById("server");
const status = document.getElementById("status");
input.value = (await loadSettings()).server;

document.getElementById("settings").addEventListener("submit", async (e) => {
  e.preventDefault();
  const server = serverOrigin(input.value);
  if (!server) return void (status.textContent = "That isn't a Common Ink address: it starts with https://");
  if (!(await chrome.permissions.request({ origins: [hostPattern(server)] }))) return void (status.textContent = `Not saved: the extension wasn't allowed to reach ${new URL(server).host}.`);
  // A workspace belongs to one server, so the choice of one doesn't carry over.
  await chrome.storage.sync.set({ server, workspace: "" });
  input.value = server;
  status.textContent = "Saved.";
});
