/**
 * Nettoyage défensif d'un SVG produit par mermaid (déjà en `securityLevel: 'strict'`) :
 * pas de script, pas de gestionnaire `on*`, pas de lien hors ancre/http(s).
 */
const BLOCKED = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'textarea', 'button']);
const SAFE_LINK = /^(#|https?:\/\/)/i;

export function sanitizeSvg(svg: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = svg; // contenu inerte : rien ne s'exécute ni ne se charge
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (BLOCKED.has(child.localName.toLowerCase())) {
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith('on')) child.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'xlink:href' || name === 'src' || name === 'action' || name === 'formaction') && !SAFE_LINK.test(value))
          child.removeAttribute(attr.name);
        else if (name === 'style' && /url\s*\(|expression\s*\(|javascript:/i.test(value)) child.removeAttribute(attr.name);
      }
      walk(child);
    }
  };
  const root = document.createElement('div');
  root.appendChild(tpl.content.cloneNode(true));
  walk(root);
  return root.innerHTML;
}
