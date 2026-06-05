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
            <input type="checkbox" data-reviews-control="vehicle_first" disabled>
        </div>
        <div id="product-reviews"></div>
        <div class="cs-reviews-pagination" data-reviews-pagination></div>
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
        expect(api.getReviews).toHaveBeenCalledWith(ARCHETYPE_ID, {
            page: 1,
            sort: 'date_desc',
            rating: null,
            verified: null,
            media: null,
            sort_alias: null,
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

            // 25 / 10 => ceil 3 numbered pages.
            const numbered = document.querySelectorAll('[data-page-key="1"], [data-page-key="2"], [data-page-key="3"]');
            expect(numbered).toHaveLength(3);
            expect(document.querySelector('[data-reviews-page="2"]')).not.toBeNull();
            expect(document.querySelector('[data-reviews-page="4"]')).toBeNull();
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
                <input type="checkbox" data-questions-control="vehicle_first" disabled>
            </div>
            <div id="product-questions"></div>
            <div class="cs-questions-pagination" data-questions-pagination></div>
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
            sort_alias: null,
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
            expect(qParamsOfCall(api, 2)).toEqual({ sort: expected, page: 1, sort_alias: null });
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

            const numbered = document.querySelectorAll('[data-page-key="1"], [data-page-key="2"], [data-page-key="3"]');
            expect(numbered).toHaveLength(3);
            expect(document.querySelector('[data-questions-page="2"]')).not.toBeNull();
            expect(document.querySelector('[data-questions-page="4"]')).toBeNull();
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
    });

    it('floats alias-matching questions only when the vehicle-first toggle is on', async () => {
        const stateManager = buildStateManager();
        const api = buildQaApi(okQuestions());
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        // Initial Q&A fetch carries no sort_alias; the toggle is disabled.
        expect(qParamsOfCall(api, 1).sort_alias).toBeNull();
        const toggle = document.querySelector('[data-questions-control="vehicle_first"]');
        expect(toggle.disabled).toBe(true);

        // Selecting an alias enables the toggle but does NOT refetch — the
        // float is opt-in.
        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
        await flush();
        expect(api.getQuestions).toHaveBeenCalledTimes(1);
        expect(toggle.disabled).toBe(false);

        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
        await flush();
        expect(api.getQuestions).toHaveBeenCalledTimes(2);
        expect(qParamsOfCall(api, 2).sort_alias).toBe(4821);

        // Deselecting the alias drops the param and disables the toggle.
        stateManager._emit({ aliasData: null });
        await flush();
        expect(api.getQuestions).toHaveBeenCalledTimes(3);
        expect(qParamsOfCall(api, 3).sort_alias).toBeNull();
        expect(toggle.disabled).toBe(true);
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

describe('UgcProduct (slice 6d — alias-aware sort)', () => {
    beforeEach(() => {
        mountScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    const paramsOfCall = (api, n) => api.getReviews.mock.calls[n - 1][1];

    // A reviews-only api that returns a fresh ok envelope on every call, so each
    // alias-driven refetch can be asserted against its params.
    const buildReviewsApi = () => ({
        getReviews: jest.fn(() => Promise.resolve(okEnvelope())),
    });

    it('omits sort_alias on the initial fetch (no alias selected)', async () => {
        const api = buildReviewsApi();
        new UgcProduct(ARCHETYPE_ID, buildStateManager(), api);
        await flush();

        expect(paramsOfCall(api, 1).sort_alias).toBeNull();
    });

    it('refetches reviews with sort_alias when the toggle is on and an alias is selected', async () => {
        const stateManager = buildStateManager();
        const api = buildReviewsApi();
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        // Alias selection alone never refetches — floating is opt-in.
        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
        await flush();
        expect(api.getReviews).toHaveBeenCalledTimes(1);

        toggleCheckbox('vehicle_first', true);
        await flush();

        expect(api.getReviews).toHaveBeenCalledTimes(2);
        expect(paramsOfCall(api, 2).sort_alias).toBe(4821);
    });

    it('drops sort_alias when the alias is deselected', async () => {
        const stateManager = buildStateManager();
        const api = buildReviewsApi();
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
        await flush();
        toggleCheckbox('vehicle_first', true);
        await flush();
        expect(paramsOfCall(api, 2).sort_alias).toBe(4821);

        stateManager._emit({ aliasData: null });
        await flush();

        expect(api.getReviews).toHaveBeenCalledTimes(3);
        expect(paramsOfCall(api, 3).sort_alias).toBeNull();
    });

    it('preserves the active sort and filters across an alias-driven refetch', async () => {
        const stateManager = buildStateManager();
        const api = buildReviewsApi();
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        // Establish a non-default sort and two active filters before the alias
        // is selected — they must survive the alias refetch unchanged.
        changeSelect('sort', 'rating_desc');
        await flush();
        changeSelect('rating', '4');
        await flush();
        toggleCheckbox('verified', true);
        await flush();

        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
        await flush();
        toggleCheckbox('vehicle_first', true);
        await flush();

        const last = paramsOfCall(api, api.getReviews.mock.calls.length);
        expect(last).toEqual({
            page: 1,
            sort: 'rating_desc',
            rating: 4,
            verified: true,
            media: null,
            sort_alias: 4821,
        });
    });

    it('resets to page 1 when the alias selection changes', async () => {
        const stateManager = buildStateManager();
        const api = {
            getReviews: jest.fn(() => Promise.resolve(okEnvelope({ total: 25, page: 1, per_page: 10 }))),
        };
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
        toggleCheckbox('vehicle_first', true);
        await flush();
        expect(paramsOfCall(api, 2).sort_alias).toBe(4821);

        document.querySelector('[data-reviews-page="3"]').click();
        await flush();
        expect(paramsOfCall(api, 3).page).toBe(3);

        // Switching to a different alias re-floats and resets the page.
        stateManager._emit({ aliasData: { qty_alias_index: 7777 } });
        await flush();
        expect(paramsOfCall(api, 4).page).toBe(1);
        expect(paramsOfCall(api, 4).sort_alias).toBe(7777);
    });

    it('does not refetch when an unrelated state notification leaves the alias unchanged', async () => {
        const stateManager = buildStateManager();
        const api = buildReviewsApi();
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
        toggleCheckbox('vehicle_first', true);
        await flush();
        expect(api.getReviews).toHaveBeenCalledTimes(2);

        // Same alias re-emitted (e.g. inventory/blem change) — no extra fetch.
        stateManager._emit({ aliasData: { qty_alias_index: 4821 }, blemSelected: true });
        await flush();
        expect(api.getReviews).toHaveBeenCalledTimes(2);
    });

    it('treats a missing or non-numeric qty_alias_index as no alias sort', async () => {
        const stateManager = buildStateManager();
        const api = buildReviewsApi();
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        // A "self" simple-product alias whose JSON carries no published index
        // must not trigger an alias refetch and must not send sort_alias.
        stateManager._emit({ aliasData: { bc_id: 99 } });
        await flush();
        expect(api.getReviews).toHaveBeenCalledTimes(1);
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
                            <input type="text" name="vehicle_label" data-review-field="vehicle_label">
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
                            <input type="text" name="vehicle_label" data-question-field="vehicle_label">
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
            vehicle_label: '',
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
            vehicle_label: '',
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
            fillReview({ vehicle_label: 'MINI Cooper F56' });
            submitForm('review');
            await flush();

            expect(api.postReview).toHaveBeenCalledWith({
                archetype_id: ARCHETYPE_ID,
                author: 'Jane D.',
                rating: 5,
                title: 'Great product',
                body: 'Really happy with this.',
                cf_turnstile_token: '0.test-token',
                website: '',
                vehicle_label: 'MINI Cooper F56',
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

        it('pre-fills vehicle_label from the selected alias and submits it', async () => {
            const stateManager = buildStateManager();
            const api = buildSubmitApi();
            new UgcProduct(ARCHETYPE_ID, stateManager, api);
            await flush();

            stateManager._emit({ aliasData: { qty_alias_index: 4821, vehicle_label: 'MINI Cooper F56' } });
            await flush();

            document.querySelector('[data-review-modal-open]').click();
            expect(document.querySelector('[data-review-form] [name="vehicle_label"]').value)
                .toBe('MINI Cooper F56');

            fillReview({ vehicle_label: 'MINI Cooper F56' });
            submitForm('review');
            await flush();

            expect(api.postReview.mock.calls[0][0].vehicle_label).toBe('MINI Cooper F56');
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
