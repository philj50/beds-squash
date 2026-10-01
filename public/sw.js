/* Lets a real login form finish on this site so the browser can offer to save the password.
   The password stays in the browser. This does not read or store it. */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/login')) return;
  event.respondWith(Response.redirect(new URL(safeNext(url.searchParams.get('next')), self.location.origin).href, 303));
});

function safeNext(raw) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('://')) {
    return new URL('captains/profile/', self.location.href).pathname;
  }
  return raw;
}
