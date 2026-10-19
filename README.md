# Schematic table QoL

This script mod adds schematic move and delete controls and library-to-table dragging to Salivion's Extended UI schematic table.

## Version 1.0.4

- Made Delete mode and selected schematics display a persistent selection border.
- Added multi-select deletion for schematics in the Extended UI table.
- Added a setting to show or hide detailed diagnostic log messages.

## Use

1. Click the **MOVE** button.
<img width="428" height="443" alt="image" src="https://github.com/user-attachments/assets/1e44d543-91a8-4875-bbaf-6d93f63e6adb" />

2. Click a populated slot, then click the destination slot. To move several schematics together, right-drag over a region or right-click individual schematics to select them, then left-click the destination for the selection's top-left slot. A new rectangle replaces the previous bulk selection; individual right-clicks toggle slots in or out. The yellow/orange outline follows the slot grid and remains visible around the last rectangle even if it contains no schematics. Group moves preserve the selected slots' relative positions and custom images; the whole move is rejected if it would exceed the table or overwrite an unselected schematic.


https://github.com/user-attachments/assets/3ab606bc-a216-4b56-b3a4-97b2b77aa0e8



3. If the destination is occupied, confirm the swap in the popup.
4. Click **MOVE** again to return to normal schematic-use behavior.

Click **Delete** to enter Delete mode. Right-drag over a region or right-click individual schematics to select them; a new rectangular selection replaces the previous selection. The purple outline follows the slot grid and remains visible around the last rectangle even if it contains no schematics, while each selected slot is outlined. Click **Delete** again to review the selected names and confirm deletion. Each selected slot is deleted independently, along with its slot-specific custom image. Cancel clears the selection and exits Delete mode without enabling MOVE. With no schematics selected, clicking **Delete** again exits Delete mode. In either mode, left-clicking still works for the existing single-slot move or Delete-mode selection behavior.

Moves preserve a slot's custom image. Empty destinations receive a move and leave the source empty; occupied destinations are swapped after confirmation. Use **Settings > Extended UI > Skip schematic swap confirmations** to persistently control the confirmation popup. Dismissing the swap popup without confirming clears the selected schematic. Clicking the selected source again cancels the move. Ordinary table clicks are unchanged while move mode is off.

In MOVE mode, hold and drag a schematic to see an outlined floating preview. Drop it on an empty slot to move it, or on an occupied slot to open the swap confirmation. Dropping outside the schematic slots leaves everything unchanged.

The selected slot is highlighted. You can switch category tabs while a slot is selected to move a schematic across categories. Use **Settings > Extended UI > Show diagnostic log messages** to control detailed `[Drag from Scheme Table]` messages; errors and warnings remain visible when this option is off.

## Insert from the schematic library

While in a game with the Extended UI schematic table enabled, press and hold a schematic card in the library without moving for about 0.4 seconds. When the library closes and its preview follows the pointer, drag it onto a table slot. Empty slots receive the schematic; occupied slots ask for confirmation. Releasing outside a table slot leaves the table unchanged. The library's ordinary click, info, export, edit, and delete actions are left available.

When the schematic has one vanilla icon tag, that icon is used for the table slot automatically. If it has multiple icon tags, choose one in the prompt; text tags are not offered. The schematic name and selected icon are stored in the slot. If it has no icon tags, the existing slot image behavior is unchanged.

**Performance note:** The previous working library-drag implementation caused a severe performance hit in the vanilla schematic library. The current version avoids scanning and binding every card when the library opens, but this optimization still needs in-game performance and drag verification. The table MOVE and swap features are unchanged.

**Enable visual schematic dragging** in **Settings > Extended UI** controls both table-to-table dragging and library insertion. When disabled, table click-to-select/click-to-move continues to work.

The mod remains a script mod; install the mod once and no separate JAR or build step is required.
