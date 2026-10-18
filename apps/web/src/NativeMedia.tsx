import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image } from '@openuidev/react-ui/Image';
import { Button } from '@harnessrc/ui';
import { Download, X } from 'lucide-react';
import { nativeFiles, mediaKind, type Event } from '@harnessrc/protocol';
import {
  downloadNativeFile,
  nativeMediaUrl,
  downloadResource,
  mediaResourceUrl,
} from '@harnessrc/client-sdk';

type Preview = { blob: Blob; title: string; name: string };
export async function shareFile(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
  else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
const textFile = (name: string) =>
  /\.(txt|md|json|csv|log|ya?ml|xml|html?|css|[cm]?jsx?|tsx?|py|go|rs|sh|kt|java|sql|toml)$/i.test(
    name,
  );
const PreviewContext = createContext<(preview: Preview) => void>(() => {});
/** The viewer outlives virtualized message rows and owns its own object URL. */
export function MediaPreviewProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Preview & { url: string }>();
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);
  const [text, setText] = useState('');
  const [shareError, setShareError] = useState('');
  useEffect(() => {
    setZoom(1);
    setText('');
    setShareError('');
    let cancelled = false;
    if (selected && textFile(selected.name))
      void selected.blob
        .slice(0, 262144)
        .text()
        .then((t) => {
          if (!cancelled) setText(t);
        });
    return () => {
      cancelled = true;
    };
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(selected.url);
  }, [selected]);
  return (
    <PreviewContext.Provider
      value={(value) => setSelected({ ...value, url: URL.createObjectURL(value.blob) })}
    >
      {children}
      {selected && (
        <dialog
          ref={dialog}
          className="image-preview"
          aria-label={`Preview ${selected.title}`}
          onClose={() => setSelected(undefined)}
        >
          <header>
            <strong>{selected.title}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Close image preview"
              onClick={() => dialog.current?.close()}
            >
              <X size={22} />
            </button>
          </header>
          {mediaKind(selected.name) === 'image' ? (
            <>
              <label>
                Zoom{' '}
                <input
                  aria-label="Image zoom"
                  type="range"
                  min="1"
                  max="5"
                  step="0.25"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
              </label>
              <div className="preview-viewport">
                <img
                  style={{ maxWidth: 'none', width: `${zoom * 100}%` }}
                  src={selected.url}
                  alt={selected.title}
                />
              </div>
            </>
          ) : textFile(selected.name) ? (
            <>
              <pre className="file-text-preview">{text}</pre>
              {selected.blob.size > 262144 && (
                <p>Preview limited to 256 KB. Download for the complete file.</p>
              )}
            </>
          ) : (
            <p>Download this document to open it in your preferred app.</p>
          )}
          <Button
            variant="secondary"
            onClick={() =>
              void shareFile(selected.blob, selected.name).catch((e) => {
                if (e.name !== 'AbortError')
                  setShareError('Sharing failed. Download the file to share it.');
              })
            }
          >
            Share file
          </Button>
          {shareError && <p role="alert">{shareError}</p>}
          <Button
            variant="primary"
            onClick={() => {
              const link = document.createElement('a');
              link.href = selected.url;
              link.download = selected.name;
              link.click();
            }}
          >
            Download file
          </Button>
        </dialog>
      )}
    </PreviewContext.Provider>
  );
}

export function NativeMedia({ event, index }: { event: Event; index: number }) {
  const file = nativeFiles(event)[index];
  const [url, setUrl] = useState('');
  const [actionError, setActionError] = useState('');
  const showPreview = useContext(PreviewContext);
  const kind = mediaKind(file?.path ?? '');
  const image = kind === 'image';
  const query = useQuery({
    queryKey: ['native-media', event.sessionId, event.id, index],
    queryFn: () => downloadNativeFile(event.sessionId, event.id, index),
    enabled: !!file && image,
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (!query.data) return;
    const value = URL.createObjectURL(query.data);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [query.data]);
  if (!file) return null;
  const name = file.path.split('/').pop() || 'Generated file';
  const title = file.description || name;
  const preview = async () => {
    const result = query.data ?? (await query.refetch()).data;
    if (result) showPreview({ blob: result, title, name });
  };
  const share = async () => {
    const result = query.data ?? (await query.refetch()).data;
    if (result)
      try {
        await shareFile(result, name);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError'))
          setActionError('Sharing failed. Download the file to share it.');
      }
  };
  const download = async () => {
    const result = query.data ? query.data : (await query.refetch()).data;
    if (!result) return;
    const value = URL.createObjectURL(result);
    const link = document.createElement('a');
    link.href = value;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(value), 1000);
  };
  return (
    <section className="native-media" aria-label={title}>
      {image &&
        (url ? (
          <button
            type="button"
            className="native-media-preview"
            aria-label={`View ${title}`}
            onClick={() => query.data && showPreview({ blob: query.data, title, name })}
          >
            <Image src={url} alt={title} scale="fit" aspectRatio="4:3" />
          </button>
        ) : (
          <div className="native-media-placeholder" role="status">
            {query.isError ? 'Image unavailable' : 'Loading image…'}
          </div>
        ))}
      {kind === 'video' && (
        <video
          controls
          playsInline
          preload="metadata"
          aria-label={title}
          src={nativeMediaUrl(event.sessionId, event.id, index)}
        />
      )}
      {kind === 'audio' && (
        <audio
          controls
          preload="metadata"
          aria-label={title}
          src={nativeMediaUrl(event.sessionId, event.id, index)}
        />
      )}
      <div className="native-media-caption">
        <strong>{title}</strong>
        <span>{name}</span>
      </div>
      {textFile(name) && (
        <Button variant="secondary" onClick={() => void preview()} disabled={query.isFetching}>
          Preview file
        </Button>
      )}
      <Button variant="secondary" onClick={() => void share()} disabled={query.isFetching}>
        Share file
      </Button>
      {actionError && <p role="alert">{actionError}</p>}
      {query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry file
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => void download()} disabled={query.isFetching}>
          <Download size={18} /> Download
        </Button>
      )}
    </section>
  );
}
export function NativeMediaGallery({ event }: { event: Event }) {
  return (
    <div className="native-media-gallery">
      {nativeFiles(event).map((file, index) => (
        <NativeMedia key={`${index}:${file.path}`} event={event} index={index} />
      ))}
    </div>
  );
}

export function NativeFileLink({
  event,
  index,
  children,
}: {
  event: Event;
  index: number;
  children: ReactNode;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="native-file-link"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const blob = await downloadNativeFile(event.sessionId, event.id, index);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = nativeFiles(event)[index].path.split('/').pop() || 'file';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Download failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Downloading…' : children}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

/** Fetch first: auth errors remain in chat, and Android/web never navigate into an API error. */
export function GatewayFileLink({ path, children }: { path: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <a
        href={mediaResourceUrl(path)}
        aria-busy={busy}
        onClick={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const result = await downloadResource(path);
            const url = URL.createObjectURL(result.blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = result.name;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Download failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Downloading…' : children}
      </a>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

export function FileActions({ name, load }: { name: string; load: () => Promise<Blob> }) {
  const show = useContext(PreviewContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (share: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const blob = await load();
      if (share) await shareFile(blob, name);
      else show({ blob, name, title: name });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError('Could not open the file. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="file-actions">
      {textFile(name) && (
        <button disabled={busy} onClick={() => void act(false)}>
          Preview file
        </button>
      )}
      <button disabled={busy} onClick={() => void act(true)}>
        Share file
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
