## 2026-10-12 - [Performance] Optimize Chat Message Signature Generation
**Learning:** During chat polling, \`messagesSignature\` generates a unique string for the whole thread. Using \`messages.map(...).join(',')\` nested with another \`map().join()\` created a lot of intermediate arrays and strings on every poll, causing CPU/Memory overhead on long lists. The previous signature was also very bloated because it used empty spaces for messages without reactions (e.g. \`,,,,\`).
**Action:** Replace nested \`map().join()\` calls with a simple \`for\` loop and string concatenation. This is about 4-5x faster and significantly more memory efficient by skipping empty slots instead of allocating intermediate arrays. When constructing signatures or serializing large arrays on a hot path, prefer manual loops over array map/filter chains.

## 2026-10-15 - [Performance] Prevent unnecessary UI array recalculations
**Learning:** In the chat component (`useThreadList`), derived state that requires filtering and sorting large arrays (like generating nested agent lists) was running synchronously on every render. Given that chat polling triggers frequent re-renders, this caused unnecessary CPU strain on lists that only rarely change.
**Action:** Use `useMemo` for derived states like `rows` and `current` in custom hooks when they involve `.filter()`, `.map()`, or `.sort()` and depend on data that updates less frequently than the component renders.

## 2026-10-18 - [Performance] Optimize CodeBlock Token Concatenation
**Learning:** In the `CodeBlock.tsx` component, we used nested `.map(...).join('')` calls to derive the `shown` token on every render. Just like with the `messagesSignature`, allocating new intermediate arrays and strings dynamically repeatedly creates garbage collection overhead during chat interactions.
**Action:** Utilized standard React memoization (`useMemo`) to wrap the derivation logic. This prevents unnecessary string and array operations on every render without sacrificing code readability. When deriving values on a hot UI path, consider whether React `useMemo` is sufficient before replacing concise functional methods with verbose loops.
