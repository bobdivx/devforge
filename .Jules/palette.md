## 2025-05-24 - Accessibility improvements in Toast component\n**Learning:** The Toast component used an icon-only button without an ARIA label. Added an aria-label with the translation 'Fermer', matching other close buttons in the app.\n**Action:** When adding close buttons, ensure they have proper aria-labels in French ('Fermer') to match the app's language.

## 2024-06-25 - Sidebar list navigation accessibility
**Learning:** Found that list-style navigation items (like the `ThreadSidebar`) used conditional background colors to indicate active states (`bg-[var(--color-accent-soft)]`), but completely lacked programmatic indicators for screen readers. This pattern is likely present in other custom sidebar lists.
**Action:** Always add `aria-current="true"` (or `"page"` if it's a full page navigation) alongside visual "active" states in list selections to ensure state is announced to screen readers.
