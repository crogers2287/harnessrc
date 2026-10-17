import { createRoot } from 'react-dom/client';
import { RichResponse } from './RichResponse.tsx';
import './rich.css';

declare global {
  interface Window {
    RelayRich: {
      render: (value: {
        source: string;
        id: string;
        sessionId: string;
        initialState?: Record<string, unknown>;
        dark: boolean;
        accent?: string;
        onAccent?: string;
        streaming: boolean;
      }) => void;
    };
    RelayArtifact?: {
      action: (value: string) => void;
      height: (value: number) => void;
      state: (value: string) => void;
    };
  }
}
const root = createRoot(document.getElementById('root')!);
window.RelayRich = {
  render(value) {
    document.documentElement.dataset.theme = value.dark ? 'dark' : 'light';
    if (/^#[0-9a-f]{6}$/i.test(value.accent || ''))
      document.documentElement.style.setProperty('--accent', value.accent!);
    if (/^#[0-9a-f]{6}$/i.test(value.onAccent || ''))
      document.documentElement.style.setProperty('--on-accent', value.onAccent!);
    root.render(
      <RichResponse
        source={value.source.slice(0, 100000)}
        id={value.id}
        sessionId={value.sessionId}
        initialState={value.initialState}
        onState={(state) => window.RelayArtifact?.state(JSON.stringify(state))}
        streaming={value.streaming}
        onAction={(message) => window.RelayArtifact?.action(message)}
      />,
    );
  },
};
new ResizeObserver(() =>
  window.RelayArtifact?.height(
    Math.ceil(document.getElementById('root')!.getBoundingClientRect().height + 16),
  ),
).observe(document.getElementById('root')!);
// Model links and forms do not navigate the isolated artifact document.
document.addEventListener('click', (event) => {
  if ((event.target as Element)?.closest('a')) event.preventDefault();
});
document.addEventListener('submit', (event) => event.preventDefault());
