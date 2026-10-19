"use strict";

const rowsSetting = "eui-SchematicsTableRows";
const columnsSetting = "eui-SchematicsTableColumns";
const tableName = "eui-schematics-table";
const skipSwapConfirmationsSetting = "drag-scheme-table.skip-swap-confirmations";
const visualDragSetting = "drag-scheme-table.visual-drag";
const showDebugLogsSetting = "drag-scheme-table.show-debug-logs";
const scriptVersion = "1.0.4";
const dragThresholdSquared = 64;
const dragPreviewScale = 1.35;
const libraryHoldMillis = 400;
let pendingBulkMoveVerification = null;
const bulkSelection = require("bulk-selection").create({
    slotKey: slotKey,
    getName: key => String(Core.settings.getString(key, "")),
    getImage: key => String(Core.settings.getString(key, "")),
    remove: key => Core.settings.remove(key),
    put: (key, value) => Core.settings.put(key, value),
    save: () => Core.settings.forceSave(),
    announce: (key, first, second) => announceMoveMessage(
        first === undefined
            ? Core.bundle.get(key)
            : second === undefined
                ? Core.bundle.format(key, first)
                : Core.bundle.format(key, first, second)
    ),
    log: message => dbg(message),
    confirmBulkOverwrite: (names, confirm) => showBulkMoveConfirm(names, confirm),
    refresh: moves => {
        queueBulkMoveVerification(moves);
        refreshSchematicTable();
    }
});

let moveMode = false;
let deleteMode = false;
let selectedSlot = null;
let skipSwapConfirmations = false;
let visualDragEnabled = true;
let showDebugLogs = true;
let activeDrag = null;
let dragPreview = null;
let activeBulkDrag = null;
let bulkDragPreview = null;
let bulkDragOutline = null;
let bulkMoveConfirmationOpen = false;
let bulkOutlineDragTable;
let bulkOutlineDragListener;
let moveControl;
let moveButton;
let deleteButton;
let moveControlTableHeight = -1;
let boundTable;
let boundWrappedTable;
let boundSlotTable;
let boundConfiguredRows = -1;
let boundConfiguredColumns = -1;
let attachedTable;
let pendingDeletionVerification;
let boundSlotButtons = [];
let highlightDirty = true;
let highlightedMode;
let highlightedCategory = -1;
let highlightedTable;
let highlightedButtons;
let highlightedSlotKey;
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

function getBulkSelectionMode() {
    if (moveMode) return "move";
    if (deleteMode) return "delete";
    return null;
}

function getSlotSelection(category, index, columns) {
    const key = slotKey(category, index, columns);
    return {
        key: key,
        name: String(Core.settings.getString(key, "")),
        image: String(Core.settings.getString(key + "image", "")),
        category: category,
        index: index,
        column: index % columns,
        row: Math.floor(index / columns)
    };
}

function describeSlotKeys(slots) {
    const keys = [];
    for (let i = 0; i < slots.length; i++) keys.push(slots[i].key);
    return keys.join(",");
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
    clearBulkDragPreview();
    activeBulkDrag = null;
    activeDrag = null;
}

function clearBulkDragPreview() {
    if (bulkDragPreview != null) {
        bulkDragPreview.remove();
        bulkDragPreview = null;
    }
    if (bulkDragOutline != null) {
        bulkDragOutline.remove();
        bulkDragOutline = null;
    }
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

function queueBulkMoveVerification(moves) {
    const affected = [];
    function includeSlot(index, category, key, name, image) {
        for (let i = 0; i < affected.length; i++) {
            if (affected[i].key !== key) continue;
            affected[i].index = index;
            affected[i].category = category;
            affected[i].expectedName = name;
            affected[i].expectedImage = image;
            return;
        }
        affected.push({
            index: index,
            category: category,
            key: key,
            expectedName: name,
            expectedImage: image
        });
    }

    for (let i = 0; i < moves.length; i++) {
        includeSlot(
            moves[i].source.index,
            moves[i].source.category,
            moves[i].source.key,
            "",
            ""
        );
    }
    for (let i = 0; i < moves.length; i++) {
        includeSlot(
            moves[i].destinationIndex,
            moves[i].category,
            moves[i].destination,
            moves[i].source.name,
            moves[i].source.image
        );
    }
    pendingBulkMoveVerification = affected;
}

function verifyBulkMoveBindings() {
    if (pendingBulkMoveVerification == null) return;
    for (let i = 0; i < pendingBulkMoveVerification.length; i++) {
        const expected = pendingBulkMoveVerification[i];
        const index = expected.index;
        const visibleKey = index >= 0 && index < boundSlotButtons.length
            ? slotKey(expected.category, index, boundColumns)
            : "out-of-range";
        const name = String(Core.settings.getString(expected.key, ""));
        const image = String(Core.settings.getString(expected.key + "image", ""));
        const button = index >= 0 && index < boundSlotButtons.length
            ? boundSlotButtons[index]
            : null;
        dbg("Post-rebuild bulk move slot: visibleIndex=" + index +
            ", expectedKey=" + expected.key + ", visibleKey=" + visibleKey +
            ", expectedName=" + JSON.stringify(expected.expectedName) +
            ", settingsName=" + JSON.stringify(name) +
            ", expectedImage=" + JSON.stringify(expected.expectedImage) +
            ", settingsImage=" + JSON.stringify(image) +
            ", checked=" + (button == null ? "unavailable" : button.isChecked()) +
            ", nameMatches=" + (name === expected.expectedName) +
            ", imageMatches=" + (image === expected.expectedImage) + ".");
    }
    pendingBulkMoveVerification = null;
}

function describeLibraryTag(tag) {
    const codeUnits = [];
    for (let i = 0; i < tag.length; i++) {
        const hex = tag.charCodeAt(i).toString(16).toUpperCase();
        codeUnits.push("U+" + ("0000" + hex).slice(-4));
    }
    return JSON.stringify(tag) + " [" + codeUnits.join(" ") + "]";
}

function getLibraryIconChoices(schematic) {
    const choicesByTag = Object.create(null);
    const labels = schematic.labels;
    const labelValues = Object.create(null);
    const choices = [];
    const iconMatchDiagnostics = [];
    const rawLabels = [];

    for (let i = 0; i < labels.size; i++) {
        const tag = String(labels.get(i));
        labelValues[tag] = true;
        rawLabels.push(describeLibraryTag(tag));
    }
    dbg("Library schematic tags for \"" + schematic.name() + "\": " +
        (rawLabels.length === 0 ? "(none)" : rawLabels.join(", ")) + ".");

    const accessibleIcons = Vars.accessibleIcons;
    for (let i = 0; i < accessibleIcons.length; i++) {
        const iconName = String(accessibleIcons[i]);
        const iconCode = Number(Packages.mindustry.gen.Iconc.codes.get(iconName, 0));
        if (iconCode === 0) continue;

        const tag = String.fromCharCode(iconCode);
        if (!labelValues[tag]) continue;
        if (!Icon.icons.containsKey(iconName)) {
            iconMatchDiagnostics.push("UI " + describeLibraryTag(tag) + " -> " +
                iconName + " (Icon.icons entry missing)");
            continue;
        }
        iconMatchDiagnostics.push("UI " + describeLibraryTag(tag) + " -> " + iconName);
        choicesByTag[tag] = {
            tag: tag,
            imageName: iconName,
            drawable: new Packages.arc.scene.style.TextureRegionDrawable(Icon.icons.get(iconName)),
            tooltip: iconName
        };
    }

    for (let typeIndex = 0; typeIndex < Vars.defaultContentIcons.length; typeIndex++) {
        const contentType = Vars.defaultContentIcons[typeIndex];
        const contents = Vars.content.getBy(contentType);
        for (let contentIndex = 0; contentIndex < contents.size; contentIndex++) {
            const content = contents.get(contentIndex);
            if (!content.hasEmoji()) continue;

            const tag = String(content.emoji());
            if (!labelValues[tag]) continue;
            if (content.isHidden() || !content.unlockedNow() || content.uiIcon == null) {
                const reasons = [];
                if (content.isHidden()) reasons.push("hidden");
                if (!content.unlockedNow()) reasons.push("locked");
                if (content.uiIcon == null) reasons.push("uiIcon missing");
                iconMatchDiagnostics.push("Content " + describeLibraryTag(tag) + " -> " +
                    String(content.localizedName) + " rejected (" + reasons.join(", ") + ")");
                continue;
            }
            iconMatchDiagnostics.push("Content " + describeLibraryTag(tag) + " -> " +
                String(content.localizedName));
            choicesByTag[tag] = {
                tag: tag,
                imageName: String(content.name),
                drawable: new Packages.arc.scene.style.TextureRegionDrawable(content.uiIcon),
                tooltip: String(content.localizedName)
            };
        }
    }

    for (let i = 0; i < labels.size; i++) {
        const choice = choicesByTag[String(labels.get(i))];
        if (choice != null) choices.push(choice);
    }

    dbg("Library icon-tag lookup for \"" + schematic.name() + "\": " +
        (iconMatchDiagnostics.length === 0
            ? "no exact vanilla icon matches"
            : iconMatchDiagnostics.join("; ")) +
        ". Final choices: " +
        (choices.length === 0
            ? "(none)"
            : choices.map(choice => choice.imageName).join(", ")) + ".");
    return choices;
}

function insertLibrarySchematic(schematic, destination, expectedDestination, iconChoice) {
    const currentDestination = Core.settings.getString(destination, "");
    if (currentDestination !== expectedDestination) {
        announceMoveMessage(Core.bundle.get("drag-scheme-table.library-insert-stale"));
        dbg("Library insertion canceled because destination " + destination + " changed.");
        return;
    }

    Core.settings.put(destination, schematic.name());
    if (iconChoice != null) {
        const imageKey = destination + "image";
        Core.settings.put(imageKey, iconChoice.imageName);
        dbg("Library slot image setting " + imageKey + " write=\"" + iconChoice.imageName +
            "\", readback=\"" + Core.settings.getString(imageKey, "") + "\".");
    } else {
        dbg("Library insertion has no selected icon; existing slot image setting " +
            destination + "image=\"" + Core.settings.getString(destination + "image", "") + "\".");
    }
    selectedSlot = null;
    announceMoveMessage(Core.bundle.get("drag-scheme-table.library-insert-complete"));
    dbg("Inserted library schematic " + schematic.name() + " into " + destination +
        (iconChoice == null ? "." : " with icon " + iconChoice.imageName + "."));
    refreshSchematicTable();
}

function continueLibraryInsert(schematic, destination, expectedDestination, iconChoice) {
    const currentDestination = Core.settings.getString(destination, "");
    if (currentDestination !== expectedDestination) {
        announceMoveMessage(Core.bundle.get("drag-scheme-table.library-insert-stale"));
        dbg("Library insertion canceled because destination " + destination + " changed.");
        return;
    }

    if (expectedDestination && !skipSwapConfirmations) {
        showLibraryInsertConfirm(schematic, destination, expectedDestination, iconChoice);
    } else {
        insertLibrarySchematic(schematic, destination, expectedDestination, iconChoice);
    }
}

function showLibraryIconChoice(schematic, destination, expectedDestination, choices) {
    if (libraryInsertConfirmationOpen) return;
    clearMoveAnnouncement();

    const dialog = new BaseDialog(Core.bundle.get("drag-scheme-table.library-icon-title"));
    let choiceMade = false;
    dialog.setFillParent(false);
    dialog.cont.add(Core.bundle.format(
        "drag-scheme-table.library-icon-message",
        schematic.name()
    )).width(Vars.mobile ? 400 : 500).wrap().pad(4).get()
        .setAlignment(Align.center, Align.center);
    dialog.cont.row();
    dialog.cont.pane(options => {
        const columns = Vars.mobile ? 4 : 8;
        options.left();
        for (let i = 0; i < choices.length; i++) {
            const choice = choices[i];
            options.button(choice.drawable, Styles.flati, 40, () => {
                if (choiceMade) return;
                choiceMade = true;
                libraryInsertConfirmationOpen = false;
                dialog.hide();
                continueLibraryInsert(schematic, destination, expectedDestination, choice);
            }).size(56).tooltip(choice.tooltip);
            if ((i + 1) % columns === 0) options.row();
        }
    }).width(Vars.mobile ? 360 : 520).maxHeight(Core.graphics.getHeight() * 0.7).scrollX(false);

    dialog.hidden(() => {
        libraryInsertConfirmationOpen = false;
        if (!choiceMade) {
            announceMoveMessage(Core.bundle.get("drag-scheme-table.library-insert-cancelled"));
            dbg("Library icon selection canceled; destination unchanged.");
        }
    });

    dialog.buttons.defaults().size(200, 54).pad(2);
    dialog.buttons.button("@cancel", Icon.cancel, () => dialog.hide());
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

function requestLibraryInsert(schematic, destination, expectedDestination) {
    const choices = getLibraryIconChoices(schematic);
    if (choices.length > 1) {
        showLibraryIconChoice(schematic, destination, expectedDestination, choices);
    } else {
        continueLibraryInsert(
            schematic,
            destination,
            expectedDestination,
            choices.length === 1 ? choices[0] : null
        );
    }
}

function showLibraryInsertConfirm(schematic, destination, expectedDestination, iconChoice) {
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
        insertLibrarySchematic(schematic, destination, expectedDestination, iconChoice);
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
    requestLibraryInsert(drag.schematic, destination, expectedDestination);
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

function updateBulkDragPreview(stageX, stageY) {
    if (!visualDragEnabled || activeBulkDrag == null || activeBulkDrag.previewFailed) return;

    if (bulkDragPreview == null) {
        const footprint = bulkSelection.getMoveFootprint();
        if (footprint == null || footprint.slots.length === 0) return;
        if (boundColumns < 2 || boundSlotButtons.length <= boundColumns) {
            Log.err("[Drag from Scheme Table] Cannot create bulk drag preview: " +
                "the live slot grid has fewer than two rows or columns.");
            activeBulkDrag.previewFailed = true;
            return;
        }

        const firstCenter = boundSlotButtons[0].localToAscendantCoordinates(
            boundTable,
            new Packages.arc.math.geom.Vec2(
                boundSlotButtons[0].getWidth() / 2,
                boundSlotButtons[0].getHeight() / 2
            )
        );
        const nextColumnCenter = boundSlotButtons[1].localToAscendantCoordinates(
            boundTable,
            new Packages.arc.math.geom.Vec2(
                boundSlotButtons[1].getWidth() / 2,
                boundSlotButtons[1].getHeight() / 2
            )
        );
        const nextRowCenter = boundSlotButtons[boundColumns].localToAscendantCoordinates(
            boundTable,
            new Packages.arc.math.geom.Vec2(
                boundSlotButtons[boundColumns].getWidth() / 2,
                boundSlotButtons[boundColumns].getHeight() / 2
            )
        );
        const stepX = Math.abs(nextColumnCenter.x - firstCenter.x);
        const stepY = Math.abs(firstCenter.y - nextRowCenter.y);
        const cellWidth = boundSlotButtons[0].getWidth();
        const cellHeight = boundSlotButtons[0].getHeight();
        if (stepX <= 0 || stepY <= 0 || cellWidth <= 0 || cellHeight <= 0) {
            Log.err("[Drag from Scheme Table] Cannot create bulk drag preview: " +
                "slot grid dimensions are invalid.");
            activeBulkDrag.previewFailed = true;
            return;
        }
        const previewWidth = footprint.width;
        const previewHeight = footprint.height;
        if (activeBulkDrag.previewSlotOffsetX == null ||
            activeBulkDrag.previewSlotOffsetY == null) {
            const draggedColumn = activeBulkDrag.index % boundColumns;
            const draggedRow = Math.floor(activeBulkDrag.index / boundColumns);
            activeBulkDrag.previewSlotOffsetX =
                (draggedColumn - footprint.minColumn) * stepX + activeBulkDrag.localX;
            activeBulkDrag.previewSlotOffsetY =
                (footprint.maxRow - draggedRow) * stepY + activeBulkDrag.localY;
        }
        activeBulkDrag.previewWidth = previewWidth;
        activeBulkDrag.previewHeight = previewHeight;
        const preview = new Table();
        preview.touchable = Packages.arc.scene.event.Touchable.disabled;
        preview.setSize(previewWidth, previewHeight);

        for (let i = 0; i < footprint.slots.length; i++) {
            const slot = footprint.slots[i];
            const sourceButton = boundSlotButtons[slot.index];
            const image = sourceButton.getImage();
            const drawable = image == null ? null : image.getDrawable();
            if (drawable == null) {
                Log.err("[Drag from Scheme Table] Cannot create bulk drag preview: " +
                    "selected slot " + slot.key + " has no drawable.");
                activeBulkDrag.previewFailed = true;
                return;
            }
            const previewImage = new Packages.arc.scene.ui.Image(
                drawable,
                Packages.arc.util.Scaling.fit
            );
            previewImage.touchable = Packages.arc.scene.event.Touchable.disabled;
            const imageScale = dragPreviewScale * 0.6;
            const imageWidth = cellWidth * imageScale;
            const imageHeight = cellHeight * imageScale;
            previewImage.setSize(imageWidth, imageHeight);
            preview.addChild(previewImage);
            previewImage.setPosition(
                (slot.column - footprint.minColumn) * stepX + (cellWidth - imageWidth) / 2,
                (footprint.maxRow - slot.row) * stepY + (cellHeight - imageHeight) / 2
            );
        }

        const outline = new JavaAdapter(Packages.arc.scene.Element, {
            draw: function() {
                const width = this.getWidth();
                const height = this.getHeight();
                Lines.stroke(4);
                Draw.color(Pal.accentBack);
                Lines.rect(this.x + width / 2, this.y + height / 2, width + 2, height + 2);
                Lines.stroke(2);
                Draw.color(Pal.accent);
                Lines.rect(this.x + width / 2, this.y + height / 2, width, height);
                Draw.reset();
            }
        });
        outline.touchable = Packages.arc.scene.event.Touchable.disabled;
        outline.cullable = false;
        outline.setSize(previewWidth, previewHeight);

        bulkDragPreview = preview;
        bulkDragOutline = outline;
        Core.scene.add(bulkDragPreview);
        Core.scene.add(bulkDragOutline);
        dbg("Created cursor-following preview for " + footprint.slots.length +
            " selected schematics (" + previewWidth + "x" + previewHeight +
            "), dragHandle=" + (activeBulkDrag.outlineHandle
                ? "selection-outline"
                : "slot-" + activeBulkDrag.index) +
            ", pointerOffset=(" + activeBulkDrag.previewSlotOffsetX + "," +
            activeBulkDrag.previewSlotOffsetY + ").");
    }

    const left = stageX - activeBulkDrag.previewSlotOffsetX;
    const bottom = stageY - activeBulkDrag.previewSlotOffsetY;
    bulkDragPreview.setPosition(left, bottom);
    bulkDragOutline.setPosition(left, bottom);
    bulkDragPreview.toFront();
    bulkDragOutline.toFront();
}

function showBulkMoveConfirm(overwrittenNames, confirmMove) {
    if (bulkMoveConfirmationOpen) return;
    clearMoveAnnouncement();

    const dialog = new BaseDialog(Core.bundle.get("drag-scheme-table.bulk-move-overwrite-title"));
    let confirmed = false;
    const names = overwrittenNames.map(name => "- " + name).join("\n");
    dialog.setFillParent(false);
    dialog.cont.add(Core.bundle.format(
        "drag-scheme-table.bulk-move-overwrite-message",
        names
    )).width(Vars.mobile ? 400 : 500).wrap().pad(4).get()
        .setAlignment(Align.center, Align.center);

    const confirm = () => {
        if (confirmed) return;
        confirmed = true;
        dialog.hide();
        confirmMove();
    };

    dialog.hidden(() => {
        bulkMoveConfirmationOpen = false;
        if (!confirmed) {
            announceMoveMessage(Core.bundle.get("drag-scheme-table.bulk-move-overwrite-cancelled"));
            dbg("Bulk move overwrite canceled; no schematics were changed.");
        }
    });
    dialog.buttons.defaults().size(200, 54).pad(2);
    dialog.buttons.button("@cancel", Icon.cancel, () => dialog.hide());
    dialog.buttons.button("@ok", Icon.ok, confirm);
    dialog.keyDown(Packages.arc.input.KeyCode.enter, confirm);
    dialog.keyDown(Packages.arc.input.KeyCode.escape, () => dialog.hide());
    dialog.keyDown(Packages.arc.input.KeyCode.back, () => dialog.hide());
    bulkMoveConfirmationOpen = true;
    try {
        dialog.show();
    } catch (error) {
        bulkMoveConfirmationOpen = false;
        throw error;
    }
    dbg("Opened bulk move overwrite confirmation for " +
        overwrittenNames.length + " destination schematics.");
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
            announceMoveMessage(Core.bundle.get("drag-scheme-table.swap-cancelled"));
            dbg("Swap confirmation dismissed; selected source remains active.");
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
        announceMoveMessage(Core.bundle.get("drag-scheme-table.move-stale"));
        dbg("Move rejected as stale; selected source remains active: " + source.key + ".");
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
    updateHighlight();
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
        selectedSlot = {
            key: key,
            name: value,
            category: category,
            index: index
        };
        announceMoveMessage(Core.bundle.format("drag-scheme-table.source-selected", value));
        return;
    }

    if (selectedSlot.key === key) {
        announceMoveMessage(Core.bundle.format(
            "drag-scheme-table.source-selected",
            selectedSlot.name
        ));
        dbg("Selected source remains active until a move or swap succeeds: " + key + ".");
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
    const slot = getSlotSelection(category, index, columns);
    if (!slot.name) {
        announceMoveMessage(Core.bundle.get("drag-scheme-table.delete-empty-slot"));
        return;
    }

    const selected = bulkSelection.toggle("delete", slot);
    updateDeleteButtonHighlight();
    updateHighlight();
    dbg((selected ? "Selected " : "Deselected ") + slot.key +
        " (" + slot.name + ") for deletion.");
    announceMoveMessage(selected
        ? Core.bundle.format(
            "drag-scheme-table.delete-selected",
            slot.name,
            bulkSelection.getDeleteSlots().length
        )
        : Core.bundle.format(
            "drag-scheme-table.delete-deselected",
            bulkSelection.getDeleteSlots().length
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

    bulkSelection.clear("delete");
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
    const selectedDeleteSlots = bulkSelection.getDeleteSlots();
    if (selectedDeleteSlots.length === 0) {
        deleteMode = false;
        updateDeleteButtonHighlight();
        updateHighlight();
        announceMoveMessage(Core.bundle.get("drag-scheme-table.delete-mode-disabled"));
        return;
    }

    clearMoveAnnouncement();
    const selection = selectedDeleteSlots;
    dbg("Delete confirmation snapshot keys: " +
        describeSlotKeys(selection) + ".");
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
            bulkSelection.clear("delete");
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

function liveTableButtonsMatch(table, rows, columns) {
    if (boundTable !== table || boundConfiguredRows !== rows ||
        boundConfiguredColumns !== columns || boundWrappedTable == null ||
        boundSlotTable == null) return false;

    const tableChildren = table.getChildren();
    if (tableChildren.size === 0 || tableChildren.get(0) !== boundWrappedTable) return false;

    const wrappedChildren = boundWrappedTable.getChildren();
    if (wrappedChildren.size < 3 || wrappedChildren.get(0).getChildren().size !==
        boundCategoryButtons.length || wrappedChildren.get(2) !== boundSlotTable) return false;

    const categoryChildren = wrappedChildren.get(0).getChildren();
    for (let i = 0; i < boundCategoryButtons.length; i++) {
        if (categoryChildren.get(i) !== boundCategoryButtons[i]) return false;
    }

    const slotChildren = boundSlotTable.getChildren();
    if (slotChildren.size !== boundSlotButtons.length) return false;
    for (let i = 0; i < boundSlotButtons.length; i++) {
        if (slotChildren.get(i) !== boundSlotButtons[i]) return false;
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

function moveSelectedSchematics(category, destinationIndex, columns) {
    bulkSelection.moveSelected(
        category,
        destinationIndex,
        columns,
        Math.ceil(boundSlotButtons.length / columns)
    );
    selectedSlot = null;
}

function findBulkOutlineDropTarget(drag, stageX, stageY) {
    const footprint = bulkSelection.getMoveFootprint();
    if (footprint == null || drag.previewSlotOffsetX == null ||
        drag.previewSlotOffsetY == null) return -1;

    const cellWidth = boundSlotButtons[0].getWidth();
    const cellHeight = boundSlotButtons[0].getHeight();
    const point = new Packages.arc.math.geom.Vec2(
        stageX - drag.previewSlotOffsetX + cellWidth / 2,
        stageY - drag.previewSlotOffsetY + footprint.height - cellHeight / 2
    );
    boundTable.stageToLocalCoordinates(point);
    const destination = bulkSelection.indexAtTablePoint(point.x, point.y);
    dbg("Bulk outline drop mapping: previewOrigin=(" +
        (stageX - drag.previewSlotOffsetX) + "," +
        (stageY - drag.previewSlotOffsetY) + "), tableAnchor=(" +
        point.x + "," + point.y + "), destination=" + destination + ".");
    return destination;
}

function installBulkOutlineDragListener(table) {
    if (bulkOutlineDragTable === table) return;
    if (bulkOutlineDragTable != null && bulkOutlineDragListener != null) {
        bulkOutlineDragTable.removeCaptureListener(bulkOutlineDragListener);
    }

    bulkOutlineDragTable = table;
    bulkOutlineDragListener = new JavaAdapter(Packages.arc.scene.event.InputListener, {
        touchDown: function(event, x, y, pointer, button) {
            if (button != Packages.arc.input.KeyCode.mouseLeft ||
                !moveMode || deleteMode || bulkMoveConfirmationOpen ||
                activeBulkDrag != null) return false;

            const outline = bulkSelection.getMoveOutline();
            const footprint = bulkSelection.getMoveFootprint();
            if (outline == null || footprint == null ||
                x < outline.left || x > outline.right ||
                y < outline.bottom || y > outline.top) return false;

            activeBulkDrag = {
                pointer: pointer,
                startX: event.stageX,
                startY: event.stageY,
                dragging: false,
                outlineHandle: true,
                previewSlotOffsetX: x - footprint.left,
                previewSlotOffsetY: y - footprint.bottom,
                previewWidth: footprint.width,
                previewHeight: footprint.height
            };
            event.stop();
            dbg("Started bulk outline drag: pointer=(" + x + "," + y +
                "), selectionBounds=[" + outline.left + "," + outline.bottom +
                " -> " + outline.right + "," + outline.top +
                "], groupBounds=[" + footprint.left + "," + footprint.bottom +
                " -> " + footprint.right + "," + footprint.top +
                "], selected=" + footprint.slots.length + ".");
            return true;
        },
        touchDragged: function(event, x, y, pointer) {
            if (activeBulkDrag == null || !activeBulkDrag.outlineHandle ||
                activeBulkDrag.pointer !== pointer) return;
            event.stop();
            const dx = event.stageX - activeBulkDrag.startX;
            const dy = event.stageY - activeBulkDrag.startY;
            if (!activeBulkDrag.dragging &&
                dx * dx + dy * dy >= dragThresholdSquared) {
                activeBulkDrag.dragging = true;
                dbg("Bulk selection-outline drag started with " +
                    bulkSelection.getMoveSlots().length + " schematics.");
            }
            if (activeBulkDrag.dragging) {
                updateBulkDragPreview(event.stageX, event.stageY);
            }
        },
        touchUp: function(event, x, y, pointer, button) {
            if (activeBulkDrag == null || !activeBulkDrag.outlineHandle ||
                activeBulkDrag.pointer !== pointer ||
                button != Packages.arc.input.KeyCode.mouseLeft) return;
            event.stop();
            const drag = activeBulkDrag;
            const dx = event.stageX - drag.startX;
            const dy = event.stageY - drag.startY;
            const wasDragged = drag.dragging ||
                dx * dx + dy * dy >= dragThresholdSquared;
            clearBulkDragPreview();
            activeBulkDrag = null;
            if (!wasDragged) {
                dbg("Bulk outline handle released without a drag; no move made.");
                return;
            }

            const destination = findBulkOutlineDropTarget(
                drag,
                event.stageX,
                event.stageY
            );
            if (destination >= 0) {
                dbg("Dropping bulk outline group at footprint anchor slot " +
                    destination + ".");
                moveSelectedSchematics(
                    getSelectedCategory(boundCategoryButtons),
                    destination,
                    boundColumns
                );
            } else {
                dbg("Bulk outline drag ended outside the slot grid; no changes made.");
            }
        }
    });
    table.addCaptureListener(bulkOutlineDragListener);
}

function bindTableButtons(table) {
    const rows = Core.settings.getInt(rowsSetting, 4);
    const columns = Core.settings.getInt(columnsSetting, 5);
    if (liveTableButtonsMatch(table, rows, columns)) return;
    if (table.getChildren().size === 0) return;

    table.validate();
    const wrapped = table.getChildren().get(0);
    wrapped.validate();
    const wrappedChildren = wrapped.getChildren();
    if (wrappedChildren.size < 3) return;

    const categories = wrappedChildren.get(0).getChildren();
    const slotTable = wrappedChildren.get(2);
    slotTable.validate();
    const slots = slotTable.getChildren();
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
    if (boundTable === table && boundColumns === liveColumns &&
        sameButtons(boundSlotButtons, slotButtons)) {
        boundWrappedTable = wrapped;
        boundSlotTable = slotTable;
        boundConfiguredRows = rows;
        boundConfiguredColumns = columns;
        return;
    }

    clearBulkDragPreview();
    activeBulkDrag = null;
    boundCategoryButtons = categoryButtons;
    boundColumns = liveColumns;
    boundSlotButtons = slotButtons;

    for (let i = 0; i < slotButtons.length; i++) {
        const index = i;
        slotButtons[i].addCaptureListener(new JavaAdapter(Packages.arc.scene.event.InputListener, {
            touchDown: function(event, x, y, pointer, button) {
                const selectionMode = getBulkSelectionMode();
                if (button == Packages.arc.input.KeyCode.mouseLeft &&
                    !moveMode && !deleteMode) {
                    const category = getSelectedCategory(boundCategoryButtons);
                    const slot = getSlotSelection(category, index, boundColumns);
                    const style = slotButtons[index].getStyle();
                    const targetActor = event.targetActor;
                    dbg("Mode-off schematic click passed through: category=" + category +
                        ", index=" + index + ", key=" + slot.key +
                        ", name=" + JSON.stringify(slot.name) +
                        ", pointer=" + pointer + ", local=(" + x + "," + y +
                        "), stage=(" + event.stageX + "," + event.stageY +
                        "), targetActor=" + (targetActor == null
                            ? "null"
                            : String(targetActor.getClass().getName())) +
                        ", checkedBefore=" + slotButtons[index].isChecked() +
                        ", hoveringBefore=" + slotButtons[index].isOver() +
                        ", upMatchesOver=" + (style.up === style.over) +
                        ", backgroundMatchesUp=" +
                        (slotButtons[index].getBackground() === style.up) +
                        ", selectedSlot=" +
                        (selectedSlot == null ? "none" : selectedSlot.key) +
                        ", bulkMoveKeys=[" +
                        describeSlotKeys(bulkSelection.getMoveSlots()) +
                        "], bulkDeleteKeys=[" +
                        describeSlotKeys(bulkSelection.getDeleteSlots()) +
                        "], listenerReturns=false (normal table click continues).");
                }
                if (button == Packages.arc.input.KeyCode.mouseRight &&
                    (moveMode || deleteMode)) {
                    dbg("Bulk right-button input received: mode=" + selectionMode +
                        ", category=" + getSelectedCategory(boundCategoryButtons) +
                        ", slot=" + index + ", pointer=" + pointer +
                        ", local=(" + x + "," + y + "), stage=(" +
                        event.stageX + "," + event.stageY + ").");
                    if (selectionMode == null) return false;
                    if (!bulkSelection.begin(
                        event,
                        selectionMode,
                        getSelectedCategory(boundCategoryButtons),
                        index,
                        pointer,
                        slotButtons[index],
                        x,
                        y
                    )) return false;
                    event.stop();
                    return true;
                }
                if ((!moveMode && !deleteMode) ||
                    button != Packages.arc.input.KeyCode.mouseLeft) return false;
                if (moveMode && bulkSelection.getMoveSlots().length > 0) {
                    activeBulkDrag = {
                        pointer: pointer,
                        index: index,
                        startX: event.stageX,
                        startY: event.stageY,
                        localX: x,
                        localY: y,
                        dragging: false
                    };
                    event.stop();
                    return true;
                }
                if (moveMode && bulkSelection.getMoveSlots().length === 0) {
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
                if (activeBulkDrag != null && activeBulkDrag.pointer === pointer) {
                    event.stop();
                    const dx = event.stageX - activeBulkDrag.startX;
                    const dy = event.stageY - activeBulkDrag.startY;
                    if (!activeBulkDrag.dragging &&
                        dx * dx + dy * dy >= dragThresholdSquared) {
                        activeBulkDrag.dragging = true;
                        dbg("Bulk group drag started with " +
                            bulkSelection.getMoveSlots().length + " schematics.");
                    }
                    if (activeBulkDrag.dragging) {
                        updateBulkDragPreview(event.stageX, event.stageY);
                    }
                    return;
                }
                if (bulkSelection.drag(event, pointer, slotButtons[index], x, y)) {
                    event.stop();
                    return;
                }
                if (moveMode && bulkSelection.getMoveSlots().length > 0) {
                    event.stop();
                    return;
                }
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
                if (button == Packages.arc.input.KeyCode.mouseRight) {
                    const result = bulkSelection.finish(
                        event,
                        pointer,
                        slotButtons[index],
                        x,
                        y
                    );
                    if (result == null) {
                        if (moveMode || deleteMode) {
                            dbg("Bulk right-button release had no active gesture: mode=" +
                                getBulkSelectionMode() + ", slot=" + index +
                                ", pointer=" + pointer + ", local=(" + x + "," +
                                y + "), stage=(" + event.stageX + "," +
                                event.stageY + ").");
                        }
                        return;
                    }
                    event.stop();
                    if (result.mode === "move") selectedSlot = null;
                    if (result.slot != null) {
                        const style = slotButtons[index].getStyle();
                        const selection = result.mode === "move"
                            ? bulkSelection.getMoveSlots()
                            : bulkSelection.getDeleteSlots();
                        dbg("Bulk selection click visual state after update: mode=" +
                            result.mode + ", key=" + result.slot.key +
                            ", selected=" + result.selected +
                            ", selectedKeys=[" +
                            describeSlotKeys(selection) +
                            "], checked=" + slotButtons[index].isChecked() +
                            ", hovering=" + slotButtons[index].isOver() +
                            ", upMatchesOver=" + (style.up === style.over) +
                            ", backgroundMatchesUp=" +
                            (slotButtons[index].getBackground() === style.up) + ".");
                    }
                    return;
                }
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
                if (activeBulkDrag != null && activeBulkDrag.pointer === pointer) {
                    event.stop();
                    const destination = findDropTarget(event.stageX, event.stageY);
                    clearBulkDragPreview();
                    activeBulkDrag = null;
                    if (destination >= 0) {
                        dbg("Dropping selected schematic group at slot " + destination + ".");
                        moveSelectedSchematics(
                            getSelectedCategory(boundCategoryButtons),
                            destination,
                            boundColumns
                        );
                    } else {
                        dbg("Bulk group drag ended outside a schematic slot; no changes made.");
                    }
                    return;
                }
                if (activeDrag == null || activeDrag.pointer !== pointer) {
                    if (moveMode && bulkSelection.getMoveSlots().length > 0) {
                        event.stop();
                        const destination = findDropTarget(event.stageX, event.stageY);
                        if (destination >= 0) {
                            moveSelectedSchematics(
                                getSelectedCategory(boundCategoryButtons),
                                destination,
                                boundColumns
                            );
                        }
                    }
                    return;
                }
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
    boundWrappedTable = wrapped;
    boundSlotTable = slotTable;
    boundConfiguredRows = rows;
    boundConfiguredColumns = columns;
    installBulkOutlineDragListener(table);
    bulkSelection.bind(
        table,
        slotButtons,
        liveColumns,
        (category, index) => getSlotSelection(category, index, liveColumns),
        (mode, selection) => {
            if (mode === "move") selectedSlot = null;
            highlightDirty = true;
            updateHighlight();
        }
    );
    verifyBulkMoveBindings();
    dbg("Bound " + slotButtons.length + " schematic slots.");
}

function updateHighlight() {
    const category = getSelectedCategory(boundCategoryButtons);
    const mode = getBulkSelectionMode();
    const selectedKey = selectedSlot == null ? null : selectedSlot.key;
    if (!highlightDirty && highlightedMode === mode &&
        highlightedCategory === category && highlightedTable === boundTable &&
        highlightedButtons === boundSlotButtons && highlightedSlotKey === selectedKey) return;

    const singleMoveIndex = moveMode && selectedSlot != null &&
        selectedSlot.category === category
        ? selectedSlot.index
        : null;
    bulkSelection.update(mode, category, singleMoveIndex);
    highlightDirty = false;
    highlightedMode = mode;
    highlightedCategory = category;
    highlightedTable = boundTable;
    highlightedButtons = boundSlotButtons;
    highlightedSlotKey = selectedKey;
}

function updateDeleteButtonHighlight() {
    if (deleteButton && deleteButton.isChecked() !== deleteMode) {
        deleteButton.setChecked(deleteMode);
    }
}

function createMoveControl() {
    if (moveControl) return;

    moveControl = new Table(Styles.black3);
    moveControl.name = "drag-scheme-table-control";
    const moveButtonStyle = new Packages.arc.scene.ui.TextButton.TextButtonStyle(Styles.defaultt);
    moveButtonStyle.checked = moveButtonStyle.over;
    moveButton = moveControl.button("MOVE", moveButtonStyle, () => {
        moveMode = !moveMode;
        deleteMode = false;
        selectedSlot = null;
        bulkSelection.clear();
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
                bulkSelection.clear();
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
    let attached = false;
    if (attachedTable !== table) {
        if (attachedTable != null) attachedTable.removeChild(moveControl);
        table.addChild(moveControl);
        attachedTable = table;
        attached = true;
        dbg("Attached MOVE control to schematic table.");
    }

    const tableHeight = table.getHeight();
    if (attached || moveControlTableHeight !== tableHeight) {
        moveControl.setPosition(0, table.getHeight(), Align.bottomLeft);
        moveControlTableHeight = tableHeight;
    }
    if (attached) {
        moveControl.toFront();
        bulkSelection.bringToFront();
    }
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
                    bulkSelection.clear();
                    moveMode = false;
                    deleteMode = false;
                    moveButton.setChecked(false);
                    updateDeleteButtonHighlight();
                    return;
                }
                if (!table) {
                    clearBulkDragPreview();
                    activeBulkDrag = null;
                    if (!waitingLogged) {
                        dbg("Waiting for table named " + tableName + ".");
                        waitingLogged = true;
                    }
                    return;
                }
                waitingLogged = false;
                bindTableButtons(table);
                verifyBulkMoveBindings();
                verifyDeletedSlotsAfterTableUpdate(table);
                if (moveButton.isChecked() !== moveMode) moveButton.setChecked(moveMode);
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
