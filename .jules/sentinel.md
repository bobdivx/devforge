## 2026-10-12 - [Improved SVG Sanitization against mXSS]
**Vulnerability:** The manual SVG sanitizer `apps/web/src/lib/sanitize-svg.ts` used an insufficient allowlist/blocklist. It allowed `<foreignObject>`, `<use>`, `<animate>`, `<set>`, `<image>`, and `<math>` which could lead to mutation XSS (mXSS) and other attack vectors when rendering untrusted Mermaid or Math blocks.
**Learning:** Manual DOM tree sanitization is notoriously hard to get right because attackers can hide active elements (e.g. `<a>` tags with `javascript:` payloads) inside grandchild trees (like `<math><mtext><a>`) or use SVG-specific tricks (like `<animate href... values="javascript:...">`) which naive list-based cleaners overlook.
**Prevention:** Rather than adding heavy third-party dependencies (like DOMPurify) against explicit project instructions, expanding the `BLOCKED` Set to include these structural injection vectors provides a robust, zero-dependency mitigation. Future expansions should verify nested elements carefully.

## 2026-10-13 - [Missing Security Headers in Rust Axum Backend]
**Vulnerability:** The application was missing basic security headers (`x-frame-options`, `x-content-type-options`, `strict-transport-security`) which could allow Clickjacking and MIME-sniffing vulnerabilities.
**Learning:** In the Rust `axum` backend, using `HeaderMap::insert` or `HeaderName::from_static` with uppercase characters (like "X-Frame-Options") causes a runtime panic. The library requires exact lowercase for header names.
**Prevention:** Always use lowercase header strings (e.g. "x-frame-options") when inserting custom headers into the `axum` response.
