# Regression Diagnostic: Cover Rendering Properties

## Answers to Diagnostic Questions

**Q1. renderLibraryGrid() cover image property:**
It explicitly reads `file.coverUrl` to assign the source logic for `<img src="...">`.
```javascript
  for (const file of files) {
    let coverHtml = '';
    if (file.coverUrl) {
      coverHtml = `<img src="${file.coverUrl}" class="book-cover" alt="Cover" ... />`;
```

**Q2. loadCoversFor() assignment:**
After `saveCover` succeeds, it assigns **both** properties natively. 
```javascript
    if (res.success) {
      f.coverUrl = res.coverUrl;
      console.log('[COVER DEBUG 6] Assigned coverUrl to:', f.id, 'url preview:', f.coverUrl?.substring(0, 50));
      if (f._libraryData) f._libraryData.coverImage = res.coverUrl;
    }
```

**Q3. Startup property mapping (init):**
During `init()`, the raw string path is retrieved precisely from `b.coverImage` (from the DB) and populated into `coverUrl`.
```javascript
        const books = await window.electronAPI.library.getBooks();
          ...
          const mapped = books.map(b => ({
            ...
            coverUrl: b.coverImage || null,
            coverLoading: false,
            _libraryData: b
          }));
          state.files = mapped;
```

**Q4. renderLibraryGrid() vs loadCoversFor() mismatch:**
There is **no mismatch**. `renderLibraryGrid()` inherently tracks `file.coverUrl` to render HTML templates. Over within `loadCoversFor()`, `f.coverUrl` is accurately mutated, representing the same pointer within `state.files[]`. The `finally` block successfully invokes `renderLibraryGrid()`, mapping the identical structure without property misalignment.

**Q5. Original loadCoversFor mapping (before Mutex):**
Before adding the mutex queue structure, `loadCoversFor` mutated precisely the exact same property sets.
```javascript
    // (Before Mutex queue iteration)
    if (res.success) {
       f.coverUrl = res.coverUrl;
       if (f._libraryData) f._libraryData.coverImage = res.coverUrl;
    }
```

---

## Conclusion & Diagnostic Observation
The internal synchronization and properties trace correctly without syntax regressions. Because properties like `.coverUrl` are verified fully bound across IPC load stages independently of extraction logic, any issue wiping **pre-existing valid covers unconditionally** upon startup confirms the `try/finally` is NOT structurally responsible since `needsCovers.length === 0` natively skips `loadCoversFor()` entirely on startup!

If zero covers persist, there is a distinct environmental disruption elsewhere overriding `state.files` rendering vectors. Awaiting your instruction.
