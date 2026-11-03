import { Loader2, Mic, MicOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAiStatus } from '@/modules/ai/api';
import { Button } from './ui/button';

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult:
    ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function speech(): (new () => Recognition) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const canRecord = () =>
  typeof window !== 'undefined' && 'MediaRecorder' in window && Boolean(navigator.mediaDevices);

/** Send one recording to the company's speech-to-text (OpenAI Whisper or Gemini, set in System Master → AI). */
async function transcribe(blob: Blob, lang: 'hi' | 'en'): Promise<string> {
  const body = new FormData();
  body.append('file', blob, `speech.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`);
  const res = await fetch(`/api/ai/transcribe?lang=${lang}`, {
    method: 'POST',
    body,
    credentials: 'same-origin',
  });
  const json = (await res.json()) as { text?: string; error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? 'Speech to text failed');
  return json.text ?? '';
}

/**
 * Dictate / Speak (CLAUDE.md §13): the company's speech-to-text when it is set up (Hindi or English),
 * else the browser's own recognition (Chrome/Android). Adds the words to the end of the text.
 */
export function DictateButton({ onText, lang }: { onText: (text: string) => void; lang?: 'hi' | 'en' }) {
  const { t, i18n } = useTranslation();
  const status = useAiStatus();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const language = lang ?? (i18n.language === 'hi' ? 'hi' : 'en');
  const server = status.data && status.data.stt !== 'browser' && canRecord();
  const Ctor = speech();
  if (!server && !Ctor) return null;

  const startServer = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(t('work.dictate.noMic'));
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      setOn(false);
      if (!chunks.length) return;
      setBusy(true);
      try {
        const text = await transcribe(new Blob(chunks, { type: r.mimeType || 'audio/webm' }), language);
        if (text) onText(text);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(false);
      }
    };
    recorder.current = r;
    r.start();
    setOn(true);
  };

  const startBrowser = () => {
    const r = new Ctor!();
    r.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (last?.isFinal) onText(last[0]!.transcript.trim());
    };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  };

  const toggle = () => {
    if (on) {
      if (server) recorder.current?.stop();
      else rec.current?.stop();
      return;
    }
    if (server) void startServer();
    else startBrowser();
  };
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? 'destructive' : 'secondary'}
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
    >
      {busy ? <Loader2 className="animate-spin" /> : on ? <MicOff /> : <Mic />}{' '}
      {busy ? t('work.dictate.writing') : on ? t('work.dictate.stop') : t('work.dictate.start')}
    </Button>
  );
}
