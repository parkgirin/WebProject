# Pose Mesh Editor

A browser-based editor for building poseable 2D character meshes from joints,
independently rotatable joint axes, and generated faces. Each joint currently
supports up to two axes; the array-based model can be expanded for more general
rigs later.

The editor has one default body color with optional per-face and per-joint color overrides,
can toggle outlines for the complete body, and can show or hide the wrist and
ankle joint shapes. Selected joints and faces can be assigned to named groups,
groups can be shown or hidden together, and both group order and item layer
values can be adjusted. Joints and faces share one ordering scale inside each
group, so either type can be placed in front of the other when needed. The
default left/right arms and legs are separate groups. The outline option can
hide only face edges whose two endpoints belong to the same joint, while
keeping the long limb edges and boundaries between overlapping groups visible.
The editor also supports undo/redo, Shift-click and marquee multi-selection,
face-to-joint and layer-group selection, group movement and rotation, wheel zoom, Space-drag panning, and fitting the
viewport to the current selection. Direct parent-child face axes stay
perpendicular to their joint connection; rotating one of those axes rotates
the connected child joint and its descendant subtree.

## Export

Use the `PNG 저장` or `SVG 저장` button above the canvas to download the current
character as a tightly cropped image with a transparent background. SVG export
keeps the body as editable vector shapes. The editor grid, reference image,
joint guides, labels, axes, and rotation handle are excluded from both formats.
Use `저장 미리보기` to inspect that exact cropped, transparent-background result
before downloading it.

## License

Source code is available under the MIT License. See `LICENSE`.
Creative assets are excluded from that license unless a file explicitly says
otherwise. See `LICENSE-ASSETS.md`.
