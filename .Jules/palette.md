## 2025-05-24 - Accessibility improvements in Toast component\n**Learning:** The Toast component used an icon-only button without an ARIA label. Added an aria-label with the translation 'Fermer', matching other close buttons in the app.\n**Action:** When adding close buttons, ensure they have proper aria-labels in French ('Fermer') to match the app's language.

## 2024-06-25 - Sidebar list navigation accessibility
**Learning:** Found that list-style navigation items (like the `ThreadSidebar`) used conditional background colors to indicate active states (`bg-[var(--color-accent-soft)]`), but completely lacked programmatic indicators for screen readers. This pattern is likely present in other custom sidebar lists.
**Action:** Always add `aria-current="true"` (or `"page"` if it's a full page navigation) alongside visual "active" states in list selections to ensure state is announced to screen readers.

## 2024-10-24 - Added Focus Styles to Button component
**Learning:** The main `Button` component in `apps/web/src/components/ui/Button.tsx` lacked keyboard focus styles (`focus-visible:`). This makes keyboard navigation difficult as users cannot tell which button is currently focused.
**Action:** Always ensure that base UI interactive components like Buttons have `focus-visible` styles using the app's accent color (`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]`).
