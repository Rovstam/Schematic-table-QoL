"use strict";

const dragThresholdSquared = 64;

function create(operations) {
    let table = null;
    let buttons = [];
    let columns = 0;
    let slotAt;
    let onSelectionChanged;
    let currentMode;
    let currentCategory = -1;
    let activeSelection;
    let lastRectangle;
    let overlay;
    let singleMoveIndex = -1;
    let cachedGrid;
    let cachedBounds = [];
    const moveSlots = [];
    const deleteSlots = [];

    function slotsFor(mode) {
        return mode === "move" ? moveSlots : deleteSlots;
    }

    function findSlot(selection, key) {
        for (let i = 0; i < selection.length; i++) {
            if (selection[i].key === key) return i;
        }
        return -1;
    }

    function notify(mode) {
        if (onSelectionChanged != null) onSelectionChanged(mode, slotsFor(mode).slice());
    }

    function formatRectangle(rectangle) {
        if (rectangle == null) return "null";
        return "[" + rectangle.left + "," + rectangle.bottom + " -> " +
            rectangle.right + "," + rectangle.top + "]";
    }

    function describeSlots(slots) {
        const descriptions = [];
        for (let i = 0; i < slots.length; i++) {
            descriptions.push(slots[i].index + ":" + slots[i].key +
                "=" + JSON.stringify(slots[i].name));
        }
        return descriptions.join(";");
    }

    function describeBounds(start, stride, count) {
        const descriptions = [];
        for (let i = 0; i < count; i++) {
            descriptions.push(formatRectangle(cachedBounds[start + i * stride]));
        }
        return descriptions.join(";");
    }

    function announceResult(result) {
        if (result.rectangle) {
            operations.announce(
                result.mode === "move"
                    ? "drag-scheme-table.move-region-selected"
                    : "drag-scheme-table.delete-region-selected",
                result.slots.length
            );
            operations.log("Replaced " + result.mode + " selection with " +
                result.slots.length + " slots from a rectangle.");
        } else if (result.slot != null) {
            operations.log((result.selected ? "Selected " : "Deselected ") +
                result.slot.key + " in " + result.mode + " mode.");
            if (result.mode === "move") {
                operations.announce(
                    result.selected
                        ? "drag-scheme-table.move-slot-selected"
                        : "drag-scheme-table.move-slot-deselected",
                    result.slot.name,
                    result.slots.length
                );
            } else {
                if (result.selected) {
                    operations.announce(
                        "drag-scheme-table.delete-selected",
                        result.slot.name,
                        result.slots.length
                    );
                } else {
                    operations.announce(
                        "drag-scheme-table.delete-deselected",
                        result.slots.length
                    );
                }
            }
        } else {
            operations.announce(result.mode === "delete"
                ? "drag-scheme-table.delete-empty-slot"
                : "drag-scheme-table.no-source");
        }
    }

    function boundsFor(button) {
        const bottomLeft = button.localToAscendantCoordinates(table, new Vec2(0, 0));
        const topRight = button.localToAscendantCoordinates(
            table,
            new Vec2(button.getWidth(), button.getHeight())
        );
        return {
            left: bottomLeft.x,
            bottom: bottomLeft.y,
            right: topRight.x,
            top: topRight.y
        };
    }

    function buildSlotGrid() {
        if (table == null || columns <= 0 || buttons.length === 0) return null;

        cachedBounds = [];
        for (let i = 0; i < buttons.length; i++) {
            cachedBounds.push(boundsFor(buttons[i]));
        }
        if (buttons.length < columns) return null;

        const columnBounds = [];
        const rowBounds = [];
        const rows = Math.ceil(buttons.length / columns);

        for (let column = 0; column < columns; column++) {
            columnBounds.push({
                left: cachedBounds[column].left,
                right: cachedBounds[column].right
            });
        }
        for (let row = 0; row < rows; row++) {
            rowBounds.push({
                bottom: cachedBounds[row * columns].bottom,
                top: cachedBounds[row * columns].top
            });
        }

        return {
            columnBounds: columnBounds,
            rowBounds: rowBounds
        };
    }

    function slotGrid() {
        return cachedGrid;
    }

    function indexFromBounds(value, length, descending, axis, trace) {
        let selected = -1;

        for (let i = 0; i < length; i++) {
            if (descending
                ? value >= cachedBounds[i * columns].bottom &&
                    value <= cachedBounds[i * columns].top
                : value >= cachedBounds[i].left &&
                    value <= cachedBounds[i].right) {
                selected = i;
                break;
            }
        }

        if (selected < 0) {
            for (let i = 0; i < length - 1; i++) {
                if (descending) {
                    if (value < cachedBounds[i * columns].bottom &&
                        value > cachedBounds[(i + 1) * columns].top) {
                        selected = value >
                            (cachedBounds[i * columns].bottom +
                                cachedBounds[(i + 1) * columns].top) / 2
                            ? i
                            : i + 1;
                        break;
                    }
                } else if (value > cachedBounds[i].right &&
                    value < cachedBounds[i + 1].left) {
                    selected = value <
                        (cachedBounds[i].right + cachedBounds[i + 1].left) / 2
                        ? i
                        : i + 1;
                    break;
                }
            }
        }

        if (selected < 0) {
            selected = descending
                ? (value > cachedBounds[0].top ? 0 : length - 1)
                : (value < cachedBounds[0].left ? 0 : length - 1);
        }

        if (trace) {
            operations.log("Bulk grid direct-bounds lookup: axis=" + axis +
                ", value=" + value + ", descending=" + descending +
                ", selected=" + selected + ", bounds=" +
                formatRectangle(cachedBounds[descending
                    ? selected * columns
                    : selected]) + ".");
        }
        return selected;
    }

    function gridPositionAt(x, y, trace) {
        const grid = slotGrid();
        if (grid == null) return null;
        const column = indexFromBounds(x, columns, false, "column", trace);
        const row = indexFromBounds(
            y,
            grid.rowBounds.length,
            true,
            "row",
            trace
        );
        const index = row * columns + column;
        if (index < 0 || index >= buttons.length) return null;
        return {
            index: index,
            column: column,
            row: row,
            grid: grid,
            localX: x,
            localY: y
        };
    }

    function gridPosition(button, localX, localY, trace) {
        if (button == null) return null;
        const point = button.localToAscendantCoordinates(
            table,
            new Vec2(localX, localY)
        );
        return gridPositionAt(point.x, point.y, trace);
    }

    function indexAtTablePoint(x, y) {
        if (cachedGrid == null || cachedBounds.length === 0) return -1;
        const rows = cachedGrid.rowBounds.length;
        const left = cachedBounds[0].left;
        const right = cachedBounds[columns - 1].right;
        const top = cachedBounds[0].top;
        const bottom = cachedBounds[(rows - 1) * columns].bottom;
        if (x < left || x > right || y < bottom || y > top) return -1;
        const position = gridPositionAt(x, y, false);
        return position == null ? -1 : position.index;
    }

    function appendRectangleSlot(selected, category, index) {
        const slot = slotAt(category, index);
        if (slot != null && slot.name && findSlot(selected, slot.key) < 0) {
            selected.push(slot);
        } else if (slot != null && slot.name) {
            operations.log("Ignored duplicate slot while building bulk rectangle: index=" +
                index + ", key=" + slot.key + ", category=" + category + ".");
        }
    }

    function appendRectangleSlotIfInside(
        selected, category, index, minColumn, maxColumn, minRow, maxRow
    ) {
        const row = Math.floor(index / columns);
        const column = index % columns;
        if (row < minRow || row > maxRow ||
            column < minColumn || column > maxColumn) return;
        appendRectangleSlot(selected, category, index);
    }

    function slotsInRectangle(category, first, last) {
        const selected = [];
        const minColumn = Math.min(first.column, last.column);
        const maxColumn = Math.max(first.column, last.column);
        const minRow = Math.min(first.row, last.row);
        const maxRow = Math.min(
            Math.max(first.row, last.row),
            Math.ceil(buttons.length / columns) - 1
        );
        const firstIndex = minRow * columns + minColumn;
        const lastIndex = Math.min(
            buttons.length - 1,
            maxRow * columns + maxColumn
        );

        for (let index = firstIndex; index <= lastIndex; index++) {
            appendRectangleSlotIfInside(
                selected,
                category,
                index,
                minColumn,
                maxColumn,
                minRow,
                maxRow
            );
        }
        return selected;
    }

    function cellRectangle(first, last) {
        const minColumn = Math.min(first.column, last.column);
        const maxColumn = Math.max(first.column, last.column);
        const minRow = Math.min(first.row, last.row);
        const maxRow = Math.max(first.row, last.row);
        return {
            left: cachedBounds[minRow * columns + minColumn].left,
            bottom: cachedBounds[maxRow * columns + minColumn].bottom,
            right: cachedBounds[minRow * columns + maxColumn].right,
            top: cachedBounds[minRow * columns + minColumn].top
        };
    }

    function drawRectangle(rectangle, backColor, frontColor, offsetX, offsetY) {
        if (rectangle == null) return;
        const x = offsetX + rectangle.left;
        const y = offsetY + rectangle.bottom;
        const width = rectangle.right - rectangle.left;
        const height = rectangle.top - rectangle.bottom;

        Lines.stroke(2);
        Draw.color(backColor);
        Lines.rect(x - 1, y - 1, width + 2, height + 2);
        Draw.color(frontColor);
        Lines.rect(x, y, width, height);
    }

    function drawOverlay() {
        if (table == null || buttons.length === 0) return;
        const mode = currentMode;
        if (mode !== "move" && mode !== "delete") return;

        const backColor = mode === "move" ? Pal.accentBack : Pal.sapBulletBack;
        const frontColor = mode === "move" ? Pal.accent : Pal.sapBullet;
        const offsetX = overlay.x;
        const offsetY = overlay.y;
        const activeRectangleVisible = activeSelection != null &&
            activeSelection.mode === mode &&
            activeSelection.category === currentCategory &&
            activeSelection.dragging && activeSelection.rectangle != null;
        const persistentRectangleVisible = lastRectangle != null &&
            lastRectangle.mode === mode &&
            lastRectangle.category === currentCategory;
        const selection = slotsFor(mode);
        let drewOutline = false;

        if (activeRectangleVisible) {
            drawRectangle(
                activeSelection.rectangle,
                backColor,
                frontColor,
                offsetX,
                offsetY
            );
            drewOutline = true;
        }
        if (persistentRectangleVisible) {
            drawRectangle(
                lastRectangle.rectangle,
                backColor,
                frontColor,
                offsetX,
                offsetY
            );
            drewOutline = true;
        }
        for (let i = 0; i < selection.length; i++) {
            const slot = selection[i];
            if (slot.category !== currentCategory ||
                slot.index < 0 || slot.index >= cachedBounds.length) continue;
            drawRectangle(cachedBounds[slot.index], backColor, frontColor, offsetX, offsetY);
            drewOutline = true;
        }
        if (mode === "move" && singleMoveIndex >= 0 &&
            singleMoveIndex < cachedBounds.length) {
            let alreadyOutlined = false;
            for (let i = 0; i < selection.length; i++) {
                if (selection[i].category === currentCategory &&
                    selection[i].index === singleMoveIndex) {
                    alreadyOutlined = true;
                    break;
                }
            }
            if (!alreadyOutlined) {
                drawRectangle(
                    cachedBounds[singleMoveIndex],
                    backColor,
                    frontColor,
                    offsetX,
                    offsetY
                );
                drewOutline = true;
            }
        }
        if (drewOutline) Draw.reset();
    }

    function installOverlay() {
        if (table == null) return;
        if (overlay != null && overlay.parent === table) return;
        if (overlay != null) overlay.remove();

        overlay = new JavaAdapter(Packages.arc.scene.Element, {
            draw: function() {
                drawOverlay();
            }
        });
        overlay.touchable = Packages.arc.scene.event.Touchable.disabled;
        overlay.cullable = false;
        overlay.setPosition(0, 0);
        overlay.setSize(table.getWidth(), table.getHeight());
        table.addChild(overlay);
    }

    function bind(newTable, newButtons, newColumns, getSlot, changed) {
        const tableChanged = table !== newTable;
        const buttonsChanged = buttons.length !== newButtons.length ||
            buttons.some((button, index) => button !== newButtons[index]);

        table = newTable;
        buttons = newButtons;
        columns = newColumns;
        slotAt = getSlot;
        onSelectionChanged = changed;
        cachedGrid = buildSlotGrid();
        if (tableChanged) {
            if (overlay != null) overlay.remove();
            overlay = null;
        }
        if (tableChanged || buttonsChanged) {
            activeSelection = null;
            lastRectangle = null;
        }
        installOverlay();
        if (tableChanged || buttonsChanged) {
            operations.log("Bound bulk-selection overlay to " + buttons.length + " schematic slots.");
            const first = cachedBounds.length > 0 ? cachedBounds[0] : null;
            const last = cachedBounds.length > 0 ? cachedBounds[cachedBounds.length - 1] : null;
            operations.log("Bulk grid geometry: columns=" + columns +
                ", rows=" + (cachedGrid == null ? 0 : cachedGrid.rowBounds.length) +
                ", firstSlot=" + formatRectangle(first) +
                ", lastSlot=" + formatRectangle(last) +
                ", firstRowBounds=" + describeBounds(0, 1, columns) +
                ", firstColumnBounds=" + describeBounds(
                    0,
                    columns,
                    Math.ceil(buttons.length / columns)
                ) + ".");
        }
    }

    function begin(event, mode, category, index, pointer, button, x, y) {
        if (mode !== "move" && mode !== "delete") {
            operations.log("Bulk selection start rejected: invalid mode=" + mode + ".");
            return false;
        }
        const grid = slotGrid();
        if (grid == null) {
            operations.log("Bulk selection start rejected: grid unavailable, mode=" +
                mode + ", category=" + category + ", slot=" + index +
                ", columns=" + columns + ", buttons=" + buttons.length + ".");
            return false;
        }

        const startPoint = gridPosition(button, x, y, true);
        activeSelection = {
            mode: mode,
            category: category,
            index: index,
            pointer: pointer,
            startX: x,
            startY: y,
            lastX: x,
            lastY: y,
            dragging: false,
            start: {
                column: index % columns,
                row: Math.floor(index / columns),
                grid: grid
            }
        };
        lastRectangle = null;
        const clicked = slotAt(category, index);
        operations.log("Started " + mode + " selection gesture: category=" + category +
            ", slot=" + index + ", key=" + (clicked == null ? "null" : clicked.key) +
            ", name=" + JSON.stringify(clicked == null ? "" : clicked.name) +
            ", pointer=" + pointer + ", local=(" +
            x + "," + y + "), tablePoint=(" +
            (startPoint == null ? "null" : startPoint.localX + "," + startPoint.localY) +
            "), stage=(" + event.stageX + "," + event.stageY + "), cell=(" +
            activeSelection.start.column + "," + activeSelection.start.row +
            "), mappedCell=" + (startPoint == null ? "null" :
                startPoint.column + "," + startPoint.row + " (slot " +
                    startPoint.index + ")") +
            ", slotBounds=" + formatRectangle(cachedBounds[index]) + ".");
        return true;
    }

    function drag(event, pointer, button, x, y) {
        if (activeSelection == null || activeSelection.pointer !== pointer) return false;
        const dx = x - activeSelection.startX;
        const dy = y - activeSelection.startY;
        let activated = false;
        if (!activeSelection.dragging && dx * dx + dy * dy >= dragThresholdSquared) {
            activeSelection.dragging = true;
            activated = true;
        }
        activeSelection.lastX = x;
        activeSelection.lastY = y;
        if (activeSelection.dragging) {
            const current = gridPosition(button, x, y, activated);
            activeSelection.rectangle = current == null
                ? null
                : cellRectangle(activeSelection.start, current);
            if (activated) {
                operations.log("Bulk selection drag activated: mode=" +
                    activeSelection.mode + ", local=(" + x + "," + y +
                    "), tablePoint=(" + (current == null ? "null" :
                        current.localX + "," + current.localY) +
                    "), delta=(" + dx + "," + dy +
                    "), mappedCell=" + (current == null ? "null" :
                        current.column + "," + current.row + " (slot " +
                        current.index + ")") +
                    ", rectangle=" + formatRectangle(activeSelection.rectangle) + ".");
            }
        }
        return true;
    }

    function finish(event, pointer, button, x, y) {
        if (activeSelection == null || activeSelection.pointer !== pointer) return null;
        const completed = activeSelection;
        activeSelection = null;

        if (completed.dragging) {
            const end = gridPosition(button, x, y, true);
            if (end == null) {
                operations.log("Bulk selection finished without an endpoint cell: mode=" +
                    completed.mode + ", category=" + completed.category +
                    ", startSlot=" + completed.index + ", stage=(" +
                    event.stageX + "," + event.stageY + ").");
                const emptyResult = { mode: completed.mode, slots: [] };
                announceResult(emptyResult);
                return emptyResult;
            }
            const slots = slotsInRectangle(completed.category, completed.start, end);
            const rectangle = cellRectangle(completed.start, end);
            lastRectangle = {
                mode: completed.mode,
                category: completed.category,
                rectangle: rectangle
            };
            const selection = slotsFor(completed.mode);
            selection.length = 0;
            for (let i = 0; i < slots.length; i++) selection.push(slots[i]);
            notify(completed.mode);
            const result = { mode: completed.mode, slots: slots, rectangle: true };
            operations.log("Bulk selection rectangle finished: mode=" + completed.mode +
                ", category=" + completed.category + ", startSlot=" +
                completed.index + ", startCell=(" + completed.start.column + "," +
                completed.start.row + "), endCell=(" + end.column + "," + end.row +
                "), endpointLocal=(" + x + "," + y +
                "), endpointTable=(" + end.localX + "," + end.localY +
                "), endpointStage=(" + event.stageX + "," + event.stageY +
                "), endpointSlot=" + end.index +
                ", rectangle=" + formatRectangle(rectangle) +
                ", populatedSlots=" + slots.length +
                ", selectedSlots=[" + describeSlots(slots) +
                "], persistent=true.");
            announceResult(result);
            return result;
        }

        const clicked = slotAt(completed.category, completed.index);
        if (clicked == null || !clicked.name) {
            operations.log("Bulk selection click ended on an empty slot: mode=" +
                completed.mode + ", category=" + completed.category +
                ", slot=" + completed.index + ".");
            const emptyResult = { mode: completed.mode, slots: [] };
            announceResult(emptyResult);
            return emptyResult;
        }
        const selection = slotsFor(completed.mode);
        lastRectangle = null;
        const existing = findSlot(selection, clicked.key);
        operations.log("Bulk selection toggle before update: mode=" + completed.mode +
            ", category=" + completed.category + ", key=" + clicked.key +
            ", name=" + JSON.stringify(clicked.name) +
            ", selectedBefore=" + (existing >= 0) +
            ", selectionIndexBefore=" + existing +
            ", selectedSlotsBefore=[" + describeSlots(selection) + "].");
        if (existing >= 0) {
            selection.splice(existing, 1);
        } else {
            selection.push(clicked);
        }
        operations.log("Bulk selection toggle after update: mode=" + completed.mode +
            ", key=" + clicked.key + ", selectedAfter=" +
            (findSlot(selection, clicked.key) >= 0) +
            ", selectedSlotsAfter=[" + describeSlots(selection) + "].");
        notify(completed.mode);
        const result = {
            mode: completed.mode,
            slots: selection.slice(),
            rectangle: false,
            selected: existing < 0,
            slot: clicked
        };
        announceResult(result);
        return result;
    }

    function toggle(mode, slot) {
        const selection = slotsFor(mode);
        lastRectangle = null;
        const existing = findSlot(selection, slot.key);
        if (existing >= 0) {
            selection.splice(existing, 1);
            notify(mode);
            return false;
        }
        selection.push(slot);
        notify(mode);
        return true;
    }

    function clear(mode) {
        if (mode == null || mode === "move") moveSlots.length = 0;
        if (mode == null || mode === "delete") deleteSlots.length = 0;
        if (lastRectangle != null &&
            (mode == null || mode === lastRectangle.mode)) lastRectangle = null;
        activeSelection = null;
        if (mode == null || mode === "move") notify("move");
        if (mode == null || mode === "delete") notify("delete");
    }

    function validateMoves(moves) {
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const currentSourceName = operations.getName(move.source.key);
            const currentSourceImage = operations.getImage(move.source.key + "image");
            const currentDestinationName = operations.getName(move.destination);
            const currentDestinationImage = operations.getImage(move.destination + "image");
            if (currentSourceName !== move.source.name ||
                currentSourceImage !== move.source.image ||
                currentDestinationName !== move.expectedDestination ||
                currentDestinationImage !== move.expectedDestinationImage) {
                operations.announce("drag-scheme-table.bulk-move-stale");
                operations.log("Bulk move rejected because source or destination " +
                    move.source.key + " -> " + move.destination + " changed: " +
                    "sourceExpected=(" + JSON.stringify(move.source.name) + "," +
                    JSON.stringify(move.source.image) + "), sourceCurrent=(" +
                    JSON.stringify(currentSourceName) + "," +
                    JSON.stringify(currentSourceImage) + "), destinationExpected=(" +
                    JSON.stringify(move.expectedDestination) + "," +
                    JSON.stringify(move.expectedDestinationImage) +
                    "), destinationCurrent=(" + JSON.stringify(currentDestinationName) +
                    "," + JSON.stringify(currentDestinationImage) + ").");
                return false;
            }
        }
        return true;
    }

    function removeMoveSource(move) {
        operations.log("Bulk move removing source: index=" + move.source.index +
            ", key=" + move.source.key + ", name=" +
            JSON.stringify(move.source.name) + ", image=" +
            JSON.stringify(move.source.image) + ".");
        operations.remove(move.source.key);
        operations.remove(move.source.key + "image");
    }

    function writeMoveDestination(move) {
        operations.put(move.destination, move.source.name);
        operations.remove(move.destination + "image");
        if (move.source.image) {
            operations.put(move.destination + "image", move.source.image);
        }
        operations.log("Bulk move destination write: index=" +
            move.destinationIndex + ", key=" + move.destination +
            ", nameWritten=" + JSON.stringify(move.source.name) +
            ", imageWritten=" + JSON.stringify(move.source.image) +
            ", nameReadback=" +
            JSON.stringify(operations.getName(move.destination)) +
            ", imageReadback=" +
            JSON.stringify(operations.getImage(move.destination + "image")) + ".");
    }

    function commitMoves(moves) {
        if (!validateMoves(moves)) return;
        operations.log("Bulk move commit started for " + moves.length + " mappings.");
        let changed = false;
        for (let i = 0; i < moves.length; i++) {
            if (moves[i].source.key !== moves[i].destination) changed = true;
            removeMoveSource(moves[i]);
        }
        for (let i = 0; i < moves.length; i++) {
            writeMoveDestination(moves[i]);
        }

        clear("move");
        if (changed) {
            operations.save();
            operations.refresh(moves);
        }
        operations.announce("drag-scheme-table.bulk-move-complete");
        operations.log("Moved " + moves.length + " selected schematics as a group.");
    }

    function moveSelected(category, destinationIndex, slotColumns, rowCount) {
        const selection = moveSlots.slice();
        if (selection.length === 0) return;
        const sourceDescriptions = [];
        for (let i = 0; i < selection.length; i++) {
            sourceDescriptions.push(selection[i].index + ":" + selection[i].key +
                "=" + JSON.stringify(selection[i].name) +
                " image=" + JSON.stringify(selection[i].image) +
                " cell=(" + selection[i].column + "," + selection[i].row + ")");
        }
        operations.log("Bulk move source snapshot: count=" + selection.length +
            ", slots=[" + sourceDescriptions.join(";") + "].");

        let minColumn = slotColumns;
        let minRow = rowCount;
        const sourceKeys = Object.create(null);
        const targetKeys = Object.create(null);
        const moves = [];
        const overwrittenNames = [];

        for (let i = 0; i < selection.length; i++) {
            minColumn = Math.min(minColumn, selection[i].column);
            minRow = Math.min(minRow, selection[i].row);
            markMoveSource(sourceKeys, selection[i]);
        }

        const destinationColumn = destinationIndex % slotColumns;
        const destinationRow = Math.floor(destinationIndex / slotColumns);
        for (let i = 0; i < selection.length; i++) {
            if (!appendMoveForSource(
                moves,
                overwrittenNames,
                selection[i],
                category,
                minColumn,
                minRow,
                destinationColumn,
                destinationRow,
                slotColumns,
                rowCount,
                sourceKeys,
                targetKeys
            )) return;
        }

        if (!validateMoves(moves)) return;
        if (overwrittenNames.length > 0) {
            operations.log("Bulk move needs confirmation to overwrite " +
                overwrittenNames.length + " destination schematics.");
            operations.confirmBulkOverwrite(overwrittenNames, function() {
                commitMoves(moves);
            });
            return;
        }
        commitMoves(moves);
    }

    function markMoveSource(sourceKeys, source) {
        sourceKeys[source.key] = true;
    }

    function appendMoveForSource(moves, overwrittenNames, source, category,
        minColumn, minRow, destinationColumn, destinationRow, slotColumns,
        rowCount, sourceKeys, targetKeys) {
        const column = destinationColumn + source.column - minColumn;
        const row = destinationRow + source.row - minRow;
        if (column < 0 || column >= slotColumns || row < 0 || row >= rowCount) {
            operations.announce("drag-scheme-table.bulk-move-out-of-bounds");
            operations.log("Bulk move rejected because the selection would extend beyond the table.");
            return false;
        }
        const destinationIndex = row * slotColumns + column;
        const destination = operations.slotKey(category, destinationIndex, slotColumns);
        if (targetKeys[destination]) {
            operations.announce("drag-scheme-table.bulk-move-overlap");
            operations.log("Bulk move rejected because multiple selected slots map to " + destination + ".");
            return false;
        }
        targetKeys[destination] = true;
        const destinationIsSelectedSource = !!sourceKeys[destination];
        const expectedDestination = operations.getName(destination);
        const expectedDestinationImage = operations.getImage(destination + "image");
        moves.push({
            source: source,
            category: category,
            destination: destination,
            destinationIndex: destinationIndex,
            expectedDestination: expectedDestination,
            expectedDestinationImage: expectedDestinationImage
        });
        operations.log("Bulk move planned mapping: sourceIndex=" + source.index +
            ", sourceKey=" + source.key + ", sourceName=" +
            JSON.stringify(source.name) + ", sourceImage=" +
            JSON.stringify(source.image) + ", destinationIndex=" +
            destinationIndex + ", destinationKey=" + destination +
            ", destinationNameBefore=" + JSON.stringify(expectedDestination) +
            ", destinationImageBefore=" + JSON.stringify(expectedDestinationImage) +
            ", destinationIsSelectedSource=" + destinationIsSelectedSource + ".");
        if (expectedDestination && !destinationIsSelectedSource) {
            overwrittenNames.push(expectedDestination);
        }
        return true;
    }

    function getMoveFootprint() {
        if (moveSlots.length === 0) return null;

        let minColumn = columns;
        let minRow = buttons.length;
        let maxColumn = -1;
        let maxRow = -1;
        for (let i = 0; i < moveSlots.length; i++) {
            const slot = moveSlots[i];
            minColumn = Math.min(minColumn, slot.column);
            minRow = Math.min(minRow, slot.row);
            maxColumn = Math.max(maxColumn, slot.column);
            maxRow = Math.max(maxRow, slot.row);
        }
        const topLeft = cachedBounds[minRow * columns + minColumn];
        const bottomLeft = cachedBounds[maxRow * columns + minColumn];
        const bottomRight = cachedBounds[maxRow * columns + maxColumn];
        return {
            slots: moveSlots.slice(),
            minColumn: minColumn,
            minRow: minRow,
            maxColumn: maxColumn,
            maxRow: maxRow,
            left: topLeft.left,
            bottom: bottomLeft.bottom,
            right: bottomRight.right,
            top: topLeft.top,
            width: bottomRight.right - topLeft.left,
            height: topLeft.top - bottomLeft.bottom
        };
    }

    function getMoveOutline() {
        if (moveSlots.length === 0 || lastRectangle == null ||
            lastRectangle.mode !== "move" ||
            lastRectangle.category !== currentCategory) return null;
        return {
            left: lastRectangle.rectangle.left,
            bottom: lastRectangle.rectangle.bottom,
            right: lastRectangle.rectangle.right,
            top: lastRectangle.rectangle.top
        };
    }

    function update(mode, category, selectedMoveIndex) {
        if (currentMode !== mode || currentCategory !== category) {
            operations.log("Bulk overlay mode/category changed: mode=" + mode +
                ", category=" + category + ", persistentRectangle=" +
                (lastRectangle == null ? "none" :
                    lastRectangle.mode + "/" + lastRectangle.category +
                    " " + formatRectangle(lastRectangle.rectangle)) + ".");
        }
        currentMode = mode;
        currentCategory = category;
        singleMoveIndex = mode === "move" && selectedMoveIndex != null
            ? selectedMoveIndex
            : -1;
        if (overlay != null && table != null) {
            overlay.setSize(table.getWidth(), table.getHeight());
            overlay.toFront();
        }
    }

    function bringToFront() {
        if (overlay != null) overlay.toFront();
    }

    return {
        bind: bind,
        begin: begin,
        drag: drag,
        finish: finish,
        toggle: toggle,
        clear: clear,
        update: update,
        moveSelected: moveSelected,
        getMoveFootprint: getMoveFootprint,
        getMoveOutline: getMoveOutline,
        indexAtTablePoint: indexAtTablePoint,
        bringToFront: bringToFront,
        getMoveSlots: function() { return moveSlots.slice(); },
        getDeleteSlots: function() { return deleteSlots.slice(); }
    };
}

exports.create = create;
