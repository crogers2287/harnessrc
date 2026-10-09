/** A PWA launch may restore a chat state without restoring its preceding entry. */
export function prepareMobileHistory() {
  if (!matchMedia('(max-width: 767px)').matches) return;
  const route = new URLSearchParams(location.search);
  if (route.get('view')) return;
  // Seed for this document before authentication/network work. Never assume a
  // persisted relayChat marker proves the installed app retained its back stack.
  history.replaceState({ relayDrawer: true, relayDrawerBase: true }, '', location.href);
  history.pushState({ relayChat: true }, '', location.href);
}
