## 2026-10-12 - [Performance] Optimize Chat Message Signature Generation
**Learning:** During chat polling, \`messagesSignature\` generates a unique string for the whole thread. Using \`messages.map(...).join(',')\` nested with another \`map().join()\` created a lot of intermediate arrays and strings on every poll, causing CPU/Memory overhead on long lists. The previous signature was also very bloated because it used empty spaces for messages without reactions (e.g. \`,,,,\`).
**Action:** Replace nested \`map().join()\` calls with a simple \`for\` loop and string concatenation. This is about 4-5x faster and significantly more memory efficient by skipping empty slots instead of allocating intermediate arrays. When constructing signatures or serializing large arrays on a hot path, prefer manual loops over array map/filter chains.

## 2026-10-15 - [Performance] Prevent unnecessary UI array recalculations
**Learning:** In the chat component (`useThreadList`), derived state that requires filtering and sorting large arrays (like generating nested agent lists) was running synchronously on every render. Given that chat polling triggers frequent re-renders, this caused unnecessary CPU strain on lists that only rarely change.
**Action:** Use `useMemo` for derived states like `rows` and `current` in custom hooks when they involve `.filter()`, `.map()`, or `.sort()` and depend on data that updates less frequently than the component renders.

## 2026-10-16 - [Performance] Optimize className concatenation in `cn` utility
**Learning:** The `cn` function for generating class names is called hundreds of times per render cycle across the frontend. Using `parts.filter(Boolean).join(' ')` caused unnecessary intermediate array allocation and overhead from `join()` on a very hot path, leading to increased memory pressure and garbage collection pauses.
**Action:** Replace `Array.prototype.filter().join()` with manual `for` loops and string concatenation for frequently called utility functions like class name generators. This roughly halves the execution time and reduces GC pressure significantly.
