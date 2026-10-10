import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

/** Rich-editable for Android IME image admission; its message value stays plain text. */
export const ComposerInput = forwardRef<
  HTMLDivElement,
  {
    value: string;
    placeholder: string;
    onChange: (text: string) => void;
    onFiles: (files: File[]) => void;
    allowFiles: boolean;
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  }
>(function ComposerInput(
  { value, placeholder, onChange, onFiles, allowFiles, onKeyDown },
  forwarded,
) {
  const input = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const lastEmitted = useRef(value);
  const deferred = useRef('');
  const [error, setError] = useState('');
  useImperativeHandle(forwarded, () => input.current!, []);
  const read = () => {
    const text = input.current?.innerText.replaceAll('\r\n', '\n') ?? '';
    return !input.current?.textContent && text === '\n' ? '' : text;
  };
  const resize = () => {
    if (!input.current) return;
    input.current.style.height = 'auto';
    input.current.style.height = `${Math.min(input.current.scrollHeight, 160)}px`;
  };
  const replace = (text: string) => {
    const node = input.current!;
    node.textContent = text;
    if (document.activeElement === node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    resize();
  };
  useLayoutEffect(() => {
    if (read() === value) {
      resize();
      return;
    }
    if (composing.current) {
      // Dictation can append while a keyboard is composing a word. Keep both.
      if (value !== lastEmitted.current && value.startsWith(lastEmitted.current))
        deferred.current += value.slice(lastEmitted.current.length);
      return;
    }
    replace(value);
  }, [value]);
  const changed = () => {
    const text = read() + deferred.current;
    lastEmitted.current = text;
    onChange(text);
    resize();
  };
  const insertText = (text: string) => {
    if (!text) return;
    // Native editing command retains caret replacement and Undo history.
    if (!document.execCommand('insertText', false, text)) {
      const selection = window.getSelection();
      if (selection?.rangeCount && input.current?.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    changed();
  };
  const filesFrom = (data: DataTransfer) => {
    const files = Array.from(data.files);
    return files.length
      ? files
      : Array.from(data.items).flatMap((item) => {
          const file = item.kind === 'file' ? item.getAsFile() : null;
          return file ? [file] : [];
        });
  };
  const attach = (files: File[]) => {
    if (!allowFiles) {
      setError('Attachments are unavailable for this session.');
      return;
    }
    setError('');
    onFiles(files);
  };
  return (
    <>
      <div
        ref={input}
        id="composer"
        className="composer-input openui-textarea"
        role="textbox"
        aria-label="Instruction"
        aria-multiline="true"
        contentEditable={true}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-empty={value === ''}
        spellCheck
        autoCapitalize="sentences"
        inputMode="text"
        onInput={changed}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          if (deferred.current) {
            const text = read() + deferred.current;
            deferred.current = '';
            replace(text);
          }
          changed();
        }}
        onPaste={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const files = filesFrom(event.clipboardData);
          if (files.length) attach(files);
          insertText(event.clipboardData.getData('text/plain'));
        }}
        onBeforeInput={(event) => {
          const native = event.nativeEvent as InputEvent;
          if (native.inputType?.startsWith('format')) event.preventDefault();
          if (native.inputType === 'insertFromPaste' && native.dataTransfer) {
            const files = filesFrom(native.dataTransfer);
            if (files.length) {
              event.preventDefault();
              attach(files);
            }
          }
        }}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            ['b', 'i', 'u'].includes(event.key.toLowerCase())
          ) {
            event.preventDefault();
            return;
          }
          if (!composing.current && !event.nativeEvent.isComposing) onKeyDown(event);
        }}
      />
      {error && (
        <p role="alert" className="helper error">
          {error}
        </p>
      )}
    </>
  );
});
