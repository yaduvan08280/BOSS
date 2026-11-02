import nodemailer, { type Transporter } from 'nodemailer';
import { escapeHtml } from '@mono/shared';
import { ChannelError, type OutgoingMessage, type SendResult } from './types';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
};

const transports = new Map<string, Transporter>();

export function smtpTransport(cfg: SmtpConfig): Transporter {
  const key = JSON.stringify(cfg);
  let t = transports.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass ?? '' } } : {}),
      connectionTimeout: 15_000,
    });
    transports.set(key, t);
  }
  return t;
}

/** Simple, readable HTML email in the brand colours, with a plain-text twin. */
function html(msg: OutgoingMessage, appName: string): string {
  const body = escapeHtml(msg.text).replace(/\n/g, '<br>');
  const button = msg.link
    ? `<p style="margin:24px 0"><a href="${escapeHtml(msg.link)}" style="background:#1C1B19;color:#FBF9F4;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Open in ${escapeHtml(appName)}</a></p>`
    : '';
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#F2EFE7;padding:24px"><div style="max-width:560px;margin:auto;background:#FBF9F4;border:1px solid #E4DFD3;border-radius:14px;padding:24px;color:#1C1B19"><div style="font-weight:700;margin-bottom:16px">${escapeHtml(appName)}</div><div style="font-size:15px;line-height:1.6">${body}</div>${button}</div></div>`;
}

export async function sendEmail(
  t: Transporter,
  from: string,
  to: string,
  msg: OutgoingMessage,
  appName: string,
): Promise<SendResult> {
  try {
    const info = await t.sendMail({
      from,
      to,
      subject: msg.subject ?? appName,
      text: msg.link ? `${msg.text}\n\n${msg.link}` : msg.text,
      html: html(msg, appName),
    });
    return { providerId: info.messageId ?? null };
  } catch (err) {
    const code = (err as { responseCode?: number }).responseCode;
    throw new ChannelError(`Email: ${(err as Error).message}`, !(code && code >= 500 && code < 600));
  }
}
