import { useSyncExternalStore } from 'react';
type InstallPrompt = Event & {
  prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' } | void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
let prompt: InstallPrompt | undefined;
let installed =
  matchMedia('(display-mode: standalone)').matches ||
  !!(navigator as Navigator & { standalone?: boolean }).standalone;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  prompt = event as InstallPrompt;
  emit();
});
window.addEventListener('appinstalled', () => {
  installed = true;
  prompt = undefined;
  emit();
});
matchMedia('(display-mode: standalone)').addEventListener('change', (e) => {
  installed = e.matches;
  emit();
});
export function useInstall() {
  const state = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => (installed ? 'installed' : prompt ? 'ready' : 'manual'),
  );
  return {
    state,
    install: async () => {
      const current = prompt;
      if (!current) return 'unavailable';
      prompt = undefined;
      emit();
      // Called directly from the click, before awaiting anything, to preserve user activation.
      const result = await current.prompt();
      return (result ?? (await current.userChoice))?.outcome ?? 'unavailable';
    },
  };
}
