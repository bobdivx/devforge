/* Index de recherche du wiki public, figé au build (/wiki/search-index.json). */
import { loadWiki } from '../../lib/wiki-source';
import { buildSearchIndex } from '../../lib/wiki';

export function GET() {
  return new Response(JSON.stringify(buildSearchIndex(loadWiki().pages)), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
