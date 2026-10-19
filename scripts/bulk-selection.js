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

        const columnCenters = [];
        const rowCenters = [];
        const columnBounds = [];
        const rowBounds = [];
        const rows = Math.ceil(buttons.length / columns);

        for (let column = 0; column < columns; column++) {
            const bounds = cachedBounds[column];
            columnCenters.push((bounds.left + bounds.right) / 2);
            columnBounds.push({ left: bounds.left, right: bounds.right });
        }
        for (let row = 0; row < rows; row++) {
            const bounds = cachedBounds[row * columns];
            rowCenters.push((bounds.bottom + bounds.top) / 2);
            rowBounds.push({ bottom: bounds.bottom, top: bounds.top });
        }

        return {
            columnCenters: columnCenters,
            rowCenters: rowCenters,
            columnBounds: columnBounds,
            rowBounds: rowBounds
        };
    }

    function slotGrid() {
        return cachedGrid;
    }

    function nearestIndex(values, value) {
        let selected = 0;
        let distance = Infinity;
        for (let i = 0; i < values.length; i++) {
            const currentDistance = Math.abs(values[i] - value);
            if (currentDistance < distance) {
                selected = i;
                distance = currentDistance;
            }
        }
        return selected;
    }

    function gridPosition(button, localX, localY) {
        const grid = slotGrid();
        if (grid == null || button == null) return null;

        const point = button.localToAscendantCoordinates(
            table,
            new Vec2(localX, localY)
        );
        const column = nearestIndex(grid.columnCenters, point.x);
        const row = nearestIndex(grid.rowCenters, point.y);
        const index = row * columns + column;
        if (index < 0 || index >= buttons.length) return null;
        return {
            index: index,
            column: column,
            row: row,
            grid: grid,
            localX: point.x,
            localY: point.y
        };
    }

    function cellRectangle(first, last) {
        const minColumn = Math.min(first.column, last.column);
        const maxColumn = Math.max(first.column, last.column);
        const minRow = Math.min(first.row, last.row);
        const maxRow = Math.max(first.row, last.row);
        const grid = first.grid;

        let left = grid.columnBounds[minColumn].left;
        let right = grid.columnBounds[maxColumn].right;
        if (minColumn > 0) {
            left = (grid.columnBounds[minColumn - 1].right +
                grid.columnBounds[minColumn].left) / 2;
        }
        if (maxColumn < grid.columnBounds.length - 1) {
            right = (grid.columnBounds[maxColumn].right +
                grid.columnBounds[maxColumn + 1].left) / 2;
        }

        let top = grid.rowBounds[minRow].top;
        let bottom = grid.rowBounds[maxRow].bottom;
        if (minRow > 0) {
            top = (grid.rowBounds[minRow - 1].bottom +
                grid.rowBounds[minRow].top) / 2;
        }
        if (maxRow < grid.rowBounds.length - 1) {
            bottom = (grid.rowBounds[maxRow].bottom +
                grid.rowBounds[maxRow + 1].top) / 2;
        }

        return { left: left, bottom: bottom, right: right, top: top };
    }

    function slotsInRectangle(category, first, last) {
        const selected = [];
        const minColumn = Math.min(first.column, last.column);
        const maxColumn = Math.max(first.column, last.column);
        const minRow = Math.min(first.row, last.row);
        const maxRow = Math.max(first.row, last.row);

        for (let row = minRow; row <= maxRow; row++) {
            for (let column = minColumn; column <= maxColumn; column++) {
                const index = row * columns + column;
                if (index >= buttons.length) continue;
                const slot = slotAt(category, index);
                if (slot != null && slot.name) selected.push(slot);
            }
        }
        return selected;
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

        const activeRectangleVisible = activeSelection != null &&
            activeSelection.mode === mode &&
            activeSelection.category === currentCategory &&
            activeSelection.dragging && activeSelection.rectangle != null;
        const persistentRectangleVisible = lastRectangle != null &&
            lastRectangle.mode === mode && lastRectangle.category === currentCategory;
        if (!activeRectangleVisible && !persistentRectangleVisible) return;

        const backColor = mode === "move" ? Pal.accentBack : Pal.sapBulletBack;
        const frontColor = mode === "move" ? Pal.accent : Pal.sapBullet;
        const offsetX = overlay.x;
        const offsetY = overlay.y;

        if (activeRectangleVisible) {
            drawRectangle(activeSelection.rectangle, backColor, frontColor, offsetX, offsetY);
        }
        if (persistentRectangleVisible) {
            drawRectangle(
                lastRectangle.rectangle,
                backColor,
                frontColor,
                offsetX,
                offsetY
            );
        }
        Draw.reset();
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
                ", rows=" + (cachedGrid == null ? 0 : cachedGrid.rowCenters.length) +
                ", firstSlot=" + formatRectangle(first) +
                ", lastSlot=" + formatRectangle(last) +
                ", firstRowBounds=" + cachedBounds.slice(0, columns)
                    .map(formatRectangle).join(";") +
                ", firstColumnBounds=" + cachedBounds.filter((bounds, index) =>
                    index % columns === 0
                ).map(formatRectangle).join(";") +
                ", columnCenters=" +
                (cachedGrid == null ? "null" : cachedGrid.columnCenters.join(",")) +
                ", rowCenters=" +
                (cachedGrid == null ? "null" : cachedGrid.rowCenters.join(",")) + ".");
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
            start: { column: index % columns, row: Math.floor(index / columns), grid: grid }
        };
        lastRectangle = null;
        const startPoint = gridPosition(button, x, y);
        operations.log("Started " + mode + " selection gesture: category=" + category +
            ", slot=" + index + ", pointer=" + pointer + ", local=(" +
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
            const current = gridPosition(button, x, y);
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
            const end = gridPosition(button, x, y);
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
                ", populatedSlots=" + slots.length + ", persistent=true.");
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
        if (existing >= 0) {
            selection.splice(existing, 1);
        } else {
            selection.push(clicked);
        }
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

    function moveSelected(category, destinationIndex, slotColumns, rowCount) {
        const selection = moveSlots.slice();
        if (selection.length === 0) return;

        let minColumn = slotColumns;
        let minRow = rowCount;
        const sourceKeys = Object.create(null);
        const targetKeys = Object.create(null);
        const moves = [];

        for (let i = 0; i < selection.length; i++) {
            const slot = selection[i];
            minColumn = Math.min(minColumn, slot.column);
            minRow = Math.min(minRow, slot.row);
            sourceKeys[slot.key] = true;
        }

        const destinationColumn = destinationIndex % slotColumns;
        const destinationRow = Math.floor(destinationIndex / slotColumns);
        for (let i = 0; i < selection.length; i++) {
            const source = selection[i];
            const column = destinationColumn + source.column - minColumn;
            const row = destinationRow + source.row - minRow;
            if (column < 0 || column >= slotColumns || row < 0 || row >= rowCount) {
                operations.announce("drag-scheme-table.bulk-move-out-of-bounds");
                operations.log("Bulk move rejected because the selection would extend beyond the table.");
                return;
            }

            const destination = operations.slotKey(category, row * slotColumns + column, slotColumns);
            if (targetKeys[destination]) {
                operations.announce("drag-scheme-table.bulk-move-overlap");
                operations.log("Bulk move rejected because multiple selected slots map to " + destination + ".");
                return;
            }
            targetKeys[destination] = true;
            moves.push({
                source: source,
                destination: destination,
                expectedDestination: operations.getName(destination)
            });
        }

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            if (operations.getName(move.source.key) !== move.source.name ||
                operations.getImage(move.source.key + "image") !== move.source.image) {
                operations.announce("drag-scheme-table.move-stale");
                operations.log("Bulk move rejected because source " + move.source.key + " changed.");
                return;
            }
            if (move.expectedDestination && !sourceKeys[move.destination]) {
                operations.announce("drag-scheme-table.bulk-move-occupied");
                operations.log("Bulk move rejected because destination " + move.destination + " is occupied.");
                return;
            }
        }

        let changed = false;
        for (let i = 0; i < moves.length; i++) {
            if (moves[i].source.key !== moves[i].destination) changed = true;
            operations.remove(moves[i].source.key);
            operations.remove(moves[i].source.key + "image");
        }
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            operations.put(move.destination, move.source.name);
            operations.remove(move.destination + "image");
            if (move.source.image) {
                operations.put(move.destination + "image", move.source.image);
            }
        }

        clear("move");
        if (changed) {
            operations.save();
            operations.refresh();
        }
        operations.announce("drag-scheme-table.bulk-move-complete");
        operations.log("Moved " + moves.length + " selected schematics as a group.");
    }

    function update(mode, category) {
        if (currentMode !== mode || currentCategory !== category) {
            operations.log("Bulk overlay mode/category changed: mode=" + mode +
                ", category=" + category + ", persistentRectangle=" +
                (lastRectangle == null ? "none" :
                    lastRectangle.mode + "/" + lastRectangle.category +
                    " " + formatRectangle(lastRectangle.rectangle)) + ".");
        }
        currentMode = mode;
        currentCategory = category;
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
        bringToFront: bringToFront,
        getMoveSlots: function() { return moveSlots.slice(); },
        getDeleteSlots: function() { return deleteSlots.slice(); }
    };
}

exports.create = create;
