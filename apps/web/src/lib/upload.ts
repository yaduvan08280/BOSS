export type Uploaded = { id: string; url: string; mime: string; size: number; name: string };

/** Upload one file; it stays "unlinked" until the record it belongs to is saved. */
export async function uploadFile(file: File | Blob, name = (file as File).name ?? 'file'): Promise<Uploaded> {
  const body = new FormData();
  body.append('file', file, name);
  const res = await fetch('/api/files', { method: 'POST', body, credentials: 'same-origin' });
  const json = (await res.json()) as {
    id?: string;
    url?: string;
    mime?: string;
    size?: number;
    error?: { message: string };
  };
  if (!res.ok || !json.id) throw new Error(json.error?.message ?? 'Upload failed');
  return { id: json.id, url: json.url!, mime: json.mime!, size: json.size!, name };
}
