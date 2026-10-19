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

2. Click a populated slot, then click the destination slot.


https://github.com/user-attachments/assets/3ab606bc-a216-4b56-b3a4-97b2b77aa0e8



3. If the destination is occupied, confirm the swap in the popup.
4. Click **MOVE** again to return to normal schematic-use behavior.

Click **Delete** to enter Delete mode. The on-screen message explains how to select schematics; selected slots use the same highlight as hovering, and the Delete button is highlighted while Delete mode is active. Select multiple slots if desired, then click **Delete** again to review their names and confirm deletion. Each selected slot is deleted independently, along with its slot-specific custom image. Cancel clears the selection and exits Delete mode without enabling MOVE. With no schematics selected, clicking **Delete** again exits Delete mode.

Moves preserve a slot's custom image. Empty destinations receive a move and leave the source empty; occupied destinations are swapped after confirmation. Use **Settings > Extended UI > Skip schematic swap confirmations** to persistently control the confirmation popup. Dismissing the swap popup without confirming clears the selected schematic. Clicking the selected source again cancels the move. Ordinary table clicks are unchanged while move mode is off.

In MOVE mode, hold and drag a schematic to see an outlined floating preview. Drop it on an empty slot to move it, or on an occupied slot to open the swap confirmation. Dropping outside the schematic slots leaves everything unchanged.

The selected slot is highlighted. You can switch category tabs while a slot is selected to move a schematic across categories. Use **Settings > Extended UI > Show diagnostic log messages** to control detailed `[Drag from Scheme Table]` messages; errors and warnings remain visible when this option is off.

## Insert from the schematic library


https://github.com/user-attachments/assets/1c3fc178-d382-4991-8ba5-e02048ce9bf8


While in a game with the Extended UI schematic table enabled, press and hold a schematic card in the library without moving for about 0.4 seconds. When the library closes and its preview follows the pointer, drag it onto a table slot. Empty slots receive the schematic; occupied slots ask for confirmation. Releasing outside a table slot leaves the table unchanged. The library's ordinary click, info, export, edit, and delete actions are left available.

**Performance note:** The previous working library-drag implementation caused a severe performance hit in the vanilla schematic library. The current version avoids scanning and binding every card when the library opens, but this optimization still needs in-game performance and drag verification. The table MOVE and swap features are unchanged.

**Enable visual schematic dragging** in **Settings > Extended UI** controls both table-to-table dragging and library insertion. When disabled, table click-to-select/click-to-move continues to work.

The mod remains a script mod; install the mod once and no separate JAR or build step is required.
