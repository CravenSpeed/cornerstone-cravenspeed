/**
 * @file ugcPagination
 * @description Shared, pure pagination helper for the UGC surfaces — the product
 * reviews/Q&A lists (ugcProduct.js) and the home overview wall (ugcOverview.js).
 * Computes which page numbers a control should show so a feed of thousands of
 * reviews renders a compact windowed control (1 … 7 8 9 10 11 … 200) rather than
 * one button per page. Pure: numbers in, window out — no DOM.
 */

// Sentinel marking a collapsed run of hidden pages. Callers render PAGE_GAP_HTML
// in its place — a non-interactive ellipsis between numbered buttons.
export const PAGE_GAP = '…';

// The ellipsis stand-in. aria-hidden because it carries no navigation; the
// prev/next/number buttons are the operable controls. Sized in SCSS
// (.cs-ugc-page-gap) to line up with the 44px page buttons.
export const PAGE_GAP_HTML = '<span class="cs-ugc-page-gap" aria-hidden="true">…</span>';

/**
 * The page numbers to display for `current` within `pageCount`, always anchored
 * by the first and last page and showing `radius` neighbours either side of the
 * current page. A run of 2+ hidden pages collapses to a PAGE_GAP sentinel; a lone
 * hidden page is shown rather than replaced (a gap never saves space over the one
 * number it would hide).
 * @param {number} current - 1-indexed current page (clamped into range).
 * @param {number} pageCount - Total pages (assumed >= 1).
 * @param {number} [radius] - Neighbours shown either side of current.
 * @returns {Array<number|string>} Page numbers, with PAGE_GAP marking each gap.
 */
export function pageWindow(current, pageCount, radius = 2) {
    if (pageCount <= 1) {
        return [1];
    }

    const cur = Math.min(Math.max(1, current), pageCount);
    const lo = Math.max(2, cur - radius);
    const hi = Math.min(pageCount - 1, cur + radius);
    const items = [1];

    // Left side: nothing when the window reaches page 2, the lone page itself
    // when exactly one is hidden, otherwise a gap.
    if (lo === 3) {
        items.push(2);
    } else if (lo > 3) {
        items.push(PAGE_GAP);
    }

    for (let page = lo; page <= hi; page += 1) {
        items.push(page);
    }

    // Right side, mirrored against the last page.
    if (hi === pageCount - 2) {
        items.push(pageCount - 1);
    } else if (hi < pageCount - 2) {
        items.push(PAGE_GAP);
    }

    items.push(pageCount);
    return items;
}
