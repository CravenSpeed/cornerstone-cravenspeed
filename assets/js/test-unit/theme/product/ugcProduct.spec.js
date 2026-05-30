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
        <div id="product-reviews"></div>
    `;
};

describe('UgcProduct (slice 6a)', () => {
    beforeEach(() => {
        mountScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('requests page 1 of reviews for the archetype on init', async () => {
        const api = buildApi({ ok: true, status: 200, data: buildEnvelope() });
        const stateManager = buildStateManager();

        // eslint-disable-next-line no-new
        new UgcProduct(ARCHETYPE_ID, stateManager, api);
        await flush();

        expect(api.getReviews).toHaveBeenCalledWith(ARCHETYPE_ID, { page: 1 });
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
