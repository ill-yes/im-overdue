import { describe, expect, it } from 'vitest';
import { calculateQuickPosition, intersectQuickRect, resolveQuickVisibleAnchor, shouldDismissInvisibleQuickCreate } from '../src/hooks/useQuickCreatePosition';

const menu = { width: 300, height: 280 };
const list = { width: 320, height: 420 };

describe('quick create portal geometry', () => {
  it('keeps an existing menu on state/layout refresh but dismisses after external scroll or resize', () => {
    expect(shouldDismissInvisibleQuickCreate(true, false)).toBe(false);
    expect(shouldDismissInvisibleQuickCreate(true, true)).toBe(true);
    expect(shouldDismissInvisibleQuickCreate(false, false)).toBe(true);
  });
  it('remeasures grown error content against the retained anchor after the preview becomes invisible', () => {
    const previous = { block: { left: 100, right: 190, top: 430, bottom: 490 }, releaseY: 480 };
    const anchor = resolveQuickVisibleAnchor(null, previous, false);
    expect(anchor).toEqual(previous);
    const viewport = { width: 1440, height: 800 };
    const initial = calculateQuickPosition(previous.block, previous.releaseY, viewport, menu, list);
    const grownMenu = { ...menu, height: 460 };
    const updated = calculateQuickPosition(anchor!.block, anchor!.releaseY, viewport, grownMenu, list);
    expect(updated.top).toBeLessThan(initial.top);
    expect(updated.top + grownMenu.height).toBe(792);
    expect(resolveQuickVisibleAnchor(null, previous, true)).toBeNull();
    expect(resolveQuickVisibleAnchor(null, null, false)).toBeNull();
  });
  it('intersects below a sticky header and reports wholly hidden drawings', () => {
    const visible = { left: 10, right: 900, top: 170, bottom: 600 };
    expect(intersectQuickRect({ left: 30, right: 150, top: 100, bottom: 220 }, visible)).toEqual({ left: 30, right: 150, top: 170, bottom: 220 });
    expect(intersectQuickRect({ left: 30, right: 150, top: 100, bottom: 170 }, visible)).toBeNull();
    expect(intersectQuickRect({ left: 910, right: 1030, top: 200, bottom: 270 }, visible)).toBeNull();
  });

  it('prefers the right side with an 8px gap and aligns with the release point', () => {
    const result = calculateQuickPosition({ left: 100, right: 190, top: 200, bottom: 280 }, 250, { width: 1440, height: 900 }, menu, list);
    expect(result).toMatchObject({ left: 198, top: 250, listLeft: 308, inline: false });
  });

  it('uses the left side at the right viewport edge and fits the list on the left', () => {
    const result = calculateQuickPosition({ left: 1100, right: 1190, top: 200, bottom: 280 }, 250, { width: 1200, height: 900 }, menu, list);
    expect(result).toMatchObject({ left: 792, top: 250, listLeft: -328, inline: false });
  });

  it('clamps vertically to the viewport and uses inline list on mobile', () => {
    const result = calculateQuickPosition({ left: 300, right: 380, top: 640, bottom: 750 }, 745, { width: 390, height: 780 }, menu, list);
    expect(result).toMatchObject({ left: 8, top: 492, inline: true, maxHeight: 764 });
    expect(result.left + result.width).toBeLessThanOrEqual(382);
  });

  it('uses inline list when neither side can hold an additional panel', () => {
    expect(calculateQuickPosition({ left: 152, right: 242, top: 200, bottom: 280 }, 250, { width: 800, height: 900 }, menu, list).inline).toBe(true);
  });
});
