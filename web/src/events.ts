// Vault-wide change notifications for live widgets (task lists, note lists, calendars).
export const vaultEvents = new EventTarget();

export function onVaultChange(fn: () => void, ms = 250): () => void {
  let t = 0;
  const handler = () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
  vaultEvents.addEventListener("change", handler);
  return () => {
    clearTimeout(t);
    vaultEvents.removeEventListener("change", handler);
  };
}
