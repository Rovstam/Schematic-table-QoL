# Schematic table QoL

This script mod adds schematic move and delete controls and library-to-table dragging to Salivion's Extended UI schematic table.

## Version 1.0.5

- Added Bulk-select move and delete features with right click for schematics in the Extended UI table.
- Schematic drag from Vanilla UI now Displays a message asking what Tag should be used for the Table's icon.

## Use

Click the **MOVE** button.


<img width="428" height="443" alt="image" src="https://github.com/user-attachments/assets/1e44d543-91a8-4875-bbaf-6d93f63e6adb" />


Click on a schematic to select it, click again in the slot you want it to go. Swapping between schematics works too. For bulk selection, Right-click when Move is on. Same for Delete. If the slots you are working with are occupied, you will be asked before proceeding. If you don't read don't blame the mod: It's your own fault.


https://github.com/user-attachments/assets/3ab606bc-a216-4b56-b3a4-97b2b77aa0e8


Moves preserve a slot's custom image. Empty destinations receive a move and leave the source empty; occupied destinations are swapped after confirmation. Use **Settings > Extended UI > Skip schematic swap confirmations** to persistently control the confirmation popup. Dismissing a swap popup leaves the source selected and highlighted. The selected source remains pending until a move or swap succeeds, or MOVE mode is turned off. In normal mode, schematic slots show their outline on hover only; clicking a schematic to use it does not leave a selection outline behind.

For bulk moves, drag a selected schematic and drop it on the destination slot. The dragged schematic anchors the placement, while the other selected schematics keep their relative positions.


## Insert from the schematic library


https://github.com/user-attachments/assets/1c3fc178-d382-4991-8ba5-e02048ce9bf8


While in a game with the Extended UI schematic table enabled, press and hold a schematic card in the library without moving for about 0.4 seconds. When the library closes and its preview follows the pointer, drag it onto a table slot. Empty slots receive the schematic; occupied slots ask for confirmation. Releasing outside a table slot leaves the table unchanged. The library's ordinary click, info, export, edit, and delete actions are left available.

When the schematic has one vanilla icon tag, that icon is used for the table slot automatically. If it has multiple icon tags, choose one in the prompt; text tags are not offered. The schematic name and selected icon are stored in the slot. If it has no icon tags, the existing slot image behavior is unchanged.

**Enable visual schematic dragging** in **Settings > Extended UI** controls both table-to-table dragging and library insertion. When disabled, table click-to-select/click-to-move continues to work.
