/* Answers the login form so the browser can offer to save the password.
   The password stays in the browser. This does not read or store it. */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data === 'beds-login') event.source?.postMessage('beds-login');
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/login')) return;
  const next = safeNext(url.searchParams.get('next'));
  event.respondWith(Response.redirect(new URL(next, self.location.origin).href, 303));
});

function safeNext(raw) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('://') || raw.includes('/login')) {
    return '/captains/profile/';
  }
  return raw;
}
