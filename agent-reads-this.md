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
- The vanilla-library-to-table feature uses a stationary hold of about 0.4 seconds, then shows a pointer-following preview. Empty destinations insert; occupied destinations ask for confirmation; drops outside the table do nothing.
- Preserve normal vanilla schematic-card clicks and nested info/export/edit/delete controls.

## Delete-mode selection: current runtime findings

- The user confirmed in-game that Delete mode and selected schematic slots highlight correctly. The selected slot uses the same appearance as the normal hover highlight; preserve this behavior.
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

## Current library feature plan: show schematic icon tags in table slots

- The immediate focus is to make an inserted schematic's vanilla icon tags available as the image shown in its Extended UI table slot. This is not text translation and does not modify the schematic's tags.
- Vanilla stores both icon tags and arbitrary text tags in `Schematic.labels`. A schematic can have a mixture of both; offer only tags that represent displayable icons. Ignore text/custom-name tags, even if their text resembles an icon name. Do not use a regex that strips letters or other text heuristics to classify tags.
- If there is one displayable icon tag, use it automatically. If there are multiple, ask which icon to use with a prompt naming the schematic and show only its displayable icon-tag choices. Do not show text-only tags as choices.
- When the user chooses an icon, save the schematic name to the destination slot as usual and save the matching Extended UI icon identifier to that slot's existing `<slot-key>image` setting, then rebuild the table. Resolve vanilla icon-tag values to identifiers/drawables using exact icon/content mappings; do not assume the raw tag string is already an Extended UI icon identifier.
- If there are no displayable icon tags, retain the existing insertion behavior. If the user cancels an icon-choice prompt, do not insert or modify the destination. Preserve the existing occupied-slot confirmation flow and do not overwrite slot data before the required confirmations/selections are complete.
- The current drag resolves the actual schematic from `SchematicsDialog.SchematicImage`; use that `Schematic` object's labels for icon choices, not the card preview or its rendered image.
- Keep the selection UI event-driven and scoped to the insertion interaction. Do not add recurring scans or expensive per-frame work for tag/icon discovery.
- Verify in game with no icon tags, one icon tag, multiple icon tags mixed with text tags, prompt cancellation, and occupied-slot confirmation. Confirm the selected icon and schematic name both appear in the intended slot and that ordinary library clicks and table MOVE behavior remain unchanged.

## Future library feature: multi-select/batch insertion

- Multi-select from the vanilla library and placing multiple schematics into the EUI table remains a separate future feature; do not implement it as part of the icon-tag work.
- Keep schematic data (`Schematic` objects) distinct from card icons/previews. Preserve the current one-at-a-time drag interaction and table MOVE behavior.
- A future batch-placement feature needs explicit rules for destination order, occupied slots and confirmation, preserving or replacing existing schematics, and what happens when the selected count exceeds available slots. Do not overwrite current slots implicitly.

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
