# Pose Mesh Editor

A browser-based editor for building poseable 2D character meshes from joints,
independently rotatable joint axes, and generated faces. Each joint currently
supports up to two axes; the array-based model can be expanded for more general
rigs later.

The editor has one default body color with optional per-face color overrides,
can toggle outlines for the complete body, and can show or hide the wrist and
ankle joint shapes. Body joint circles are always rendered behind the connected
faces.

## Export

Use the `PNG 저장` or `SVG 저장` button above the canvas to download the current
character as a tightly cropped image with a transparent background. SVG export
keeps the body as editable vector shapes. The editor grid, reference image,
joint guides, labels, axes, and rotation handle are excluded from both formats.

## License

Source code is available under the MIT License. See `LICENSE`.
Creative assets are excluded from that license unless a file explicitly says
otherwise. See `LICENSE-ASSETS.md`.
