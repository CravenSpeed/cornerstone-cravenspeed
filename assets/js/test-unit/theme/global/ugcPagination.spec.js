import {
    pageWindow,
    PAGE_GAP,
    PAGE_GAP_HTML,
    pageButton,
    renderPaginationNav,
} from '../../../theme/_addons/global/ugcPagination';

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

describe('ugcPagination.pageButton', () => {
    it('wires the class, data attribute, key, and label', () => {
        const html = pageButton({
            key: 3,
            page: 3,
            label: '3',
            pageClass: 'cs-reviews-page',
            dataAttr: 'data-reviews-page',
        });
        expect(html).toBe('<button type="button" class="cs-reviews-page" data-reviews-page="3" data-page-key="3">3</button>');
    });

    it('adds is-current and aria-current for the current page', () => {
        const html = pageButton({
            key: 2,
            page: 2,
            label: '2',
            isCurrent: true,
            pageClass: 'cs-questions-page',
            dataAttr: 'data-questions-page',
        });
        expect(html).toBe('<button type="button" class="cs-questions-page is-current" data-questions-page="2" data-page-key="2" aria-current="page">2</button>');
    });

    it('renders the disabled attribute when disabled', () => {
        const html = pageButton({
            key: 'prev',
            page: 0,
            label: 'Previous',
            disabled: true,
            pageClass: 'cs-ugc-overview-page',
            dataAttr: 'data-ugc-page',
        });
        expect(html).toBe('<button type="button" class="cs-ugc-overview-page" data-ugc-page="0" data-page-key="prev" disabled>Previous</button>');
    });
});

describe('ugcPagination.renderPaginationNav', () => {
    it('renders nothing when a single page covers everything', () => {
        expect(renderPaginationNav({
            current: 1,
            pageCount: 1,
            pageClass: 'cs-reviews-page',
            dataAttr: 'data-reviews-page',
            navClass: 'cs-reviews-pages',
            ariaLabel: 'Reviews pagination, top of list',
        })).toBe('');
    });

    it('emits prev, windowed numbers with gaps, and next inside the nav', () => {
        const html = renderPaginationNav({
            current: 9,
            pageCount: 200,
            pageClass: 'cs-reviews-page',
            dataAttr: 'data-reviews-page',
            navClass: 'cs-reviews-pages',
            ariaLabel: 'Reviews pagination, bottom of list',
        });

        const container = document.createElement('div');
        container.innerHTML = html;
        const nav = container.firstElementChild;

        expect(nav.tagName).toBe('NAV');
        expect(nav.className).toBe('cs-reviews-pages');
        expect(nav.getAttribute('aria-label')).toBe('Reviews pagination, bottom of list');

        const buttons = Array.from(nav.querySelectorAll('button')).map(b => b.textContent);
        // prev + windowed numbers (gaps are non-button spans) + next.
        expect(buttons).toEqual(['Previous', '1', '7', '8', '9', '10', '11', '200', 'Next']);

        // Two collapsed runs render as the shared ellipsis stand-in.
        expect(nav.innerHTML).toContain(PAGE_GAP_HTML);
        expect(nav.querySelectorAll('.cs-ugc-page-gap').length).toBe(2);

        // Current page carries the marker; the boundary buttons are disabled at
        // the right edges only when appropriate (here neither).
        expect(nav.querySelector('.is-current').textContent).toBe('9');
        expect(nav.querySelector('[data-page-key="prev"]').disabled).toBe(false);
    });

    it('disables prev on the first page and next on the last', () => {
        const first = renderPaginationNav({
            current: 1,
            pageCount: 5,
            pageClass: 'cs-questions-page',
            dataAttr: 'data-questions-page',
            navClass: 'cs-questions-pages',
            ariaLabel: 'Questions pagination, top of list',
        });
        const container = document.createElement('div');
        container.innerHTML = first;
        expect(container.querySelector('[data-page-key="prev"]').disabled).toBe(true);
        expect(container.querySelector('[data-page-key="next"]').disabled).toBe(false);
    });
});
