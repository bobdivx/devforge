## 2026-10-12 - [Improved SVG Sanitization against mXSS]
**Vulnerability:** The manual SVG sanitizer `apps/web/src/lib/sanitize-svg.ts` used an insufficient allowlist/blocklist. It allowed `<foreignObject>`, `<use>`, `<animate>`, `<set>`, `<image>`, and `<math>` which could lead to mutation XSS (mXSS) and other attack vectors when rendering untrusted Mermaid or Math blocks.
**Learning:** Manual DOM tree sanitization is notoriously hard to get right because attackers can hide active elements (e.g. `<a>` tags with `javascript:` payloads) inside grandchild trees (like `<math><mtext><a>`) or use SVG-specific tricks (like `<animate href... values="javascript:...">`) which naive list-based cleaners overlook.
**Prevention:** Rather than adding heavy third-party dependencies (like DOMPurify) against explicit project instructions, expanding the `BLOCKED` Set to include these structural injection vectors provides a robust, zero-dependency mitigation. Future expansions should verify nested elements carefully.
## 2026-10-22 - [Bypass Command Parsing and Path Traversal fix]
**Vulnerability:** The `validate_read_only` function in `crates/agent/src/tools/workdir_cmd.rs` allowed command parsing bypass (using quoted paths like `cat ".."/".."/etc/passwd`) which facilitated path traversal because the check only matched against the literal block string `../`.
**Learning:** Checking for exact substrings against raw commands is highly fragile against obfuscation, such as Unix-style quotation.
**Prevention:** Validation for string containment (such as blocking `..`) should run against the tokenized and normalized (i.e., lower-case without surrounding quotes) arguments, not the unparsed raw command line.

## 2023-10-25 - [Fix Masking of Secrets in Environment Variables]
**Vulnerability:** The `mask_sensitive_env_key` function in `docker.rs` was not properly masking environment variables that contained sensitive keywords (like `AWS_SECRET_ACCESS_KEY`) because it only checked for exact matches or suffix matches (e.g., ends with `_SECRET`).
**Learning:** Only matching for suffixes or exact values can leave secrets exposed when developers prefix or infix the sensitive word in the environment variable name.
**Prevention:** Use substring matching (`contains`) for sensitive keywords to ensure all variables containing words like `SECRET` or `TOKEN` are masked.


## 2026-10-18 - [Timing Attack in Webhook Signature Verification]
**Vulnerability:** The `verify_github_sig` function in `apps/server/src/infra_routes.rs` verified GitHub webhook signatures using standard string comparison `expected.eq_ignore_ascii_case(hex_sig)`.
**Learning:** String comparison functions exit early as soon as a character mismatch is found. In a cryptographic context, this variable response time leaks information and allows an attacker to perform a timing attack to forge a valid HMAC signature by guessing it byte by byte.
**Prevention:** Always use a constant-time comparison library (like `hmac`'s `verify_slice()`) to compare cryptographic hashes, secrets, and signatures to prevent side-channel timing attacks. Avoid custom implementations of standard cryptographic algorithms.
## 2025-02-14 - Bypass of `workdir_cmd` token validation
**Vulnerability:** The command validation in `crates/agent/src/tools/workdir_cmd.rs` used `joined.to_ascii_lowercase()` and `lower.contains(bad)` to validate blocked tokens, which incorrectly treated quoted substrings separately (e.g. bypass via quotes like `"s"udo` works if only checked against joined raw string, wait, no, the bug was actually about `rm ` vs `"rm"` bypass and argument checking). The previous checks failed to detect exact token matches for `rm` since `rm ` and `rm\t` were checked but an isolated `rm` token at the end of the argument string could be bypassed, or if a command parameter exactly matched `rm` (e.g., via quotes).
**Learning:** Command validation must evaluate the exact token (after shell splitting) rather than a joined raw command string or simple space-suffixed tokens. By validating each parameter/argument *individually* against exact matches (like `rm`) and using `contains` on the token string for blocklisted subsets, it prevents evasion via Unix-style quotation/argument structure.
**Prevention:** Always perform blocked token checks on the individual tokens resulting from shell word splitting, not on the recombined string, and ensure exact malicious commands/binaries like `rm` are explicitly denied regardless of whitespace padding.
