import UgcProduct from '../../../theme/_addons/product/ui/ugcProduct';

const ARCHETYPE_ID = 12;

const buildEnvelope = (overrides = {}) => ({
    items: [],
    total: 0,
    page: 1,
    per_page: 10,
    archetype_rating_average: 4.67,
    archetype_review_count: 36,
    ...overrides,
});

const buildStateManager = () => {
    const subscribers = new Set();
    return {
        subscribe: jest.fn((cb) => {
            subscribers.add(cb);
            return () => subscribers.delete(cb);
        }),
        getState: jest.fn(() => ({})),
        _emit(state) {
            subscribers.forEach(cb => cb(state));
        },
    };
};

// Minimal GlobalStateManager stub: holds a vehicle.selected + a search registry
// and lets a test emit a new global snapshot. Mirrors the live search-JSON shape
// resolveGarageFitment reads: a `brands` map keyed by make slug, a `models` map
// keyed by model slug, and object generation nodes `{ name, fitment_id }`
// (SRS §3.1.4 Pass 27). The chip names the garage vehicle by make + model
// ("MINI Cooper"), composed from the brand/model display names.
const F56_REGISTRY = {
    brands: {
        mini: { name: 'MINI', models: ['cooper'] },
    },
    models: {
        cooper: {
            name: 'Cooper',
            generations: {
                f56: { name: 'F56 2014 to 2024', fitment_id: 87 },
                r53: { name: 'R53 2002 to 2006', fitment_id: 42 },
            },
        },
    },
};

const F56_GARAGE = { make: 'mini', model: 'cooper', generation: 'f56' };

const buildGlobalStateManager = (initial = {}) => {
    const subscribers = new Set();
    let state = {
        vehicle: { selected: initial.vehicle || null },
        search: { data: initial.registry ? { vehicle_registry: initial.registry } : null },
    };
    return {
        getState: jest.fn(() => state),
        subscribe: jest.fn((cb) => {
            subscribers.add(cb);
            return () => subscribers.delete(cb);
        }),
        _set(next) {
            state = next;
            subscribers.forEach(cb => cb(state));
        },
    };
};

const buildApi = result => ({
    getReviews: jest.fn(() => Promise.resolve(result)),
});

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const mountScaffold = () => {
    document.body.innerHTML = `
        <a id="product-rating" data-product-rating></a>
        <div class="cs-reviews-toolbar" data-reviews-toolbar>
            <select data-reviews-control="sort">
                <option value="date_desc">Newest</option>
                <option value="date_asc">Oldest</option>
                <option value="rating_desc">Highest</option>
                <option value="rating_asc">Lowest</option>
            </select>
            <select data-reviews-control="rating">
                <option value="">All</option>
                <option value="5">5</option>
                <option value="4">4</option>
            </select>
            <input type="checkbox" data-reviews-control="verified">
            <input type="checkbox" data-reviews-control="media">
            <div class="cs-fitment-chip-slot" data-reviews-fitment-chip></div>
        </div>
        <div class="cs-reviews-pagination cs-reviews-pagination--top" data-reviews-pagination></div>
        <div id="product-reviews"></div>
        <div class="cs-reviews-pagination cs-reviews-pagination--bottom" data-reviews-pagination></div>
    `;
};

// Drive a toolbar control and dispatch the change event the component listens for.
const changeSelect = (control, value) => {
    const el = document.querySelector(`[data-reviews-control="${control}"]`);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
};

const toggleCheckbox = (control, checked) => {
    const el = document.querySelector(`[data-reviews-control="${control}"]`);
    el.checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
};

// Build an api whose getReviews returns a queued sequence of results (one per
// call), so each refetch can assert against a distinct envelope.
const buildSequencedApi = (results) => {
    let call = 0;
    return {
        getReviews: jest.fn(() => {
            const result = results[Math.min(call, results.length - 1)];
            call += 1;
            return Promise.resolve(result);
        }),
    };
};

const okEnvelope = overrides => ({ ok: true, status: 200, data: buildEnvelope(overrides) });

describe('UgcProduct (slice 6a)', () => {
    beforeEach(() => {
        mountScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('requests page 1 with the default sort and no active filters on init', async () => {
        const api = buildApi({ ok: true, status: 200, data: buildEnvelope() });
        const stateManager = buildStateManager();

        // eslint-disable-next-line no-new
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        // verified/media are null (omitted by buildQuery) until toggled on; rating
        // is null until selected; sort defaults to date_desc (SRS §3.2.1).
        // fitment_id is null with no garage; fitment_only stays null (off).
        expect(api.getReviews).toHaveBeenCalledWith(ARCHETYPE_ID, {
            page: 1,
            sort: 'date_desc',
            rating: null,
            verified: null,
            media: null,
            fitment_id: null,
            fitment_only: null,
        });
    });

    it('renders the rating summary from the envelope aggregates (overrides stale JSON)', async () => {
        const api = buildApi({
            ok: true,
            status: 200,
            data: buildEnvelope({ archetype_rating_average: 4.67, archetype_review_count: 36 }),
        });
        const stateManager = buildStateManager();

        const ugc = new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        const rating = document.querySelector('[data-product-rating]');
        expect(rating.querySelectorAll('.icon--ratingFull')).toHaveLength(5);
        expect(rating.querySelector('.rating-count').textContent).toEqual('36 reviews');
        expect(ugc.ratingAverage).toEqual(4.67);
        expect(ugc.reviewCount).toEqual(36);
    });

    it('renders four filled stars when the average rounds down', async () => {
        const api = buildApi({
            ok: true,
            status: 200,
            data: buildEnvelope({ archetype_rating_average: 3.5, archetype_review_count: 1 }),
        });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const rating = document.querySelector('[data-product-rating]');
        // 3.5 rounds to 4 full stars; 1 review is singular.
        expect(rating.querySelectorAll('.icon--ratingFull')).toHaveLength(4);
        expect(rating.querySelector('.rating-count').textContent).toEqual('1 review');
    });

    it('renders the first page of reviews into #product-reviews', async () => {
        const api = buildApi({
            ok: true,
            status: 200,
            data: buildEnvelope({
                items: [
                    {
                        id: 1,
                        author: 'Jane D.',
                        rating: 5,
                        title: 'Great product',
                        body: 'Really happy with this.',
                        vehicle_label: 'MINI Cooper F56',
                        verified_purchaser: true,
                        date: '2026-01-15T00:00:00Z',
                    },
                    {
                        id: 2,
                        author: 'Bob',
                        rating: 4,
                        title: 'Solid',
                        body: 'Works well.',
                        verified_purchaser: false,
                        date: '2026-02-01T00:00:00Z',
                    },
                ],
            }),
        });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const list = document.querySelector('#product-reviews');
        expect(list.querySelectorAll('.cs-review')).toHaveLength(2);
        expect(list.textContent).toContain('Jane D.');
        expect(list.textContent).toContain('Really happy with this.');
        expect(list.textContent).toContain('MINI Cooper F56');
        expect(list.querySelectorAll('.cs-review-verified')).toHaveLength(1);
    });

    it('renders the "Edited by CravenSpeed" marker only when edited === true (SRS §3.2.1, #145)', async () => {
        const api = buildApi({
            ok: true,
            status: 200,
            data: buildEnvelope({
                items: [
                    // edited === true → marker shown.
                    {
                        id: 1, author: 'A', rating: 5, title: 't', body: 'b',
                        date: '2026-01-15T00:00:00Z', edited: true,
                    },
                    // edited === false → nothing.
                    {
                        id: 2, author: 'B', rating: 4, title: 't', body: 'b',
                        date: '2026-02-01T00:00:00Z', edited: false,
                    },
                    // field absent (older payload) → defensive no-render, card intact.
                    {
                        id: 3, author: 'C', rating: 3, title: 't', body: 'b',
                        date: '2026-03-01T00:00:00Z',
                    },
                ],
            }),
        });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const list = document.querySelector('#product-reviews');
        // Exactly one marker — only the edited === true review.
        const markers = list.querySelectorAll('.cs-review-edited');
        expect(markers).toHaveLength(1);
        expect(markers[0].textContent).toEqual('Edited by CravenSpeed');
        // The absent-field card still rendered fully (no break on missing flag).
        expect(list.querySelectorAll('.cs-review')).toHaveLength(3);
    });

    it('renders the "no reviews yet" state when archetype_rating_average is null', async () => {
        const api = buildApi({
            ok: true,
            status: 200,
            data: buildEnvelope({
                items: [],
                total: 0,
                archetype_rating_average: null,
                archetype_review_count: 0,
            }),
        });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const rating = document.querySelector('[data-product-rating]');
        const list = document.querySelector('#product-reviews');
        expect(rating.querySelector('.cs-rating-empty')).not.toBeNull();
        expect(rating.querySelectorAll('.icon--ratingFull')).toHaveLength(0);
        expect(list.querySelector('.cs-reviews-empty')).not.toBeNull();
    });

    it('renders an error state when the API call resolves not-ok (branches on ok, not status)', async () => {
        // Network/parse failure resolves to status 0 — must be treated as an error.
        const api = buildApi({
            ok: false, status: 0, message: 'Something went wrong.', error: 'network down',
        });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const list = document.querySelector('#product-reviews');
        expect(list.querySelector('.cs-reviews-error')).not.toBeNull();
        expect(document.querySelector('[data-product-rating]').innerHTML).toEqual('');
    });

    it('escapes review text to prevent HTML injection', async () => {
        const api = buildApi({
            ok: true,
            status: 200,
            data: buildEnvelope({
                items: [{
                    id: 1,
                    author: '<script>x</script>',
                    rating: 5,
                    title: 'ok',
                    body: '<img src=x onerror=alert(1)>',
                    date: '2026-01-15T00:00:00Z',
                }],
            }),
        });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const list = document.querySelector('#product-reviews');
        expect(list.querySelector('script')).toBeNull();
        expect(list.querySelector('.cs-review-body img')).toBeNull();
    });

    it('does not fetch when no archetype id is provided', async () => {
        const api = buildApi({ ok: true, status: 200, data: buildEnvelope() });

        new UgcProduct(undefined, buildStateManager(), api);
        await flush();

        expect(api.getReviews).not.toHaveBeenCalled();
    });

    it('subscribes for the component lifecycle and unsubscribes on destroy', async () => {
        const api = buildApi({ ok: true, status: 200, data: buildEnvelope() });
        const stateManager = buildStateManager();

        const ugc = new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        expect(stateManager.subscribe).toHaveBeenCalledTimes(1);

        // A subsequent state change re-paints the cached summary without refetching.
        stateManager._emit({});
        expect(api.getReviews).toHaveBeenCalledTimes(1);

        ugc.destroy();
        stateManager._emit({});
        // Still only the single init fetch after destroy.
        expect(api.getReviews).toHaveBeenCalledTimes(1);
    });
});

describe('UgcProduct (slice 6b — sort, filter, pagination)', () => {
    beforeEach(() => {
        mountScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // The params object passed on the Nth getReviews call (1-indexed mirrors the
    // human "first/second" refetch language).
    const paramsOfCall = (api, n) => api.getReviews.mock.calls[n - 1][1];

    describe('sort', () => {
        const cases = [
            ['date_desc', 'date_desc'],
            ['date_asc', 'date_asc'],
            ['rating_desc', 'rating_desc'],
            ['rating_asc', 'rating_asc'],
        ];

        it.each(cases)('refetches with sort=%s when selected', async (value, expected) => {
            const api = buildApi(okEnvelope());
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            changeSelect('sort', value);
            await flush();

            expect(api.getReviews).toHaveBeenCalledTimes(2);
            expect(paramsOfCall(api, 2)).toEqual(expect.objectContaining({ sort: expected, page: 1 }));
        });
    });

    describe('filters', () => {
        it('emits rating as an integer when a star filter is chosen', async () => {
            const api = buildApi(okEnvelope());
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            changeSelect('rating', '4');
            await flush();

            expect(paramsOfCall(api, 2).rating).toBe(4);
        });

        it('clears the rating filter (null) when "all ratings" is reselected', async () => {
            const api = buildApi(okEnvelope());
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            changeSelect('rating', '5');
            await flush();
            changeSelect('rating', '');
            await flush();

            expect(paramsOfCall(api, 3).rating).toBeNull();
        });

        it('emits verified=true only when toggled on, omitted (null) when off', async () => {
            const api = buildApi(okEnvelope());
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            toggleCheckbox('verified', true);
            await flush();
            expect(paramsOfCall(api, 2).verified).toBe(true);

            toggleCheckbox('verified', false);
            await flush();
            expect(paramsOfCall(api, 3).verified).toBeNull();
        });

        it('emits media=true only when toggled on, omitted (null) when off', async () => {
            const api = buildApi(okEnvelope());
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            toggleCheckbox('media', true);
            await flush();
            expect(paramsOfCall(api, 2).media).toBe(true);

            toggleCheckbox('media', false);
            await flush();
            expect(paramsOfCall(api, 3).media).toBeNull();
        });

        it('resets to page 1 when a filter changes after paging forward', async () => {
            const api = buildSequencedApi([
                okEnvelope({ total: 25, page: 1, per_page: 10 }),
                okEnvelope({ total: 25, page: 2, per_page: 10 }),
                okEnvelope({ total: 4, page: 1, per_page: 10 }),
            ]);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            // Go to page 2, then apply a filter — page must reset to 1.
            document.querySelector('[data-reviews-page="2"]').click();
            await flush();
            expect(paramsOfCall(api, 2).page).toBe(2);

            toggleCheckbox('verified', true);
            await flush();
            expect(paramsOfCall(api, 3).page).toBe(1);
            expect(paramsOfCall(api, 3).verified).toBe(true);
        });
    });

    describe('pagination', () => {
        it('renders a page button per page derived from total / per_page', async () => {
            const api = buildApi(okEnvelope({ total: 25, page: 1, per_page: 10, items: [{ id: 1, rating: 5, date: '2026-01-01' }] }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            // 25 / 10 => ceil 3 numbered pages, scoped to one container.
            const bottom = document.querySelector('.cs-reviews-pagination--bottom');
            const numbered = bottom.querySelectorAll('[data-page-key="1"], [data-page-key="2"], [data-page-key="3"]');
            expect(numbered).toHaveLength(3);
            expect(bottom.querySelector('[data-reviews-page="2"]')).not.toBeNull();
            expect(bottom.querySelector('[data-reviews-page="4"]')).toBeNull();
        });

        it('paints the same controls into both the top and bottom containers', async () => {
            const api = buildApi(okEnvelope({ total: 25, page: 1, per_page: 10, items: [{ id: 1, rating: 5, date: '2026-01-01' }] }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const navs = document.querySelectorAll('[data-reviews-pagination] .cs-reviews-pages');
            expect(navs).toHaveLength(2);
            document.querySelectorAll('[data-reviews-pagination]').forEach((container) => {
                expect(container.querySelectorAll('[data-page-key]')).toHaveLength(5);
                expect(container.style.visibility).toBe('visible');
            });
            // Distinct landmark names (axe landmark-unique).
            const labels = Array.from(navs).map(n => n.getAttribute('aria-label'));
            expect(new Set(labels).size).toBe(2);
        });

        it('clicking the top controls pages the list just like the bottom', async () => {
            const api = buildSequencedApi([
                okEnvelope({ total: 25, page: 1, per_page: 10 }),
                okEnvelope({ total: 25, page: 2, per_page: 10 }),
            ]);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('.cs-reviews-pagination--top [data-reviews-page="2"]').click();
            await flush();

            expect(api.getReviews).toHaveBeenCalledTimes(2);
            expect(paramsOfCall(api, 2).page).toBe(2);
        });

        it('hides pagination when a single page covers all results', async () => {
            const api = buildApi(okEnvelope({ total: 6, page: 1, per_page: 10 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const pagination = document.querySelector('[data-reviews-pagination]');
            expect(pagination.innerHTML).toBe('');
            expect(pagination.style.visibility).toBe('hidden');
        });

        it('refetches the chosen page on a pagination click', async () => {
            const api = buildSequencedApi([
                okEnvelope({ total: 25, page: 1, per_page: 10 }),
                okEnvelope({ total: 25, page: 3, per_page: 10 }),
            ]);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-reviews-page="3"]').click();
            await flush();

            expect(api.getReviews).toHaveBeenCalledTimes(2);
            expect(paramsOfCall(api, 2).page).toBe(3);
        });

        it('does not refetch when clicking the already-current page', async () => {
            const api = buildApi(okEnvelope({ total: 25, page: 1, per_page: 10 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-reviews-page="1"]').click();
            await flush();

            expect(api.getReviews).toHaveBeenCalledTimes(1);
        });

        it('smoothly scrolls the list header into view on a page change', async () => {
            const api = buildSequencedApi([
                okEnvelope({ total: 25, page: 1, per_page: 10 }),
                okEnvelope({ total: 25, page: 2, per_page: 10 }),
            ]);
            const toolbar = document.querySelector('[data-reviews-toolbar]');
            toolbar.scrollIntoView = jest.fn();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-reviews-page="2"]').click();
            await flush();

            expect(toolbar.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        });

        it('does not scroll when the clicked page is already current', async () => {
            const api = buildApi(okEnvelope({ total: 25, page: 1, per_page: 10 }));
            const toolbar = document.querySelector('[data-reviews-toolbar]');
            toolbar.scrollIntoView = jest.fn();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-reviews-page="1"]').click();
            await flush();

            expect(toolbar.scrollIntoView).not.toHaveBeenCalled();
        });
    });

    describe('rating summary constancy under filters', () => {
        it('keeps the cached unfiltered aggregates when a filter narrows the page', async () => {
            const api = buildSequencedApi([
                okEnvelope({ archetype_rating_average: 4.67, archetype_review_count: 36, total: 36 }),
                // Filtered page reports the SAME archetype aggregates (constant per
                // §3.2.1) but a smaller `total`; the summary must not change.
                okEnvelope({ archetype_rating_average: 4.67, archetype_review_count: 36, total: 5 }),
            ]);
            const ugc = new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(document.querySelector('.rating-count').textContent).toBe('36 reviews');

            changeSelect('rating', '5');
            await flush();

            expect(ugc.ratingAverage).toBe(4.67);
            expect(ugc.reviewCount).toBe(36);
            expect(document.querySelector('.rating-count').textContent).toBe('36 reviews');
        });

        it('shows the no-matches state (not no-reviews) when a filter matches nothing but the archetype has reviews', async () => {
            const api = buildSequencedApi([
                okEnvelope({ archetype_review_count: 36, total: 36, items: [{ id: 1, rating: 5, date: '2026-01-01' }] }),
                okEnvelope({ archetype_review_count: 36, total: 0, items: [] }),
            ]);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            changeSelect('rating', '1');
            await flush();

            expect(document.querySelector('.cs-reviews-empty').textContent)
                .toContain('No reviews match');
        });
    });

    it('removes toolbar and pagination listeners on destroy', async () => {
        const api = buildApi(okEnvelope({ total: 25, page: 1, per_page: 10 }));
        const ugc = new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        ugc.destroy();

        // After destroy a sort change must not trigger a refetch.
        changeSelect('sort', 'rating_desc');
        await flush();
        expect(api.getReviews).toHaveBeenCalledTimes(1);
    });
});

describe('UgcProduct (slice 6c — Q&A tab)', () => {
    const buildQuestionEnvelope = (overrides = {}) => ({
        items: [],
        total: 0,
        page: 1,
        per_page: 10,
        ...overrides,
    });

    const okQuestions = overrides => ({
        ok: true,
        status: 200,
        data: buildQuestionEnvelope(overrides),
    });

    // A no-op reviews result so the reviews half of the module stays inert while
    // the Q&A behaviour is exercised in isolation.
    const reviewsNoop = () => Promise.resolve({ ok: true, status: 200, data: buildEnvelope() });

    const buildQaApi = result => ({
        getReviews: jest.fn(reviewsNoop),
        getQuestions: jest.fn(() => Promise.resolve(result)),
    });

    const buildSequencedQaApi = (results) => {
        let call = 0;
        return {
            getReviews: jest.fn(reviewsNoop),
            getQuestions: jest.fn(() => {
                const result = results[Math.min(call, results.length - 1)];
                call += 1;
                return Promise.resolve(result);
            }),
        };
    };

    const qParamsOfCall = (api, n) => api.getQuestions.mock.calls[n - 1][1];

    const mountQaScaffold = () => {
        document.body.innerHTML = `
            <div class="cs-questions-toolbar" data-questions-toolbar>
                <select data-questions-control="sort">
                    <option value="date_desc">Newest</option>
                    <option value="date_asc">Oldest</option>
                </select>
                <div class="cs-fitment-chip-slot" data-questions-fitment-chip></div>
            </div>
            <div class="cs-questions-pagination cs-questions-pagination--top" data-questions-pagination></div>
            <div id="product-questions"></div>
            <div class="cs-questions-pagination cs-questions-pagination--bottom" data-questions-pagination></div>
        `;
    };

    const changeQuestionsSort = (value) => {
        const el = document.querySelector('[data-questions-control="sort"]');
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    beforeEach(() => {
        mountQaScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('requests page 1 with the default date_desc sort on init', async () => {
        const api = buildQaApi(okQuestions());
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        expect(api.getQuestions).toHaveBeenCalledWith(ARCHETYPE_ID, {
            page: 1,
            sort: 'date_desc',
            fitment_id: null,
            fitment_only: null,
        });
    });

    it('renders approved questions and their staff answers', async () => {
        const api = buildQaApi(okQuestions({
            total: 2,
            items: [
                {
                    id: 1,
                    author: 'Jane D.',
                    body: 'Does this fit the F56?',
                    vehicle_label: 'MINI Cooper F56',
                    staff_answer: 'Yes, it fits all F56 generations.',
                    staff_answer_author: 'CravenSpeed',
                    date: '2026-05-01T12:00:00Z',
                },
                {
                    id: 2,
                    author: 'Bob',
                    body: 'Is hardware included?',
                    staff_answer: 'All mounting hardware is in the box.',
                    date: '2026-04-15T00:00:00Z',
                },
            ],
        }));

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const list = document.querySelector('#product-questions');
        expect(list.querySelectorAll('.cs-question')).toHaveLength(2);
        expect(list.textContent).toContain('Does this fit the F56?');
        expect(list.textContent).toContain('Yes, it fits all F56 generations.');
        expect(list.textContent).toContain('MINI Cooper F56');
        expect(list.querySelectorAll('.cs-question-answer')).toHaveLength(2);
    });

    it('omits the answer block when staff_answer is null', async () => {
        const api = buildQaApi(okQuestions({
            total: 1,
            items: [{
                id: 1,
                author: 'Jane D.',
                body: 'Pending answer?',
                staff_answer: null,
                date: '2026-05-01T12:00:00Z',
            }],
        }));

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const list = document.querySelector('#product-questions');
        expect(list.querySelectorAll('.cs-question')).toHaveLength(1);
        expect(list.querySelector('.cs-question-answer')).toBeNull();
    });

    it('renders the empty state when there are no approved questions', async () => {
        const api = buildQaApi(okQuestions({ total: 0, items: [] }));

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const list = document.querySelector('#product-questions');
        expect(list.querySelector('.cs-questions-empty')).not.toBeNull();
    });

    it('renders an error state when the questions call resolves not-ok', async () => {
        const api = buildQaApi({
            ok: false, status: 0, message: 'Something went wrong.', error: 'network down',
        });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const list = document.querySelector('#product-questions');
        expect(list.querySelector('.cs-questions-error')).not.toBeNull();
    });

    it('escapes question and answer text to prevent HTML injection', async () => {
        const api = buildQaApi(okQuestions({
            total: 1,
            items: [{
                id: 1,
                author: '<script>x</script>',
                body: '<img src=x onerror=alert(1)>',
                staff_answer: '<svg onload=alert(2)>',
                date: '2026-05-01T12:00:00Z',
            }],
        }));

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        const list = document.querySelector('#product-questions');
        expect(list.querySelector('script')).toBeNull();
        expect(list.querySelector('.cs-question-body img')).toBeNull();
        expect(list.querySelector('.cs-question-answer svg')).toBeNull();
    });

    describe('sort', () => {
        const cases = [
            ['date_desc', 'date_desc'],
            ['date_asc', 'date_asc'],
        ];

        it.each(cases)('refetches with sort=%s when selected', async (value, expected) => {
            const api = buildQaApi(okQuestions());
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            changeQuestionsSort(value);
            await flush();

            expect(api.getQuestions).toHaveBeenCalledTimes(2);
            expect(qParamsOfCall(api, 2)).toEqual({
                sort: expected, page: 1, fitment_id: null, fitment_only: null,
            });
        });

        it('resets to page 1 when the sort changes after paging forward', async () => {
            const api = buildSequencedQaApi([
                okQuestions({ total: 25, page: 1, per_page: 10 }),
                okQuestions({ total: 25, page: 2, per_page: 10 }),
                okQuestions({ total: 25, page: 1, per_page: 10 }),
            ]);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-questions-page="2"]').click();
            await flush();
            expect(qParamsOfCall(api, 2).page).toBe(2);

            changeQuestionsSort('date_asc');
            await flush();
            expect(qParamsOfCall(api, 3).page).toBe(1);
            expect(qParamsOfCall(api, 3).sort).toBe('date_asc');
        });
    });

    describe('pagination', () => {
        it('renders a page button per page derived from total / per_page', async () => {
            const api = buildQaApi(okQuestions({
                total: 25,
                page: 1,
                per_page: 10,
                items: [{ id: 1, body: 'Q?', date: '2026-01-01' }],
            }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            // 25 / 10 => ceil 3 numbered pages, scoped to one container.
            const bottom = document.querySelector('.cs-questions-pagination--bottom');
            const numbered = bottom.querySelectorAll('[data-page-key="1"], [data-page-key="2"], [data-page-key="3"]');
            expect(numbered).toHaveLength(3);
            expect(bottom.querySelector('[data-questions-page="2"]')).not.toBeNull();
            expect(bottom.querySelector('[data-questions-page="4"]')).toBeNull();
        });

        it('paints the same controls into both the top and bottom containers', async () => {
            const api = buildQaApi(okQuestions({
                total: 25,
                page: 1,
                per_page: 10,
                items: [{ id: 1, body: 'Q?', date: '2026-01-01' }],
            }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const navs = document.querySelectorAll('[data-questions-pagination] .cs-questions-pages');
            expect(navs).toHaveLength(2);
            document.querySelectorAll('[data-questions-pagination]').forEach((container) => {
                expect(container.querySelectorAll('[data-page-key]')).toHaveLength(5);
                expect(container.style.visibility).toBe('visible');
            });
            const labels = Array.from(navs).map(n => n.getAttribute('aria-label'));
            expect(new Set(labels).size).toBe(2);
        });

        it('clicking the top controls pages the list just like the bottom', async () => {
            const api = buildSequencedQaApi([
                okQuestions({ total: 25, page: 1, per_page: 10 }),
                okQuestions({ total: 25, page: 2, per_page: 10 }),
            ]);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('.cs-questions-pagination--top [data-questions-page="2"]').click();
            await flush();

            expect(api.getQuestions).toHaveBeenCalledTimes(2);
            expect(qParamsOfCall(api, 2).page).toBe(2);
        });

        it('hides pagination when a single page covers all results', async () => {
            const api = buildQaApi(okQuestions({ total: 6, page: 1, per_page: 10 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const pagination = document.querySelector('[data-questions-pagination]');
            expect(pagination.innerHTML).toBe('');
            expect(pagination.style.visibility).toBe('hidden');
        });

        it('refetches the chosen page on a pagination click', async () => {
            const api = buildSequencedQaApi([
                okQuestions({ total: 25, page: 1, per_page: 10 }),
                okQuestions({ total: 25, page: 3, per_page: 10 }),
            ]);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-questions-page="3"]').click();
            await flush();

            expect(api.getQuestions).toHaveBeenCalledTimes(2);
            expect(qParamsOfCall(api, 2).page).toBe(3);
        });

        it('does not refetch when clicking the already-current page', async () => {
            const api = buildQaApi(okQuestions({ total: 25, page: 1, per_page: 10 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-questions-page="1"]').click();
            await flush();

            expect(api.getQuestions).toHaveBeenCalledTimes(1);
        });

        it('smoothly scrolls the list header into view on a page change', async () => {
            const api = buildSequencedQaApi([
                okQuestions({ total: 25, page: 1, per_page: 10 }),
                okQuestions({ total: 25, page: 2, per_page: 10 }),
            ]);
            const toolbar = document.querySelector('[data-questions-toolbar]');
            toolbar.scrollIntoView = jest.fn();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-questions-page="2"]').click();
            await flush();

            expect(toolbar.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        });
    });

    it('passes the garage fitment_id on the initial questions fetch and shows the chip on count > 0', async () => {
        const api = buildQaApi(okQuestions({ fitment_question_count: 4 }));
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        expect(qParamsOfCall(api, 1).fitment_id).toBe(87);
        expect(qParamsOfCall(api, 1).fitment_only).toBeNull();

        const chip = document.querySelector('[data-questions-fitment-chip]');
        const toggle = chip.querySelector('[data-fitment-chip-toggle]');
        expect(toggle).not.toBeNull();
        expect(toggle.textContent).toContain('For your MINI Cooper');
        expect(chip.style.visibility).toBe('visible');
    });

    it('hard-filters questions with fitment_only when the Q&A chip is clicked, and clears it', async () => {
        const api = buildQaApi(okQuestions({ fitment_question_count: 4 }));
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        document.querySelector('[data-questions-fitment-chip] [data-fitment-chip-toggle]').click();
        await flush();
        expect(api.getQuestions).toHaveBeenCalledTimes(2);
        expect(qParamsOfCall(api, 2)).toEqual({
            page: 1, sort: 'date_desc', fitment_id: 87, fitment_only: true,
        });

        document.querySelector('[data-questions-fitment-chip] [data-fitment-chip-clear]').click();
        await flush();
        expect(api.getQuestions).toHaveBeenCalledTimes(3);
        expect(qParamsOfCall(api, 3).fitment_only).toBeNull();
    });

    it('shows a "no questions for your vehicle" status when fitment_question_count is 0', async () => {
        const api = buildQaApi(okQuestions({ fitment_question_count: 0 }));
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        const chip = document.querySelector('[data-questions-fitment-chip]');
        const empty = chip.querySelector('.cs-fitment-empty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toContain('No questions');
        expect(empty.textContent).toContain('MINI Cooper');
        expect(chip.querySelector('[data-fitment-chip-toggle]')).toBeNull();
        expect(chip.style.visibility).toBe('visible');
    });

    it('does not fetch questions when the Q&A DOM is absent', async () => {
        document.body.innerHTML = '<div id="product-reviews"></div>';
        const api = buildQaApi(okQuestions());

        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        expect(api.getQuestions).not.toHaveBeenCalled();
    });

    it('removes Q&A toolbar and pagination listeners on destroy', async () => {
        const api = buildQaApi(okQuestions({ total: 25, page: 1, per_page: 10 }));
        const ugc = new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        ugc.destroy();

        changeQuestionsSort('date_asc');
        await flush();
        expect(api.getQuestions).toHaveBeenCalledTimes(1);
    });
});

describe('UgcProduct (slice A — fitment filter chip, reviews)', () => {
    beforeEach(() => {
        mountScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    const paramsOfCall = (api, n) => api.getReviews.mock.calls[n - 1][1];

    const reviewsChip = () => document.querySelector('[data-reviews-fitment-chip]');

    // A reviews-only api that returns a fresh envelope (default fitment count of
    // 4) on every call, so each refetch can be asserted against its params.
    const buildReviewsApi = (count = 4) => ({
        getReviews: jest.fn(() => Promise.resolve(okEnvelope({ fitment_review_count: count }))),
    });

    it('passes the garage fitment_id on the initial reviews fetch', async () => {
        const api = buildReviewsApi();
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        expect(paramsOfCall(api, 1).fitment_id).toBe(87);
        expect(paramsOfCall(api, 1).fitment_only).toBeNull();
    });

    it('omits fitment_id when there is no garage vehicle', async () => {
        const api = buildReviewsApi();
        const global = buildGlobalStateManager({ registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        expect(paramsOfCall(api, 1).fitment_id).toBeNull();
        expect(reviewsChip().style.visibility).toBe('hidden');
    });

    it('omits fitment_id for an un-filterable (null fitment_id) generation', async () => {
        const api = buildReviewsApi(0);
        const registry = {
            models: {
                cooper: { name: 'Cooper', generations: { f56: { name: 'MINI Cooper F56', fitment_id: null } } },
            },
        };
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        expect(paramsOfCall(api, 1).fitment_id).toBeNull();
        expect(reviewsChip().style.visibility).toBe('hidden');
    });

    it('shows the "For your <vehicle>" chip only when fitment_review_count > 0', async () => {
        const api = buildReviewsApi(7);
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        const chip = reviewsChip();
        const toggle = chip.querySelector('[data-fitment-chip-toggle]');
        expect(toggle).not.toBeNull();
        expect(toggle.textContent).toContain('For your MINI Cooper');
        expect(chip.querySelector('.cs-fitment-chip-count').textContent).toBe('7');
        expect(chip.style.visibility).toBe('visible');
    });

    it('shows a "no reviews for your vehicle" status when fitment_review_count is 0', async () => {
        const api = buildReviewsApi(0);
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        const chip = reviewsChip();
        const empty = chip.querySelector('.cs-fitment-empty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toContain('No reviews');
        expect(empty.textContent).toContain('MINI Cooper');
        expect(chip.querySelector('[data-fitment-chip-toggle]')).toBeNull();
        expect(chip.style.visibility).toBe('visible');
    });

    it('hard-filters with fitment_only=true on chip click and resets to page 1', async () => {
        const api = buildReviewsApi(5);
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        reviewsChip().querySelector('[data-fitment-chip-toggle]').click();
        await flush();

        expect(api.getReviews).toHaveBeenCalledTimes(2);
        expect(paramsOfCall(api, 2)).toEqual({
            page: 1,
            sort: 'date_desc',
            rating: null,
            verified: null,
            media: null,
            fitment_id: 87,
            fitment_only: true,
        });
        expect(reviewsChip().querySelector('[data-fitment-chip-toggle]').classList).toContain('is-active');
    });

    it('clears the hard filter (drops fitment_only) when the clear control is clicked', async () => {
        const api = buildReviewsApi(5);
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        reviewsChip().querySelector('[data-fitment-chip-toggle]').click();
        await flush();
        expect(paramsOfCall(api, 2).fitment_only).toBe(true);

        reviewsChip().querySelector('[data-fitment-chip-clear]').click();
        await flush();
        expect(api.getReviews).toHaveBeenCalledTimes(3);
        expect(paramsOfCall(api, 3).fitment_only).toBeNull();
    });

    it('composes fitment_only with the active sort and filters', async () => {
        const api = buildReviewsApi(5);
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        changeSelect('sort', 'rating_desc');
        await flush();
        changeSelect('rating', '4');
        await flush();
        toggleCheckbox('verified', true);
        await flush();

        reviewsChip().querySelector('[data-fitment-chip-toggle]').click();
        await flush();

        const last = paramsOfCall(api, api.getReviews.mock.calls.length);
        expect(last).toEqual({
            page: 1,
            sort: 'rating_desc',
            rating: 4,
            verified: true,
            media: null,
            fitment_id: 87,
            fitment_only: true,
        });
    });

    it('re-resolves and refetches when a late-arriving registry resolves the garage vehicle', async () => {
        const api = buildReviewsApi(3);
        // Garage selected, but the registry has not loaded yet → no fitment_id.
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        expect(paramsOfCall(api, 1).fitment_id).toBeNull();

        // Search data arrives: registry now resolves the garage to fitment 87.
        global._set({
            vehicle: { selected: F56_GARAGE },
            search: { data: { vehicle_registry: F56_REGISTRY } },
        });
        await flush();

        expect(api.getReviews).toHaveBeenCalledTimes(2);
        expect(paramsOfCall(api, 2).fitment_id).toBe(87);
        expect(paramsOfCall(api, 2).page).toBe(1);
        expect(reviewsChip().style.visibility).toBe('visible');
    });

    it('refetches with the new fitment_id and resets the hard filter on a garage swap', async () => {
        const api = buildReviewsApi(3);
        const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
        await flush();

        // Turn the hard filter on for the F56.
        reviewsChip().querySelector('[data-fitment-chip-toggle]').click();
        await flush();
        expect(paramsOfCall(api, 2).fitment_only).toBe(true);

        // Swap the garage to the R53 (fitment 42) — the filter resets to off.
        global._set({
            vehicle: { selected: { make: 'mini', model: 'cooper', generation: 'r53' } },
            search: { data: { vehicle_registry: F56_REGISTRY } },
        });
        await flush();

        expect(paramsOfCall(api, 3).fitment_id).toBe(42);
        expect(paramsOfCall(api, 3).fitment_only).toBeNull();
        expect(paramsOfCall(api, 3).page).toBe(1);
    });

    it('still tracks qty_alias_index as alias_id provenance without refetching', async () => {
        const stateManager = buildStateManager();
        const api = buildReviewsApi();
        const ugc = new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();
        expect(api.getReviews).toHaveBeenCalledTimes(1);

        // A local alias selection updates provenance but never triggers a fetch
        // (the removed sort_alias relevance sort is gone).
        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
        await flush();
        expect(api.getReviews).toHaveBeenCalledTimes(1);
        expect(ugc.aliasIndex).toBe(4821);

        stateManager._emit({ aliasData: { bc_id: 99 } });
        await flush();
        expect(api.getReviews).toHaveBeenCalledTimes(1);
        expect(ugc.aliasIndex).toBeNull();
    });
});

describe('UgcProduct (issue #45 — click a vehicle badge to filter)', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    const paramsOfCall = (api, n) => api.getReviews.mock.calls[n - 1][1];
    const lastReviewParams = api => paramsOfCall(api, api.getReviews.mock.calls.length);
    const reviewsChip = () => document.querySelector('[data-reviews-fitment-chip]');
    const reviewBadges = () => document.querySelectorAll('#product-reviews .cs-ugc-vehicle-badge');

    const reviewItem = (over = {}) => ({
        id: 1,
        author: 'Jane D.',
        rating: 5,
        title: 't',
        body: 'b',
        fitment_id: 42,
        vehicle_label: 'MINI Cooper R53 2002 to 2006',
        ...over,
    });

    const buildReviewsApiWith = (items, count) => ({
        getReviews: jest.fn(() => Promise.resolve(okEnvelope({
            items,
            total: items.length,
            fitment_review_count: count === undefined ? items.length : count,
        }))),
    });

    describe('reviews', () => {
        beforeEach(() => {
            mountScaffold();
        });

        it('renders a clickable button badge for a review with a fitment_id, a static <p> without', async () => {
            const items = [
                reviewItem({ id: 1, fitment_id: 42, vehicle_label: 'MINI Cooper R53 2002 to 2006' }),
                reviewItem({ id: 2, fitment_id: null, vehicle_label: 'Legacy Vehicle' }),
            ];
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildReviewsApiWith(items));
            await flush();

            const badges = reviewBadges();
            expect(badges.length).toBe(2);
            expect(badges[0].tagName).toBe('BUTTON');
            expect(badges[0].dataset.fitmentFilter).toBe('42');
            expect(badges[0].dataset.fitmentLabel).toBe('MINI Cooper R53 2002 to 2006');
            expect(badges[1].tagName).toBe('P');
            expect(badges[1].hasAttribute('data-fitment-filter')).toBe(false);
        });

        it('renders a static (non-clickable) badge for the lightbox review, a button in the list', async () => {
            const ugc = new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildReviewsApiWith([]));
            await flush();
            const review = reviewItem({ fitment_id: 42 });

            // List context (default): a clickable filter button.
            expect(ugc._buildReview(review)).toContain('data-fitment-filter="42"');

            // Lightbox context (clickable=false): a static <p>, no filter hook.
            const lightbox = ugc._buildReview(review, false, false);
            expect(lightbox).toContain('<p class="cs-ugc-vehicle-badge cs-review-vehicle">');
            expect(lightbox).not.toContain('data-fitment-filter');
        });

        it('escapes a vehicle_label with quotes/angle brackets through the data attr and the takeover chip', async () => {
            const label = '26" Wheels <script>';
            const api = buildReviewsApiWith([reviewItem({ fitment_id: 42, vehicle_label: label })], 4);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            // The badge label is inert text, and the raw label round-trips
            // through the escaped data attribute (the browser decodes it back).
            const badge = reviewBadges()[0];
            expect(badge.querySelector('script')).toBeNull();
            expect(badge.dataset.fitmentLabel).toBe(label);

            badge.click();
            await flush();

            // The "Showing:" takeover chip renders the label as text, not markup.
            const showing = reviewsChip().querySelector('.cs-fitment-showing');
            expect(showing.querySelector('script')).toBeNull();
            expect(showing.textContent).toBe(`Showing: ${label}`);
        });

        it('filters to the clicked vehicle (fitment_only + that fitment_id, page 1) on badge click', async () => {
            const api = buildReviewsApiWith([reviewItem({ fitment_id: 42 })], 4);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            reviewBadges()[0].click();
            await flush();

            expect(api.getReviews).toHaveBeenCalledTimes(2);
            expect(paramsOfCall(api, 2).fitment_id).toBe(42);
            expect(paramsOfCall(api, 2).fitment_only).toBe(true);
            expect(paramsOfCall(api, 2).page).toBe(1);
        });

        it('shows a "Showing: <vehicle>" takeover chip and clears back to the default view', async () => {
            const api = buildReviewsApiWith([reviewItem({ fitment_id: 42 })], 4);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            reviewBadges()[0].click();
            await flush();

            const showing = reviewsChip().querySelector('.cs-fitment-showing');
            expect(showing).not.toBeNull();
            expect(showing.textContent).toContain('Showing: MINI Cooper R53 2002 to 2006');
            expect(reviewsChip().querySelector('[data-fitment-chip-clear]')).not.toBeNull();
            expect(reviewsChip().style.visibility).toBe('visible');

            reviewsChip().querySelector('[data-fitment-chip-clear]').click();
            await flush();

            expect(api.getReviews).toHaveBeenCalledTimes(3);
            expect(paramsOfCall(api, 3).fitment_id).toBeNull();
            expect(paramsOfCall(api, 3).fitment_only).toBeNull();
            expect(reviewsChip().querySelector('.cs-fitment-showing')).toBeNull();
        });

        it('activates the garage chip (no takeover) when the clicked badge is the garage vehicle', async () => {
            const api = buildReviewsApiWith([reviewItem({ fitment_id: 87, vehicle_label: 'MINI Cooper F56 2014 to 2024' })], 5);
            const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
            await flush();

            reviewBadges()[0].click();
            await flush();

            expect(reviewsChip().querySelector('.cs-fitment-showing')).toBeNull();
            expect(reviewsChip().querySelector('[data-fitment-chip-toggle]').classList).toContain('is-active');
            expect(lastReviewParams(api).fitment_id).toBe(87);
            expect(lastReviewParams(api).fitment_only).toBe(true);
        });

        it('takes over the garage chip with a non-garage vehicle and restores it on clear', async () => {
            const api = buildReviewsApiWith([reviewItem({ fitment_id: 42 })], 5);
            const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry: F56_REGISTRY });
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
            await flush();
            expect(reviewsChip().textContent).toContain('For your MINI Cooper');

            reviewBadges()[0].click();
            await flush();

            expect(reviewsChip().querySelector('[data-fitment-chip-toggle]')).toBeNull();
            expect(reviewsChip().querySelector('.cs-fitment-showing').textContent).toContain('Showing: MINI Cooper R53');
            expect(lastReviewParams(api).fitment_id).toBe(42);

            reviewsChip().querySelector('[data-fitment-chip-clear]').click();
            await flush();

            expect(lastReviewParams(api).fitment_id).toBe(87);
            expect(lastReviewParams(api).fitment_only).toBeNull();
            expect(reviewsChip().textContent).toContain('For your MINI Cooper');
        });

        it('drops an active click-filter when the garage vehicle is swapped', async () => {
            const registry = {
                brands: { mini: { name: 'MINI', models: ['cooper'] } },
                models: {
                    cooper: {
                        name: 'Cooper',
                        generations: {
                            f56: { name: 'F56 2014 to 2024', fitment_id: 87 },
                            r53: { name: 'R53 2002 to 2006', fitment_id: 42 },
                            r56: { name: 'R56 2007 to 2013', fitment_id: 99 },
                        },
                    },
                },
            };
            const api = buildReviewsApiWith([reviewItem({ fitment_id: 42 })], 5);
            const global = buildGlobalStateManager({ vehicle: F56_GARAGE, registry });
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global);
            await flush();

            // Click a non-garage vehicle (R53, 42) → takeover.
            reviewBadges()[0].click();
            await flush();
            expect(lastReviewParams(api).fitment_id).toBe(42);
            expect(reviewsChip().querySelector('.cs-fitment-showing')).not.toBeNull();

            // Swap the garage to R56 (99): the click-filter is dropped and the
            // view returns to the new garage's default (unfiltered).
            global._set({
                vehicle: { selected: { make: 'mini', model: 'cooper', generation: 'r56' } },
                search: { data: { vehicle_registry: registry } },
            });
            await flush();

            expect(lastReviewParams(api).fitment_id).toBe(99);
            expect(lastReviewParams(api).fitment_only).toBeNull();
            expect(reviewsChip().querySelector('.cs-fitment-showing')).toBeNull();
        });
    });

    describe('questions', () => {
        const mountQaScaffold = () => {
            document.body.innerHTML = `
                <div class="cs-questions-toolbar" data-questions-toolbar>
                    <select data-questions-control="sort">
                        <option value="date_desc">Newest</option>
                    </select>
                    <div class="cs-fitment-chip-slot" data-questions-fitment-chip></div>
                </div>
                <div id="product-questions"></div>
                <div class="cs-questions-pagination" data-questions-pagination></div>
            `;
        };

        beforeEach(() => {
            mountQaScaffold();
        });

        it('filters the Q&A list to a clicked question vehicle', async () => {
            const questionItems = [{
                id: 1, author: 'A', body: 'b', fitment_id: 42, vehicle_label: 'MINI Cooper R53 2002 to 2006', staff_answer: 'ans',
            }];
            const api = {
                getReviews: jest.fn(() => Promise.resolve(okEnvelope())),
                getQuestions: jest.fn(() => Promise.resolve({
                    ok: true,
                    status: 200,
                    data: {
                        items: questionItems, total: 1, page: 1, per_page: 10, fitment_question_count: 3,
                    },
                })),
            };
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const badge = document.querySelector('#product-questions .cs-ugc-vehicle-badge');
            expect(badge.tagName).toBe('BUTTON');
            badge.click();
            await flush();

            const calls = api.getQuestions.mock.calls;
            const last = calls[calls.length - 1][1];
            expect(last.fitment_id).toBe(42);
            expect(last.fitment_only).toBe(true);
            expect(last.page).toBe(1);
            expect(document.querySelector('[data-questions-fitment-chip] .cs-fitment-showing')).not.toBeNull();
        });
    });
});

describe('UgcProduct (vehicle-filter prompt when no vehicle is selected)', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    const reviewsChip = () => document.querySelector('[data-reviews-fitment-chip]');

    const buildReviewsApi = (count = 0) => ({
        getReviews: jest.fn(() => Promise.resolve(okEnvelope({ fitment_review_count: count }))),
    });

    const ARCH_WITH_FITMENTS = {
        make_model_index: {
            mini: {
                name: 'MINI',
                models: {
                    cooper: {
                        name: 'Cooper',
                        generations: { f56: { name: 'F56 2014 to 2024', fitment_id: 87 } },
                    },
                },
            },
        },
    };

    it('shows the "select your vehicle" prompt on a fitment-capable product with no garage vehicle', async () => {
        mountScaffold();
        const global = buildGlobalStateManager({ registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildReviewsApi(0), undefined, global, ARCH_WITH_FITMENTS);
        await flush();

        const prompt = reviewsChip().querySelector('[data-fitment-prompt]');
        expect(prompt).not.toBeNull();
        expect(prompt.textContent).toContain('Select your vehicle');
        expect(reviewsChip().style.visibility).toBe('visible');
    });

    it('shows no prompt on a universal product (no archetype fitments)', async () => {
        mountScaffold();
        const global = buildGlobalStateManager({ registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildReviewsApi(0), undefined, global, { universal_product: true });
        await flush();

        expect(reviewsChip().querySelector('[data-fitment-prompt]')).toBeNull();
        expect(reviewsChip().style.visibility).toBe('hidden');
    });

    it('replaces the prompt with the live chip once a vehicle resolves', async () => {
        mountScaffold();
        const global = buildGlobalStateManager({ registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildReviewsApi(4), undefined, global, ARCH_WITH_FITMENTS);
        await flush();
        expect(reviewsChip().querySelector('[data-fitment-prompt]')).not.toBeNull();

        global._set({
            vehicle: { selected: F56_GARAGE },
            search: { data: { vehicle_registry: F56_REGISTRY } },
        });
        await flush();

        expect(reviewsChip().querySelector('[data-fitment-prompt]')).toBeNull();
        expect(reviewsChip().querySelector('[data-fitment-chip-toggle]')).not.toBeNull();
    });

    it('scrolls to and focuses the make picker when the prompt is clicked', async () => {
        mountScaffold();
        const makeSelect = document.createElement('select');
        makeSelect.setAttribute('data-product-option', 'make');
        makeSelect.innerHTML = '<option>MINI</option>';
        document.body.appendChild(makeSelect);
        const scrollSpy = jest.fn();
        makeSelect.scrollIntoView = scrollSpy;

        const global = buildGlobalStateManager({ registry: F56_REGISTRY });
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildReviewsApi(0), undefined, global, ARCH_WITH_FITMENTS);
        await flush();

        reviewsChip().querySelector('[data-fitment-prompt]').click();

        expect(scrollSpy).toHaveBeenCalled();
        expect(document.activeElement).toBe(makeSelect);
    });
});

describe('UgcProduct (country flag on review cards)', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    const buildUgc = () => {
        mountScaffold();
        return new UgcProduct(
            ARCHETYPE_ID,
            buildStateManager(),
            { getReviews: jest.fn(() => Promise.resolve(okEnvelope())) },
        );
    };

    const review = over => ({
        author: 'Jane D.', rating: 5, title: 't', body: 'b', ...over,
    });

    it('renders a lazy-loaded flag from the ISO-3166 alpha-2 country code', async () => {
        const ugc = buildUgc();
        await flush();

        const html = ugc._buildReview(review({ country: 'US' }));
        expect(html).toContain('class="cs-review-flag"');
        expect(html).toContain('src="https://flagcdn.com/us.svg"');
        expect(html).toContain('alt="US"');
        expect(html).toContain('loading="lazy"');
    });

    it('omits the flag when country is null', async () => {
        const ugc = buildUgc();
        await flush();

        expect(ugc._buildReview(review({ country: null }))).not.toContain('cs-review-flag');
    });

    it('omits the flag for a value that is not a two-letter code', async () => {
        const ugc = buildUgc();
        await flush();

        expect(ugc._buildReview(review({ country: 'USA' }))).not.toContain('cs-review-flag');
        expect(ugc._buildReview(review({ country: '12' }))).not.toContain('cs-review-flag');
        expect(ugc._buildReview(review({ country: '' }))).not.toContain('cs-review-flag');
    });
});

describe('UgcProduct (slice 6e — submission modal)', () => {
    // A reviews + questions api that resolves both list fetches inertly, plus
    // injectable postReview/postQuestion spies for the submission paths.
    const buildSubmitApi = (postResult = { ok: true, status: 201, data: { id: 1 } }) => ({
        getReviews: jest.fn(() => Promise.resolve({ ok: true, status: 200, data: buildEnvelope() })),
        getQuestions: jest.fn(() => Promise.resolve({
            ok: true, status: 200, data: { items: [], total: 0, page: 1, per_page: 10 },
        })),
        postReview: jest.fn(() => Promise.resolve(postResult)),
        postQuestion: jest.fn(() => Promise.resolve(postResult)),
    });

    const mountModalScaffold = () => {
        document.body.innerHTML = `
            <a id="product-rating" data-product-rating></a>
            <div data-reviews-toolbar>
                <button type="button" data-review-modal-open>Write a Review</button>
            </div>
            <div id="product-reviews"></div>
            <div data-reviews-pagination></div>

            <div class="cs-ugc-modal" data-review-modal hidden>
                <div data-review-modal-close></div>
                <div class="cs-ugc-modal-dialog">
                    <button type="button" data-review-modal-close>x</button>
                    <h4>Write a Review</h4>
                    <form data-review-form novalidate>
                        <p data-review-error hidden></p>
                        <p data-review-success hidden>Thanks!</p>
                        <div data-review-fields>
                            <select name="rating" data-review-field="rating">
                                <option value="">—</option>
                                <option value="5">5</option>
                            </select>
                            <input type="text" name="title" data-review-field="title">
                            <textarea name="body" data-review-field="body"></textarea>
                            <input type="text" name="author" data-review-field="author">
                            <div class="cs-ugc-vehicle" data-review-vehicle></div>
                            <label class="cs-ugc-honeypot"><input type="text" name="website" data-review-field="website"></label>
                            <div data-review-turnstile data-ugc-turnstile-sitekey=""></div>
                            <input type="hidden" name="cf_turnstile_token" data-review-field="cf_turnstile_token">
                            <button type="submit" data-review-submit>Submit Review</button>
                        </div>
                    </form>
                </div>
            </div>

            <div data-questions-toolbar>
                <button type="button" data-question-modal-open>Ask a Question</button>
            </div>
            <div id="product-questions"></div>
            <div data-questions-pagination></div>

            <div class="cs-ugc-modal" data-question-modal hidden>
                <div data-question-modal-close></div>
                <div class="cs-ugc-modal-dialog">
                    <button type="button" data-question-modal-close>x</button>
                    <h4>Ask a Question</h4>
                    <form data-question-form novalidate>
                        <p data-question-error hidden></p>
                        <p data-question-success hidden>Thanks!</p>
                        <div data-question-fields>
                            <textarea name="body" data-question-field="body"></textarea>
                            <input type="text" name="author" data-question-field="author">
                            <div class="cs-ugc-vehicle" data-question-vehicle></div>
                            <label class="cs-ugc-honeypot"><input type="text" name="website" data-question-field="website"></label>
                            <div data-question-turnstile data-ugc-turnstile-sitekey=""></div>
                            <input type="hidden" name="cf_turnstile_token" data-question-field="cf_turnstile_token">
                            <button type="submit" data-question-submit>Submit Question</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    };

    const setField = (scope, name, value) => {
        document.querySelector(`[data-${scope}-form] [name="${name}"]`).value = value;
    };

    // Seed a valid review form with a Turnstile token in the hidden field (the
    // fallback path read when window.turnstile is absent, as in jsdom).
    const fillReview = (overrides = {}) => {
        const values = {
            rating: '5',
            title: 'Great product',
            body: 'Really happy with this.',
            author: 'Jane D.',
            website: '',
            cf_turnstile_token: '0.test-token',
            ...overrides,
        };
        Object.keys(values).forEach(name => setField('review', name, values[name]));
    };

    const fillQuestion = (overrides = {}) => {
        const values = {
            body: 'Does this fit the F56?',
            author: 'Jane D.',
            website: '',
            cf_turnstile_token: '0.test-token',
            ...overrides,
        };
        Object.keys(values).forEach(name => setField('question', name, values[name]));
    };

    const submitForm = (scope) => {
        document.querySelector(`[data-${scope}-form]`).dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
    };

    beforeEach(() => {
        mountModalScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('opening', () => {
        it('reveals the review modal on the open trigger', async () => {
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildSubmitApi());
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            expect(document.querySelector('[data-review-modal]').hidden).toBe(false);
        });

        it('closes the modal when the overlay/close control is clicked', async () => {
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildSubmitApi());
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            document.querySelectorAll('[data-review-modal-close]')[0].click();
            expect(document.querySelector('[data-review-modal]').hidden).toBe(true);
        });
    });

    describe('review payload shaping (SRS §3.2.4)', () => {
        it('posts the frozen review body with rating as an integer', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            submitForm('review');
            await flush();

            // No archetype fitments / no garage here, so the structured vehicle
            // section is empty — neither fitment_id nor vehicle_label is sent
            // (SRS §3.4.1, Slice B). There is no free-text vehicle field.
            expect(api.postReview).toHaveBeenCalledWith({
                archetype_id: ARCHETYPE_ID,
                author: 'Jane D.',
                rating: 5,
                title: 'Great product',
                body: 'Really happy with this.',
                cf_turnstile_token: '0.test-token',
                website: '',
            });
        });

        it('omits optional vehicle_label when blank and alias_id when no alias is selected', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            submitForm('review');
            await flush();

            const payload = api.postReview.mock.calls[0][0];
            expect(payload).not.toHaveProperty('vehicle_label');
            expect(payload).not.toHaveProperty('alias_id');
        });

        // The vehicle-first float toggle is OFF throughout this test — the
        // selected alias must still ride on the submission as alias_id (the
        // float preference and the selection are independent).
        it('includes alias_id from the selected alias index', async () => {
            const stateManager = buildStateManager();
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, stateManager, api);
            await flush();

            stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            submitForm('review');
            await flush();

            expect(api.postReview.mock.calls[0][0].alias_id).toBe(4821);
        });

        // Slice B (#158): the vehicle is no longer free-text nor alias-derived.
        // With no archetype fitments and no garage, the structured section is
        // empty, so submission carries no fitment_id / vehicle_label — and there
        // is no [name="vehicle_label"] input in the DOM at all.
        it('renders no free-text vehicle input and sends no vehicle on an empty section', async () => {
            const stateManager = buildStateManager();
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, stateManager, api);
            await flush();

            stateManager._emit({ aliasData: { qty_alias_index: 4821, vehicle_label: 'MINI Cooper F56' } });
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            expect(document.querySelector('[data-review-form] [name="vehicle_label"]')).toBeNull();
            expect(document.querySelector('[data-review-vehicle]').innerHTML).toBe('');

            fillReview();
            submitForm('review');
            await flush();

            const payload = api.postReview.mock.calls[0][0];
            expect(payload).not.toHaveProperty('fitment_id');
            expect(payload).not.toHaveProperty('vehicle_label');
        });
    });

    describe('question payload shaping (SRS §3.2.5)', () => {
        it('posts the frozen question body', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-question-modal-open]').click();
            fillQuestion();
            submitForm('question');
            await flush();

            expect(api.postQuestion).toHaveBeenCalledWith({
                archetype_id: ARCHETYPE_ID,
                author: 'Jane D.',
                body: 'Does this fit the F56?',
                cf_turnstile_token: '0.test-token',
                website: '',
            });
        });
    });

    describe('client-side validation', () => {
        it('blocks a review submission with a missing required field', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview({ title: '' });
            submitForm('review');
            await flush();

            expect(api.postReview).not.toHaveBeenCalled();
            const error = document.querySelector('[data-review-error]');
            expect(error.hidden).toBe(false);
            expect(error.textContent).toContain('required');
        });

        it('blocks a submission with no Turnstile token', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview({ cf_turnstile_token: '' });
            submitForm('review');
            await flush();

            expect(api.postReview).not.toHaveBeenCalled();
            expect(document.querySelector('[data-review-error]').hidden).toBe(false);
        });

        it('still sends a non-empty honeypot value so the server can reject it (§3.4.5)', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview({ website: 'http://spam.example' });
            submitForm('review');
            await flush();

            expect(api.postReview.mock.calls[0][0].website).toBe('http://spam.example');
        });
    });

    describe('success state', () => {
        it('reveals the success message and hides the fields on a 201', async () => {
            const api = buildSubmitApi({ ok: true, status: 201, data: { id: 99 } });
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            submitForm('review');
            await flush();

            expect(document.querySelector('[data-review-success]').hidden).toBe(false);
            expect(document.querySelector('[data-review-fields]').hidden).toBe(true);
        });
    });

    describe('error-status surfacing (SRS §3.6)', () => {
        const cases = [
            ['429 too-many', {
                ok: false, status: 429, message: 'You\'ve made too many submissions. Please try again later.', error: null,
            }],
            ['400 envelope', {
                ok: false, status: 400, message: 'Turnstile validation failed', error: 'Turnstile validation failed',
            }],
            ['422 envelope', {
                ok: false, status: 422, message: 'File not found', error: 'File not found',
            }],
            ['500 generic', {
                ok: false, status: 500, message: 'Something went wrong. Please try again.', error: null,
            }],
        ];

        it.each(cases)('surfaces the %s message inline and keeps the form visible', async (label, result) => {
            const api = buildSubmitApi(result);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            submitForm('review');
            await flush();

            const error = document.querySelector('[data-review-error]');
            expect(error.hidden).toBe(false);
            expect(error.textContent).toBe(result.message);
            // The fields stay visible so the user can correct and retry.
            expect(document.querySelector('[data-review-fields]').hidden).toBe(false);
            expect(document.querySelector('[data-review-success]').hidden).toBe(true);
        });
    });

    it('removes modal listeners on destroy', async () => {
        const api = buildSubmitApi();
        const ugc = new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        ugc.destroy();

        document.querySelector('[data-review-modal-open]').click();
        // Listener removed → modal stays hidden.
        expect(document.querySelector('[data-review-modal]').hidden).toBe(true);
    });
});

describe('UgcProduct (#41 — tailored vehicle field by scenario, SRS §3.4.1)', () => {
    // Archetype JSON with one make, two models — Cooper (two generations) and
    // Clubman (one) — to exercise the make → model → generation cascade. Object
    // generation nodes per Pass 27; gen `name` is the generation-with-year-range
    // segment ONLY (Pass 35). make_model_index keys model/generation maps with
    // the make-slug prefix (mini); buildArchetypeFitmentList strips it to bare
    // slugs (cooper / f56), and the full canonical label is the make + model +
    // generation concatenation ("MINI Cooper F56 2014 to 2024").
    const ARCHETYPE_DATA = {
        make_model_index: {
            mini: {
                name: 'MINI',
                models: {
                    minicooper: {
                        name: 'Cooper',
                        generations: {
                            minif56: { name: 'F56 2014 to 2024', fitment_id: 87 },
                            minir53: { name: 'R53 2002 to 2006', fitment_id: 42 },
                        },
                    },
                    miniclubman: {
                        name: 'Clubman',
                        generations: {
                            minif54: { name: 'F54 2016 to 2024', fitment_id: 91 },
                        },
                    },
                },
            },
        },
    };

    const UNIVERSAL_DATA = { universal_product: true };

    // Drive a waterfall tier <select> and fire the change the component listens
    // for, so dependent tiers repopulate.
    const setTier = (scope, tier, value) => {
        const el = document.querySelector(`[data-${scope}-vehicle] [data-vehicle-tier="${tier}"]`);
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el;
    };

    const buildSubmitApi = (validateResult = null) => ({
        getReviews: jest.fn(() => Promise.resolve({ ok: true, status: 200, data: buildEnvelope() })),
        getQuestions: jest.fn(() => Promise.resolve({
            ok: true, status: 200, data: { items: [], total: 0, page: 1, per_page: 10 },
        })),
        validateToken: jest.fn(() => Promise.resolve(
            validateResult || { ok: true, status: 200, data: { archetype_id: ARCHETYPE_ID, alias_id: 4821, fitment_id: 87 } },
        )),
        postReview: jest.fn(() => Promise.resolve({ ok: true, status: 201, data: { id: 1 } })),
        postQuestion: jest.fn(() => Promise.resolve({ ok: true, status: 201, data: { id: 1 } })),
    });

    const mountScaffoldB = () => {
        document.body.innerHTML = `
            <a id="product-rating" data-product-rating></a>
            <div data-reviews-toolbar>
                <button type="button" data-review-modal-open>Write a Review</button>
            </div>
            <div id="product-reviews"></div>
            <div data-reviews-pagination></div>

            <div class="cs-ugc-modal" data-review-modal hidden>
                <div class="cs-ugc-modal-dialog">
                    <form data-review-form novalidate>
                        <p data-review-error hidden></p>
                        <p data-review-success hidden>Thanks!</p>
                        <div data-review-fields>
                            <select name="rating" data-review-field="rating"><option value="">—</option><option value="5">5</option></select>
                            <input type="text" name="title" data-review-field="title">
                            <textarea name="body" data-review-field="body"></textarea>
                            <input type="text" name="author" data-review-field="author">
                            <div class="cs-ugc-vehicle" data-review-vehicle></div>
                            <label class="cs-ugc-honeypot"><input type="text" name="website" data-review-field="website"></label>
                            <input type="hidden" name="cf_turnstile_token" data-review-field="cf_turnstile_token">
                            <button type="submit" data-review-submit>Submit Review</button>
                        </div>
                    </form>
                </div>
            </div>

            <div data-questions-toolbar>
                <button type="button" data-question-modal-open>Ask a Question</button>
            </div>
            <div id="product-questions"></div>
            <div data-questions-pagination></div>

            <div class="cs-ugc-modal" data-question-modal hidden>
                <div class="cs-ugc-modal-dialog">
                    <form data-question-form novalidate>
                        <p data-question-error hidden></p>
                        <p data-question-success hidden>Thanks!</p>
                        <div data-question-fields>
                            <textarea name="body" data-question-field="body"></textarea>
                            <input type="text" name="author" data-question-field="author">
                            <div class="cs-ugc-vehicle" data-question-vehicle></div>
                            <label class="cs-ugc-honeypot"><input type="text" name="website" data-question-field="website"></label>
                            <input type="hidden" name="cf_turnstile_token" data-question-field="cf_turnstile_token">
                            <button type="submit" data-question-submit>Submit Question</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    };

    const fillReview = (scope = 'review', overrides = {}) => {
        const base = scope === 'review'
            ? { rating: '5', title: 'Great', body: 'Happy.', author: 'Jane D.', website: '', cf_turnstile_token: '0.t' }
            : { body: 'Fit F56?', author: 'Jane D.', website: '', cf_turnstile_token: '0.t' };
        const values = { ...base, ...overrides };
        Object.keys(values).forEach((name) => {
            const el = document.querySelector(`[data-${scope}-form] [name="${name}"]`);
            if (el) el.value = values[name];
        });
    };

    const submitForm = (scope) => {
        document.querySelector(`[data-${scope}-form]`).dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
    };

    beforeEach(() => {
        mountScaffoldB();
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        document.body.innerHTML = '';
        window.history.replaceState({}, '', '/');
    });

    describe('non-verified review — required make/model/generation waterfall', () => {
        it('renders three dependent tier <select>s constrained to the archetype, no checkbox', async () => {
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildSubmitApi(), undefined, undefined, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();

            const container = document.querySelector('[data-review-vehicle]');
            expect(container.querySelector('[data-vehicle-tier="make"]')).not.toBeNull();
            expect(container.querySelector('[data-vehicle-tier="model"]')).not.toBeNull();
            expect(container.querySelector('[data-vehicle-tier="generation"]')).not.toBeNull();
            // No append/opt-in checkbox anywhere anymore (#41).
            expect(container.querySelector('[data-vehicle-append]')).toBeNull();
            // Required marker present on the review waterfall.
            expect(container.querySelector('[data-vehicle-required]')).not.toBeNull();

            const makeLabels = Array.from(container.querySelector('[data-vehicle-tier="make"]').options).map(o => o.textContent);
            expect(makeLabels).toContain('MINI');
        });

        it('cascades make → model → generation and auto-selects single options + newest generation', async () => {
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildSubmitApi(), undefined, undefined, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();

            // Single make auto-selects nothing on its own here, so pick it.
            setTier('review', 'make', 'mini');
            const modelSelect = document.querySelector('[data-review-vehicle] [data-vehicle-tier="model"]');
            const modelSlugs = Array.from(modelSelect.options).map(o => o.value).filter(Boolean);
            expect(modelSlugs).toEqual(['clubman', 'cooper']);

            // Cooper has two generations; selecting it populates + auto-selects the
            // newest (first in descending label order — 'R53…' sorts before 'F56…',
            // mirroring the add-to-cart picker).
            setTier('review', 'model', 'cooper');
            const genSelect = document.querySelector('[data-review-vehicle] [data-vehicle-tier="generation"]');
            const genLabels = Array.from(genSelect.options)
                .filter(o => o.value)
                .map(o => o.textContent);
            expect(genLabels).toEqual(['R53 2002 to 2006', 'F56 2014 to 2024']);
            expect(genSelect.value).toBe('42');

            // Clubman has a single generation — auto-selected on model change.
            setTier('review', 'model', 'clubman');
            const clubmanGen = document.querySelector('[data-review-vehicle] [data-vehicle-tier="generation"]');
            expect(clubmanGen.value).toBe('91');
        });

        it('blocks submit until a generation is chosen, surfacing a validation message', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, undefined, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview('review');
            submitForm('review');
            await flush();

            // No vehicle picked → submit blocked, no POST.
            expect(api.postReview).not.toHaveBeenCalled();
            const error = document.querySelector('[data-review-error]');
            expect(error.hidden).toBe(false);
            expect(error.textContent).toContain('vehicle');
        });

        it('submits the full canonical vehicle_label + fitment_id once a generation is chosen', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, undefined, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            setTier('review', 'make', 'mini');
            setTier('review', 'model', 'cooper');
            setTier('review', 'generation', '42');

            fillReview('review');
            submitForm('review');
            await flush();

            const payload = api.postReview.mock.calls[0][0];
            expect(payload.fitment_id).toBe(42);
            expect(payload.vehicle_label).toBe('MINI Cooper R53 2002 to 2006');
        });

        it('pre-fills all three tiers from the garage vehicle when it is an archetype fitment', async () => {
            // Garage slugs are the bare model/generation slugs the flat list emits.
            const global = buildGlobalStateManager({ vehicle: { make: 'mini', model: 'cooper', generation: 'f56' } });
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildSubmitApi(), undefined, global, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();

            const container = document.querySelector('[data-review-vehicle]');
            expect(container.querySelector('[data-vehicle-tier="make"]').value).toBe('mini');
            expect(container.querySelector('[data-vehicle-tier="model"]').value).toBe('cooper');
            expect(container.querySelector('[data-vehicle-tier="generation"]').value).toBe('87');
        });

        it('does not pre-fill when the garage vehicle is not one of the archetype fitments', async () => {
            const global = buildGlobalStateManager({ vehicle: { make: 'honda', model: 'civic', generation: 'eg' } });
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildSubmitApi(), undefined, global, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();

            const container = document.querySelector('[data-review-vehicle]');
            expect(container.querySelector('[data-vehicle-tier="make"]').value).toBe('');
            expect(container.querySelector('[data-vehicle-tier="generation"]').value).toBe('');
        });
    });

    describe('Q&A — optional make/model/generation waterfall', () => {
        it('shows the same waterfall but allows submit with no vehicle', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, undefined, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-question-modal-open]').click();
            const container = document.querySelector('[data-question-vehicle]');
            expect(container.querySelector('[data-vehicle-tier="make"]')).not.toBeNull();
            // Not required for Q&A.
            expect(container.querySelector('[data-vehicle-required]')).toBeNull();

            fillReview('question');
            submitForm('question');
            await flush();

            const payload = api.postQuestion.mock.calls[0][0];
            expect(payload).not.toHaveProperty('fitment_id');
            expect(payload).not.toHaveProperty('vehicle_label');
        });

        it('submits the chosen vehicle when the asker picks one', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, undefined, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-question-modal-open]').click();
            setTier('question', 'make', 'mini');
            setTier('question', 'model', 'cooper');
            setTier('question', 'generation', '42');

            fillReview('question');
            submitForm('question');
            await flush();

            const payload = api.postQuestion.mock.calls[0][0];
            expect(payload.fitment_id).toBe(42);
            expect(payload.vehicle_label).toBe('MINI Cooper R53 2002 to 2006');
        });
    });

    describe('verified reviewer (token fitment) — silent attach', () => {
        it('renders NO vehicle UI — no waterfall, no checkbox, no confirmation line', async () => {
            const global = buildGlobalStateManager({ registry: F56_REGISTRY });
            window.history.replaceState({}, '', '/products/x?ugc_token=abc123');
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildSubmitApi(), undefined, global, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();

            const container = document.querySelector('[data-review-vehicle]');
            expect(container.innerHTML).toBe('');
            expect(container.querySelector('[data-vehicle-tier="make"]')).toBeNull();
            expect(container.querySelector('[data-vehicle-append]')).toBeNull();
        });

        it('silently attaches the token fitment_id + full canonical label resolved from make_model_index', async () => {
            const global = buildGlobalStateManager({ registry: F56_REGISTRY });
            window.history.replaceState({}, '', '/products/x?ugc_token=abc123');
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview('review');
            submitForm('review');
            await flush();

            const payload = api.postReview.mock.calls[0][0];
            expect(payload.fitment_id).toBe(87);
            expect(payload.vehicle_label).toBe('MINI Cooper F56 2014 to 2024');
            expect(payload.ugc_token).toBe('abc123');
        });

        it('resolves the verified label from make_model_index (correct make) when the registry slug collides (#209)', async () => {
            // The registry's "3" slug is shared by two makes; makeNameForModel
            // returns the first brand listing it (Polestar here), so the registry
            // alone would mislabel a Mazda 3 fitment. The archetype make_model_index
            // is make-namespaced, so resolving from it yields the correct make.
            const collidedRegistry = {
                brands: {
                    polestar: { name: 'Polestar', models: ['3'] },
                    mazda: { name: 'Mazda', models: ['3'] },
                },
                models: {
                    3: { name: '3', generations: { shared: { name: 'gen', fitment_id: 555 } } },
                },
            };
            const mazda3Archetype = {
                make_model_index: {
                    mazda: {
                        name: 'Mazda',
                        models: {
                            mazda3: {
                                name: '3',
                                generations: { mazda34th: { name: '4th gen BP 2019 to 2026', fitment_id: 555 } },
                            },
                        },
                    },
                },
            };
            const global = buildGlobalStateManager({ registry: collidedRegistry });
            window.history.replaceState({}, '', '/products/mazda-3?ugc_token=tok');
            const api = buildSubmitApi({ ok: true, status: 200, data: { archetype_id: ARCHETYPE_ID, alias_id: 1, fitment_id: 555 } });
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, global, mazda3Archetype);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview('review');
            submitForm('review');
            await flush();

            const payload = api.postReview.mock.calls[0][0];
            expect(payload.fitment_id).toBe(555);
            expect(payload.vehicle_label).toBe('Mazda 3 4th gen BP 2019 to 2026');
            expect(payload.vehicle_label).not.toContain('Polestar');
        });

        it('falls back to the waterfall when the token carries no fitment_id', async () => {
            const validateResult = { ok: true, status: 200, data: { archetype_id: ARCHETYPE_ID, alias_id: 4821, fitment_id: null } };
            window.history.replaceState({}, '', '/products/x?ugc_token=abc123');
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildSubmitApi(validateResult), undefined, undefined, ARCHETYPE_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            // No token fitment → the non-verified waterfall path renders instead.
            expect(document.querySelector('[data-review-vehicle] [data-vehicle-tier="make"]')).not.toBeNull();
        });
    });

    describe('universal products', () => {
        it('renders no vehicle section in any path and submits with no fitment', async () => {
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, undefined, undefined, UNIVERSAL_DATA);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            expect(document.querySelector('[data-review-vehicle]').innerHTML).toBe('');
            expect(document.querySelector('[data-review-vehicle] [data-vehicle-tier="make"]')).toBeNull();

            fillReview('review');
            submitForm('review');
            await flush();

            const payload = api.postReview.mock.calls[0][0];
            expect(payload).not.toHaveProperty('fitment_id');
            expect(payload).not.toHaveProperty('vehicle_label');
        });
    });
});

describe('UgcProduct (slice 6f — verified-purchaser token capture)', () => {
    // Reviews/questions list fetches resolve inertly; validateToken and postReview
    // are injectable spies for the capture and submit paths.
    const buildTokenApi = ({
        validateResult = { ok: true, status: 200, data: { archetype_id: ARCHETYPE_ID, alias_id: 4821 } },
        postResult = { ok: true, status: 201, data: { id: 1 } },
    } = {}) => ({
        getReviews: jest.fn(() => Promise.resolve({ ok: true, status: 200, data: buildEnvelope() })),
        getQuestions: jest.fn(() => Promise.resolve({
            ok: true, status: 200, data: { items: [], total: 0, page: 1, per_page: 10 },
        })),
        validateToken: jest.fn(() => Promise.resolve(validateResult)),
        postReview: jest.fn(() => Promise.resolve(postResult)),
        postQuestion: jest.fn(() => Promise.resolve(postResult)),
    });

    const mountTokenScaffold = () => {
        document.body.innerHTML = `
            <a id="product-rating" data-product-rating></a>
            <div data-reviews-toolbar>
                <button type="button" data-review-modal-open>Write a Review</button>
            </div>
            <div id="product-reviews"></div>
            <div data-reviews-pagination></div>

            <div class="cs-ugc-modal" data-review-modal hidden>
                <div class="cs-ugc-modal-dialog">
                    <form data-review-form novalidate>
                        <p data-review-error hidden></p>
                        <p data-review-success hidden>Thanks!</p>
                        <div data-review-fields>
                            <select name="rating" data-review-field="rating">
                                <option value="">—</option>
                                <option value="5">5</option>
                            </select>
                            <input type="text" name="title" data-review-field="title">
                            <textarea name="body" data-review-field="body"></textarea>
                            <input type="text" name="author" data-review-field="author">
                            <input type="text" name="vehicle_label" data-review-field="vehicle_label">
                            <label class="cs-ugc-honeypot"><input type="text" name="website" data-review-field="website"></label>
                            <div data-review-turnstile data-ugc-turnstile-sitekey=""></div>
                            <input type="hidden" name="cf_turnstile_token" data-review-field="cf_turnstile_token">
                            <button type="submit" data-review-submit>Submit Review</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    };

    const setReviewField = (name, value) => {
        document.querySelector(`[data-review-form] [name="${name}"]`).value = value;
    };

    const fillReview = (overrides = {}) => {
        const values = {
            rating: '5',
            title: 'Great product',
            body: 'Really happy with this.',
            author: 'Jane D.',
            vehicle_label: '',
            website: '',
            cf_turnstile_token: '0.test-token',
            ...overrides,
        };
        Object.keys(values).forEach(name => setReviewField(name, values[name]));
    };

    const submitReview = () => {
        fillReview();
        document.querySelector('[data-review-form]').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
    };

    // Point window.location at a URL carrying the given query string, without a
    // navigation, then spy on replaceState so the strip can be asserted.
    const setUrl = (search) => {
        window.history.replaceState({}, '', `/products/platypus-mount${search}`);
        return jest.spyOn(window.history, 'replaceState');
    };

    beforeEach(() => {
        mountTokenScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        window.history.replaceState({}, '', '/');
        jest.restoreAllMocks();
    });

    describe('URL strip (SRS §3.4.1)', () => {
        it('strips ugc_token from the URL via history.replaceState', async () => {
            const spy = setUrl('?ugc_token=abc123');
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildTokenApi());
            await flush();

            expect(spy).toHaveBeenCalled();
            expect(window.location.search).not.toContain('ugc_token');
        });

        it('preserves other query params and the path when stripping', async () => {
            const spy = setUrl('?utm=email&ugc_token=abc123');
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildTokenApi());
            await flush();

            const newUrl = spy.mock.calls[0][2];
            expect(newUrl).toBe('/products/platypus-mount?utm=email');
            expect(window.location.search).toContain('utm=email');
            expect(window.location.search).not.toContain('ugc_token');
        });

        it('validates the captured token via GET /api/token/validate', async () => {
            setUrl('?ugc_token=abc123');
            const api = buildTokenApi();
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(api.validateToken).toHaveBeenCalledWith('abc123');
        });

        it('does not touch the URL or validate when no token is present', async () => {
            const spy = setUrl('');
            const api = buildTokenApi();
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(api.validateToken).not.toHaveBeenCalled();
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('token on submit (SRS §3.2.4)', () => {
        it('sends ugc_token on review submit after a valid token is captured', async () => {
            setUrl('?ugc_token=abc123');
            const api = buildTokenApi();
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            submitReview();
            await flush();

            expect(api.postReview.mock.calls[0][0].ugc_token).toBe('abc123');
        });
    });

    describe('graceful degradation', () => {
        it('omits ugc_token when the token is invalid/expired (submission proceeds unverified)', async () => {
            setUrl('?ugc_token=expired');
            const api = buildTokenApi({
                validateResult: {
                    ok: false, status: 400, message: 'Invalid', error: 'Invalid',
                },
            });
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            submitReview();
            await flush();

            expect(api.postReview).toHaveBeenCalledTimes(1);
            expect(api.postReview.mock.calls[0][0]).not.toHaveProperty('ugc_token');
        });

        it('still strips an invalid token from the URL', async () => {
            const spy = setUrl('?ugc_token=expired');
            const api = buildTokenApi({
                validateResult: {
                    ok: false, status: 400, message: 'Invalid', error: 'Invalid',
                },
            });
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(spy).toHaveBeenCalled();
            expect(window.location.search).not.toContain('ugc_token');
        });

        it('omits ugc_token on submit when no token was in the URL', async () => {
            setUrl('');
            const api = buildTokenApi();
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            submitReview();
            await flush();

            expect(api.postReview.mock.calls[0][0]).not.toHaveProperty('ugc_token');
        });
    });

    describe('auto-open from the tokenized email link', () => {
        const reviewModal = () => document.querySelector('[data-review-modal]');

        it('opens the review submission modal when landing with a valid token', async () => {
            setUrl('?ugc_token=abc123');
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildTokenApi());
            await flush();

            expect(reviewModal().hidden).toBe(false);
        });

        it('still opens the modal when the token is invalid/expired (unverified)', async () => {
            setUrl('?ugc_token=expired');
            const api = buildTokenApi({ validateResult: { ok: false, status: 400, error: 'Invalid' } });
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(reviewModal().hidden).toBe(false);
        });

        it('leaves the modal closed when no token is present', async () => {
            setUrl('');
            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildTokenApi());
            await flush();

            expect(reviewModal().hidden).toBe(true);
        });

        it('activates the reviews tab when the tab strip is present', async () => {
            setUrl('?ugc_token=abc123');
            const tabs = document.createElement('ul');
            tabs.className = 'tabs';
            tabs.innerHTML = '<li class="tab"><a class="tab-title" href="#tab-reviews">Reviews</a></li>';
            document.body.appendChild(tabs);
            // preventDefault mirrors Foundation's tab handler and stops jsdom
            // from logging a not-implemented navigation on the hash link.
            const tabClick = jest.fn(event => event.preventDefault());
            document.querySelector('ul.tabs a[href="#tab-reviews"]').addEventListener('click', tabClick);

            // eslint-disable-next-line no-new
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), buildTokenApi());
            await flush();

            expect(tabClick).toHaveBeenCalled();
            expect(reviewModal().hidden).toBe(false);
        });
    });
});

describe('UgcProduct (slice #9 — media upload flow)', () => {
    // Reviews/questions list fetches resolve inertly; presign/confirm/postReview
    // are injectable spies, and mediaPut stands in for the raw PUT to DO Spaces.
    const buildMediaApi = ({
        presignResult = {
            ok: true,
            status: 200,
            data: {
                presigned_url: 'https://spaces.example/raw/abc?sig=1',
                raw_url: 'https://cdn.example/ugc/media/raw/abc.jpg',
            },
        },
        confirmResult = {
            ok: true,
            status: 200,
            data: {
                confirmed: true, type: 'photo', url: 'https://cdn.example/ugc/media/uuid/full.jpg', poster_url: null,
            },
        },
        postResult = { ok: true, status: 201, data: { id: 1 } },
    } = {}) => ({
        getReviews: jest.fn(() => Promise.resolve({ ok: true, status: 200, data: buildEnvelope() })),
        getQuestions: jest.fn(() => Promise.resolve({
            ok: true, status: 200, data: { items: [], total: 0, page: 1, per_page: 10 },
        })),
        presignMedia: jest.fn(() => Promise.resolve(presignResult)),
        confirmMedia: jest.fn(() => Promise.resolve(confirmResult)),
        postReview: jest.fn(() => Promise.resolve(postResult)),
        postQuestion: jest.fn(() => Promise.resolve({ ok: true, status: 201, data: { id: 1 } })),
    });

    const okPut = jest.fn(() => Promise.resolve({ ok: true, status: 200 }));

    // Build a File of an exact byte size without allocating real bytes, so size
    // limits can be exercised cheaply. jsdom honours the size of the blob parts,
    // so we pass a single string part of the requested length when small, else a
    // fake part whose `size` jsdom reads.
    const makeFile = (name, type, size = 1024) => {
        const file = new File(['x'], name, { type });
        Object.defineProperty(file, 'size', { value: size });
        return file;
    };

    const mountMediaScaffold = () => {
        document.body.innerHTML = `
            <a id="product-rating" data-product-rating></a>
            <div data-reviews-toolbar>
                <button type="button" data-review-modal-open>Write a Review</button>
            </div>
            <div id="product-reviews"></div>
            <div data-reviews-pagination></div>

            <div class="cs-ugc-modal" data-review-modal hidden>
                <div class="cs-ugc-modal-dialog">
                    <form data-review-form novalidate>
                        <p data-review-error hidden></p>
                        <p data-review-success hidden>Thanks!</p>
                        <div data-review-fields>
                            <select name="rating" data-review-field="rating">
                                <option value="">—</option>
                                <option value="5">5</option>
                            </select>
                            <input type="text" name="title" data-review-field="title">
                            <textarea name="body" data-review-field="body"></textarea>
                            <input type="text" name="author" data-review-field="author">
                            <input type="text" name="vehicle_label" data-review-field="vehicle_label">
                            <input type="file" name="media" data-review-field="media" multiple>
                            <p data-review-processing hidden></p>
                            <label class="cs-ugc-honeypot"><input type="text" name="website" data-review-field="website"></label>
                            <div data-review-turnstile data-ugc-turnstile-sitekey=""></div>
                            <input type="hidden" name="cf_turnstile_token" data-review-field="cf_turnstile_token">
                            <button type="submit" data-review-submit>Submit Review</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    };

    const setReviewField = (name, value) => {
        document.querySelector(`[data-review-form] [name="${name}"]`).value = value;
    };

    const fillReview = (overrides = {}) => {
        const values = {
            rating: '5',
            title: 'Great product',
            body: 'Really happy with this.',
            author: 'Jane D.',
            vehicle_label: '',
            website: '',
            cf_turnstile_token: '0.test-token',
            ...overrides,
        };
        Object.keys(values).forEach(name => setReviewField(name, values[name]));
    };

    // Seed the file input's FileList with the given files (FileList is read-only,
    // so define the `files` property directly).
    const attachFiles = (files) => {
        const input = document.querySelector('[data-review-form] [name="media"]');
        Object.defineProperty(input, 'files', { value: files, configurable: true });
    };

    const submitReview = () => {
        document.querySelector('[data-review-form]').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
    };

    beforeEach(() => {
        mountMediaScaffold();
        okPut.mockClear();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('client-side validation (before presign)', () => {
        it('accepts a valid photo and a valid video', async () => {
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([
                makeFile('a.jpg', 'image/jpeg', 1024),
                makeFile('clip.mp4', 'video/mp4', 1024),
            ]);
            submitReview();
            await flush();

            // Both files were presigned → validation passed.
            expect(api.presignMedia).toHaveBeenCalledTimes(2);
            expect(api.postReview).toHaveBeenCalledTimes(1);
            expect(document.querySelector('[data-review-error]').hidden).toBe(true);
        });

        it('rejects an unsupported file type before any presign', async () => {
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([makeFile('doc.pdf', 'application/pdf', 1024)]);
            submitReview();
            await flush();

            expect(api.presignMedia).not.toHaveBeenCalled();
            expect(api.postReview).not.toHaveBeenCalled();
            const error = document.querySelector('[data-review-error]');
            expect(error.hidden).toBe(false);
            expect(error.textContent).toContain('Unsupported file type');
        });

        it('rejects a photo larger than 10 MB', async () => {
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([makeFile('big.png', 'image/png', (10 * 1024 * 1024) + 1)]);
            submitReview();
            await flush();

            expect(api.presignMedia).not.toHaveBeenCalled();
            expect(document.querySelector('[data-review-error]').textContent).toContain('10 MB');
        });

        it('rejects a video larger than 50 MB', async () => {
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([makeFile('big.mov', 'video/quicktime', (50 * 1024 * 1024) + 1)]);
            submitReview();
            await flush();

            expect(api.presignMedia).not.toHaveBeenCalled();
            expect(document.querySelector('[data-review-error]').textContent).toContain('50 MB');
        });

        it('rejects more than 3 photos', async () => {
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([
                makeFile('1.jpg', 'image/jpeg', 1024),
                makeFile('2.jpg', 'image/jpeg', 1024),
                makeFile('3.jpg', 'image/jpeg', 1024),
                makeFile('4.jpg', 'image/jpeg', 1024),
            ]);
            submitReview();
            await flush();

            expect(api.presignMedia).not.toHaveBeenCalled();
            expect(document.querySelector('[data-review-error]').textContent).toContain('up to 3 photos');
        });

        it('rejects more than 1 video', async () => {
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([
                makeFile('a.mp4', 'video/mp4', 1024),
                makeFile('b.mov', 'video/quicktime', 1024),
            ]);
            submitReview();
            await flush();

            expect(api.presignMedia).not.toHaveBeenCalled();
            expect(document.querySelector('[data-review-error]').textContent).toContain('up to 1 video');
        });
    });

    describe('upload pipeline (presign → PUT → confirm)', () => {
        it('runs presign, raw PUT, then confirm for each file', async () => {
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            const file = makeFile('a.jpg', 'image/jpeg', 1024);
            attachFiles([file]);
            submitReview();
            await flush();

            expect(api.presignMedia).toHaveBeenCalledWith(file);
            // Raw PUT targets the absolute presigned URL, not ugcApi's base.
            expect(okPut).toHaveBeenCalledWith(
                'https://spaces.example/raw/abc?sig=1',
                expect.objectContaining({ method: 'PUT', body: file }),
            );
            expect(api.confirmMedia).toHaveBeenCalledWith('https://cdn.example/ugc/media/raw/abc.jpg');
        });

        it('aborts the submit when a raw PUT fails', async () => {
            const failingPut = jest.fn(() => Promise.resolve({ ok: false, status: 403 }));
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, failingPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([makeFile('a.jpg', 'image/jpeg', 1024)]);
            submitReview();
            await flush();

            expect(api.postReview).not.toHaveBeenCalled();
            expect(document.querySelector('[data-review-error]').textContent).toContain('failed to upload');
        });

        it('aborts the submit when confirm resolves not-ok', async () => {
            const api = buildMediaApi({
                confirmResult: {
                    ok: false, status: 422, message: 'Media processing failure', error: 'Media processing failure',
                },
            });
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([makeFile('a.jpg', 'image/jpeg', 1024)]);
            submitReview();
            await flush();

            expect(api.postReview).not.toHaveBeenCalled();
        });
    });

    describe('ordered media_urls assembly (SRS §3.4.4)', () => {
        it('sends media_urls in upload order (photo then video) with index = sort_order', async () => {
            // Confirm returns a distinct URL per call so order is observable.
            let confirmCall = 0;
            const api = buildMediaApi();
            api.confirmMedia = jest.fn(() => {
                const urls = [
                    { ok: true, status: 200, data: { type: 'photo', url: 'https://cdn.example/photo/full.jpg' } },
                    { ok: true, status: 200, data: { type: 'video', url: 'https://cdn.example/video/video.mp4' } },
                ];
                const result = urls[confirmCall];
                confirmCall += 1;
                return Promise.resolve(result);
            });

            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([
                makeFile('photo.jpg', 'image/jpeg', 1024),
                makeFile('clip.mp4', 'video/mp4', 1024),
            ]);
            submitReview();
            await flush();

            expect(api.postReview.mock.calls[0][0].media_urls).toEqual([
                'https://cdn.example/photo/full.jpg',
                'https://cdn.example/video/video.mp4',
            ]);
        });

        it('omits media_urls entirely when no files are attached', async () => {
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            submitReview();
            await flush();

            expect(api.presignMedia).not.toHaveBeenCalled();
            expect(api.postReview.mock.calls[0][0]).not.toHaveProperty('media_urls');
        });
    });

    describe('"Processing…" state', () => {
        it('shows the processing state during confirm and clears it after', async () => {
            // Hold confirm open so the processing state is observable mid-flight.
            let resolveConfirm;
            const api = buildMediaApi();
            api.confirmMedia = jest.fn(() => new Promise((resolve) => { resolveConfirm = resolve; }));

            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            attachFiles([makeFile('a.jpg', 'image/jpeg', 1024)]);
            submitReview();
            await flush();

            const processing = document.querySelector('[data-review-processing]');
            expect(processing.hidden).toBe(false);
            expect(processing.textContent).toContain('Processing');

            resolveConfirm({ ok: true, status: 200, data: { type: 'photo', url: 'https://cdn.example/full.jpg' } });
            await flush();

            expect(processing.hidden).toBe(true);
        });

        it('does not show the processing state when no files are attached', async () => {
            const api = buildMediaApi();
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api, okPut);
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            fillReview();
            submitReview();
            await flush();

            expect(document.querySelector('[data-review-processing]').hidden).toBe(true);
        });
    });
});

describe('UgcProduct (#30 — review media display)', () => {
    // §3.2.1 media item fixtures. Photo: thumb_url/medium_url set, poster_url
    // null. Video: poster_url set, thumb_url/medium_url null.
    const photoMedia = (overrides = {}) => ({
        id: 9,
        url: 'https://cdn.example/ugc/media/u1/full.jpg',
        thumb_url: 'https://cdn.example/ugc/media/u1/thumb.jpg',
        medium_url: 'https://cdn.example/ugc/media/u1/medium.jpg',
        poster_url: null,
        type: 'photo',
        sort_order: 0,
        ...overrides,
    });

    const videoMedia = (overrides = {}) => ({
        id: 10,
        url: 'https://cdn.example/ugc/media/u2/video.mp4',
        thumb_url: null,
        medium_url: null,
        poster_url: 'https://cdn.example/ugc/media/u2/poster.jpg',
        type: 'video',
        sort_order: 1,
        ...overrides,
    });

    const reviewWith = (media, overrides = {}) => ({
        id: 1,
        author: 'Jane D.',
        rating: 5,
        title: 'Great product',
        body: 'Really happy with this.',
        date: '2026-01-15T00:00:00Z',
        media,
        ...overrides,
    });

    const mountDisplayScaffold = () => {
        document.body.innerHTML = `
            <a id="product-rating" data-product-rating></a>
            <div data-reviews-toolbar>
                <select data-reviews-control="sort">
                    <option value="date_desc">Newest</option>
                    <option value="date_asc">Oldest</option>
                </select>
            </div>
            <section data-ugc-media-grid></section>
            <div id="product-reviews"></div>
            <div data-reviews-pagination></div>
            <div data-ugc-lightbox hidden>
                <div data-ugc-lightbox-close></div>
                <button type="button" data-ugc-lightbox-close>&times;</button>
                <button type="button" data-ugc-lightbox-prev hidden>&lsaquo;</button>
                <button type="button" data-ugc-lightbox-next hidden>&rsaquo;</button>
                <div data-ugc-lightbox-content></div>
            </div>
            <div data-ugc-gallery hidden>
                <div data-ugc-gallery-close></div>
                <button type="button" data-ugc-gallery-close>&times;</button>
                <div data-ugc-gallery-grid></div>
                <button type="button" data-ugc-gallery-more hidden>Load more</button>
            </div>
        `;
    };

    const grid = () => document.querySelector('[data-ugc-media-grid]');
    const galleryModal = () => document.querySelector('[data-ugc-gallery]');
    const lightbox = () => document.querySelector('[data-ugc-lightbox]');
    const lightboxContent = () => document.querySelector('[data-ugc-lightbox-content]');

    beforeEach(() => {
        mountDisplayScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('per-review thumbnail strip', () => {
        it('renders a lazy-loaded photo thumbnail with descriptive alt text after the body', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([photoMedia()])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const strip = document.querySelector('#product-reviews .cs-review-media');
            expect(strip).not.toBeNull();

            const img = strip.querySelector('.cs-media-tile img');
            expect(img.getAttribute('src')).toEqual('https://cdn.example/ugc/media/u1/thumb.jpg');
            expect(img.getAttribute('loading')).toEqual('lazy');
            expect(img.getAttribute('alt')).toEqual("Photo from Jane D.'s review");
        });

        it('renders a video tile as its poster frame with a play affordance and aria label', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([videoMedia()])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const tile = document.querySelector('#product-reviews .cs-media-tile--video');
            expect(tile).not.toBeNull();
            expect(tile.getAttribute('aria-label')).toEqual("Play video from Jane D.'s review");
            expect(tile.querySelector('img').getAttribute('src')).toEqual('https://cdn.example/ugc/media/u2/poster.jpg');
            expect(tile.querySelector('.cs-media-tile-play')).not.toBeNull();
        });

        it('renders no media strip when the review has an empty media array', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(document.querySelector('.cs-review-media')).toBeNull();
        });

        it('preserves the server-supplied sort_order array ordering (index 0 first)', async () => {
            const items = [reviewWith([
                photoMedia({ thumb_url: 'https://cdn.example/first.jpg', sort_order: 0 }),
                videoMedia({ sort_order: 1 }),
                photoMedia({ id: 11, thumb_url: 'https://cdn.example/third.jpg', sort_order: 2 }),
            ])];
            const api = buildApi(okEnvelope({ items, total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const srcs = Array.from(document.querySelectorAll('.cs-review-media img'))
                .map(img => img.getAttribute('src'));
            expect(srcs).toEqual([
                'https://cdn.example/first.jpg',
                'https://cdn.example/ugc/media/u2/poster.jpg',
                'https://cdn.example/third.jpg',
            ]);
        });

        it('falls down the thumb_url → poster_url → medium_url → url chain', async () => {
            const items = [reviewWith([
                photoMedia({ thumb_url: null }),
                photoMedia({ id: 12, thumb_url: null, medium_url: null, url: 'https://cdn.example/only-full.jpg' }),
            ])];
            const api = buildApi(okEnvelope({ items, total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const srcs = Array.from(document.querySelectorAll('.cs-review-media img'))
                .map(img => img.getAttribute('src'));
            // First photo: thumb null, poster null (photo) → medium_url. Second:
            // thumb/medium null → url.
            expect(srcs).toEqual([
                'https://cdn.example/ugc/media/u1/medium.jpg',
                'https://cdn.example/only-full.jpg',
            ]);
        });

        it('drops media entries without a url and labels missing authors generically', async () => {
            const items = [reviewWith(
                [photoMedia({ url: null }), photoMedia({ id: 13 })],
                { author: '' },
            )];
            const api = buildApi(okEnvelope({ items, total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const imgs = document.querySelectorAll('.cs-review-media img');
            expect(imgs).toHaveLength(1);
            expect(imgs[0].getAttribute('alt')).toEqual('Photo from a customer review');
        });
    });

    describe('top-level photo thumbnail grid', () => {
        it('sources tiles from the media of the fetched reviews, in review order', async () => {
            const items = [
                reviewWith([photoMedia()], { id: 1 }),
                reviewWith([videoMedia()], { id: 2, author: 'Bob' }),
            ];
            const api = buildApi(okEnvelope({ items, total: 2 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const tiles = grid().querySelectorAll('[data-ugc-media-tile]');
            expect(tiles).toHaveLength(2);
            expect(tiles[0].dataset.ugcMediaType).toEqual('photo');
            expect(tiles[1].dataset.ugcMediaType).toEqual('video');
            expect(grid().style.visibility).toEqual('visible');
        });

        it('shows the rating summary alone when no fetched review has media', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const summary = grid().querySelector('.cs-ugc-media-grid-summary');
            expect(summary).not.toBeNull();
            expect(summary.querySelector('.cs-ugc-summary-average').textContent).toEqual('4.7');
            expect(summary.querySelector('.cs-ugc-summary-count').textContent).toEqual('36 reviews');
            expect(grid().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(0);
            expect(grid().querySelector('.cs-ugc-media-grid-title')).toBeNull();
            expect(grid().style.visibility).toEqual('visible');
        });

        it('renders the per-score histogram from archetype_rating_breakdown (§3.2.1)', async () => {
            const api = buildApi(okEnvelope({
                items: [reviewWith([])],
                total: 1,
                archetype_review_count: 36,
                archetype_rating_breakdown: {
                    1: 0, 2: 1, 3: 2, 4: 5, 5: 28,
                },
            }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const rows = grid().querySelectorAll('.cs-ugc-breakdown-row');
            expect(rows).toHaveLength(5);
            // Rendered 5★ down to 1★, bars proportional to count / total.
            expect(rows[0].getAttribute('aria-label')).toEqual('28 reviews at 5 stars');
            expect(rows[0].querySelector('.cs-ugc-breakdown-fill').style.width).toEqual('78%');
            expect(rows[0].querySelector('.cs-ugc-breakdown-count').textContent).toEqual('28');
            expect(rows[3].getAttribute('aria-label')).toEqual('1 review at 2 stars');
            expect(rows[4].getAttribute('aria-label')).toEqual('0 reviews at 1 star');
            expect(rows[4].querySelector('.cs-ugc-breakdown-fill').style.width).toEqual('0%');
        });

        it('renders no histogram while the envelope lacks archetype_rating_breakdown', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(grid().querySelector('.cs-ugc-media-grid-summary')).not.toBeNull();
            expect(grid().querySelector('.cs-ugc-summary-breakdown')).toBeNull();
        });

        it('renders the rating summary above the gallery when media exists', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([photoMedia()])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const children = grid().children;
            expect(children[0].className).toEqual('cs-ugc-media-grid-summary');
            expect(children[1].className).toEqual('cs-ugc-media-gallery');
            expect(children[1].querySelector('.cs-ugc-media-grid-title')).not.toBeNull();
            expect(grid().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(1);
        });

        it('stays hidden (space reserved) when the archetype has no reviews at all', async () => {
            const api = buildApi(okEnvelope({
                items: [],
                total: 0,
                archetype_rating_average: null,
                archetype_review_count: 0,
            }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(grid().innerHTML).toEqual('');
            expect(grid().style.visibility).toEqual('hidden');
        });

        it('hides the grid when the reviews fetch fails', async () => {
            const api = buildApi({ ok: false, status: 0, message: 'down' });
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(grid().innerHTML).toEqual('');
            expect(grid().style.visibility).toEqual('hidden');
        });

        it('caps the band with a "+N" tile that opens the gallery modal', async () => {
            const media = [];
            for (let i = 0; i < 10; i += 1) {
                media.push(photoMedia({ id: i, sort_order: i, thumb_url: `https://cdn.example/t${i}.jpg` }));
            }
            const api = buildApi(okEnvelope({ items: [reviewWith(media)], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(grid().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(8);
            const expand = grid().querySelector('[data-ugc-media-expand]');
            expect(expand.textContent).toEqual('+2');

            expand.click();

            // The band does not grow — the gallery modal opens with the full
            // batch, and Load more stays hidden (batch exhausted).
            expect(grid().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(8);
            expect(galleryModal().hidden).toBe(false);
            expect(galleryModal().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(10);
            expect(galleryModal().querySelector('[data-ugc-gallery-more]').hidden).toBe(true);

            galleryModal().querySelector('[data-ugc-gallery-close]').click();
            expect(galleryModal().hidden).toBe(true);
        });

        it('pages further media into the gallery modal via Load more', async () => {
            const pageOf = (start) => {
                const items = [];
                for (let i = 0; i < 10; i += 1) {
                    items.push(reviewWith([photoMedia({ id: start + i, sort_order: 0 })], { id: start + i }));
                }
                return items;
            };
            const api = buildSequencedApi([
                okEnvelope({ items: [reviewWith([])], total: 1 }),
                okEnvelope({ items: pageOf(0), total: 20, per_page: 10 }),
                okEnvelope({ items: pageOf(100), total: 20, per_page: 10 }),
            ]);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            grid().querySelector('[data-ugc-media-expand]').click();
            const more = galleryModal().querySelector('[data-ugc-gallery-more]');
            expect(galleryModal().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(10);
            expect(more.hidden).toBe(false);

            more.click();
            await flush();

            expect(api.getReviews).toHaveBeenCalledTimes(3);
            expect(api.getReviews.mock.calls[2][1]).toEqual({ media: true, sort: 'date_desc', page: 2 });
            expect(galleryModal().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(20);
            expect(more.hidden).toBe(true);
        });

        it('shows the full owning review under the media for band tiles', async () => {
            const review = reviewWith([photoMedia({ medium_url: 'https://cdn.example/m.jpg' })], {
                author: 'Dave',
                title: 'Great mount',
                body: 'Fits my F56 perfectly.',
                rating: 5,
            });
            const api = buildApi(okEnvelope({ items: [review], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            grid().querySelector('[data-ugc-media-tile]').click();

            const content = document.querySelector('[data-ugc-lightbox-content]');
            expect(content.querySelector('img').src).toEqual('https://cdn.example/m.jpg');
            const shown = content.querySelector('.cs-ugc-lightbox-review .cs-review');
            expect(shown).not.toBeNull();
            expect(shown.querySelector('.cs-review-title').textContent).toEqual('Great mount');
            expect(shown.querySelector('.cs-review-body').textContent).toEqual('Fits my F56 perfectly.');
            // The review's own media strip is not duplicated inside the lightbox.
            expect(shown.querySelector('.cs-review-media')).toBeNull();
        });

        it('keeps per-review strip tiles media-only in the lightbox', async () => {
            const review = reviewWith([photoMedia()], { title: 'Great mount' });
            const api = buildApi(okEnvelope({ items: [review], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('#product-reviews [data-ugc-media-tile]').click();

            const content = document.querySelector('[data-ugc-lightbox-content]');
            expect(content.querySelector('img')).not.toBeNull();
            expect(content.querySelector('.cs-ugc-lightbox-review')).toBeNull();
        });

        it('opens the lightbox above the gallery modal from one of its tiles', async () => {
            const media = [];
            for (let i = 0; i < 10; i += 1) {
                media.push(photoMedia({ id: i, sort_order: i, medium_url: `https://cdn.example/m${i}.jpg` }));
            }
            const api = buildApi(okEnvelope({ items: [reviewWith(media)], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            grid().querySelector('[data-ugc-media-expand]').click();
            galleryModal().querySelectorAll('[data-ugc-media-tile]')[3].click();

            const lightboxEl = document.querySelector('[data-ugc-lightbox]');
            expect(lightboxEl.hidden).toBe(false);
            expect(lightboxEl.querySelector('img').src).toEqual('https://cdn.example/m3.jpg');
            // The gallery modal stays open underneath.
            expect(galleryModal().hidden).toBe(false);
        });

        it('tops up the gallery batch when a wider band wants more tiles', async () => {
            const observers = [];
            global.ResizeObserver = class {
                constructor(callback) {
                    this.callback = callback;
                    observers.push(this);
                }

                observe() {}

                disconnect() {}
            };
            let columns = 6;
            const realGetComputedStyle = window.getComputedStyle.bind(window);
            const styleSpy = jest.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
                if (el.hasAttribute && el.hasAttribute('data-ugc-media-gallery')) {
                    return { gridTemplateColumns: Array(columns).fill('100px').join(' ') };
                }
                return realGetComputedStyle(el);
            });

            try {
                const pageOf = (start) => {
                    const items = [];
                    for (let i = 0; i < 10; i += 1) {
                        items.push(reviewWith([photoMedia({ id: start + i, sort_order: 0 })], { id: start + i }));
                    }
                    return items;
                };
                const api = buildSequencedApi([
                    okEnvelope({ items: [reviewWith([])], total: 1 }),
                    okEnvelope({ items: pageOf(0), total: 20, per_page: 10 }),
                    okEnvelope({ items: pageOf(100), total: 20, per_page: 10 }),
                ]);
                new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
                await flush();

                // 6 columns → capacity 9: page 1's ten items suffice, page 2
                // is not fetched.
                observers[0].callback();
                await flush();
                expect(api.getReviews).toHaveBeenCalledTimes(2);
                expect(grid().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(8);

                // 12 columns → capacity 21: the batch tops up with page 2.
                columns = 12;
                observers[0].callback();
                await flush();
                expect(api.getReviews).toHaveBeenCalledTimes(3);
                expect(api.getReviews.mock.calls[2][1]).toEqual({ media: true, sort: 'date_desc', page: 2 });
                expect(grid().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(20);
                expect(grid().querySelector('[data-ugc-media-expand]')).toBeNull();
            } finally {
                styleSpy.mockRestore();
                delete global.ResizeObserver;
            }
        });

        it('fills the measured two-row band exactly and re-caps on resize', async () => {
            const observers = [];
            global.ResizeObserver = class {
                constructor(callback) {
                    this.callback = callback;
                    observers.push(this);
                }

                observe() {}

                disconnect() {}
            };
            let columns = 6;
            const realGetComputedStyle = window.getComputedStyle.bind(window);
            const styleSpy = jest.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
                if (el.hasAttribute && el.hasAttribute('data-ugc-media-gallery')) {
                    return { gridTemplateColumns: Array(columns).fill('100px').join(' ') };
                }
                return realGetComputedStyle(el);
            });

            try {
                const media = [];
                for (let i = 0; i < 12; i += 1) {
                    media.push(photoMedia({ id: i, sort_order: i }));
                }
                const api = buildApi(okEnvelope({ items: [reviewWith(media)], total: 1 }));
                new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
                await flush();

                // Layout lands: 6 columns → (6 * 2) - 3 = 9 elements fill the
                // band, so 8 tiles + the "+4" tile.
                observers[0].callback();
                expect(grid().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(8);
                expect(grid().querySelector('[data-ugc-media-expand]').textContent).toEqual('+4');

                // Wider viewport: 8 columns → 13 elements — all 12 tiles fit.
                columns = 8;
                observers[0].callback();
                expect(grid().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(12);
                expect(grid().querySelector('[data-ugc-media-expand]')).toBeNull();
            } finally {
                styleSpy.mockRestore();
                delete global.ResizeObserver;
            }
        });

        it('sources the gallery from its own media=true batch, stable across list refetches', async () => {
            const galleryMedia = [];
            for (let i = 0; i < 10; i += 1) {
                galleryMedia.push(photoMedia({ id: i, sort_order: i }));
            }
            const api = buildSequencedApi([
                okEnvelope({ items: [reviewWith([videoMedia()])], total: 1 }),
                okEnvelope({ items: [reviewWith(galleryMedia)], total: 1 }),
                okEnvelope({ items: [reviewWith([])], total: 1 }),
            ]);
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            // The second call is the gallery's own §3.2.1 query.
            expect(api.getReviews.mock.calls[1][1]).toEqual({ media: true, sort: 'date_desc', page: 1 });

            // The grid is built from the gallery batch (10 photos), not the
            // visible list page (1 video).
            expect(grid().querySelectorAll('[data-ugc-media-tile]')).toHaveLength(8);

            changeSelect('sort', 'date_asc');
            await flush();

            // The list refetched; the gallery batch did not.
            expect(api.getReviews).toHaveBeenCalledTimes(3);
            const tiles = grid().querySelectorAll('[data-ugc-media-tile]');
            expect(tiles).toHaveLength(8);
            expect(tiles[0].dataset.ugcMediaType).toEqual('photo');
            expect(grid().querySelector('[data-ugc-media-expand]')).not.toBeNull();
        });
    });

    describe('lightbox', () => {
        it('opens a clicked photo tile at medium size with alt text', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([photoMedia()])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            document.querySelector('.cs-review-media [data-ugc-media-tile]').click();

            expect(lightbox().hidden).toBe(false);
            const img = lightboxContent().querySelector('img');
            expect(img.getAttribute('src')).toEqual('https://cdn.example/ugc/media/u1/medium.jpg');
            expect(img.getAttribute('alt')).toEqual("Photo from Jane D.'s review");
        });

        it('opens a clicked video tile as a playable video with the poster frame', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([videoMedia()])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            grid().querySelector('[data-ugc-media-tile]').click();

            const video = lightboxContent().querySelector('video');
            expect(video.getAttribute('src')).toEqual('https://cdn.example/ugc/media/u2/video.mp4');
            expect(video.getAttribute('poster')).toEqual('https://cdn.example/ugc/media/u2/poster.jpg');
            expect(video.hasAttribute('controls')).toBe(true);
        });

        it('closes and clears the content (stopping playback) on a close click', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([videoMedia()])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            grid().querySelector('[data-ugc-media-tile]').click();
            expect(lightbox().hidden).toBe(false);

            lightbox().querySelector('button[data-ugc-lightbox-close]').click();

            expect(lightbox().hidden).toBe(true);
            expect(lightboxContent().innerHTML).toEqual('');
        });

        it('shows prev/next arrows from a band tile and steps the photo set, clamped at the ends', async () => {
            const r1 = reviewWith([photoMedia({ id: 1, medium_url: 'https://cdn.example/a.jpg' })], { id: 1, author: 'Alice', body: 'Body A' });
            const r2 = reviewWith([photoMedia({ id: 2, medium_url: 'https://cdn.example/b.jpg' })], { id: 2, author: 'Bob', body: 'Body B' });
            const api = buildApi(okEnvelope({ items: [r1, r2], total: 2 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            grid().querySelector('[data-ugc-media-tile]').click();
            const prev = lightbox().querySelector('[data-ugc-lightbox-prev]');
            const next = lightbox().querySelector('[data-ugc-lightbox-next]');
            expect(prev.hidden).toBe(false);
            expect(next.hidden).toBe(false);
            expect(prev.disabled).toBe(true); // first entry
            expect(next.disabled).toBe(false);
            expect(lightboxContent().textContent).toContain('Body A');

            next.click();
            expect(lightboxContent().querySelector('img').getAttribute('src')).toEqual('https://cdn.example/b.jpg');
            expect(lightboxContent().textContent).toContain('Body B');
            expect(next.disabled).toBe(true); // last entry
            expect(prev.disabled).toBe(false);

            prev.click();
            expect(lightboxContent().textContent).toContain('Body A');
        });

        it('keeps arrows hidden when opened from a per-review strip tile, even with multiple photos in the set', async () => {
            const r1 = reviewWith([photoMedia({ id: 1 })], { id: 1, author: 'Alice', body: 'Body A' });
            const r2 = reviewWith([photoMedia({ id: 2 })], { id: 2, author: 'Bob', body: 'Body B' });
            const api = buildApi(okEnvelope({ items: [r1, r2], total: 2 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            // A strip tile inside #product-reviews carries no media index → no nav.
            document.querySelector('#product-reviews [data-ugc-media-tile]').click();
            expect(lightbox().querySelector('[data-ugc-lightbox-prev]').hidden).toBe(true);
            expect(lightbox().querySelector('[data-ugc-lightbox-next]').hidden).toBe(true);
            expect(lightboxContent().querySelector('.cs-ugc-lightbox-review')).toBeNull();
        });

        it('navigates with arrow keys and closes on Escape', async () => {
            const r1 = reviewWith([photoMedia({ id: 1, medium_url: 'https://cdn.example/a.jpg' })], { id: 1, body: 'Body A' });
            const r2 = reviewWith([photoMedia({ id: 2, medium_url: 'https://cdn.example/b.jpg' })], { id: 2, body: 'Body B' });
            const api = buildApi(okEnvelope({ items: [r1, r2], total: 2 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            grid().querySelector('[data-ugc-media-tile]').click();
            expect(lightboxContent().textContent).toContain('Body A');

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
            expect(lightboxContent().textContent).toContain('Body B');

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
            expect(lightboxContent().textContent).toContain('Body A');

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(lightbox().hidden).toBe(true);
        });

        it('navigates onto a video entry and renders it playable with its poster', async () => {
            const r1 = reviewWith([photoMedia({ id: 1, medium_url: 'https://cdn.example/a.jpg' })], { id: 1, body: 'Body A' });
            const r2 = reviewWith([videoMedia({ id: 2 })], { id: 2, body: 'Body B' });
            const api = buildApi(okEnvelope({ items: [r1, r2], total: 2 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            grid().querySelector('[data-ugc-media-tile]').click(); // index 0 (photo)
            lightbox().querySelector('[data-ugc-lightbox-next]').click(); // index 1 (video)

            const video = lightboxContent().querySelector('video');
            expect(video.getAttribute('src')).toEqual('https://cdn.example/ugc/media/u2/video.mp4');
            expect(video.getAttribute('poster')).toEqual('https://cdn.example/ugc/media/u2/poster.jpg');
        });

        it('hides the arrows for a single-photo set even from an indexed band tile', async () => {
            const api = buildApi(okEnvelope({ items: [reviewWith([photoMedia()])], total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            grid().querySelector('[data-ugc-media-tile]').click();
            expect(lightbox().querySelector('[data-ugc-lightbox-prev]').hidden).toBe(true);
            expect(lightbox().querySelector('[data-ugc-lightbox-next]').hidden).toBe(true);
        });
    });

    describe('escaping', () => {
        it('escapes URLs so a quoted payload cannot break out of the attribute', async () => {
            const hostile = 'https://cdn.example/x.jpg" onerror="alert(1)';
            const items = [reviewWith([photoMedia({
                thumb_url: hostile,
                medium_url: hostile,
            })])];
            const api = buildApi(okEnvelope({ items, total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const img = document.querySelector('.cs-review-media img');
            expect(img.getAttribute('src')).toEqual(hostile);
            expect(img.hasAttribute('onerror')).toBe(false);

            // The same holds after the round-trip through the tile dataset into
            // the lightbox markup.
            document.querySelector('.cs-review-media [data-ugc-media-tile]').click();
            const large = lightboxContent().querySelector('img');
            expect(large.getAttribute('src')).toEqual(hostile);
            expect(large.hasAttribute('onerror')).toBe(false);
        });

        it('escapes author-derived labels to prevent HTML injection', async () => {
            const items = [reviewWith([photoMedia()], { author: '<script>x</script>' })];
            const api = buildApi(okEnvelope({ items, total: 1 }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(grid().querySelector('script')).toBeNull();
            expect(document.querySelector('.cs-review-media script')).toBeNull();
        });
    });
});

// Slice C (#158, SRS §3.4 / §3.2.1 / §3.2.2): the structured-vehicle badge on
// review and question cards — the item's system-generated `vehicle_label`,
// rendered directly from the envelope (no client-side fitment resolution),
// absent entirely when the item has no vehicle.
describe('UgcProduct (slice C — structured-vehicle badge on cards)', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('review cards', () => {
        beforeEach(() => {
            mountScaffold();
        });

        it('renders the badge from vehicle_label with the shared badge class', async () => {
            const api = buildApi(okEnvelope({
                total: 1,
                items: [{
                    id: 1, author: 'Jane D.', rating: 5, title: 't', body: 'b',
                    vehicle_label: 'MINI Cooper F56', date: '2026-01-15T00:00:00Z',
                }],
            }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const badge = document.querySelector('#product-reviews .cs-review-vehicle');
            expect(badge).not.toBeNull();
            expect(badge.classList.contains('cs-ugc-vehicle-badge')).toBe(true);
            expect(badge.textContent).toBe('MINI Cooper F56');
        });

        it('omits the badge when the review has no vehicle (null / missing label)', async () => {
            const api = buildApi(okEnvelope({
                total: 2,
                items: [
                    {
                        id: 1, author: 'A', rating: 5, title: 't', body: 'b',
                        vehicle_label: null, date: '2026-01-15T00:00:00Z',
                    },
                    {
                        id: 2, author: 'B', rating: 4, title: 't', body: 'b',
                        date: '2026-02-01T00:00:00Z',
                    },
                ],
            }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(document.querySelectorAll('#product-reviews .cs-review')).toHaveLength(2);
            expect(document.querySelector('#product-reviews .cs-review-vehicle')).toBeNull();
        });

        it('escapes the vehicle_label (no XSS via the badge)', async () => {
            const api = buildApi(okEnvelope({
                total: 1,
                items: [{
                    id: 1, author: 'A', rating: 5, title: 't', body: 'b',
                    vehicle_label: '<img src=x onerror=alert(1)>', date: '2026-01-15T00:00:00Z',
                }],
            }));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const badge = document.querySelector('#product-reviews .cs-review-vehicle');
            expect(badge).not.toBeNull();
            expect(badge.querySelector('img')).toBeNull();
            expect(badge.textContent).toBe('<img src=x onerror=alert(1)>');
        });
    });

    describe('question cards', () => {
        const buildQaApi = result => ({
            getReviews: jest.fn(() => Promise.resolve({ ok: true, status: 200, data: buildEnvelope() })),
            getQuestions: jest.fn(() => Promise.resolve(result)),
        });

        const okQuestions = items => ({
            ok: true,
            status: 200,
            data: {
                items, total: items.length, page: 1, per_page: 10,
            },
        });

        beforeEach(() => {
            document.body.innerHTML = `
                <div class="cs-questions-toolbar" data-questions-toolbar>
                    <select data-questions-control="sort">
                        <option value="date_desc">Newest</option>
                        <option value="date_asc">Oldest</option>
                    </select>
                    <div class="cs-fitment-chip-slot" data-questions-fitment-chip></div>
                </div>
                <div id="product-questions"></div>
                <div class="cs-questions-pagination" data-questions-pagination></div>
            `;
        });

        it('renders the badge from vehicle_label with the shared badge class', async () => {
            const api = buildQaApi(okQuestions([{
                id: 1, author: 'Jane D.', body: 'Does this fit?',
                vehicle_label: 'MINI Cooper F56', staff_answer: 'Yes.',
                date: '2026-05-01T12:00:00Z',
            }]));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            const badge = document.querySelector('#product-questions .cs-question-vehicle');
            expect(badge).not.toBeNull();
            expect(badge.classList.contains('cs-ugc-vehicle-badge')).toBe(true);
            expect(badge.textContent).toBe('MINI Cooper F56');
        });

        it('omits the badge when the question has no vehicle', async () => {
            const api = buildQaApi(okQuestions([{
                id: 1, author: 'Bob', body: 'Is hardware included?',
                staff_answer: 'Yes.', date: '2026-04-15T00:00:00Z',
            }]));
            new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
            await flush();

            expect(document.querySelectorAll('#product-questions .cs-question')).toHaveLength(1);
            expect(document.querySelector('#product-questions .cs-question-vehicle')).toBeNull();
        });
    });
});
