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
