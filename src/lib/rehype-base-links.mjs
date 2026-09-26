/**
 * Rehype plugin: prefix root-relative URLs in Markdown (href="/clubs/", src="/uploads/x.jpg")
 * with the configured site base (e.g. "/beds-squash") so content links work on GitHub Pages
 * project sites as well as on a custom domain (where base is "/").
 */
export default function rehypeBaseLinks({ base = '/' } = {}) {
  const normalisedBase = base.replace(/\/+$/, ''); // "" or "/beds-squash"

  const fix = (value) => {
    if (typeof value !== 'string') return value;
    if (!normalisedBase) return value;
    if (!value.startsWith('/') || value.startsWith('//')) return value; // external, protocol-relative, anchors, relative
    if (value.startsWith(normalisedBase + '/') || value === normalisedBase) return value; // already prefixed
    return normalisedBase + value;
  };

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'element' && node.properties) {
      if (node.tagName === 'a' && node.properties.href) node.properties.href = fix(node.properties.href);
      if ((node.tagName === 'img' || node.tagName === 'source' || node.tagName === 'video') && node.properties.src) {
        node.properties.src = fix(node.properties.src);
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };

  return (tree) => {
    walk(tree);
  };
}
