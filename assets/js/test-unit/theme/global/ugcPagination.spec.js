import { pageWindow, PAGE_GAP } from '../../../theme/_addons/global/ugcPagination';

describe('ugcPagination.pageWindow', () => {
    it('lists every page when the count is small enough to fit', () => {
        expect(pageWindow(1, 1)).toEqual([1]);
        expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
        // radius 2 either side of a centered current still reaches both ends.
        expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('windows a large count with both ends anchored and a gap each side', () => {
        expect(pageWindow(9, 200)).toEqual([1, PAGE_GAP, 7, 8, 9, 10, 11, PAGE_GAP, 200]);
    });

    it('omits the leading gap near the start', () => {
        expect(pageWindow(1, 200)).toEqual([1, 2, 3, PAGE_GAP, 200]);
        expect(pageWindow(3, 200)).toEqual([1, 2, 3, 4, 5, PAGE_GAP, 200]);
    });

    it('omits the trailing gap near the end', () => {
        expect(pageWindow(200, 200)).toEqual([1, PAGE_GAP, 198, 199, 200]);
        expect(pageWindow(198, 200)).toEqual([1, PAGE_GAP, 196, 197, 198, 199, 200]);
    });

    it('shows a lone hidden page instead of a one-page gap', () => {
        // Page 2 is the only page between 1 and the window — show it, not '…'.
        expect(pageWindow(5, 200)).toEqual([1, 2, 3, 4, 5, 6, 7, PAGE_GAP, 200]);
        // Mirror on the trailing side: page 199 is the only one hidden.
        expect(pageWindow(196, 200)).toEqual([1, PAGE_GAP, 194, 195, 196, 197, 198, 199, 200]);
    });

    it('clamps an out-of-range current into the page span', () => {
        expect(pageWindow(0, 200)).toEqual(pageWindow(1, 200));
        expect(pageWindow(999, 200)).toEqual(pageWindow(200, 200));
    });

    it('honours a custom radius', () => {
        expect(pageWindow(10, 200, 1)).toEqual([1, PAGE_GAP, 9, 10, 11, PAGE_GAP, 200]);
    });
});
