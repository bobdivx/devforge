## 2024-08-24 - Eloquent Memory Exhaustion Anti-pattern
**Learning:** Found multiple instances where the codebase fetches entire tables into memory using `Model::all()` before filtering or grabbing the first record (e.g., `Model::all()->first()` or `Team::all()->filter(...)`). This creates severe memory bottlenecks and N+1 query issues on large tables.
**Action:** Always scan for `::all()->` usages and push the constraints down to the database level using `::first()`, `::where()`, or relationship queries like `::doesntHave()`.
