# Schematic table QoL

This script mod adds schematic move and delete controls and library-to-table dragging to Salivion's Extended UI schematic table.

## Version 1.0.4

- Made Delete mode and selected schematics display a persistent selection border.
- Added multi-select deletion for schematics in the Extended UI table.
- Added a setting to show or hide detailed diagnostic log messages.
- Schematic drag from Vanilla UI now Displays a message asking what Tag should be used for the Table's icon.

## Use

1. Click the **MOVE** button.
<img width="428" height="443" alt="image" src="https://github.com/user-attachments/assets/1e44d543-91a8-4875-bbaf-6d93f63e6adb" />

2. Click a populated slot, then click the destination slot. The selected source remains highlighted until a move or swap succeeds. To move several schematics together, right-drag over a region or right-click individual schematics to select them. Each populated selected slot is outlined; empty slots are not highlighted. During a right-drag, the selection rectangle follows the pointer and remains around the selected region after release. Left-drag a selected slot to move the group. The cursor-following preview preserves the selected slots' relative positions and the grab offset. A new rectangle replaces the previous bulk selection; individual right-clicks toggle slots in or out. Group moves preserve custom images; they are rejected if they would exceed the table, and ask before replacing any unselected destination schematics.


https://github.com/user-attachments/assets/3ab606bc-a216-4b56-b3a4-97b2b77aa0e8



3. For a single schematic, confirm a swap if the destination is occupied. For a bulk move, confirm before any occupied destination schematics are replaced; empty destinations move without a prompt.
4. Click **MOVE** again to return to normal schematic-use behavior.

Click **Delete** to enter Delete mode. Right-drag over a region or right-click individual schematics to select them; a new rectangular selection replaces the previous selection. Each populated selected slot is outlined; empty slots are not highlighted. During a right-drag, the selection rectangle follows the pointer and remains around the selected region after release. Click **Delete** again to review the selected names and confirm deletion. Each selected slot is deleted independently, along with its slot-specific custom image. Cancel clears the selection and exits Delete mode without enabling MOVE. With no schematics selected, clicking **Delete** again exits Delete mode. In either mode, left-clicking still works for the existing single-slot move or Delete-mode selection behavior.

Moves preserve a slot's custom image. Empty destinations receive a move and leave the source empty; occupied destinations are swapped after confirmation. Use **Settings > Extended UI > Skip schematic swap confirmations** to persistently control the confirmation popup. Dismissing a swap popup leaves the source selected and highlighted. The selected source remains pending until a move or swap succeeds, or MOVE mode is turned off. In normal mode, schematic slots show their outline on hover only; clicking a schematic to use it does not leave a selection outline behind.

In MOVE mode, hold and drag a single schematic to see its outlined floating preview. Drop it on an empty slot to move it, or on an occupied slot to open the swap confirmation. A selected group can also be left-dragged; its preview wraps the selected schematics and retains their spacing. Dropping outside the schematic slots leaves everything unchanged.

The selected slot is highlighted. You can switch category tabs while a slot is selected to move a schematic across categories. Use **Settings > Extended UI > Show diagnostic log messages** to control detailed `[Drag from Scheme Table]` messages; errors and warnings remain visible when this option is off.

## Insert from the schematic library


https://github.com/user-attachments/assets/1c3fc178-d382-4991-8ba5-e02048ce9bf8


While in a game with the Extended UI schematic table enabled, press and hold a schematic card in the library without moving for about 0.4 seconds. When the library closes and its preview follows the pointer, drag it onto a table slot. Empty slots receive the schematic; occupied slots ask for confirmation. Releasing outside a table slot leaves the table unchanged. The library's ordinary click, info, export, edit, and delete actions are left available.

When the schematic has one vanilla icon tag, that icon is used for the table slot automatically. If it has multiple icon tags, choose one in the prompt; text tags are not offered. The schematic name and selected icon are stored in the slot. If it has no icon tags, the existing slot image behavior is unchanged.

**Performance note:** The previous working library-drag implementation caused a severe performance hit in the vanilla schematic library. The current version avoids scanning and binding every card when the library opens, but this optimization still needs in-game performance and drag verification. The table MOVE and swap features are unchanged.

**Enable visual schematic dragging** in **Settings > Extended UI** controls both table-to-table dragging and library insertion. When disabled, table click-to-select/click-to-move continues to work.

The mod remains a script mod; install the mod once and no separate JAR or build step is required.
