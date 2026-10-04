/** Shared checks for photos, videos, links and articles. The database repeats these rules. */

export const GALLERY_CAPTION_MAX = 200;
export const GALLERY_CREDIT_MAX = 80;
export const GALLERY_TITLE_MAX = 140;
export const GALLERY_SUMMARY_MAX = 280;
export const GALLERY_BODY_MIN = 40;
export const GALLERY_BODY_MAX = 8000;
export const GALLERY_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const GALLERY_VIDEO_MAX_BYTES = 10 * 1024 * 1024;

const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const VIDEO_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'player.vimeo.com',
  'facebook.com',
  'm.facebook.com',
  'fb.watch',
]);

export function photoExtension(file: File): string | null {
  if (file.size <= 0 || file.size > GALLERY_PHOTO_MAX_BYTES) return null;
  return PHOTO_TYPES[file.type] ?? null;
}

export function photoProblem(file: File): string | null {
  if (file.size > GALLERY_PHOTO_MAX_BYTES) return 'Photos can be up to 8 MB.';
  if (!PHOTO_TYPES[file.type]) return 'Use a JPG, PNG, WEBP or GIF.';
  return null;
}

export function videoExtension(file: File): string | null {
  if (file.size <= 0 || file.size > GALLERY_VIDEO_MAX_BYTES) return null;
  const fromType = VIDEO_TYPES[file.type];
  if (fromType) return fromType;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if ((file.type === '' || file.type === 'application/octet-stream') && (ext === 'mp4' || ext === 'webm' || ext === 'mov')) {
    return ext;
  }
  return null;
}

export function videoProblem(file: File): string | null {
  if (file.size > GALLERY_VIDEO_MAX_BYTES) return 'Videos can be up to 10 MB.';
  if (!videoExtension(file)) return 'Use an MP4, WEBM or MOV.';
  return null;
}

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** A normal https link, or null when it should be refused. */
export function cleanLinkUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 12 || trimmed.length > 500) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (!host.includes('.')) return null;
  return url.toString();
}

/** A https link on YouTube, Vimeo or Facebook, or null when it should be refused. */
export function cleanVideoUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 12 || trimmed.length > 500) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!VIDEO_HOSTS.has(host)) return null;
  return url.toString();
}

/** Embed address for YouTube and Vimeo. Facebook stays as a normal link. */
export function videoEmbedSrc(value: string): string | null {
  const clean = cleanVideoUrl(value);
  if (!clean) return null;
  const url = new URL(clean);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const fromQuery = url.searchParams.get('v');
    const fromPath = url.pathname.split('/').filter(Boolean).pop();
    const id = url.pathname.startsWith('/watch') ? fromQuery : fromPath;
    if (!id || !/^[\w-]{6,}$/.test(id)) return null;
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[0] === 'video' ? parts[1] : parts[0];
    const hash = parts[0] === 'video' ? parts[2] : parts[1];
    if (!id || !/^\d+$/.test(id)) return null;
    const privacy = hash && /^[\w]+$/.test(hash) ? `?h=${encodeURIComponent(hash)}` : '';
    return `https://player.vimeo.com/video/${id}${privacy}`;
  }
  return null;
}
