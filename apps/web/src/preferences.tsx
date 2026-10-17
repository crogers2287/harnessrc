import { useSyncExternalStore } from 'react';

export type Preferences = { textSize: string; spacing: string; activity: string; haptics: boolean };
const defaults: Preferences = {
  textSize: 'standard',
  spacing: 'comfortable',
  activity: 'grouped',
  haptics: false,
};
let current: Preferences = { ...defaults };
try {
  current = { ...defaults, ...JSON.parse(localStorage.getItem('relay-preferences') || '{}') };
} catch {
  /* default */
}
const listeners = new Set<() => void>();
export function applyPreferences() {
  const root = document.documentElement;
  root.dataset.spacing = current.spacing;
  root.dataset.activity = current.activity;
  root.dataset.textSize = current.textSize;
}
export function setPreferences(patch: Partial<Preferences>) {
  current = { ...current, ...patch };
  localStorage.setItem('relay-preferences', JSON.stringify(current));
  applyPreferences();
  listeners.forEach((fn) => fn());
}
export function usePreferences() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => current,
  );
}
export function feedback() {
  if (current.haptics) navigator.vibrate?.(12);
}
export function ReadingPreferences() {
  const value = usePreferences();
  return (
    <fieldset className="reading-preferences">
      <legend>Reading & interaction</legend>
      <label>
        Text size
        <select
          aria-label="Text size"
          value={value.textSize}
          onChange={(e) => setPreferences({ textSize: e.target.value })}
        >
          <option value="standard">Standard</option>
          <option value="large">Large</option>
          <option value="larger">Larger</option>
        </select>
      </label>
      <label>
        Message spacing
        <select
          aria-label="Message spacing"
          value={value.spacing}
          onChange={(e) => setPreferences({ spacing: e.target.value })}
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <label>
        Activity detail
        <select
          aria-label="Activity detail"
          value={value.activity}
          onChange={(e) => setPreferences({ activity: e.target.value })}
        >
          <option value="responses">Responses only</option>
          <option value="grouped">Grouped tools</option>
          <option value="everything">Everything</option>
        </select>
      </label>
      <label className="preference-toggle">
        <input
          type="checkbox"
          checked={value.haptics}
          onChange={(e) => {
            setPreferences({ haptics: e.target.checked });
            feedback();
          }}
        />
        Haptic feedback
      </label>
      <p className="helper">
        Haptics work where your browser supports vibration. Questions and artifacts stay visible at
        every detail level.
      </p>
      <div className="reading-preview">
        <strong>Conversation preview</strong>
        <p>Your agent’s replies use this text size and spacing.</p>
      </div>
    </fieldset>
  );
}
