/** A PWA launch may restore a chat state without restoring its preceding entry. */
export function prepareMobileHistory() {
  if (!matchMedia('(max-width: 767px)').matches) return;
  const route = new URLSearchParams(location.search);
  if (route.get('view')) return;
  // Seed for this document before authentication/network work. Never assume a
  // persisted relayChat marker proves the installed app retained its back stack.
  history.replaceState({ relayDrawer: true, relayDrawerBase: true }, '', location.href);
  history.pushState({ relayChat: true }, '', location.href);
  watchMobileBack(true);
}

// Chrome skips history entries created before user activation when Android Back
// is pressed. CloseWatcher receives that native close request even on cold start.
// Consume one close request; never cancel it or trap repeated Back presses.
type NativeWatcher = EventTarget & { destroy(): void };
let watcher: NativeWatcher | undefined;
export function watchMobileBack(enabled: boolean) {
  if (!enabled) {
    watcher?.destroy();
    watcher = undefined;
    return;
  }
  const Constructor = (window as unknown as { CloseWatcher?: new () => NativeWatcher })
    .CloseWatcher;
  if (!Constructor || watcher) return;
  watcher = new Constructor();
  watcher.addEventListener(
    'close',
    () => {
      watcher = undefined;
      if (history.state?.relayChat) history.back();
      else window.dispatchEvent(new Event('relay-open-sessions'));
    },
    { once: true },
  );
}
