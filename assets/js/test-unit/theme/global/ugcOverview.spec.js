import UgcOverview, {
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

// Fire a delegated 'change' on a toolbar control (the listener lives on the
// container, so the event must bubble).
const fireChange = el => el.dispatchEvent(new Event('change', { bubbles: true }));

describe('ugcOverview pure helpers', () => {
    describe('paginate', () => {
        it('returns the first 12 for page 1', () => {
            const reviews = makeReviews(25);
            expect(paginate(reviews, 1).map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        });

        it('returns the next 12 for page 2', () => {
            const reviews = makeReviews(25);
            expect(paginate(reviews, 2).map(r => r.id)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
        });

        it('returns the remainder on the last page', () => {
            const reviews = makeReviews(25);
            expect(paginate(reviews, 3).map(r => r.id)).toEqual([25]);
        });

        it('returns nothing past the end', () => {
            expect(paginate(makeReviews(5), 2)).toEqual([]);
        });
    });

    describe('pageCount', () => {
        it('ceils to whole pages of 12', () => {
            expect(pageCount(25)).toBe(3);
            expect(pageCount(24)).toBe(2);
            expect(pageCount(1)).toBe(1);
        });

        it('is at least 1 even when empty', () => {
            expect(pageCount(0)).toBe(1);
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

    it('renders the first page of 12 from GET /api/overview', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25)));
        const overview = mount();

        await overview.init();

        expect(api.getOverview).toHaveBeenCalledTimes(1);
        const cards = document.querySelectorAll('.cs-ugc-overview-card');
        expect(cards).toHaveLength(12);
    });

    it('paginates client-side with no further fetches', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25)));
        const overview = mount();
        await overview.init();

        // data-page-key is unambiguous (the numbered "2" button, not the
        // next-arrow which also carries data-ugc-page="2" from page 1).
        document.querySelector('[data-page-key="2"]').click();

        expect(api.getOverview).toHaveBeenCalledTimes(1);
        const current = document.querySelector('.cs-ugc-overview-page.is-current');
        expect(current.textContent).toBe('2');
        expect(current.getAttribute('aria-current')).toBe('page');
        // 25 reviews → pages of 12, 12, 1; page 2 is a full 12.
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(12);
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

    it('renders page controls both above and below the wall', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25)));
        const overview = mount();
        await overview.init();

        const navs = document.querySelectorAll('.cs-ugc-overview-pagination');
        expect(navs).toHaveLength(2);
        expect(document.querySelector('.cs-ugc-overview-pagination--top')).not.toBeNull();
        expect(document.querySelector('.cs-ugc-overview-pagination--bottom')).not.toBeNull();
        // Distinct landmark names (axe landmark-unique).
        const labels = Array.from(navs).map(n => n.getAttribute('aria-label'));
        expect(new Set(labels).size).toBe(2);
    });

    it('renders the sort/filter toolbar but no "write a review" submit button', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(5)));
        const overview = mount();
        await overview.init();

        expect(document.querySelector('.cs-reviews-toolbar')).not.toBeNull();
        expect(document.querySelector('[data-ugc-control="sort"]')).not.toBeNull();
        expect(document.querySelector('[data-ugc-control="rating"]')).not.toBeNull();
        expect(document.querySelector('[data-ugc-control="verified"]')).not.toBeNull();
        expect(document.querySelector('[data-ugc-control="media"]')).not.toBeNull();
        // No single archetype to submit to from home, so no submit opener.
        expect(document.querySelector('[data-review-modal-open]')).toBeNull();
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

        const img = document.querySelector('.cs-ugc-overview-media img');
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

    it('renders the numeric score, verified badge, flag, date, and edited marker', async () => {
        const reviews = makeReviews(1);
        Object.assign(reviews[0], {
            rating: 4,
            verified_purchaser: true,
            country: 'DE',
            date: '2026-06-09T15:00:00',
            edited: true,
        });
        api.getOverview.mockResolvedValue(okResult(reviews));
        const overview = mount();
        await overview.init();

        const card = document.querySelector('.cs-ugc-overview-card');
        expect(card.querySelector('.cs-review-score').textContent).toBe('4');
        expect(card.querySelector('.cs-review-verified')).not.toBeNull();
        const flag = card.querySelector('.cs-review-flag');
        expect(flag.getAttribute('src')).toBe('https://flagcdn.com/de.svg');
        expect(card.querySelector('.cs-review-date').textContent).toBe('06/09/2026');
        expect(card.querySelector('.cs-review-edited')).not.toBeNull();
    });

    it('omits the verified/flag/edited markers when the data is absent or invalid', async () => {
        const reviews = makeReviews(1);
        Object.assign(reviews[0], {
            verified_purchaser: false,
            country: 'XYZ',
            edited: false,
        });
        api.getOverview.mockResolvedValue(okResult(reviews));
        const overview = mount();
        await overview.init();

        const card = document.querySelector('.cs-ugc-overview-card');
        expect(card.querySelector('.cs-review-verified')).toBeNull();
        expect(card.querySelector('.cs-review-flag')).toBeNull();
        expect(card.querySelector('.cs-review-edited')).toBeNull();
    });

    it('smoothly scrolls the wall into view on a page change', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25)));
        const overview = mount();
        await overview.init();
        const container = document.querySelector('[data-ugc-overview]');
        container.scrollIntoView = jest.fn();

        document.querySelector('[data-page-key="2"]').click();

        expect(container.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    it('does not scroll when the clicked page is already current', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25)));
        const overview = mount();
        await overview.init();
        const container = document.querySelector('[data-ugc-overview]');
        container.scrollIntoView = jest.fn();

        document.querySelector('[data-page-key="1"]').click();

        expect(container.scrollIntoView).not.toHaveBeenCalled();
    });
});

describe('UgcOverview toolbar (client-side sort & filters)', () => {
    let api;

    beforeEach(() => {
        document.body.innerHTML = '<div class="cs-ugc-overview" data-ugc-overview></div>';
        api = { getOverview: jest.fn() };
    });

    const mount = () => new UgcOverview({ api });
    const titles = () => Array.from(document.querySelectorAll('.cs-ugc-overview-title')).map(t => t.textContent);
    const cardCount = () => document.querySelectorAll('.cs-ugc-overview-card').length;

    it('sorts the wall by the selected order without refetching', async () => {
        const reviews = makeReviews(3);
        Object.assign(reviews[0], { date: '2026-01-01', rating: 3 }); // Title 1
        Object.assign(reviews[1], { date: '2026-03-01', rating: 5 }); // Title 2
        Object.assign(reviews[2], { date: '2026-02-01', rating: 1 }); // Title 3
        api.getOverview.mockResolvedValue(okResult(reviews));
        const overview = mount();
        await overview.init();

        // Default: newest first.
        expect(titles()).toEqual(['Title 2', 'Title 3', 'Title 1']);

        const sort = document.querySelector('[data-ugc-control="sort"]');
        sort.value = 'date_asc';
        fireChange(sort);
        expect(titles()).toEqual(['Title 1', 'Title 3', 'Title 2']);

        sort.value = 'rating_desc';
        fireChange(sort);
        expect(titles()).toEqual(['Title 2', 'Title 1', 'Title 3']);

        sort.value = 'rating_asc';
        fireChange(sort);
        expect(titles()).toEqual(['Title 3', 'Title 1', 'Title 2']);

        // All client-side: the feed was fetched exactly once.
        expect(api.getOverview).toHaveBeenCalledTimes(1);
    });

    it('filters the wall by the selected rating, and clears back to all', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(4, { ratingCycle: [5, 4, 5, 3] })));
        const overview = mount();
        await overview.init();
        expect(cardCount()).toBe(4);

        const rating = document.querySelector('[data-ugc-control="rating"]');
        rating.value = '5';
        fireChange(rating);
        expect(cardCount()).toBe(2);

        rating.value = '';
        fireChange(rating);
        expect(cardCount()).toBe(4);
    });

    it('filters the wall to verified purchasers', async () => {
        const reviews = makeReviews(3);
        reviews[0].verified_purchaser = true;
        reviews[1].verified_purchaser = false;
        reviews[2].verified_purchaser = true;
        api.getOverview.mockResolvedValue(okResult(reviews));
        const overview = mount();
        await overview.init();

        const verified = document.querySelector('[data-ugc-control="verified"]');
        verified.checked = true;
        fireChange(verified);
        expect(cardCount()).toBe(2);

        verified.checked = false;
        fireChange(verified);
        expect(cardCount()).toBe(3);
    });

    it('filters the wall to reviews with photos & videos', async () => {
        // withMediaEvery 2 → indices 0 and 2 carry media → 2 of 4.
        api.getOverview.mockResolvedValue(okResult(makeReviews(4, { withMediaEvery: 2 })));
        const overview = mount();
        await overview.init();

        const media = document.querySelector('[data-ugc-control="media"]');
        media.checked = true;
        fireChange(media);
        expect(cardCount()).toBe(2);
    });

    it('composes rating + verified filters together', async () => {
        const reviews = makeReviews(4, { ratingCycle: [5, 5, 4, 5] });
        reviews[0].verified_purchaser = true; // 5, verified ✓
        reviews[1].verified_purchaser = false; // 5, unverified ✗
        reviews[2].verified_purchaser = true; // 4 ✗ (rating)
        reviews[3].verified_purchaser = true; // 5, verified ✓
        api.getOverview.mockResolvedValue(okResult(reviews));
        const overview = mount();
        await overview.init();

        document.querySelector('[data-ugc-control="rating"]').value = '5';
        fireChange(document.querySelector('[data-ugc-control="rating"]'));
        document.querySelector('[data-ugc-control="verified"]').checked = true;
        fireChange(document.querySelector('[data-ugc-control="verified"]'));

        expect(cardCount()).toBe(2);
    });

    it('resets to page 1 on any sort or filter change', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(25)));
        const overview = mount();
        await overview.init();

        document.querySelector('[data-page-key="2"]').click();
        expect(document.querySelector('.cs-ugc-overview-page.is-current').textContent).toBe('2');

        const sort = document.querySelector('[data-ugc-control="sort"]');
        sort.value = 'date_asc';
        fireChange(sort);
        expect(document.querySelector('.cs-ugc-overview-page.is-current').textContent).toBe('1');
    });

    it('reflects the current sort/filter state in the toolbar after a full repaint', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(5)));
        const overview = mount();
        await overview.init();

        overview.sort = 'rating_asc';
        overview.rating = 4;
        overview.verified = true;
        overview.media = true;
        overview.render();

        expect(document.querySelector('[data-ugc-control="sort"]').value).toBe('rating_asc');
        expect(document.querySelector('[data-ugc-control="rating"]').value).toBe('4');
        expect(document.querySelector('[data-ugc-control="verified"]').checked).toBe(true);
        expect(document.querySelector('[data-ugc-control="media"]').checked).toBe(true);
    });

    it('shows the empty message but keeps the toolbar when filters exclude every review', async () => {
        api.getOverview.mockResolvedValue(okResult(makeReviews(3, { ratingCycle: [5] })));
        const overview = mount();
        await overview.init();

        const rating = document.querySelector('[data-ugc-control="rating"]');
        rating.value = '1';
        fireChange(rating);

        expect(cardCount()).toBe(0);
        expect(document.querySelector('.cs-ugc-overview-empty')).not.toBeNull();
        // The toolbar stays so the visitor can relax the filter.
        expect(document.querySelector('.cs-reviews-toolbar')).not.toBeNull();
    });

    it('does not mutate the source feed when sorting', async () => {
        const reviews = makeReviews(3);
        Object.assign(reviews[0], { date: '2026-01-01' });
        Object.assign(reviews[1], { date: '2026-03-01' });
        Object.assign(reviews[2], { date: '2026-02-01' });
        api.getOverview.mockResolvedValue(okResult(reviews));
        const overview = mount();
        await overview.init();

        const sort = document.querySelector('[data-ugc-control="sort"]');
        sort.value = 'date_asc';
        fireChange(sort);

        // The in-memory feed is still in fetch order (ids 1, 2, 3).
        expect(overview.reviews.map(r => r.id)).toEqual([1, 2, 3]);
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

    it('makes every card openable and shows a photo only on media reviews', async () => {
        await mountInit(makeReviews(10, { withMediaEvery: 5 }));

        // The whole-card opener carries each card's absolute filtered index, so
        // no-photo reviews open too — not just the two with a photo.
        const openers = document.querySelectorAll('.cs-ugc-overview-open[data-ugc-review-open]');
        expect(Array.from(openers).map(b => b.dataset.ugcIndex))
            .toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
        // Photo blocks only on the media reviews; no empty placeholder slots.
        expect(document.querySelectorAll('.cs-ugc-overview-media')).toHaveLength(2);
        expect(document.querySelectorAll('.cs-ugc-overview-thumb')).toHaveLength(0);
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

    it('renders no thumbnail strip for a single-media review', async () => {
        await mountInit(makeReviews(1, { withMediaEvery: 1 }));

        document.querySelector('[data-ugc-review-open]').click();
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');
        expect(lightbox.querySelector('.cs-ugc-overview-lightbox-hero')).not.toBeNull();
        expect(lightbox.querySelector('[data-ugc-media-thumb]')).toBeNull();
    });

    it('shows one hero plus a thumbnail strip for a multi-media review, swapping the hero on click', async () => {
        const reviews = makeReviews(1);
        reviews[0].media = [
            { type: 'photo', thumb_url: 'https://cdn/0t.jpg', medium_url: 'https://cdn/0m.jpg' },
            { type: 'photo', thumb_url: 'https://cdn/1t.jpg', medium_url: 'https://cdn/1m.jpg' },
            { type: 'video', url: 'https://cdn/2v.mp4', poster_url: 'https://cdn/2p.jpg', thumb_url: 'https://cdn/2t.jpg' },
        ];
        await mountInit(reviews);

        document.querySelector('[data-ugc-review-open]').click();
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');

        // One hero (the first item), and a 3-thumb strip with the first active.
        expect(lightbox.querySelector('.cs-ugc-overview-lightbox-hero img').getAttribute('src')).toBe('https://cdn/0m.jpg');
        const thumbs = lightbox.querySelectorAll('[data-ugc-media-thumb]');
        expect(thumbs).toHaveLength(3);
        expect(thumbs[0].classList.contains('is-active')).toBe(true);

        // Click the 2nd thumb → hero swaps and the active marker moves.
        thumbs[1].click();
        expect(lightbox.querySelector('.cs-ugc-overview-lightbox-hero img').getAttribute('src')).toBe('https://cdn/1m.jpg');
        expect(lightbox.querySelectorAll('[data-ugc-media-thumb]')[1].classList.contains('is-active')).toBe(true);

        // Click the video thumb → hero becomes a <video> with its poster.
        lightbox.querySelectorAll('[data-ugc-media-thumb]')[2].click();
        const video = lightbox.querySelector('.cs-ugc-overview-lightbox-hero video');
        expect(video.getAttribute('src')).toBe('https://cdn/2v.mp4');
        expect(video.getAttribute('poster')).toBe('https://cdn/2p.jpg');
    });

    it('resets to the first media when navigating to another review', async () => {
        const reviews = makeReviews(2);
        reviews[0].media = [
            { type: 'photo', thumb_url: 'https://cdn/a0t.jpg', medium_url: 'https://cdn/a0m.jpg' },
            { type: 'photo', thumb_url: 'https://cdn/a1t.jpg', medium_url: 'https://cdn/a1m.jpg' },
        ];
        reviews[1].media = [{ type: 'photo', thumb_url: 'https://cdn/b0t.jpg', medium_url: 'https://cdn/b0m.jpg' }];
        await mountInit(reviews);

        overview.openLightbox(0);
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');

        // Switch to review 0's second photo, then step to review 1.
        lightbox.querySelectorAll('[data-ugc-media-thumb]')[1].click();
        expect(lightbox.querySelector('.cs-ugc-overview-lightbox-hero img').getAttribute('src')).toBe('https://cdn/a1m.jpg');

        lightbox.querySelector('[data-ugc-review-next]').click();
        expect(lightbox.querySelector('.cs-ugc-overview-lightbox-hero img').getAttribute('src')).toBe('https://cdn/b0m.jpg');
    });

    it('navigates across page boundaries using absolute filtered indices', async () => {
        // 18 reviews all carry media → page 1 shows 12, page 2 shows 6.
        await mountInit(makeReviews(18, { withMediaEvery: 1 }));

        document.querySelector('[data-ugc-page="2"]').click();
        // Page-2 openers carry absolute indices 12..17.
        document.querySelector('[data-ugc-review-open][data-ugc-index="12"]').click();
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');
        expect(lightbox.textContent).toContain('Body 13');

        lightbox.querySelector('[data-ugc-review-next]').click();
        expect(lightbox.textContent).toContain('Body 14');

        // Stepping back crosses onto page 1's reviews — nav is page-independent.
        lightbox.querySelector('[data-ugc-review-prev]').click();
        lightbox.querySelector('[data-ugc-review-prev]').click();
        expect(lightbox.textContent).toContain('Body 12');
    });
});

describe('UgcOverview vehicle filter', () => {
    let api;
    let overview;

    // Minimal search registry: MINI Cooper F56 → fitment_id 87.
    const REGISTRY = {
        brands: { MINI: { name: 'MINI' } },
        models: {
            Cooper: { name: 'Cooper', generations: { F56: { name: 'F56 2014 to 2024', fitment_id: 87 } } },
        },
    };
    const GARAGE = { make: 'MINI', model: 'Cooper', generation: 'F56' };

    // A GlobalStateManager stand-in whose vehicle can change and notify.
    const makeGlobal = (vehicle, registry) => {
        const store = { vehicle, registry };
        let cb = null;
        const getState = () => ({
            vehicle: { selected: store.vehicle },
            search: { data: store.registry ? { vehicle_registry: store.registry } : null },
        });
        return {
            getState,
            subscribe: (fn) => { cb = fn; return () => { cb = null; }; },
            setVehicle: (v) => { store.vehicle = v; if (cb) cb(getState()); },
        };
    };

    // 4 reviews; ids 1 and 3 fit fitment_id 87, ids 2 and 4 do not.
    const reviewsWithFitment = () => {
        const reviews = makeReviews(4);
        reviews[0].fitment_id = 87;
        reviews[1].fitment_id = 12;
        reviews[2].fitment_id = 87;
        reviews[3].fitment_id = null;
        return reviews;
    };

    const mountWith = async (vehicle, registry, reviews) => {
        api.getOverview.mockResolvedValue(okResult(reviews));
        const globalStateManager = makeGlobal(vehicle, registry);
        overview = new UgcOverview({ api, globalStateManager });
        await overview.init();
        return globalStateManager;
    };

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

    it('renders a "For your <vehicle>" chip (no count) inside the toolbar slot when the garage vehicle matches loaded reviews', async () => {
        await mountWith(GARAGE, REGISTRY, reviewsWithFitment());

        // The chip now lives in the toolbar's reserved slot, made visible only
        // once populated (the product page's CLS pattern).
        const slot = document.querySelector('.cs-fitment-chip-slot[data-ugc-fitment-chip]');
        expect(slot).not.toBeNull();
        expect(slot.style.visibility).toBe('visible');

        const chip = document.querySelector('[data-ugc-fitment-toggle]');
        expect(chip).not.toBeNull();
        expect(slot.contains(chip)).toBe(true);
        expect(chip.textContent).toContain('For your MINI Cooper');
        expect(document.querySelector('.cs-fitment-chip-count')).toBeNull();
    });

    it('shows the "select your vehicle" prompt when no garage vehicle is resolved', async () => {
        await mountWith(null, REGISTRY, reviewsWithFitment());

        expect(document.querySelector('[data-ugc-fitment-prompt]')).not.toBeNull();
        expect(document.querySelector('[data-ugc-fitment-toggle]')).toBeNull();
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(4);
    });

    it('scrolls to the vehicle selector when the prompt is clicked', async () => {
        document.body.insertAdjacentHTML(
            'beforeend',
            '<select data-car-selection-field="make"></select>',
        );
        const make = document.querySelector('[data-car-selection-field="make"]');
        make.scrollIntoView = jest.fn();
        make.focus = jest.fn();
        await mountWith(null, REGISTRY, reviewsWithFitment());

        document.querySelector('[data-ugc-fitment-prompt]').click();

        expect(make.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
        expect(make.focus).toHaveBeenCalled();
    });

    it('leaves the chip slot empty and hidden without a GlobalStateManager', async () => {
        api.getOverview.mockResolvedValue(okResult(reviewsWithFitment()));
        overview = new UgcOverview({ api });
        await overview.init();

        // The toolbar (and its slot) still render, but the vehicle filter is
        // inert: the slot stays empty and its reserved space hidden.
        const slot = document.querySelector('[data-ugc-fitment-chip]');
        expect(slot).not.toBeNull();
        expect(slot.innerHTML).toBe('');
        expect(slot.style.visibility).toBe('hidden');
        expect(document.querySelector('[data-ugc-fitment-toggle]')).toBeNull();
        expect(document.querySelector('[data-ugc-fitment-prompt]')).toBeNull();
    });

    it('toggles the wall to matching reviews and clears back to all', async () => {
        await mountWith(GARAGE, REGISTRY, reviewsWithFitment());
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(4);

        document.querySelector('[data-ugc-fitment-toggle]').click();
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(2);
        expect(document.querySelector('[data-ugc-fitment-toggle]').getAttribute('aria-pressed')).toBe('true');

        document.querySelector('[data-ugc-fitment-clear]').click();
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(4);
    });

    it('explains the absent filter when the vehicle resolves but no loaded review matches', async () => {
        const reviews = makeReviews(3).map(review => ({ ...review, fitment_id: 999 }));
        await mountWith(GARAGE, REGISTRY, reviews);

        expect(document.querySelector('[data-ugc-fitment-toggle]')).toBeNull();
        expect(document.querySelector('.cs-fitment-empty').textContent)
            .toContain('No reviews yet for your MINI Cooper');
    });

    it('re-resolves and drops the active filter when the garage vehicle changes', async () => {
        const globalStateManager = await mountWith(GARAGE, REGISTRY, reviewsWithFitment());
        document.querySelector('[data-ugc-fitment-toggle]').click();
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(2);

        // Swap to a vehicle absent from the registry → unresolved → prompt
        // returns and the filter is dropped.
        globalStateManager.setVehicle({ make: 'AUDI', model: 'A3', generation: '8V' });
        expect(document.querySelector('[data-ugc-fitment-prompt]')).not.toBeNull();
        expect(document.querySelector('[data-ugc-fitment-toggle]')).toBeNull();
        expect(document.querySelectorAll('.cs-ugc-overview-card')).toHaveLength(4);
    });

    it('steps the lightbox only through the filtered subset when the filter is active', async () => {
        await mountWith(GARAGE, REGISTRY, reviewsWithFitment());
        document.querySelector('[data-ugc-fitment-toggle]').click();

        // Subset in display order: id 1 (index 0), id 3 (index 1).
        document.querySelector('[data-ugc-review-open][data-ugc-index="0"]').click();
        const lightbox = document.querySelector('[data-ugc-overview-lightbox]');
        expect(lightbox.textContent).toContain('Body 1');

        lightbox.querySelector('[data-ugc-review-next]').click();
        expect(lightbox.textContent).toContain('Body 3'); // skips non-matching id 2
        expect(lightbox.querySelector('[data-ugc-review-next]').disabled).toBe(true);
    });
});
