import { describe, expect, it } from 'vitest';
import {
  buildSearchIndex,
  completeNav,
  ensureHome,
  headingId,
  isValidSlug,
  parseSidebar,
  parseWikiLink,
  resolveHref,
  searchWiki,
  WIKI_HOME,
  type WikiPage,
} from './wiki';
import { loadWiki } from './wiki-source';

const known = new Set(['Home', 'Kubernetes', 'Premier-demarrage', 'Cluster']);

describe('wiki : slugs et liens', () => {
  it('liste blanche de slugs : pas de chemin, de point ni de fichier spécial', () => {
    expect(isValidSlug('Kubernetes')).toBe(true);
    expect(isValidSlug('SSO-et-OIDC')).toBe(true);
    for (const bad of ['', '..', '../etc', 'a/b', 'a\\b', '_Sidebar', 'Home.md', '%2e%2e', 'a b', '-x']) {
      expect(isValidSlug(bad)).toBe(false);
    }
  });

  it('[[Libellé|Page]] et [[Page#ancre]]', () => {
    expect(parseWikiLink('Premier démarrage|Premier-demarrage')).toEqual({
      label: 'Premier démarrage',
      slug: 'Premier-demarrage',
      anchor: undefined,
    });
    expect(parseWikiLink('Kubernetes#Choix par défaut')).toEqual({
      label: 'Kubernetes',
      slug: 'Kubernetes',
      anchor: 'choix-par-defaut',
    });
  });

  it('liens : pages connues, ancres, http(s) ; schémas dangereux refusés', () => {
    expect(resolveHref('Kubernetes.md', known)).toEqual({ kind: 'internal', href: '/wiki/Kubernetes/' });
    expect(resolveHref('./Cluster#Bascule', known)).toEqual({ kind: 'internal', href: '/wiki/Cluster/#bascule' });
    expect(resolveHref('#Étape-1', known)).toEqual({ kind: 'internal', href: '#etape-1' });
    expect(resolveHref('https://github.com/bobdivx/devforge', known).kind).toBe('external');
    expect(resolveHref('../deploy/usb/README.md', known)).toEqual({
      kind: 'external',
      href: 'https://github.com/bobdivx/devforge/blob/main/deploy/usb/README.md',
    });
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>',
      'vbscript:x',
      '//evil.example',
      '../../../etc/passwd',
      'Inconnue',
      '/etc/passwd',
    ]) {
      expect(resolveHref(bad, known)).toEqual({ kind: 'none' });
    }
  });

  it('ancres : accents et ligatures', () => {
    expect(headingId('2. Stockage : local-path (défaut mono-nœud)')).toBe('2-stockage-local-path-defaut-mono-noeud');
  });
});

describe('wiki : navigation, secours, recherche', () => {
  it('_Sidebar.md → sections, pages inconnues ignorées', () => {
    const nav = parseSidebar('**Démarrer**\n- [[Accueil|Home]]\n- [[Kubernetes]]\n- [[Fantôme]]\n\n**Vide**\n', known);
    expect(nav).toEqual([
      {
        title: 'Démarrer',
        items: [
          { label: 'Accueil', slug: 'Home' },
          { label: 'Kubernetes', slug: 'Kubernetes' },
        ],
      },
    ]);
  });

  it('pages hors sommaire regroupées', () => {
    const pages: WikiPage[] = [
      { slug: 'Home', title: 'DevForge', markdown: '' },
      { slug: 'Cluster', title: 'Cluster', markdown: '' },
    ];
    const nav = completeNav([{ title: 'A', items: [{ label: 'Accueil', slug: 'Home' }] }], pages);
    expect(nav[1]).toEqual({ title: 'Autres pages', items: [{ label: 'Cluster', slug: 'Cluster' }] });
  });

  it('wiki vide → accueil minimal plutôt qu’une erreur', () => {
    const pages = ensureHome([]);
    expect(pages).toHaveLength(1);
    expect(pages[0].slug).toBe(WIKI_HOME);
    expect(pages[0].markdown).toContain('Wiki DevForge');
  });

  it('recherche insensible aux accents, titre prioritaire', () => {
    const index = buildSearchIndex([
      { slug: 'Kubernetes', title: 'Kubernetes', markdown: '# Kubernetes\nInstaller avec Helm sur Talos.' },
      { slug: 'Cluster', title: 'Cluster', markdown: 'Ajouter des nœuds. Voir Kubernetes.' },
      { slug: 'FAQ', title: 'FAQ', markdown: 'Questions fréquentes' },
    ]);
    const hits = searchWiki(index, 'kubernetes');
    expect(hits.map((h) => h.slug)).toEqual(['Kubernetes', 'Cluster']);
    expect(searchWiki(index, 'frequentes')[0].slug).toBe('FAQ');
    expect(searchWiki(index, 'k')).toEqual([]);
  });

  it('dossier wiki/ du dépôt embarqué : Home, Kubernetes, sommaire', () => {
    const wiki = loadWiki();
    const slugs = wiki.pages.map((p) => p.slug);
    expect(slugs).toContain('Home');
    expect(slugs).not.toContain('_Sidebar');
    expect(slugs).not.toContain('README');
    if (wiki.embedded) {
      expect(slugs).toContain('Kubernetes');
      expect(wiki.nav.flatMap((s) => s.items.map((i) => i.slug))).toContain('Kubernetes');
    }
    for (const s of slugs) expect(isValidSlug(s)).toBe(true);
  });
});
