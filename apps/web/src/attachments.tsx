import { useEffect, useRef, useState } from 'react';
import { Camera, FilePlus2, ImagePlus, Paperclip, X, RotateCcw } from 'lucide-react';
import { api, uploadFile, downloadAttachment } from '@harnessrc/client-sdk';
export type DraftFile = {
  key: string;
  id?: string;
  name: string;
  size: number;
  mime: string;
  progress: number;
  error?: string;
  preview?: string;
  file?: File;
};
export function restoreFiles(sessionId: string): DraftFile[] {
  try {
    return JSON.parse(sessionStorage.getItem(`relay-files:${sessionId}`) ?? '[]');
  } catch {
    return [];
  }
}
export function useAttachments(sessionId: string) {
  const [files, setFiles] = useState<DraftFile[]>(() => restoreFiles(sessionId));
  const previews = useRef<string[]>([]);
  useEffect(
    () => () => {
      previews.current.forEach(URL.revokeObjectURL);
    },
    [],
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(
        `relay-files:${sessionId}`,
        JSON.stringify(
          files
            .filter((f) => f.id)
            .map(({ id, key, name, size, mime }) => ({ id, key, name, size, mime, progress: 100 })),
        ),
      );
    } catch {
      /* Private browsing may restrict storage. */
    }
  }, [files, sessionId]);
  const upload = async (entry: DraftFile) => {
    if (!entry.file) return;
    const update = (data: Partial<DraftFile>) =>
      setFiles((current) => current.map((f) => (f.key === entry.key ? { ...f, ...data } : f)));
    update({ error: undefined, progress: 0 });
    try {
      const { attachment } = await uploadFile(sessionId, entry.file, (progress) =>
        update({ progress }),
      );
      update({ ...attachment, progress: 100 });
    } catch (error) {
      update({ error: (error as Error).message });
    }
  };
  const add = (selected: File[]) => {
    const space = Math.max(0, 10 - files.length);
    const added = selected.slice(0, space).map((file) => {
      const preview = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
        ? URL.createObjectURL(file)
        : undefined;
      if (preview) previews.current.push(preview);
      return {
        key: crypto.randomUUID(),
        file,
        name: file.name,
        mime: file.type,
        size: file.size,
        preview,
        progress: 0,
        error:
          file.size > 20 * 1024 * 1024
            ? 'Maximum file size is 20 MB.'
            : !file.size
              ? 'This file is empty.'
              : undefined,
      };
    });
    setFiles((current) => [...current, ...added]);
    for (const entry of added) if (!entry.error) void upload(entry);
  };
  const remove = async (entry: DraftFile) => {
    try {
      if (entry.id)
        await api(`/api/sessions/${sessionId}/attachments/${entry.id}`, { method: 'DELETE' });
      setFiles((current) => current.filter((f) => f.key !== entry.key));
    } catch (error) {
      setFiles((current) =>
        current.map((f) => (f.key === entry.key ? { ...f, error: (error as Error).message } : f)),
      );
    }
  };
  const clear = (ids: string[]) =>
    setFiles((current) => current.filter((f) => !f.id || !ids.includes(f.id)));
  return {
    files,
    add,
    remove,
    retry: upload,
    clear,
    busy: files.some((f) => !f.id && !f.error),
    invalid: files.some((f) => !!f.error),
  };
}
export function AttachmentPicker({
  disabled,
  add,
}: {
  disabled: boolean;
  add: (files: File[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const photos = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null),
    documents = useRef<HTMLInputElement>(null);
  const pick = (input: HTMLInputElement) => {
    add(Array.from(input.files ?? []));
    input.value = '';
    setOpen(false);
  };
  return (
    <div className="attachment-picker">
      <button
        type="button"
        className="icon-button"
        aria-label="Add files or images"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Paperclip size={21} />
      </button>
      {open && (
        <div className="attachment-menu" role="group" aria-label="Attachment options">
          <button type="button" onClick={() => photos.current?.click()}>
            <ImagePlus size={20} />
            Photos
          </button>
          <button type="button" onClick={() => camera.current?.click()}>
            <Camera size={20} />
            Camera
          </button>
          <button type="button" onClick={() => documents.current?.click()}>
            <FilePlus2 size={20} />
            Files
          </button>
        </div>
      )}
      <input
        ref={photos}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => pick(e.currentTarget)}
        aria-label="Choose photos"
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => pick(e.currentTarget)}
        aria-label="Take a photo"
      />
      <input
        ref={documents}
        type="file"
        multiple
        hidden
        onChange={(e) => pick(e.currentTarget)}
        aria-label="Choose files"
      />
    </div>
  );
}
export function AttachmentTray({ value }: { value: ReturnType<typeof useAttachments> }) {
  if (!value.files.length) return null;
  return (
    <div className="attachment-tray" aria-label="Message attachments">
      {value.files.map((file) => (
        <div className={`attachment-chip ${file.error ? 'has-error' : ''}`} key={file.key}>
          {file.preview ? (
            <img src={file.preview} alt={`Preview of ${file.name}`} />
          ) : (
            <Paperclip size={22} aria-hidden="true" />
          )}
          <div>
            <strong title={file.name}>{file.name}</strong>
            <span role="status">
              {file.error ||
                (file.id
                  ? `${Math.max(1, Math.round(file.size / 1024))} KB · Ready`
                  : `Uploading ${file.progress}%`)}
            </span>
            {!file.id && !file.error && (
              <progress value={file.progress} max={100} aria-label={`Uploading ${file.name}`} />
            )}
          </div>
          {file.error && file.file && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Retry ${file.name}`}
              onClick={() => void value.retry(file)}
            >
              <RotateCcw size={18} />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            disabled={!file.id && !file.error}
            aria-label={`Remove ${file.name}`}
            onClick={() => void value.remove(file)}
          >
            <X size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function SentAttachment({
  sessionId,
  file,
}: {
  sessionId: string;
  file: { id: string; name: string; mime?: string };
}) {
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const isImage = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mime ?? '');
  useEffect(() => {
    if (!isImage) return;
    let disposed = false,
      url = '';
    void downloadAttachment(sessionId, file.id)
      .then((blob) => {
        if (disposed) return;
        url = URL.createObjectURL(new Blob([blob], { type: file.mime }));
        setPreview(url);
      })
      .catch(() => {
        /* The download control still offers an explicit retry. */
      });
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sessionId, file.id, file.mime, isImage]);
  const download = async () => {
    setError('');
    try {
      const blob = await downloadAttachment(sessionId, file.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Download failed. Tap the file to retry.');
    }
  };
  return (
    <div className="sent-file">
      <button
        type="button"
        onClick={() => (preview ? dialog.current?.showModal() : void download())}
      >
        {preview ? <img src={preview} alt="" /> : <Paperclip size={18} />}
        <span>{file.name}</span>
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preview && (
        <dialog ref={dialog} className="image-preview" aria-label={`Preview ${file.name}`}>
          <header>
            <strong>{file.name}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Close image preview"
              onClick={() => dialog.current?.close()}
            >
              <X size={22} />
            </button>
          </header>
          <img src={preview} alt={file.name} />
          <button type="button" className="primary" onClick={() => void download()}>
            Download image
          </button>
        </dialog>
      )}
    </div>
  );
}
