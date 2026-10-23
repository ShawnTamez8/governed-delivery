# Debugging Analysis: crew-chatter run 9, final-panel findings 169 and 170

Target: `C:\Repositories\testing-repos\crew-chatter`, run 9 (`crew-chatter-note-lifecycle`),
delivered commit `c0665ad` on `gov/crew-chatter-note-lifecycle/9`. Both findings were from
the final panel (round 2) and medium, so they did not block (threshold `high`).

## Problem

- **169 (correctness):** the reviewer says that when a parent folder is deleted while one of
  its subfolders is open, "the subfolder is removed with it". It also says
  `handleDeleteFolder` resets the view only when the open folder is the deleted one, so the
  view stays on a folder that no longer exists.
- **170 (state integrity):** `rowMatches`/`mergeRow` ignore `deletedAt`. A save or
  organization response that arrives after Move to trash can put the trashed note back in
  the active list.

## Finding 169: not a defect

**Expected behavior (claimed):** deleting a parent folder removes its subfolders, so an open
subfolder view must reset.

**Actual behavior of the delivered backend:** subfolders are kept and re-parented.
`DELETE /api/folders/:id` (`backend/src/routes/folders.ts:161-196`) runs, in one
transaction:

1. `reassignFolderNotes`, for the deleted folder's notes only;
2. `reparentChildFolders(db, userId, id, folder.parentId)`, which moves every child
   (`listSiblingFolders(..., parentId = id)`) to the deleted folder's parent;
3. `deleteFolder` on that one row.

The frontend matches this. `handleDeleteFolder`'s fallback (`App.tsx:549-554`) drops only
the deleted folder and lifts its subfolders to its parent.

**Result:** an open subfolder still exists after its parent is deleted. Staying on it is
correct, because the `else` branch reloads the list and refreshes the folders. The finding's
premise contradicts the code, so it is disproved by reading the code; no run was made.
**No change.**

## Finding 170: confirmed, fixed

**Expected behavior:** a note in Trash appears only in the Trash view (AC-045: "Moving a note
to trash removes it from every view except Trash").

**Actual behavior:** a late response for a trashed note re-adds it to the active list.

**Failing layer:** UI (client state merge), made reachable by the API.

**Evidence:**

- **The API accepts writes to trashed notes.** `findNote` (`backend/src/db.ts:501`) filters
  only by `purge_at`, not by `deleted_at`, and `PATCH /api/notes/:id` (`notes.ts:362-475`)
  has no `deletedAt` check. So a PATCH that the server handles after `POST /:id/trash`
  returns 200 with `deletedAt` set. The tag endpoints use the same lookup.
- **The client re-adds such a row.** Every response passes through `mergeRow`:
  - `onSaved` (auto-save, version restore);
  - `applyOrganization` (folder change, tag add or remove);
  - `applyFlags` (pin, archive).

  `rowMatches` checks archive, pin, open tasks, folder, tag and date range, but never
  `deletedAt`, so a trashed row matches the default filters.
- **The client sequence that reaches it:**
  1. `handleMoveToTrash` flushes pending saves and calls `trashNote`.
  2. It filters the row out.
  3. During the `trashNote` await the editor is still mounted, so typing in that window
     starts a debounced save 750 ms later. Alternatively, a folder or tag change goes
     unguarded.
  4. The response comes back with `deletedAt` set, and `onSaved` or `applyOrganization`
     calls `mergeRow`, which adds the row back.
- **Reproduction:**
  `C:\Users\tamezs\AppData\Local\Temp\1\claude\C--Repositories-AI-Tools-governed-delivery\e0d52321-e88e-48c9-8460-3c870123447b\scratchpad\repro-170.mjs`
  slices `displayTitle`..`mergeRow` verbatim from a given `App.tsx` and merges a
  `deletedAt`-set row into a list that no longer holds it.
  - On `c0665ad` it printed `rowMatches(trashed row, default filters): true` and the list
    `kept, trashed`, and exited 1.

**Root cause:** `rowMatches` is the single predicate for "belongs in the current active list",
and it omits the trash state. The backend's acceptance of writes to trashed notes makes the
omission reachable.

**Fix:** in `frontend/src/App.tsx` `rowMatches`, return `false` when `row.deletedAt !== null`
(4 lines, on branch `fix/run-9-finding-170` from `c0665ad`, worktree
`C:\Repositories\testing-repos\crew-chatter-fix-170`).

**Fix validation:**
- The reproduction on the fixed file printed `false` and the list `kept`, and exited 0.
- An active row still matches.
- After Snitch approval (2026-10-23, `0fb3d69d`), the target's verification commands passed
  on the host in the fix worktree:
  - `npm ci`, `npm run typecheck`, `npm run lint` and `npm run build` all exited 0;
  - npm's allow-scripts left esbuild's postinstall unrun, and the Vite build still
    succeeded;
  - `git status` shows only `frontend/src/App.tsx`.

**Regression coverage:** crew-chatter has no test framework. Its frozen verification is
`npm ci`, `typecheck`, `lint` and `build`, and the functions are module-private. The
scratch reproduction is the regression check: it fails on `c0665ad` and passes on the fix.
Adding a test runner to the target is out of scope.

## Risks and residuals

- **Trash view.** `mergeRow` is called with the current filters whatever the destination
  kind, and the Trash view's filters are `DEFAULT_FILTERS`. After the fix, a trashed row
  merged while the Trash view is open is dropped from it rather than kept.
  - This needs a selected, already trashed note while Trash is open, which no current path
    produces: Move to trash clears the selection.
  - Separately, and before this change: a non-trashed selected note saved while the Trash
    view is open is added to the Trash list. This is a follow-up and was not changed.
- **Response reordering.** A folder change that the server handled *before* the trash, but
  whose response the client processes *after* the trash filter, carries `deletedAt: null`
  and is still re-added. That needs response reordering across connections, and the fix
  does not cover it.
- **Backend.** Refusing writes to trashed notes (409) would close both cases at the source.
  That is a contract change the spec does not make, and it was not done.
