# Schematic table QoL — Agent Context

## Scope and constraints

- This is a script-only Mindustry mod extending Salivion's Extended UI schematic table. Keep the install workflow to one mod package; do not add a Java build or separate JAR requirement.
- Preserve the existing table-to-table move behavior, settings keys, and `[Drag from Scheme Table]` log prefix.
- The user exclusively controls all version changes. Never change version metadata or version strings in source, manifests, or documentation unless the user explicitly requests that change.
- Do not modify Mindustry, Extended UI, or any other mod. Mindustry and Arc source may be read as references.
- Distinguish source-confirmed behavior from runtime behavior that has not been tested.

## Project structure

- Entry point: `scripts/main.js`
- Manifest: `mod.hjson`, currently version `1.0.4`, `java: false`, `script: true`, dependency `extended-ui`.
- `JavaAdapter` in `main.js` is Rhino interop for Arc listeners and does not imply a Java build.

## Existing functionality to preserve

- MOVE mode selects/highlights a populated table slot, then moves it to another slot; cross-category moves are supported.
- Occupied destinations use confirmation; cancellation leaves the slots unchanged.
- Moves transfer the source slot's custom image setting, clear the source as appropriate, and rebuild the EUI table.
- Visual table-to-table dragging can be disabled while click-to-select/click-to-move remains available.
- In normal mode, slot outlines are hover-only; clicking a schematic to use it must not leave the checked selection outline visible. Checked selection outlines are enabled only in Move or Delete mode.
- The vanilla-library-to-table feature uses a stationary hold of about 0.4 seconds, then shows a pointer-following preview. Empty destinations insert; occupied destinations ask for confirmation; drops outside the table do nothing.
- Preserve normal vanilla schematic-card clicks and nested info/export/edit/delete controls.

## Delete-mode selection: current runtime findings

- The user confirmed in-game that Delete mode and selected schematic slots highlight correctly. The selected slot uses the same appearance as the normal hover highlight; preserve this behavior.
- Latest user report (2026-10-19): bulk selection retains selected slot information and its selection/move functionality, but the visible bulk-selection wrapper/outline is not going around the selected schematic icons. Track this as an outstanding bulk visual issue only; do not change the working bulk selection data or behavior while addressing separate single-left-click selection visuals.
- Multi-selection, the confirmation list, and deletion of all selected slots have been confirmed working in-game.
- A multi-delete bug repeatedly processed the first selected slot despite looping over the selection. Explicit per-iteration `var` values for the selected key and associated data fixed it in Rhino. Preserve this approach in the deletion and post-rebuild verification loops unless an alternative is runtime-tested.
- Each selected slot is deleted independently, including its slot-specific custom image. Keep the confirmation snapshot, stale-slot checks, and table refresh consistent with that behavior.
- Cancel/Escape/Back clears selection and exits Delete mode without enabling MOVE. Confirmation also clears selection and exits Delete mode.
- Diagnostic logs are gated by the persistent `drag-scheme-table.show-debug-logs` preference, defaulting to enabled; errors and warnings remain visible when routine diagnostics are disabled. Temporary highlight diagnostics can be removed when no longer needed, but preserve the actual style/state logic in `updateHighlight()`.
- A prior crash was caused by an `exit` callback invoking a diagnostic helper after it had been commented out. The obsolete callback was removed; avoid leaving calls to removed or commented-out helpers.

## Current library-drag implementation and performance goal

- For the reusable Rhino UI input-debugging and performance-discovery workflow, see [the Mindustry Rhino Scripts skill](../.github/skills/mindustry-rhino-scripts/SKILL.md). This project note records the mod-specific findings below.
- The old working implementation recursively scanned the vanilla schematic dialog every 200 ms while it was open and attached a capture listener to every discovered schematic card. The repeated idle scans were removed.
- Current runtime behavior has been confirmed by the user: the optimized library-card drag works, including the floating schematic preview. The previous working implementation caused a severe performance hit; whether the on-demand implementation fully resolves that hit still needs user verification.
- The previous working script scanned dialog content after it opened and after pane rebuild/resize events. It recursively visited the actor tree, reflected each `SchematicImage`'s private `schematic` field, and attached a direct capture listener to each card. This open-time full-tree scan and listener setup are a plausible cause of the hitch, but their cost was not measured.
- The current optimization removes the open/rebuild scans and per-card listeners. A single capture listener on `Vars.ui.schematics` uses `InputEvent.targetActor` ancestry to find the pressed card and searches only that card for its `SchematicImage`; the schematic reflection field is cached after first use.
- The matching local Arc source confirms `targetActor` is set to the original event target and remains available during ancestor capture. Runtime logs showed the target itself is `SchematicsDialog$SchematicImage`. The working fix resolves that target as an image before walking upward to its card button; only if the target is not itself the image does it search the nearest button's subtree. Do not reverse this order: searching the nearest button first failed because it found no schematic image.
- Image recognition uses the exact Java class name `mindustry.ui.dialogs.SchematicsDialog$SchematicImage`, because the script's `instanceof` test did not recognize the runtime target. Keep this class-name check aligned with the verified runtime trace.
- Temporary press diagnostics currently log the input button, dialog/game/settings guards, and target ancestor chain, plus which image/card resolution step fails. Remove or gate this verbose trace after the interaction is fully validated; retain concise error logging for actual failures.
- After binding, the card listeners do not themselves poll every frame. A per-frame updater is created only after a card press becomes a drag candidate, then removed when the candidate ends or is cancelled.
- Focus the next performance investigation on the transition immediately after opening, distinguishing mod work from vanilla dialog/card construction and from later idle/rebuild/drag costs. Do not assume an open-time scan explains performance degradation that continues while idle.
- The on-demand target path has passed a user in-game test: the library drag preview appears. Continue verifying actual slot drop, occupied-slot confirmation, cancellation, nested controls, and ordinary schematic click behavior.
- Do not reintroduce recurring or open-time full-dialog scans. Preserve normal card clicks, nested info/export/edit/delete actions, hold/movement thresholds, preview, drops, confirmation, cancellation, and the existing EUI table MOVE/swap behavior.

## Library icon-tag selection: implemented, runtime verification pending

- Library insertion now inspects the dropped `Schematic` object's labels and offers its vanilla icon tags as the image for the destination table slot. This is not text translation and does not modify schematic tags.
- Icon tags are classified by exact vanilla values, not regex or text heuristics: UI icon glyphs are matched against `Vars.accessibleIcons` and `Iconc.codes`; content emoji are matched against visible, unlocked content in `Vars.defaultContentIcons`, as in vanilla's icon-tag picker. Text/custom-name tags are excluded even if they resemble an icon name.
- A single matching icon tag is applied automatically. Multiple matches open a prompt naming the schematic and showing only matching icon choices; canceling leaves the destination unchanged.
- On insertion, the schematic name is saved as before and a chosen icon's Extended UI identifier is saved in the destination's `<slot-key>image` setting. With no matching icon tags, the prior insertion behavior is retained. Occupied-slot confirmation still runs after icon selection and before settings are changed.
- Discovery runs only after a library drop, not in a recurring scan or per-frame update.
- Drop-scoped icon diagnostics log raw label strings and UTF-16 code units, exact UI/content icon matches (including content rejected as hidden, locked, or missing `uiIcon`), final choices, and the slot image setting write/readback. These use the existing detailed-log toggle; enable it when investigating icon matching or display failures.
- The code has syntax/whitespace checks only. In-game validation remains necessary for no/one/multiple icon tags, mixed text and icon tags, cancellation, occupied-slot confirmation, displayed slot icon/name, ordinary library clicks, and table MOVE behavior.

## Future library feature: multi-select/batch insertion

- Multi-select from the vanilla library and placing multiple schematics into the EUI table remains a separate future feature; do not implement it as part of the icon-tag work.
- Keep schematic data (`Schematic` objects) distinct from card icons/previews. Preserve the current one-at-a-time drag interaction and table MOVE behavior.
- A future batch-placement feature needs explicit rules for destination order, occupied slots and confirmation, preserving or replacing existing schematics, and what happens when the selected count exceeds available slots. Do not overwrite current slots implicitly.

## Maintainability and deferred refactoring

- `scripts/main.js` remains the integration point for table binding, single moves, Delete confirmation, settings, library insertion, and refresh.
- `scripts/bulk-selection.js` owns bulk MOVE/DELETE selection state, right-button region/toggle input, and the table-attached selection overlay. It is loaded as a sibling script module with `require("bulk-selection")`.
- Split further by cohesive feature when requested; avoid broad mechanical moves or duplicated shared state. Pass dependencies through small module APIs and verify Rhino behavior.

## Bulk selection

- Right-drag in MOVE or Delete mode selects populated slots in a snapped table-cell rectangle and replaces that mode's prior selection. The last rectangle outline remains visible after release even when it contains no populated slots; it clears when another selection gesture starts, a slot is toggled individually, the selection is cleared, or the table is rebound. A right-click without a drag toggles one populated slot.
- Detailed bulk-selection diagnostics use the existing debug-log toggle and `[Drag from Scheme Table]` prefix. They log cached slot-grid coordinates and gesture start/drag/end mapping. Avoid building or logging trace strings in `drawOverlay()`; drawing runs every frame.
- Button selection/highlight state is recomputed only when the mode, category, bound table/buttons, selected move slot, or bulk selection changes. Keep per-frame `updateHighlight()` calls as cheap state checks; don't rescan every button against selection arrays on every update.
- The overlay draws only the active or persistent region rectangle. Individual selected slots use the existing button checked/highlight style; do not issue a pair of `Lines.rect()` calls per selected slot per frame.
- The recurring EUI update should use `liveTableButtonsMatch()` to detect stable bindings before layout validation, Java-sequence-to-array copies, and listener installation. Do not run `validate()` or rebuild the slot-button arrays every frame.
- MOVE selections use the vanilla accent/accentBack outline colors; Delete selections use sapBullet/sapBulletBack. Bulk-selection input receives listener-local x/y and the originating slot button, converts the point to outer-table coordinates, and compares it with the cached table-local grid. Do not mix event stage coordinates with table-local slot bounds. Validate the outer table, wrapped table, and slot table before caching bounds; table child positions may not be laid out when bindings are first installed. Map grid cells by directly comparing each coordinate to indexed cached slot bounds, then split a gap using its two adjacent slot edges. Avoid per-iteration bounds aliases and accumulated nearest-distance calculations in this Rhino path: the user's runtime log showed those producing repeated values.
- The active and persistent selection outline uses the exact outer edges of the selected slot cells, not midpoint positions in the gaps. During a right-drag, remap the current pointer to a cell and draw the snapped cell footprint; the completed outline should match the active outline.
- `[R-002/R-006, implemented; runtime verification pending]` Cell mapping directly checks indexed cached bounds and splits gaps at the midpoint of the actual neighboring edges. The live and completed selection rectangles use the selected cells' exact edges. The latest in-game log showed nearest-distance values repeating from index 1 onward and mapping slot 138 to `(1,1)`; the nearest-distance implementation was removed.
- A left-drag in MOVE with a bulk selection preserves relative slot offsets, gaps, and custom images. During a drag, a cursor-following group preview shows selected schematic images without individual button borders and draws one border around the full footprint. Selected source slots remain highlighted in the table. Dragging a selected slot preserves its position beneath the cursor; dragging the persistent rectangle uses the grabbed point's offset from the group footprint. Empty destinations move immediately; occupied unselected destinations prompt before replacement. Revalidate all source and destination names/images after confirmation and before changing settings. Reject moves that go out of bounds, encounter stale data, or map multiple sources to one destination.
- `[R-001, implemented; runtime verification pending]` The cursor-following group preview positions its footprint using the clicked selected slot's offset from the footprint origin plus the pointer's local offset within that slot. Verify in-game by starting drags from the top-left and non-top-left selected slots, including single-row and single-column groups; the clicked schematic should stay under the pointer and the outline should enclose the full footprint.
- In Delete mode, existing left-click selection and the Delete button confirmation flow remain available alongside right-button selection.
- In-game verification is required for Arc overlay positioning, right-button gesture capture, layout snapping, group move collision checks, and Delete confirmation.

## Current bulk-selection runtime findings

- The latest user's runtime log showed a pointer at `(232.2,36.2)`, inside slot 138's bounds `[215,29.2 -> 240,54.2]`, mapping to `(1,1)` because nearest-distance values repeated for columns and rows. The corrected direct-bound lookup should map that point to `(8,13)` and the drag endpoint `(115.2,128.2)` to `(4,10)`; runtime confirmation is still pending.
- The same rectangle log formatted 90 entries with the same slot key/name. The former formatter used `Array.map` with an arrow callback in this Rhino path, so the repeated text did not prove the underlying selection contained duplicates. Selection keys and grid-bound diagnostics now use explicit indexed loops; region slot lookup also filters a single linear index traversal through a helper. Duplicate keys are skipped defensively and logged.
- User clarified that the bulk cursor preview should show the schematic images without individual outlines, with one outline around the group; selected source slots in the table should remain highlighted. The floating preview now uses plain `Image` actors rather than checked `ImageButton`s, and retains its single footprint outline.
- Bulk move source-removal and destination-write operations now run through per-mapping helper calls. This avoids relying on Rhino loop-local aliases when applying multiple source/destination records. The source/destination logs and post-rebuild setting verification remain enabled through the debug-log setting. The reported name decrement and “only last item” result still require an in-game multi-item move test to establish resolution.
- `[R-007, implemented; runtime verification pending]` A table capture listener starts a bulk drag from any point inside the visible MOVE rectangle, including empty cells, and preserves the grab offset in the preview. Right-click continues through to the slot listener for individual selection toggles. The drop target is derived from the preview footprint's top-left cell so the committed group matches the preview; occupied destinations use the existing confirmation and cancellation path.
- `[R-005/R-006, implemented; runtime verification pending]` Rectangle selection scans linear slot indices once and filters by row/column in a helper, avoiding nested-loop index reuse in Rhino. Gap mapping uses direct comparisons against neighboring bounds. The live and completed rectangles stay snapped to exact slot edges.
- With MOVE and Delete off, the local Extended UI source inspected is `saves\\mods\\zipextract\\Salivion-Extended-UI-54ad91f\\scripts\\ui\\other\\schematics-table-ui.js`. Its ordinary slot callback calls `Vars.control.input.useSchematic(schematic)`. That is the normal schematic-use/placement-preview path and is passed through by this mod. Do not suppress it unless the user explicitly wants normal schematic use from the table disabled; a separate mod-generated outline has not yet been demonstrated.
- Diagnostic traces remain gated by `drag-scheme-table.show-debug-logs` and are scoped to gesture/click/rebuild events, not per-frame drawing. In-game verification remains necessary for cell mapping, distinct slot snapshots, multi-item writes, preview appearance, and ordinary slot clicks.

## Extended UI integration

The inspected Extended UI copy is the user's `saves\mods\zipextract\Salivion-Extended-UI-54ad91f` (internal mod name `extended-ui`):

- The table is named `eui-schematics-table`; its direct settings keys use `schematic<category>.<column>.<row>` and append `image` for custom images.
- EUI exposes `global.eui.registerUpdate(fn)` and `global.eui.schematicsTableUI.rebuildTable()`.
- The live structure is outer table -> wrapped table -> categories at child 0, label at child 1, slots at child 2.
- EUI rebuilds the table and slot actors. The mod binds direct capture listeners to live slot buttons and rebinds when their identities change.
- Normal slot use calls `Vars.control.input.useSchematic(schematic)`. Preserve EUI's right-click edit and mobile double-tap behavior.

## Reference sources

- Local Mindustry source: `C:\Program Files (x86)\Steam\steamapps\common\Mindustry\Mindustry source code and Libraries\Mindustry-160.7`
- Matching Arc source: `C:\Program Files (x86)\Steam\steamapps\common\Mindustry\Mindustry source code and Libraries\Arc-7445105cd2683daf5b9ac7033ebb07265d3e814d`
- The user's installed game build may differ; check the game log header when exact runtime compatibility matters.

## Verification

- Run `node --check scripts\main.js` and `git diff --check` for script changes.
- UI behavior requires in-game testing. For library drag, test normal card use; nested controls; search/filter rebuilds; hold threshold; empty and occupied table destinations; cancellation; and release outside the table. Also re-test table-to-table move behavior.
- Never claim runtime success from syntax checks alone.
