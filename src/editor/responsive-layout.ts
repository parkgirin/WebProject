export interface LayoutRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export const COMPACT_WORKSPACE_MEDIA =
  "(max-width: 820px), (min-width: 821px) and (max-width: 1180px) and (max-height: 760px)";
export const COMPACT_PORTRAIT_MEDIA =
  "(max-width: 820px) and (max-aspect-ratio: 4/3), (min-width: 821px) and (max-width: 1180px) and (max-height: 760px) and (max-aspect-ratio: 4/3)";

export function getPanelAvoidanceLift(
  floatingRect: LayoutRect,
  panelRects: readonly LayoutRect[],
  gap = 10,
): number {
  const horizontalPanels = panelRects
    .filter((panel) => panel.width > 0 && panel.height > 0)
    .filter((panel) => panel.left < floatingRect.right && panel.right > floatingRect.left);
  const blockingPanels = horizontalPanels.filter(
    (panel) => panel.top < floatingRect.bottom && panel.bottom > floatingRect.top,
  );
  if (!blockingPanels.length) return 0;

  let blockingTop = Math.min(...blockingPanels.map((panel) => panel.top));
  let blockingBottom = Math.max(...blockingPanels.map((panel) => panel.bottom));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const panel of horizontalPanels) {
      if (panel.top > blockingBottom || panel.bottom < blockingTop) continue;
      const nextTop = Math.min(blockingTop, panel.top);
      const nextBottom = Math.max(blockingBottom, panel.bottom);
      if (nextTop === blockingTop && nextBottom === blockingBottom) continue;
      blockingTop = nextTop;
      blockingBottom = nextBottom;
      expanded = true;
    }
  }

  return Math.max(0, floatingRect.bottom - blockingTop + gap);
}
