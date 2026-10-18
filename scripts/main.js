"use strict";

const rowsSetting = "eui-SchematicsTableRows";
const columnsSetting = "eui-SchematicsTableColumns";
const tableName = "eui-schematics-table";
const skipSwapConfirmationsSetting = "drag-scheme-table.skip-swap-confirmations";
const visualDragSetting = "drag-scheme-table.visual-drag";
const showDebugLogsSetting = "drag-scheme-table.show-debug-logs";
const scriptVersion = "1.0.3";
const dragThresholdSquared = 64;
const dragPreviewScale = 1.35;
const libraryHoldMillis = 400;

let moveMode = false;
let deleteMode = false;
let selectedSlot = null;
let selectedDeleteSlots = [];
let skipSwapConfirmations = false;
let visualDragEnabled = true;
let showDebugLogs = true;
let activeDrag = null;
let dragPreview = null;
let moveControl;
let moveButton;
let deleteButton;
let boundTable;
let attachedTable;
let pendingDeletionVerification;
let boundSlotButtons = [];
let boundSlotStyles = [];
let boundSlotDefaultBackgrounds = [];
let boundSlotDeleteHighlights = [];
let lastUpdateError;
let boundCategoryButtons = [];
let boundColumns = 5;
let lastLayoutWarning;
let waitingLogged = false;
let lastMoveAnnouncement;
let swapSettingInstalled = false;
let swapSettingIntegrationErrorLogged = false;
let dragPreviewErrorLogged = false;
let libraryDragUpdater;
let librarySchematicField;
let libraryCandidate;
let libraryPreview;
let libraryLastUpdateError;
let libraryInsertConfirmationOpen = false;
let libraryPressListenerInstalled = false;

function dbg(message) {
    if (showDebugLogs) Log.info("[Drag from Scheme Table] " + message);
}

function announceMoveMessage(message) {
    if (lastMoveAnnouncement != null) lastMoveAnnouncement.remove();

    const announcement = new Table(Styles.black3);
    announcement.touchable = Packages.arc.scene.event.Touchable.disabled;
    announcement.margin(8).add(message).style(Styles.outlineLabel).labelAlign(Align.center);
    announcement.update(() => {
        announcement.setPosition(Core.graphics.getWidth() / 2, Core.graphics.getHeight() / 2, Align.center);
        announcement.toFront();
        if (Vars.state.isMenu() || !Vars.ui.hudfrag.shown) announcement.remove();
    });
    announcement.actions(Actions.fadeOut(3, Interp.pow4In), Actions.remove());
    announcement.pack();
    announcement.act(0.1);
    Core.scene.add(announcement);
    lastMoveAnnouncement = announcement;
}

function clearMoveAnnouncement() {
    if (lastMoveAnnouncement != null) {
        lastMoveAnnouncement.remove();
        lastMoveAnnouncement = null;
    }
}

function findTable() {
    const children = Vars.ui.hudGroup.getChildren();
    for (let i = 0; i < children.size; i++) {
        const child = children.get(i);
        if (String(child.name) === tableName) return child;
    }
    return null;
}

function slotKey(category, index, columns) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return "schematic" + category + "." + column + "." + row;
}

function getSelectedCategory(categoryButtons) {
    for (let i = 0; i < categoryButtons.length; i++) {
        if (categoryButtons[i].isChecked()) return i;
    }
    return 0;
}

function addSwapConfirmationSetting() {
    if (swapSettingInstalled || !global.eui.settings || !global.eui.settings.cont) return;

    const children = global.eui.settings.cont.getChildren();
    for (let i = 0; i < children.size; i++) {
        const child = children.get(i);
        if (typeof child.getWidget !== "function") continue;

        const settingsTable = child.getWidget();
        if (!settingsTable || typeof settingsTable.checkPref !== "function") continue;

        settingsTable.checkPref(
            skipSwapConfirmationsSetting,
            false,
            value => {
                skipSwapConfirmations = value;
                Core.settings.forceSave();
            }
        );
        settingsTable.checkPref(
            visualDragSetting,
            true,
            value => {
                visualDragEnabled = value;
                if (!visualDragEnabled) {
                    clearVisualDrag();
                    cancelLibraryDrag(true);
                }
                Core.settings.forceSave();
            }
        );
        settingsTable.checkPref(
            showDebugLogsSetting,
            true,
            value => {
                showDebugLogs = value;
                Core.settings.forceSave();
            }
        );
        swapSettingInstalled = true;
        dbg("Added swap, visual-drag, and debug-log toggles to Extended UI settings.");
        return;
    }

    if (!swapSettingIntegrationErrorLogged) {
        Log.err("[Drag from Scheme Table] Could not find Extended UI's settings table; swap toggle was not added.");
        swapSettingIntegrationErrorLogged = true;
    }
}

function clearVisualDrag() {
    if (dragPreview != null) {
        dragPreview.remove();
        dragPreview = null;
    }
    activeDrag = null;
}

function clearLibraryDrag() {
    if (libraryPreview != null) {
        libraryPreview.remove();
        libraryPreview = null;
    }
    libraryCandidate = null;
    stopLibraryDragController();
}

function cancelLibraryDrag(restoreLibrary) {
    const wasDragging = libraryCandidate != null && libraryCandidate.dragging;
    clearLibraryDrag();
    if (restoreLibrary && wasDragging && Vars.state.isGame() && !Vars.ui.schematics.isShown()) {
        Vars.ui.schematics.show();
    }
}

function getLibrarySchematic(image) {
    if (librarySchematicField == null) {
        librarySchematicField = image.getClass().getDeclaredField("schematic");
        librarySchematicField.setAccessible(true);
    }
    return librarySchematicField.get(image);
}

function findSchematicImage(element) {
    if (element == null) return null;
    if (String(element.getClass().getName()) ===
        "mindustry.ui.dialogs.SchematicsDialog$SchematicImage") return element;
    if (!(element instanceof Packages.arc.scene.Group)) return null;

    const children = element.getChildren();
    for (let i = 0; i < children.size; i++) {
        const image = findSchematicImage(children.get(i));
        if (image != null) return image;
    }
    return null;
}

function installLibraryPressListener() {
    if (libraryPressListenerInstalled || Vars.headless) return;

    Vars.ui.schematics.addCaptureListener(new JavaAdapter(Packages.arc.scene.event.InputListener, {
        touchDown: function(event, x, y, pointer, button) {
            const targetPath = [];
            let target = event.targetActor;
            while (target != null && targetPath.length < 12) {
                targetPath.push(String(target.getClass().getName()));
                if (target === Vars.ui.schematics) break;
                target = target.parent;
            }
            dbg("Library touchDown: button=" + button +
                ", shown=" + Vars.ui.schematics.isShown() +
                ", inGame=" + Vars.state.isGame() +
                ", visualDrag=" + visualDragEnabled +
                ", candidateActive=" + (libraryCandidate != null) +
                ", tableEnabled=" + Core.settings.getBool("eui-ShowSchematicsTable", true) +
                ", targetPath=" + targetPath.join(" -> "));

            if (button != Packages.arc.input.KeyCode.mouseLeft) {
                dbg("Library press ignored: not the left mouse button.");
                return false;
            }
            if (!Vars.ui.schematics.isShown() || !Vars.state.isGame() ||
                !visualDragEnabled || libraryCandidate != null ||
                !Core.settings.getBool("eui-ShowSchematicsTable", true)) {
                dbg("Library press ignored by state/settings guard.");
                return false;
            }

            let image = findSchematicImage(event.targetActor);
            let card = event.targetActor;
            while (card != null && !(card instanceof Button)) {
                card = card.parent;
            }
            if (card == null) {
                dbg("Library press target has no Button ancestor.");
                return false;
            }

            if (image == null) image = findSchematicImage(card);
            if (image == null) {
                dbg("Library press nearest Button contains no schematic image: " +
                    String(card.getClass().getName()) + ".");
                return false;
            }

            let schematic;
            try {
                schematic = getLibrarySchematic(image);
            } catch (error) {
                Log.err("[Drag from Scheme Table] Could not read the schematic associated with a library card: " + error);
                return false;
            }
            if (schematic == null) return false;

            libraryCandidate = {
                card: card,
                schematic: schematic,
                pointer: pointer,
                startX: event.stageX,
                startY: event.stageY,
                startedAt: Packages.arc.util.Time.millis(),
                dragging: false
            };
            installLibraryDragController();
            dbg("Library press captured for " + schematic.name() + ".");
            return false;
        }
    }));

    Vars.ui.schematics.hidden(() => {
        if (libraryCandidate != null && !libraryCandidate.dragging) clearLibraryDrag();
    });
    libraryPressListenerInstalled = true;
    dbg("Installed on-demand schematic library press listener.");
}

function libraryPointerDown(drag) {
    return Vars.mobile
        ? Core.input.isTouched(drag.pointer)
        : Core.input.keyDown(Packages.arc.input.KeyCode.mouseLeft);
}

function libraryPointerPosition(drag) {
    const screenX = Core.input.mouseX(drag.pointer);
    const screenY = Core.input.mouseY(drag.pointer);
    return Core.scene.screenToStageCoordinates(new Packages.arc.math.geom.Vec2(screenX, screenY));
}

function updateLibraryPreview(stageX, stageY) {
    if (libraryPreview == null) {
        libraryPreview = new Table(Styles.black3);
        libraryPreview.touchable = Packages.arc.scene.event.Touchable.disabled;
        libraryPreview.add(new Packages.mindustry.ui.dialogs.SchematicsDialog.SchematicImage(
            libraryCandidate.schematic
        )).size(150).row();
        const name = libraryPreview.add(libraryCandidate.schematic.name())
            .style(Styles.outlineLabel).color(Color.white).width(170).get();
        name.setEllipsis(true);
        libraryPreview.setSize(180, 180);
        Core.scene.add(libraryPreview);
        dbg("Library drag started for " + libraryCandidate.schematic.name() + ".");
        Vars.ui.schematics.hide();
    }

    libraryPreview.setPosition(stageX, stageY, Align.center);
    libraryPreview.toFront();
}

function findLibraryDropTarget(stageX, stageY) {
    let actor = Core.scene.hit(stageX, stageY, true);
    while (actor != null) {
        for (let i = 0; i < boundSlotButtons.length; i++) {
            if (actor === boundSlotButtons[i]) return i;
        }
        actor = actor.parent;
    }
    return -1;
}

function refreshSchematicTable() {
    if (global.eui.schematicsTableUI && global.eui.schematicsTableUI.rebuildTable) {
        dbg("Requesting Extended UI schematic table rebuild.");
        try {
            global.eui.schematicsTableUI.rebuildTable();
            dbg("Extended UI schematic table rebuild call returned.");
        } catch (error) {
            Log.err("[Drag from Scheme Table] Extended UI schematic table rebuild failed: " + error);
        }
    } else {
        Log.err("[Drag from Scheme Table] schematicsTableUI.rebuildTable missing; table not refreshed.");
    }
}

function insertLibrarySchematic(schematic, destination, expectedDestination) {
    const currentDestination = Core.settings.getString(destination, "");
    if (currentDestination !== expectedDestination) {
        announceMoveMessage(Core.bundle.get("drag-scheme-table.library-insert-stale"));
        dbg("Library insertion canceled because destination " + destination + " changed.");
        return;
    }

    Core.settings.put(destination, schematic.name());
    selectedSlot = null;
    announceMoveMessage(Core.bundle.get("drag-scheme-table.library-insert-complete"));
    dbg("Inserted library schematic " + schematic.name() + " into " + destination + ".");
    refreshSchematicTable();
}

function showLibraryInsertConfirm(schematic, destination, expectedDestination) {
    if (libraryInsertConfirmationOpen) return;
    clearMoveAnnouncement();

    const dialog = new BaseDialog(Core.bundle.get("drag-scheme-table.library-insert-title"));
    let confirmed = false;
    dialog.setFillParent(false);
    dialog.cont.add(Core.bundle.get("drag-scheme-table.library-insert-message"))
        .width(Vars.mobile ? 400 : 500).wrap().pad(4).get()
        .setAlignment(Align.center, Align.center);
    dialog.cont.row();
    const skipCheckbox = new Packages.arc.scene.ui.CheckBox(
        Core.bundle.get("drag-scheme-table.skip-confirmation")
    );
    skipCheckbox.setChecked(skipSwapConfirmations);
    dialog.cont.add(skipCheckbox).left().pad(4);

    const confirm = () => {
        if (confirmed) return;
        confirmed = true;
        dialog.hide();
        if (skipCheckbox.isChecked()) {
            skipSwapConfirmations = true;
            Core.settings.put(skipSwapConfirmationsSetting, true);
            Core.settings.forceSave();
            dbg("Swap confirmation preference saved.");
        }
        insertLibrarySchematic(schematic, destination, expectedDestination);
    };

    dialog.hidden(() => {
        libraryInsertConfirmationOpen = false;
        if (!confirmed) {
            announceMoveMessage(Core.bundle.get("drag-scheme-table.library-insert-cancelled"));
            dbg("Library schematic replacement dismissed; destination unchanged.");
        }
    });

    dialog.buttons.defaults().size(200, 54).pad(2);
    dialog.buttons.button("@cancel", Icon.cancel, () => dialog.hide());
    dialog.buttons.button("@ok", Icon.ok, confirm);
    dialog.keyDown(Packages.arc.input.KeyCode.enter, confirm);
    dialog.keyDown(Packages.arc.input.KeyCode.escape, () => dialog.hide());
    dialog.keyDown(Packages.arc.input.KeyCode.back, () => dialog.hide());
    libraryInsertConfirmationOpen = true;
    try {
        dialog.show();
    } catch (error) {
        libraryInsertConfirmationOpen = false;
        throw error;
    }
}

function finishLibraryDrag(drag, stageX, stageY) {
    const table = findTable();
    if (table == null) {
        dbg("Library drag ended without an Extended UI table; no changes made.");
        return;
    }
    bindTableButtons(table);

    const index = findLibraryDropTarget(stageX, stageY);
    if (index < 0) {
        dbg("Library drag ended outside a schematic slot; no changes made.");
        return;
    }

    const category = getSelectedCategory(boundCategoryButtons);
    const destination = slotKey(category, index, boundColumns);
    const expectedDestination = Core.settings.getString(destination, "");
    dbg("Library drop at slot " + index + " resolved to " + destination + ".");
    if (expectedDestination) {
        if (skipSwapConfirmations) {
            insertLibrarySchematic(drag.schematic, destination, expectedDestination);
        } else {
            showLibraryInsertConfirm(drag.schematic, destination, expectedDestination);
        }
    } else {
        insertLibrarySchematic(drag.schematic, destination, "");
    }
}

function updateLibraryDrag() {
    if (!visualDragEnabled || !Core.settings.getBool("eui-ShowSchematicsTable", true) ||
        !Vars.state.isGame()) {
        cancelLibraryDrag(true);
        return;
    }

    if (libraryCandidate == null) return;
    if (!libraryCandidate.dragging && !Vars.ui.schematics.isShown()) {
        clearLibraryDrag();
        return;
    }

    if (!libraryPointerDown(libraryCandidate)) {
        if (libraryCandidate.dragging) {
            const completed = libraryCandidate;
            const position = libraryPointerPosition(completed);
            clearLibraryDrag();
            finishLibraryDrag(completed, position.x, position.y);
        } else {
            clearLibraryDrag();
        }
        return;
    }

    const position = libraryPointerPosition(libraryCandidate);
    if (!libraryCandidate.dragging) {
        const dx = position.x - libraryCandidate.startX;
        const dy = position.y - libraryCandidate.startY;
        if (dx * dx + dy * dy >= dragThresholdSquared) {
            clearLibraryDrag();
            return;
        }
        if (Packages.arc.util.Time.millis() - libraryCandidate.startedAt < libraryHoldMillis) return;

        libraryCandidate.dragging = true;
        Core.scene.cancelTouchFocus(libraryCandidate.card);
    }

    updateLibraryPreview(position.x, position.y);
}

function installLibraryDragController() {
    if (libraryDragUpdater != null || Vars.headless) return;
    libraryDragUpdater = new Table();
    libraryDragUpdater.touchable = Packages.arc.scene.event.Touchable.disabled;
    libraryDragUpdater.update(() => {
        try {
            updateLibraryDrag();
            libraryLastUpdateError = null;
        } catch (error) {
            const message = String(error);
            if (message !== libraryLastUpdateError) {
                Log.err("[Drag from Scheme Table] Library drag update failed: " + message);
                libraryLastUpdateError = message;
            }
            cancelLibraryDrag(true);
        }
    });
    Core.scene.add(libraryDragUpdater);
    dbg("Library drag controller installed.");
}

function stopLibraryDragController() {
    if (libraryDragUpdater == null) return;
    libraryDragUpdater.remove();
    libraryDragUpdater = null;
    dbg("Library drag controller stopped.");
}

function updateDragPreview(stageX, stageY) {
    if (dragPreview == null) {
        const image = activeDrag.button.getImage();
        const drawable = image == null ? null : image.getDrawable();
        if (drawable == null) {
            if (!dragPreviewErrorLogged) {
                Log.err("[Drag from Scheme Table] Cannot create drag preview: schematic slot has no drawable.");
                dragPreviewErrorLogged = true;
            }
            return;
        }

        const width = image.getWidth() > 0 ? image.getWidth() : activeDrag.button.getWidth() * 0.6;
        const height = image.getHeight() > 0 ? image.getHeight() : activeDrag.button.getHeight() * 0.6;
        dragPreview = new Packages.arc.scene.ui.ImageButton(drawable, Styles.selecti);
        dragPreview.setChecked(true);
        dragPreview.touchable = Packages.arc.scene.event.Touchable.disabled;
        dragPreview.setSize(activeDrag.button.getWidth() * dragPreviewScale,
            activeDrag.button.getHeight() * dragPreviewScale);
        dragPreview.resizeImage(width * dragPreviewScale);
        Core.scene.add(dragPreview);
        dbg("Created outlined drag preview for " + activeDrag.key + ".");
    }

    dragPreview.setPosition(stageX, stageY, Align.center);
    dragPreview.toFront();
}

function showSwapConfirm(source, destination, expectedDestination) {
    clearMoveAnnouncement();
    const dialog = new BaseDialog(Core.bundle.get("drag-scheme-table.swap-title"));
    let confirmed = false;
    dialog.setFillParent(false);
    dialog.cont.add(Core.bundle.get("drag-scheme-table.swap-message"))
        .width(Vars.mobile ? 400 : 500).wrap().pad(4).get()
        .setAlignment(Align.center, Align.center);
    dialog.cont.row();

    const skipCheckbox = new Packages.arc.scene.ui.CheckBox(
        Core.bundle.get("drag-scheme-table.skip-confirmation")
    );
    skipCheckbox.setChecked(skipSwapConfirmations);
    dialog.cont.add(skipCheckbox).left().pad(4);

    const confirm = () => {
        if (confirmed) return;
        confirmed = true;
        dialog.hide();
        if (skipCheckbox.isChecked()) {
            skipSwapConfirmations = true;
            Core.settings.put(skipSwapConfirmationsSetting, true);
            Core.settings.forceSave();
            dbg("Swap confirmation preference saved.");
        }
        moveSchematic(source, destination, expectedDestination);
    };

    dialog.hidden(() => {
        if (!confirmed) {
            selectedSlot = null;
            announceMoveMessage(Core.bundle.get("drag-scheme-table.swap-cancelled"));
            dbg("Swap confirmation dismissed; cleared selected schematic.");
        }
    });

    dialog.buttons.defaults().size(200, 54).pad(2);
    dialog.buttons.button("@cancel", Icon.cancel, () => dialog.hide());
    dialog.buttons.button("@ok", Icon.ok, confirm);
    dialog.keyDown(Packages.arc.input.KeyCode.enter, confirm);
    dialog.keyDown(Packages.arc.input.KeyCode.escape, () => dialog.hide());
    dialog.keyDown(Packages.arc.input.KeyCode.back, () => dialog.hide());
    dialog.show();
}

function moveSchematic(source, destination, expectedDestination) {
    const currentSource = Core.settings.getString(source.key, "");
    const currentDestination = Core.settings.getString(destination, "");

    if (currentSource !== source.name || currentDestination !== expectedDestination) {
        selectedSlot = null;
        announceMoveMessage(Core.bundle.get("drag-scheme-table.move-stale"));
        return;
    }

    const sourceImageKey = source.key + "image";
    const destinationImageKey = destination + "image";
    const sourceImage = Core.settings.getString(sourceImageKey, "");
    const destinationImage = Core.settings.getString(destinationImageKey, "");

    Core.settings.put(destination, currentSource);
    if (currentDestination) {
        Core.settings.put(source.key, currentDestination);
    } else {
        Core.settings.remove(source.key);
    }

    Core.settings.remove(sourceImageKey);
    Core.settings.remove(destinationImageKey);
    if (sourceImage) {
        Core.settings.put(destinationImageKey, sourceImage);
    }
    if (currentDestination && destinationImage) {
        Core.settings.put(sourceImageKey, destinationImage);
    }

    selectedSlot = null;
    announceMoveMessage(Core.bundle.get(currentDestination
        ? "drag-scheme-table.swap-complete"
        : "drag-scheme-table.move-complete"));
    dbg((currentDestination ? "Swapped " : "Moved ") + source.key + " <-> " + destination);
    refreshSchematicTable();
}

function selectOrMove(category, index, columns) {
    const key = slotKey(category, index, columns);
    const value = Core.settings.getString(key, "");
    dbg("Slot click: " + key + " value=\"" + value + "\" selected=" + (selectedSlot ? selectedSlot.key : "none"));

    if (selectedSlot == null) {
        if (!value) {
            announceMoveMessage(Core.bundle.get("drag-scheme-table.no-source"));
            return;
        }
        selectedSlot = { key: key, name: value };
        announceMoveMessage(Core.bundle.format("drag-scheme-table.source-selected", value));
        return;
    }

    if (selectedSlot.key === key) {
        selectedSlot = null;
        announceMoveMessage(Core.bundle.get("drag-scheme-table.move-cancelled"));
        return;
    }

    const source = selectedSlot;
    if (value) {
        if (skipSwapConfirmations) {
            moveSchematic(source, key, value);
        } else {
            showSwapConfirm(source, key, value);
        }
    } else {
        moveSchematic(source, key, "");
    }
}

function selectOrToggleDelete(category, index, columns) {
    const key = slotKey(category, index, columns);
    let selectedIndex = -1;
    for (let i = 0; i < selectedDeleteSlots.length; i++) {
        if (selectedDeleteSlots[i].key === key) {
            selectedIndex = i;
            break;
        }
    }
    if (selectedIndex >= 0) {
        selectedDeleteSlots.splice(selectedIndex, 1);
        updateDeleteButtonHighlight();
        updateHighlight(key);
        //logDeleteSlotVisualState(key, index, false);
        dbg("Deselected " + key + " for deletion.");
        announceMoveMessage(Core.bundle.format(
            "drag-scheme-table.delete-deselected",
            selectedDeleteSlots.length
        ));
        return;
    }

    const name = Core.settings.getString(key, "");
    if (!name) {
        announceMoveMessage(Core.bundle.get("drag-scheme-table.delete-empty-slot"));
        return;
    }

    selectedDeleteSlots.push({
        key: key,
        name: String(name),
        image: String(Core.settings.getString(key + "image", ""))
    });
    updateDeleteButtonHighlight();
    updateHighlight(key);
    //logDeleteSlotVisualState(key, index, true);
    dbg("Selected " + key + " (" + name + ") for deletion.");
    announceMoveMessage(Core.bundle.format(
        "drag-scheme-table.delete-selected",
        name,
        selectedDeleteSlots.length
    ));
}

/* Console messages for debugging the visual state of schematic slot buttons. These are not used in normal operation, but can be helpful for diagnosing issues with button styles or interactions. Enable if highlighting in table breaks.
function logDeleteSlotVisualState(key, index, selected) {
    const button = boundSlotButtons[index];
    const style = button.getStyle();
    dbg("Delete slot visual state: key=" + key +
        ", selected=" + selected +
        ", checked=" + button.isChecked() +
        ", hovering=" + button.isOver() +
        ", upMatchesOver=" + (style.up === style.over) +
        ", overDrawable=" + (style.over != null) +
        ", checkedDrawable=" + (style.checked != null) + ".");
}

function logDeleteSlotHighlightOnExit(index) {
    const category = getSelectedCategory(boundCategoryButtons);
    const key = slotKey(category, index, boundColumns);
    for (let i = 0; i < selectedDeleteSlots.length; i++) {
        if (selectedDeleteSlots[i].key !== key) continue;

        const button = boundSlotButtons[index];
        const style = button.getStyle();
        dbg("Delete slot mouse exit: key=" + key +
            ", checked=" + button.isChecked() +
            ", hovering=" + button.isOver() +
            ", upMatchesOver=" + (style.up === style.over) +
            ", backgroundMatchesUp=" + (button.getBackground() === style.up) +
            ", hasButtonGroup=" + (button.getButtonGroup() != null) + ".");
        return;
    }
}
*/

function deleteSelectedSchematics(selection) {
    let deleted = 0;
    let stale = 0;
    const removedSlots = [];
    dbg("Starting deletion for " + selection.length + " selected schematics.");
    for (var i = 0; i < selection.length; i++) {
        var selectedKey = String(selection[i].key);
        var expectedName = String(selection[i].name);
        var expectedImage = String(selection[i].image);
        var imageKey = selectedKey + "image";
        var currentName = String(Core.settings.getString(selectedKey, ""));
        var currentImage = String(Core.settings.getString(imageKey, ""));
        dbg("Checking deletion index " + i + " for " + selectedKey +
            ": nameMatches=" + (currentName === expectedName) +
            ", imageMatches=" + (currentImage === expectedImage) + ".");
        if (currentName !== expectedName || currentImage !== expectedImage) {
            stale++;
            dbg("Skipped stale deletion for " + selectedKey +
                ": nameMatches=" + (currentName === expectedName) +
                ", imageMatches=" + (currentImage === expectedImage) + ".");
            continue;
        }
        Core.settings.remove(selectedKey);
        Core.settings.remove(imageKey);
        var remainingName = String(Core.settings.getString(selectedKey, ""));
        var remainingImage = String(Core.settings.getString(imageKey, ""));
        if (remainingName === "" && remainingImage === "") {
            deleted++;
            removedSlots.push(selectedKey);
            dbg("Verified schematic slot removed: " + selectedKey + ".");
        } else {
            stale++;
            Log.err("[Drag from Scheme Table] Schematic slot remained after removal: " +
                selectedKey + " (nameEmpty=" + (remainingName === "") +
                ", imageEmpty=" + (remainingImage === "") + ").");
        }
    }

    selectedDeleteSlots = [];
    deleteMode = false;
    updateDeleteButtonHighlight();
    updateHighlight();
    if (deleted > 0) {
        pendingDeletionVerification = {
            keys: removedSlots,
            previousTable: boundTable
        };
        Core.settings.forceSave();
        refreshSchematicTable();
    }
    moveButton.setChecked(moveMode);
    deleteButton.setChecked(deleteMode);

    if (stale > 0) {
        announceMoveMessage(Core.bundle.format(
            deleted > 0
                ? "drag-scheme-table.delete-complete-stale"
                : "drag-scheme-table.delete-stale",
            deleted,
            stale
        ));
    } else {
        announceMoveMessage(Core.bundle.format("drag-scheme-table.delete-complete", deleted));
    }
    dbg("Deleted " + deleted + " selected schematics; skipped " + stale + " changed slots.");
}

function verifyDeletedSlotsAfterTableUpdate(table) {
    if (pendingDeletionVerification == null) return;

    const verification = pendingDeletionVerification;
    pendingDeletionVerification = null;
    dbg("Post-rebuild deletion check: tableReplaced=" +
        (table !== verification.previousTable) +
        ", visibleSlotButtons=" + boundSlotButtons.length + ".");

    for (var i = 0; i < verification.keys.length; i++) {
        var key = String(verification.keys[i]);
        var imageKey = key + "image";
        var currentName = String(Core.settings.getString(key, ""));
        var currentImage = String(Core.settings.getString(imageKey, ""));
        dbg("Post-rebuild slot state index=" + i + ": key=" + key +
            ", nameExists=" + Core.settings.has(key) +
            ", name=\"" + currentName +
            "\", imageExists=" + Core.settings.has(imageKey) +
            ", image=\"" + currentImage + "\".");
    }
}

function showDeleteConfirm() {
    if (selectedDeleteSlots.length === 0) {
        deleteMode = false;
        updateDeleteButtonHighlight();
        updateHighlight();
        announceMoveMessage(Core.bundle.get("drag-scheme-table.delete-mode-disabled"));
        return;
    }

    clearMoveAnnouncement();
    const selection = selectedDeleteSlots.slice();
    dbg("Delete confirmation snapshot keys: " +
        selection.map(selected => selected.key).join(",") + ".");
    const names = [];
    for (let i = 0; i < selection.length; i++) {
        names.push("- " + selection[i].name);
    }
    const dialog = new BaseDialog(Core.bundle.get("drag-scheme-table.delete-title"));
    let confirmed = false;
    dbg("Opened deletion confirmation for " + selection.length + " schematics.");
    dialog.setFillParent(false);
    dialog.cont.add(Core.bundle.format(
        "drag-scheme-table.delete-message",
        names.join("\n")
    )).width(Vars.mobile ? 400 : 500).wrap().pad(4).get()
        .setAlignment(Align.center, Align.center);

    const confirm = () => {
        if (confirmed) return;
        confirmed = true;
        dialog.hide();
        deleteSelectedSchematics(selection);
    };

    dialog.hidden(() => {
        if (!confirmed) {
            selectedDeleteSlots = [];
            deleteMode = false;
            updateDeleteButtonHighlight();
            updateHighlight();
            announceMoveMessage(Core.bundle.get("drag-scheme-table.delete-cancelled"));
            dbg("Schematic deletion cancelled; selection cleared and Delete mode disabled.");
        }
    });
    dialog.buttons.defaults().size(200, 54).pad(2);
    dialog.buttons.button("@cancel", Icon.cancel, () => dialog.hide());
    dialog.buttons.button("@ok", Icon.ok, confirm);
    dialog.keyDown(Packages.arc.input.KeyCode.enter, confirm);
    dialog.keyDown(Packages.arc.input.KeyCode.escape, () => dialog.hide());
    dialog.keyDown(Packages.arc.input.KeyCode.back, () => dialog.hide());
    dialog.show();
}

function sameButtons(first, second) {
    if (first.length !== second.length) return false;
    for (let i = 0; i < first.length; i++) {
        if (first[i] !== second[i]) return false;
    }
    return true;
}

function seqToArray(seq) {
    const result = [];
    for (let i = 0; i < seq.size; i++) {
        result.push(seq.get(i));
    }
    return result;
}

function findDropTarget(stageX, stageY) {
    let actor = Core.scene.hit(stageX, stageY, true);
    while (actor != null) {
        for (let i = 0; i < boundSlotButtons.length; i++) {
            if (actor === boundSlotButtons[i]) return i;
        }
        actor = actor.parent;
    }
    return -1;
}

function finishDrag(drag, stageX, stageY) {
    const index = findDropTarget(stageX, stageY);
    if (index < 0) {
        dbg("Drag ended outside a schematic slot; no changes made.");
        return;
    }
    if (!drag.name) {
        dbg("Drag ended on slot " + index + " from an empty source; no changes made.");
        return;
    }

    const category = getSelectedCategory(boundCategoryButtons);
    const destination = slotKey(category, index, boundColumns);
    if (destination === drag.key) {
        dbg("Drag ended on its source slot; no changes made.");
        return;
    }

    selectedSlot = null;
    const source = { key: drag.key, name: drag.name };
    const expectedDestination = Core.settings.getString(destination, "");
    if (expectedDestination) {
        if (skipSwapConfirmations) {
            moveSchematic(source, destination, expectedDestination);
        } else {
            showSwapConfirm(source, destination, expectedDestination);
        }
    } else {
        moveSchematic(source, destination, "");
    }
}

function bindTableButtons(table) {
    const rows = Core.settings.getInt(rowsSetting, 4);
    const columns = Core.settings.getInt(columnsSetting, 5);
    if (table.getChildren().size === 0) return;

    const wrapped = table.getChildren().get(0);
    const wrappedChildren = wrapped.getChildren();
    if (wrappedChildren.size < 3) return;

    const categories = wrappedChildren.get(0).getChildren();
    const slots = wrappedChildren.get(2).getChildren();
    if (categories.size === 0 || slots.size === 0) {
        throw new Error("Unexpected table layout: " + categories.size + " category buttons, " +
            slots.size + " schematic buttons.");
    }
    if (categories.size !== columns || slots.size !== rows * columns) {
        const warning = categories.size + " categories, " + slots.size + " slots; configured " +
            columns + "x" + rows;
        if (warning !== lastLayoutWarning) {
            Log.warn("[Drag from Scheme Table] Live table layout differs from settings (" +
                warning + "). Using the live buttons.");
            lastLayoutWarning = warning;
        }
    } else {
        lastLayoutWarning = null;
    }

    const categoryButtons = seqToArray(categories);
    const slotButtons = seqToArray(slots);
    const liveColumns = categoryButtons.length;
    if (boundTable === table && boundColumns === liveColumns && sameButtons(boundSlotButtons, slotButtons)) return;

    boundCategoryButtons = categoryButtons;
    boundColumns = liveColumns;
    boundSlotButtons = slotButtons;
    boundSlotStyles = [];
    boundSlotDefaultBackgrounds = [];
    boundSlotDeleteHighlights = [];

    for (let i = 0; i < slotButtons.length; i++) {
        const index = i;
        const slotStyle = new Packages.arc.scene.ui.ImageButton.ImageButtonStyle(
            slotButtons[i].getStyle()
        );
        slotStyle.checked = slotStyle.over;
        slotButtons[i].setStyle(slotStyle);
        boundSlotStyles.push(slotStyle);
        boundSlotDefaultBackgrounds.push(slotStyle.up);
        boundSlotDeleteHighlights.push(false);
        slotButtons[i].addCaptureListener(new JavaAdapter(Packages.arc.scene.event.InputListener, {
            touchDown: function(event, x, y, pointer, button) {
                if ((!moveMode && !deleteMode) ||
                    button != Packages.arc.input.KeyCode.mouseLeft) return false;
                if (moveMode) {
                    const category = getSelectedCategory(boundCategoryButtons);
                    const key = slotKey(category, index, boundColumns);
                    activeDrag = {
                        index: index,
                        pointer: pointer,
                        key: key,
                        name: Core.settings.getString(key, ""),
                        category: category,
                        button: slotButtons[index],
                        startX: event.stageX,
                        startY: event.stageY,
                        dragging: false
                    };
                }
                event.stop();
                return true;
            },
            touchDragged: function(event, x, y, pointer) {
                if (!moveMode || activeDrag == null || activeDrag.pointer !== pointer) return;
                event.stop();

                const dx = event.stageX - activeDrag.startX;
                const dy = event.stageY - activeDrag.startY;
                if (!activeDrag.dragging && dx * dx + dy * dy >= dragThresholdSquared) {
                    activeDrag.dragging = true;
                    dbg("Drag started for " + activeDrag.key + ".");
                }
                if (activeDrag.dragging && visualDragEnabled && activeDrag.name) {
                    updateDragPreview(event.stageX, event.stageY);
                }
            },
            touchUp: function(event, x, y, pointer, button) {
                if ((!moveMode && !deleteMode) ||
                    button != Packages.arc.input.KeyCode.mouseLeft) return;
                if (deleteMode) {
                    event.stop();
                    if (x < 0 || y < 0 ||
                        x > slotButtons[index].getWidth() ||
                        y > slotButtons[index].getHeight()) return;
                    selectOrToggleDelete(
                        getSelectedCategory(boundCategoryButtons),
                        index,
                        boundColumns
                    );
                    return;
                }
                if (activeDrag == null || activeDrag.pointer !== pointer) return;
                event.stop();
                const drag = activeDrag;
                const dx = event.stageX - drag.startX;
                const dy = event.stageY - drag.startY;
                const wasDragged = drag.dragging || dx * dx + dy * dy >= dragThresholdSquared;
                clearVisualDrag();
                if (wasDragged) {
                    if (visualDragEnabled) {
                        finishDrag(drag, event.stageX, event.stageY);
                    } else {
                        dbg("Drag-and-drop is disabled; use click-to-select and click-to-move.");
                    }
                    return;
                }
                if (x < 0 || y < 0 ||
                    x > slotButtons[index].getWidth() || y > slotButtons[index].getHeight()) return;
                selectOrMove(getSelectedCategory(boundCategoryButtons), index, boundColumns);
            }
        }));
    }

    boundTable = table;
    dbg("Bound " + slotButtons.length + " schematic slots.");
}

function updateHighlight(traceKey) {
    const category = getSelectedCategory(boundCategoryButtons);
    let traceMatched = false;
    for (let i = 0; i < boundSlotButtons.length; i++) {
        const key = slotKey(category, i, boundColumns);
        const moveSelected = moveMode && selectedSlot != null && selectedSlot.key === key;
        let deleteSelected = false;
        if (deleteMode) {
            for (let j = 0; j < selectedDeleteSlots.length; j++) {
                if (selectedDeleteSlots[j].key === key) {
                    deleteSelected = true;
                    break;
                }
            }
        }
        if (boundSlotDeleteHighlights[i] !== deleteSelected) {
            const style = boundSlotStyles[i];
            style.up = deleteSelected ? style.over : boundSlotDefaultBackgrounds[i];
            boundSlotButtons[i].setStyle(style);
            boundSlotDeleteHighlights[i] = deleteSelected;
        }
        boundSlotButtons[i].setChecked(moveSelected || deleteSelected);
        if (key === traceKey) {
            const button = boundSlotButtons[i];
            const style = button.getStyle();
            dbg("Delete highlight update: key=" + traceKey +
                ", category=" + category +
                ", index=" + i +
                ", selectionMatch=" + deleteSelected +
                ", trackedHighlight=" + boundSlotDeleteHighlights[i] +
                ", upMatchesOver=" + (style.up === style.over) +
                ", checked=" + button.isChecked() + ".");
            traceMatched = true;
        }
    }
    if (traceKey != null && !traceMatched) {
        dbg("Delete highlight update: selected key=" + traceKey +
            " has no matching visible slot (category=" + category +
            ", columns=" + boundColumns +
            ", selectedKeys=" + selectedDeleteSlots.map(slot => slot.key).join(",") + ").");
    }
}

function updateDeleteButtonHighlight() {
    if (deleteButton) deleteButton.setChecked(deleteMode);
}

function createMoveControl() {
    if (moveControl) return;

    moveControl = new Table(Styles.black3);
    moveControl.name = "drag-scheme-table-control";
    moveButton = moveControl.button("MOVE", Styles.defaultt, () => {
        moveMode = !moveMode;
        deleteMode = false;
        selectedSlot = null;
        selectedDeleteSlots = [];
        clearVisualDrag();
        moveButton.setChecked(moveMode);
        updateDeleteButtonHighlight();
        updateHighlight();
        dbg("Move mode " + (moveMode ? "ON" : "OFF"));
        announceMoveMessage(Core.bundle.get(moveMode
            ? "drag-scheme-table.mode-enabled"
            : "drag-scheme-table.mode-disabled"));
    }).size(72, 36).tooltip(Core.bundle.get("drag-scheme-table.mode-tooltip")).get();
    const deleteButtonStyle = new Packages.arc.scene.ui.TextButton.TextButtonStyle(Styles.defaultt);
    deleteButtonStyle.checked = deleteButtonStyle.over;
    deleteButton = moveControl.button(
        Core.bundle.get("drag-scheme-table.delete-button"),
        deleteButtonStyle,
        () => {
            if (!deleteMode) {
                deleteMode = true;
                moveMode = false;
                selectedSlot = null;
                selectedDeleteSlots = [];
                clearVisualDrag();
                moveButton.setChecked(moveMode);
                updateDeleteButtonHighlight();
                updateHighlight();
                announceMoveMessage(
                    Core.bundle.get("drag-scheme-table.delete-mode-enabled") + "\n" +
                    Core.bundle.get("drag-scheme-table.delete-mode-instruction")
                );
                dbg("Delete mode ON.");
            } else {
                showDeleteConfirm();
            }
        }
    ).size(72, 36).tooltip(Core.bundle.get("drag-scheme-table.delete-tooltip")).get();

    moveControl.pack();
    moveControl.visibility = () => {
        const table = findTable();
        return table != null && table.visible;
    };
}

function attachMoveControl(table) {
    if (attachedTable !== table) {
        if (attachedTable != null) attachedTable.removeChild(moveControl);
        table.addChild(moveControl);
        attachedTable = table;
        dbg("Attached MOVE control to schematic table.");
    }

    moveControl.setPosition(0, table.getHeight(), Align.bottomLeft);
    moveControl.toFront();
}

Events.on(ClientLoadEvent, () => {
    showDebugLogs = Core.settings.getBool(showDebugLogsSetting, true);
    dbg("Script evaluated. Version " + scriptVersion + ".");
    dbg("ClientLoadEvent received.");
    try {
        if (!global.eui || !global.eui.registerUpdate) {
            Log.err("[Drag from Scheme Table] Extended UI not found (global.eui missing). Mod disabled.");
            return;
        }
        createMoveControl();
        dbg("Loaded v" + scriptVersion + ".");

        skipSwapConfirmations = Core.settings.getBool(skipSwapConfirmationsSetting, false);
        dbg("Swap confirmation preference " + (skipSwapConfirmations ? "loaded as disabled." : "enabled."));
        visualDragEnabled = Core.settings.getBool(visualDragSetting, true);
        dbg("Visual drag " + (visualDragEnabled ? "enabled." : "disabled."));
        installLibraryPressListener();

        global.eui.registerUpdate(() => {
            try {
                addSwapConfirmationSetting();

                const table = findTable();
                if (!Core.settings.getBool("eui-ShowSchematicsTable", true)) {
                    clearVisualDrag();
                    if (libraryCandidate != null) cancelLibraryDrag(true);
                    selectedSlot = null;
                    selectedDeleteSlots = [];
                    moveMode = false;
                    deleteMode = false;
                    moveButton.setChecked(false);
                    updateDeleteButtonHighlight();
                    return;
                }
                if (!table) {
                    if (!waitingLogged) {
                        dbg("Waiting for table named " + tableName + ".");
                        waitingLogged = true;
                    }
                    return;
                }
                waitingLogged = false;
                bindTableButtons(table);
                verifyDeletedSlotsAfterTableUpdate(table);
                moveButton.setChecked(moveMode);
                updateDeleteButtonHighlight();
                updateHighlight();
                attachMoveControl(table);
                lastUpdateError = null;
            } catch (error) {
                const message = String(error);
                if (message !== lastUpdateError) {
                    Log.err("[Drag from Scheme Table] UI update failed: " + message);
                    lastUpdateError = message;
                }
            }
        });
    } catch (error) {
        Log.err("[Drag from Scheme Table] Client load setup failed: " + error);
    }
});
