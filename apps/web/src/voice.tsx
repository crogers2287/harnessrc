import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mic, Square, X, RotateCcw } from 'lucide-react';
import { api } from '@harnessrc/client-sdk';
type Phase = 'idle' | 'permission' | 'recording' | 'transcribing' | 'error' | 'done';
type Result = { text: string; original: string; cleaned: boolean; warning?: string };
export function useVoiceInput(sessionId: string, insert: (text: string) => void) {
  const settings = useQuery<{ enabled: boolean; maxSeconds: number }>({
    queryKey: ['voice'],
    queryFn: () => api('/api/voice'),
  });
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const changePhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result>();
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const context = useRef<AudioContext | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const audio = useRef<Blob | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const insertRef = useRef(insert);
  insertRef.current = insert;
  const busy = ['permission', 'recording', 'transcribing'].includes(phase);
  const release = () => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
    void context.current?.close().catch(() => {});
    context.current = undefined;
  };
  const cancel = () => {
    generation.current++;
    abort.current?.abort();
    if (recorder.current?.state === 'recording') recorder.current.stop();
    release();
    audio.current = undefined;
    changePhase('idle');
    setError('');
    setResult(undefined);
  };
  useEffect(() => {
    return () => {
      generation.current++;
      abort.current?.abort();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      release();
    };
  }, [sessionId]);
  const transcribe = async (blob: Blob, token: number) => {
    if (phaseRef.current === 'transcribing') return;
    changePhase('transcribing');
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 125000);
    try {
      const value = await api<Result>(
        `/api/sessions/${sessionId}/dictation?mime=${encodeURIComponent(blob.type.split(';')[0])}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: blob,
          signal: controller.signal,
        },
      );
      if (generation.current !== token) return;
      if (!value.text.trim()) throw new Error('No speech was detected. Try recording again.');
      insertRef.current(value.text);
      audio.current = undefined;
      setResult(value);
      changePhase('done');
    } catch (err) {
      if (generation.current !== token) return;
      setError(
        controller.signal.aborted
          ? 'Transcription timed out. Retry your recording.'
          : (err as Error).message,
      );
      changePhase('error');
    } finally {
      clearTimeout(timeout);
    }
  };
  const start = async () => {
    if (['permission', 'recording', 'transcribing'].includes(phaseRef.current)) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(
        'Voice recording is unavailable in this browser. Use your keyboard’s microphone instead.',
      );
      changePhase('error');
      return;
    }
    const token = ++generation.current;
    setResult(undefined);
    setError('');
    setSeconds(0);
    setLevel(0);
    changePhase('permission');
    audio.current = undefined;
    try {
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (generation.current !== token) {
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = input;
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/webm',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser does not provide a supported recording format.');
      const recording = new MediaRecorder(input, { mimeType, audioBitsPerSecond: 64000 });
      recorder.current = recording;
      const chunks: Blob[] = [];
      let size = 0;
      recording.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          size += event.data.size;
        }
      };
      recording.onerror = () => {
        if (generation.current !== token) return;
        generation.current++;
        release();
        setError('Recording stopped unexpectedly. Please try again.');
        changePhase('error');
      };
      recording.onstop = () => {
        if (generation.current !== token) return;
        release();
        const blob = new Blob(chunks, { type: recording.mimeType });
        if (!blob.size || blob.size > 10 * 1024 * 1024) {
          setError('Recording is empty or too large. Record a shorter message.');
          changePhase('error');
          return;
        }
        audio.current = blob;
        void transcribe(blob, token);
      };
      let analyser: AnalyserNode | undefined;
      try {
        const ctx = new AudioContext();
        context.current = ctx;
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(input).connect(analyser);
        void ctx.resume().catch(() => {});
      } catch {
        /* Recording works without a level meter. */
      }
      const started = Date.now();
      recording.start(1000);
      changePhase('recording');
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (analyser) {
          const samples = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(samples);
          setLevel(
            Math.min(
              100,
              Math.sqrt(samples.reduce((sum, n) => sum + (n - 128) ** 2, 0) / samples.length) * 4,
            ),
          );
        }
        if (
          (elapsed >= (settings.data?.maxSeconds ?? 180) || size >= 9 * 1024 * 1024) &&
          recording.state === 'recording'
        )
          recording.stop();
      }, 150);
    } catch (err) {
      if (generation.current !== token) return;
      release();
      const name = (err as Error).name;
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : (err as Error).message,
      );
      changePhase('error');
    }
  };
  // Stop capture when the page is left; late permission and transcription replies are ignored.
  useEffect(() => {
    const hidden = () => {
      if (document.hidden && recorder.current?.state === 'recording') recorder.current.stop();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);
  if (!settings.data?.enabled) return { busy: false, button: null, panel: null };
  return {
    busy,
    button: (
      <button
        type="button"
        className={`voice-button ${phase === 'recording' ? 'is-recording' : ''}`}
        aria-label={phase === 'recording' ? 'Stop recording and transcribe' : 'Dictate message'}
        title="Dictate message"
        disabled={phase === 'permission' || phase === 'transcribing'}
        onClick={() => (phase === 'recording' ? recorder.current?.stop() : void start())}
      >
        {phase === 'recording' ? (
          <Square size={20} aria-hidden="true" />
        ) : (
          <Mic size={22} aria-hidden="true" />
        )}
      </button>
    ),
    panel: phase !== 'idle' && (
      <div className="voice-panel" aria-label="Voice input">
        <div className="voice-status">
          <span role="status">
            {phase === 'permission'
              ? 'Allow microphone access to dictate'
              : phase === 'recording'
                ? `Listening · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
                : phase === 'transcribing'
                  ? 'Transcribing and cleaning up…'
                  : phase === 'done'
                    ? result?.warning || 'Added to your draft. Review before sending.'
                    : 'Voice input needs attention'}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={busy ? 'Cancel voice input' : 'Dismiss voice input'}
            onClick={cancel}
          >
            <X size={20} />
          </button>
        </div>
        {phase === 'recording' && (
          <>
            <meter aria-label="Microphone level" min={0} max={100} value={level} />
            <button type="button" className="voice-finish" onClick={() => recorder.current?.stop()}>
              <Square size={16} />
              Finish dictation
            </button>
          </>
        )}
        {phase === 'error' && (
          <>
            <p role="alert">{error}</p>
            {audio.current && (
              <button
                type="button"
                onClick={() => void transcribe(audio.current!, generation.current)}
              >
                <RotateCcw size={16} />
                Retry transcription
              </button>
            )}
          </>
        )}
        {phase === 'done' && result?.cleaned && (
          <details>
            <summary>Original transcription</summary>
            <p>{result.original}</p>
          </details>
        )}
      </div>
    ),
  };
}
