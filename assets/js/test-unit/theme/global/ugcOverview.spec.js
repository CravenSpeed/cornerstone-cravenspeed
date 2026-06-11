import UgcOverview, {
    FILTERS,
    applyFilter,
    buildStarIcons,
    buildVehicleBadge,
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

    describe('buildVehicleBadge', () => {
        it('renders the system-generated vehicle_label inside the badge', () => {
            const html = buildVehicleBadge('MINI Cooper F56');
            expect(html).toContain('cs-ugc-vehicle-badge');
            expect(html).toContain('MINI Cooper F56');
        });

        it('escapes the label (no XSS via vehicle_label)', () => {
            const html = buildVehicleBadge('<img src=x onerror=alert(1)>');
            expect(html).not.toContain('<img');
            expect(html).toContain('&lt;img');
        });

        it('omits the badge entirely when there is no vehicle (null / empty / missing)', () => {
            expect(buildVehicleBadge(null)).toBe('');
            expect(buildVehicleBadge(undefined)).toBe('');
            expect(buildVehicleBadge('')).toBe('');
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

    it('renders the structured-vehicle badge on a wall card from vehicle_label', async () => {
        const reviews = makeReviews(1);
        reviews[0].vehicle_label = 'MINI Cooper F56';
        api.getOverview.mockResolvedValue(okResult(reviews));
        const overview = mount();
        await overview.init();

        const badge = document.querySelector('.cs-ugc-overview-card .cs-ugc-vehicle-badge');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe('MINI Cooper F56');
    });

    it('omits the badge on a wall card with no vehicle (null / missing label)', async () => {
        const reviews = makeReviews(2);
        reviews[0].vehicle_label = null;
        // reviews[1] has no vehicle_label key at all.
        api.getOverview.mockResolvedValue(okResult(reviews));
        const overview = mount();
        await overview.init();

        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(2);
        expect(document.querySelector('.cs-ugc-vehicle-badge')).toBeNull();
    });
});

describe('UgcOverview review lightbox', () => {
    let api;
    let overview;

    beforeEach(() => {
        document.body.innerHTML = '<div class="cs-ugc-overview" data-ugc-overview></div>';
        api = { getOverview: jest.fn() };
    });

    afterEach(() => {
        if (overview) {
            overview.destroy();
            overview = null;
        }
        document.querySelectorAll('[data-ugc-overview-lightbox]').forEach(el => el.remove());
    });

    const mountInit = async (reviews) => {
        api.getOverview.mockResolvedValue(okResult(reviews));
        overview = new UgcOverview({ api });
        await overview.init();
        return overview;
    };

    it('renders media thumbs as buttons carrying their filtered index', async () => {
        await mountInit(makeReviews(10, { withMediaEvery: 5 }));

        const openers = document.querySelectorAll('[data-ugc-review-open]');
        expect(Array.from(openers).map(b => b.dataset.ugcIndex)).toEqual(['0', '5']);
        expect(document.querySelectorAll('button.cs-ugc-overview-thumb')).toHaveLength(2);
        // No-media thumbs stay non-interactive divs, not openers.
        expect(document.querySelectorAll('div.cs-ugc-overview-thumb.is-empty')).toHaveLength(8);
    });

    it('opens the clicked review and steps through the filtered set, incl. no-photo reviews', async () => {
        await mountInit(makeReviews(10, { withMediaEvery: 5 }));

        document.querySelector('[data-ugc-review-open][data-ugc-index="5"]').click();
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');
        expect(lightbox.hidden).toBe(false);
        expect(lightbox.textContent).toContain('Body 6');

        // Next lands on a review with no photo — still reachable (Decision A).
        lightbox.querySelector('[data-ugc-review-next]').click();
        expect(lightbox.textContent).toContain('Body 7');

        lightbox.querySelector('[data-ugc-review-prev]').click();
        lightbox.querySelector('[data-ugc-review-prev]').click();
        expect(lightbox.textContent).toContain('Body 5');
    });

    it('disables prev at the first review and next at the last', async () => {
        await mountInit(makeReviews(3));

        overview.openLightbox(0);
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');
        const prev = lightbox.querySelector('[data-ugc-review-prev]');
        const next = lightbox.querySelector('[data-ugc-review-next]');
        expect(prev.disabled).toBe(true);
        expect(next.disabled).toBe(false);

        next.click(); // index 1
        next.click(); // index 2 (last)
        expect(next.disabled).toBe(true);
        expect(prev.disabled).toBe(false);
    });

    it('steps only within the active filter', async () => {
        await mountInit(makeReviews(25, { withMediaEvery: 5 }));

        document.querySelector('[data-ugc-filter="photos"]').click();
        // 5 media reviews (ids 1, 6, 11, 16, 21) collapse to filtered indices 0..4.
        document.querySelector('[data-ugc-review-open][data-ugc-index="0"]').click();
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');
        expect(lightbox.textContent).toContain('Body 1');

        lightbox.querySelector('[data-ugc-review-next]').click();
        // The next media review, not the immediately-following no-photo one.
        expect(lightbox.textContent).toContain('Body 6');
    });

    it('closes via the close control and restores focus to the opening thumb', async () => {
        await mountInit(makeReviews(5, { withMediaEvery: 5 }));

        const opener = document.querySelector('[data-ugc-review-open]');
        opener.focus();
        opener.click();
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');
        expect(lightbox.hidden).toBe(false);

        lightbox.querySelector('[data-ugc-lightbox-close]').click();
        expect(lightbox.hidden).toBe(true);
        expect(document.activeElement).toBe(opener);
    });

    it('closes on Escape', async () => {
        await mountInit(makeReviews(5, { withMediaEvery: 5 }));

        document.querySelector('[data-ugc-review-open]').click();
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');
        expect(lightbox.hidden).toBe(false);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(lightbox.hidden).toBe(true);
    });

    it('renders a video review in the lightbox with its poster frame', async () => {
        const reviews = makeReviews(1);
        reviews[0].media = [{ type: 'video', url: 'https://cdn/v.mp4', poster_url: 'https://cdn/p.jpg' }];
        await mountInit(reviews);

        document.querySelector('[data-ugc-review-open]').click();
        const video = document.querySelector('[data-ugc-overview-lightbox] video');
        expect(video.getAttribute('src')).toBe('https://cdn/v.mp4');
        expect(video.getAttribute('poster')).toBe('https://cdn/p.jpg');
    });

    it('navigates across page boundaries using absolute filtered indices', async () => {
        // 15 reviews all carry media → page 1 shows 10, page 2 shows 5.
        await mountInit(makeReviews(15, { withMediaEvery: 1 }));

        document.querySelector('[data-ugc-page="2"]').click();
        // Page-2 thumbs carry absolute indices 10..14.
        document.querySelector('[data-ugc-review-open][data-ugc-index="10"]').click();
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');
        expect(lightbox.textContent).toContain('Body 11');

        lightbox.querySelector('[data-ugc-review-next]').click();
        expect(lightbox.textContent).toContain('Body 12');

        // Stepping back crosses onto page 1's reviews — nav is page-independent.
        lightbox.querySelector('[data-ugc-review-prev]').click();
        lightbox.querySelector('[data-ugc-review-prev]').click();
        expect(lightbox.textContent).toContain('Body 10');
    });
});
