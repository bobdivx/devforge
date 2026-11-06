## 2026-10-12 - [Performance] Optimize Chat Message Signature Generation
**Learning:** During chat polling, \`messagesSignature\` generates a unique string for the whole thread. Using \`messages.map(...).join(',')\` nested with another \`map().join()\` created a lot of intermediate arrays and strings on every poll, causing CPU/Memory overhead on long lists. The previous signature was also very bloated because it used empty spaces for messages without reactions (e.g. \`,,,,\`).
**Action:** Replace nested \`map().join()\` calls with a simple \`for\` loop and string concatenation. This is about 4-5x faster and significantly more memory efficient by skipping empty slots instead of allocating intermediate arrays. When constructing signatures or serializing large arrays on a hot path, prefer manual loops over array map/filter chains.

## 2026-10-15 - [Performance] Prevent unnecessary UI array recalculations
**Learning:** In the chat component (`useThreadList`), derived state that requires filtering and sorting large arrays (like generating nested agent lists) was running synchronously on every render. Given that chat polling triggers frequent re-renders, this caused unnecessary CPU strain on lists that only rarely change.
**Action:** Use `useMemo` for derived states like `rows` and `current` in custom hooks when they involve `.filter()`, `.map()`, or `.sort()` and depend on data that updates less frequently than the component renders.

## 2026-11-06 - [Performance] CodeBlock.tsx - Avoid .map().join() overhead
**Learning:** In React/Preact components, using nested array transformations like `tokens.map(l => l.map(t => t.content).join('')).join('\n')` inside derived state on hot paths (like CodeBlock rendering) creates numerous intermediate string and array allocations. This puts significant pressure on the garbage collector and causes CPU overhead on every render, especially with large code blocks.
**Action:** Always replace `.map().join()` with manual `for` loops and string concatenation inside a `useMemo` block when deriving string values from large or nested arrays.
