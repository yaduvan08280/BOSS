/** What a channel adapter needs to send one message. */
export type OutgoingMessage = {
  /** Plain text (email body, WhatsApp fallback) or Telegram HTML. */
  text: string;
  subject?: string | null;
  link?: string | null;
  /** Telegram inline buttons: [label, callbackData] or [label, url]. */
  buttons?: { label: string; data?: string; url?: string }[];
  /** WhatsApp: approved template name and its parameters in order. */
  waTemplate?: string | null;
  waLanguage?: string | null;
  waParams?: { name: string; value: string }[];
  /** Push: title + body. */
  title?: string | null;
};

export type SendResult = { providerId?: string | null };

export class ChannelError extends Error {
  constructor(
    message: string,
    /** false = retrying won't help (bad address, missing setup). */
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'ChannelError';
  }
}

export type Fetch = typeof fetch;
