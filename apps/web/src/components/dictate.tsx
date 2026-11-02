import { Mic, MicOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/**
 * Dictate: the browser's own speech recognition (Chrome/Android, Hindi or English) until the AI
 * speech-to-text of phase 6 is connected. Adds the words to the end of the text.
 */
export function DictateButton({ onText }: { onText: (text: string) => void }) {
  const { t, i18n } = useTranslation();
  const [on, setOn] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const Ctor = speech();
  if (!Ctor) return null;
  const toggle = () => {
    if (on) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = i18n.language === 'hi' ? 'hi-IN' : 'en-IN';
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
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? 'destructive' : 'secondary'}
      onClick={toggle}
      aria-pressed={on}
    >
      {on ? <MicOff /> : <Mic />} {on ? t('work.dictate.stop') : t('work.dictate.start')}
    </Button>
  );
}
