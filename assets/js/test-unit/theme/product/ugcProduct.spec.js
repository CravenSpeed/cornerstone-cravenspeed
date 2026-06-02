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

    it('floats alias-matching questions on alias select and drops sort_alias on deselect', async () => {
        const stateManager = buildStateManager();
        const api = buildQaApi(okQuestions());
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        // Initial Q&A fetch carries no sort_alias.
        expect(qParamsOfCall(api, 1).sort_alias).toBeNull();

        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
        await flush();
        expect(api.getQuestions).toHaveBeenCalledTimes(2);
        expect(qParamsOfCall(api, 2).sort_alias).toBe(4821);

        stateManager._emit({ aliasData: null });
        await flush();
        expect(api.getQuestions).toHaveBeenCalledTimes(3);
        expect(qParamsOfCall(api, 3).sort_alias).toBeNull();
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

    it('refetches reviews with sort_alias when an alias is selected', async () => {
        const stateManager = buildStateManager();
        const api = buildReviewsApi();
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
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

        document.querySelector('[data-reviews-page="3"]').click();
        await flush();
        expect(paramsOfCall(api, 2).page).toBe(3);

        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
        await flush();
        expect(paramsOfCall(api, 3).page).toBe(1);
        expect(paramsOfCall(api, 3).sort_alias).toBe(4821);
    });

    it('does not refetch when an unrelated state notification leaves the alias unchanged', async () => {
        const stateManager = buildStateManager();
        const api = buildReviewsApi();
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        stateManager._emit({ aliasData: { qty_alias_index: 4821 } });
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
