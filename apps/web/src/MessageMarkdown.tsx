import { createContext, useContext } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { nativeFiles, type Event } from '@harnessrc/protocol';
import { NativeFileLink, GatewayFileLink, NativeMedia } from './NativeMedia.tsx';

const MarkdownEventContext = createContext<Event | undefined>(undefined);
// Stable component types preserve browser selection nodes across updates.
const components: Components = {
  p: ({ children }) => <div className="markdown-paragraph">{children}</div>,
  table: ({ children }) => (
    <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="Scrollable table">
      <table>{children}</table>
    </div>
  ),
  a: function MessageLink({ href, children }) {
    const event = useContext(MarkdownEventContext);
    const index = event
      ? nativeFiles(event).findIndex((f) => f.path === href || encodeURI(f.path) === href)
      : -1;
    return event && index >= 0 ? (
      <NativeFileLink event={event} index={index}>
        {children}
      </NativeFileLink>
    ) : /^\/api\/(?:android\/apk|sessions\/[^/]+\/(?:attachments\/[a-fA-F0-9-]{36}|media\/[a-fA-F0-9-]{36}\/\d{1,2}))$/.test(
        href || '',
      ) ? (
      <GatewayFileLink path={href!}>{children}</GatewayFileLink>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img: function MessageImage({ src, alt }) {
    const event = useContext(MarkdownEventContext);
    const index = event
      ? nativeFiles(event).findIndex((f) => f.path === src || encodeURI(f.path) === src)
      : -1;
    return event && index >= 0 ? (
      <NativeMedia event={event} index={index} />
    ) : (
      <img src={src} alt={alt ?? ''} loading="lazy" />
    );
  },
};
export function MessageMarkdown({ text, event }: { text: string; event?: Event }) {
  return (
    <MarkdownEventContext.Provider value={event}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {text}
      </Markdown>
    </MarkdownEventContext.Provider>
  );
}
