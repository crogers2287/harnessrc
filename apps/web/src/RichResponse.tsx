import { mediaResourceUrl } from '@harnessrc/client-sdk';
import { ThemeProvider } from '@openuidev/react-ui';
import { Component, useContext, useEffect, useState, type ReactNode } from 'react';
import { Renderer, type ActionEvent } from '@openuidev/react-lang';
import { openuiLibrary } from '@openuidev/react-ui/genui-lib';
import '@openuidev/react-ui/index.css';

import { RichActionContext } from './rich-context.ts';
/** No toolProvider: generated interfaces never receive agent or gateway execution privileges. */
class RichBoundary extends Component<{ children: ReactNode; source: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <details>
        <summary>Interactive response unavailable — view source</summary>
        <pre>{this.props.source}</pre>
      </details>
    ) : (
      this.props.children
    );
  }
}
export function actionDraft(event: ActionEvent): string | undefined {
  if (event.type !== 'continue_conversation') return;
  const label = event.humanFriendlyMessage?.trim();
  if (!label) return;
  const fields: string[] = [];
  for (const form of Object.values(event.formState || {})) {
    if (!form || typeof form !== 'object' || Array.isArray(form)) continue;
    for (const [name, field] of Object.entries(form)) {
      if (!field || typeof field !== 'object' || !('value' in field)) continue;
      const value = (field as { value: unknown }).value;
      const title = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
      const content = typeof value === 'string' ? value : JSON.stringify(value);
      fields.push(`${title.charAt(0).toUpperCase()}${title.slice(1)}: ${content}`);
    }
  }
  return [label, ...fields].join('\n').slice(0, 32000);
}
export type RichProps = {
  source: string;
  id: string;
  sessionId?: string;
  initialState?: Record<string, unknown>;
  onState?: (state: Record<string, unknown>) => void;
  streaming?: boolean;
  onAction?: (text: string) => void;
};
export function RichResponse({
  source,
  id,
  sessionId,
  initialState,
  onState,
  streaming = false,
  onAction,
}: RichProps) {
  const linkedSource = sessionId
    ? source.replace(
        /"(\/api\/sessions\/[^"\s]+\/(?:attachments\/[a-fA-F0-9-]{36}|media\/[a-fA-F0-9-]{36}\/\d{1,2}))"/g,
        (raw, path: string) =>
          path.startsWith(`/api/sessions/${sessionId}/`)
            ? JSON.stringify(mediaResourceUrl(path))
            : raw,
      )
    : source;
  const draft = useContext(RichActionContext);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () =>
      setDark(
        document.documentElement.dataset.theme === 'dark' ||
          (document.documentElement.dataset.theme !== 'light' && media.matches),
      );
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    media.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
    };
  }, []);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [initial] = useState(() => {
    try {
      return initialState || JSON.parse(sessionStorage.getItem(`relay-rich:${id}`) || '{}');
    } catch {
      return {};
    }
  });
  return (
    <section className="rich-response" aria-label="Interactive response">
      <RichBoundary key={id} source={source}>
        <ThemeProvider
          mode={dark ? 'dark' : 'light'}
          cssSelector=".rich-response"
          lightTheme={{
            interactiveAccentDefault: 'var(--accent, #26786d)',
            interactiveAccentHover: 'var(--accent, #26786d)',
            interactiveAccentPressed: 'var(--accent, #26786d)',
            textAccentPrimary: 'var(--on-accent, #fff)',
          }}
        >
          <Renderer
            library={openuiLibrary}
            publishObservability={false}
            response={linkedSource}
            isStreaming={streaming}
            initialState={initial}
            onStateUpdate={(state) => {
              onState?.(state);
              try {
                const value = JSON.stringify(state);
                if (value.length <= 64000) sessionStorage.setItem(`relay-rich:${id}`, value);
              } catch {
                /* Private browsing: local interactions still work. */
              }
            }}
            onAction={(event) => {
              const text = actionDraft(event);
              if (text) {
                (onAction || draft)(text);
                setNotice('Added to your draft. Review and send when ready.');
              }
            }}
            onError={(list) => setErrors(list.map((e) => e.message))}
          />
        </ThemeProvider>
      </RichBoundary>
      {notice && <p role="status">{notice}</p>}
      {!!errors.length && (
        <details className="rich-errors">
          <summary>Some parts could not be displayed</summary>
          <p>{errors.join('\n')}</p>
          <pre>{source}</pre>
        </details>
      )}
    </section>
  );
}

export default RichResponse;
