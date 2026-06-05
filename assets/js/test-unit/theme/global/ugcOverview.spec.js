import UgcOverview, {
    FILTERS,
    applyFilter,
    buildStarIcons,
    paginate,
    pageCount,
} from '../../../theme/_addons/global/ugcOverview';

// Build N reviews; every Mth one carries a photo so media filters have signal.
const makeReviews = (count, { withMediaEvery = 0, ratingCycle = [5] } = {}) => (
    Array.from({ length: count }, (_, i) => {
        const review = {
            id: i + 1,
            author: `Author ${i + 1}`,
            title: `Title ${i + 1}`,
            body: `Body ${i + 1}`,
            rating: ratingCycle[i % ratingCycle.length],
            archetype_name: 'the-stubby-antenna',
            archetype_url: '/stubby-antenna/',
            media: [],
        };
        if (withMediaEvery && (i % withMediaEvery === 0)) {
            review.media = [{ type: 'photo', thumb_url: `https://cdn/${i}/thumb.jpg` }];
        }
        return review;
    })
);

const okResult = reviews => ({ ok: true, status: 200, data: { reviews } });

describe('ugcOverview pure helpers', () => {
    describe('paginate', () => {
        it('returns the first 10 for page 1', () => {
            const reviews = makeReviews(25);
            expect(paginate(reviews, 1).map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        });

        it('returns the next 10 for page 2', () => {
            const reviews = makeReviews(25);
            expect(paginate(reviews, 2).map(r => r.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
        });

        it('returns the remainder on the last page', () => {
            const reviews = makeReviews(25);
            expect(paginate(reviews, 3).map(r => r.id)).toEqual([21, 22, 23, 24, 25]);
        });

        it('returns nothing past the end', () => {
            expect(paginate(makeReviews(5), 2)).toEqual([]);
        });
    });

    describe('pageCount', () => {
        it('ceils to whole pages of 10', () => {
            expect(pageCount(25)).toBe(3);
            expect(pageCount(20)).toBe(2);
            expect(pageCount(1)).toBe(1);
        });

        it('is at least 1 even when empty', () => {
            expect(pageCount(0)).toBe(1);
        });
    });

    describe('applyFilter', () => {
        it('returns everything for ALL', () => {
            const reviews = makeReviews(6, { withMediaEvery: 2 });
            expect(applyFilter(reviews, FILTERS.ALL)).toHaveLength(6);
        });

        it('keeps only reviews with media for WITH_PHOTOS', () => {
            const reviews = makeReviews(6, { withMediaEvery: 2 });
            const filtered = applyFilter(reviews, FILTERS.WITH_PHOTOS);
            expect(filtered).toHaveLength(3);
            expect(filtered.every(r => r.media.length > 0)).toBe(true);
        });

        it('keeps only reviews without media for BASIC', () => {
            const reviews = makeReviews(6, { withMediaEvery: 2 });
            const filtered = applyFilter(reviews, FILTERS.BASIC);
            expect(filtered).toHaveLength(3);
            expect(filtered.every(r => r.media.length === 0)).toBe(true);
        });

        it('filters by exact star rating for RATING', () => {
            const reviews = makeReviews(6, { ratingCycle: [5, 4] });
            expect(applyFilter(reviews, FILTERS.RATING, 5)).toHaveLength(3);
            expect(applyFilter(reviews, FILTERS.RATING, 4)).toHaveLength(3);
        });

        it('ignores a null rating value and returns everything', () => {
            const reviews = makeReviews(6, { ratingCycle: [5, 4] });
            expect(applyFilter(reviews, FILTERS.RATING, null)).toHaveLength(6);
        });

        it('treats a non-array media field as no-media', () => {
            const reviews = [{ rating: 5 }, { rating: 5, media: null }];
            expect(applyFilter(reviews, FILTERS.WITH_PHOTOS)).toHaveLength(0);
            expect(applyFilter(reviews, FILTERS.BASIC)).toHaveLength(2);
        });
    });

    describe('buildStarIcons', () => {
        const countOf = (html, needle) => html.split(needle).length - 1;

        it('renders five sprite stars split by rating', () => {
            const html = buildStarIcons(3);
            expect(countOf(html, '#icon-star')).toBe(5);
            expect(countOf(html, 'icon--ratingFull')).toBe(3);
            expect(countOf(html, 'icon--ratingEmpty')).toBe(2);
        });

        it('renders all empty stars for a zero rating', () => {
            const html = buildStarIcons(0);
            expect(countOf(html, 'icon--ratingFull')).toBe(0);
            expect(countOf(html, 'icon--ratingEmpty')).toBe(5);
        });
    });
});

describe('UgcOverview controller', () => {
    let api;

    beforeEach(() => {
        document.body.innerHTML = '<div class="cs-ugc-overview" data-ugc-overview></div>';
        api = { getOverview: jest.fn() };
    });

    const mount = () => new UgcOverview({ api });

    it('renders the first page of 10 from GET /api/overview', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25)));
        const overview = mount();

        await overview.init();

        expect(api.getOverview).toHaveBeenCalledTimes(1);
        const cards = document.querySelectorAll('.cs-ugc-overview-card');
        expect(cards).toHaveLength(10);
    });

    it('paginates client-side with no further fetches', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25)));
        const overview = mount();
        await overview.init();

        document.querySelector('[data-ugc-page="2"]').click();

        expect(api.getOverview).toHaveBeenCalledTimes(1);
        const status = document.querySelector('.cs-ugc-overview-page-status');
        expect(status.textContent).toMatch(/Page 2 of 3/);
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(10);
    });

    it('clamps pagination within range', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25)));
        const overview = mount();
        await overview.init();

        // Jump to last page, then attempt to overshoot.
        overview.page = 3;
        overview.render();
        const next = document.querySelector('[data-ugc-page="4"]');
        expect(next.hasAttribute('disabled')).toBe(true);
    });

    it('filters client-side with no further fetches and resets to page 1', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25, { withMediaEvery: 5 })));
        const overview = mount();
        await overview.init();

        document.querySelector('[data-ugc-page="2"]').click();
        document.querySelector('[data-ugc-filter="photos"]').click();

        expect(api.getOverview).toHaveBeenCalledTimes(1);
        // 5 of 25 carry media; all fit on one page.
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(5);
        expect(document.querySelector('.cs-ugc-overview-pagination')).toBeNull();
    });

    it('filters by rating when a star button is clicked', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(20, { ratingCycle: [5, 4, 3, 2] })));
        const overview = mount();
        await overview.init();

        document.querySelector('[data-ugc-filter="rating"][data-ugc-rating="5"]').click();

        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(5);
    });

    it('renders the empty state when the feed has no reviews', async () => {
        api.getOverview.mockResolvedValue(okResult([]));
        const overview = mount();

        await overview.init();

        expect(document.querySelector('.cs-ugc-overview-empty')).not.toBeNull();
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(0);
    });

    it('renders the empty state (never a broken wall) when the API call is not ok', async () => {
        api.getOverview.mockResolvedValue({ ok: false, status: 0, message: 'Something went wrong.' });
        const overview = mount();

        await overview.init();

        expect(document.querySelector('.cs-ugc-overview-empty')).not.toBeNull();
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(0);
    });

    it('no-ops without throwing when the mount point is absent', async () => {
        document.body.innerHTML = '';
        api.getOverview.mockResolvedValue(okResult(makeReviews(5)));
        const overview = mount();

        await expect(overview.init()).resolves.toBeUndefined();
        expect(api.getOverview).not.toHaveBeenCalled();
    });

    it('renders sprite stars on cards matching the product-page markup', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(1, { ratingCycle: [4] })));
        const overview = mount();
        await overview.init();

        const stars = document.querySelector('.cs-ugc-overview-stars');
        expect(stars.getAttribute('role')).toBe('img');
        expect(stars.getAttribute('aria-label')).toBe('4 out of 5 stars');
        expect(stars.querySelectorAll('use[href="#icon-star"]')).toHaveLength(5);
        expect(stars.querySelectorAll('.icon--ratingFull')).toHaveLength(4);
        expect(stars.querySelectorAll('.icon--ratingEmpty')).toHaveLength(1);
    });

    it('uses the first media thumb_url for the card image', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(1, { withMediaEvery: 1 })));
        const overview = mount();
        await overview.init();

        const img = document.querySelector('.cs-ugc-overview-thumb img');
        expect(img.getAttribute('src')).toBe('https://cdn/0/thumb.jpg');
    });
});
