import ugcApi, { UgcApi, resolveBaseUrl } from '../../../theme/_addons/global/ugcApi';

const BASE = 'https://ugc.cravenspeed.com';
const API = `${BASE}/api`;

// Minimal stand-in for a fetch Response.
const mockResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
});

const makeApi = (fetchImpl) => new UgcApi({ baseUrl: BASE, fetchImpl });

describe('ugcApi', () => {
    describe('resolveBaseUrl', () => {
        it('targets the dev API on localhost', () => {
            expect(resolveBaseUrl('localhost')).toEqual('http://localhost:5000');
        });

        it('targets the dev API on 127.0.0.1', () => {
            expect(resolveBaseUrl('127.0.0.1')).toEqual('http://localhost:5000');
        });

        it('defaults to the production API for any other host', () => {
            expect(resolveBaseUrl('www.cravenspeed.com')).toEqual('https://ugc.cravenspeed.com');
        });
    });

    describe('default export', () => {
        it('is a UgcApi instance', () => {
            expect(ugcApi).toBeInstanceOf(UgcApi);
        });
    });

    describe('GET endpoints', () => {
        it('getReviews builds the path with query params and returns normalized data', async () => {
            const body = { items: [], total: 0, archetype_rating_average: null };
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(200, body)));
            const api = makeApi(fetchImpl);

            const result = await api.getReviews(12, { page: 2, sort: 'rating_desc', fitment_id: 87 });

            expect(fetchImpl).toHaveBeenCalledWith(
                `${API}/reviews/12?page=2&sort=rating_desc&fitment_id=87`,
                { cache: 'no-cache' },
            );
            expect(result).toEqual({ ok: true, status: 200, data: body });
        });

        it('getReviews passes the fitment filter params (fitment_id + fitment_only)', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(200, {})));
            const api = makeApi(fetchImpl);

            await api.getReviews(12, { fitment_id: 87, fitment_only: true });

            expect(fetchImpl).toHaveBeenCalledWith(
                `${API}/reviews/12?fitment_id=87&fitment_only=true`,
                { cache: 'no-cache' },
            );
        });

        it('getQuestions passes the fitment filter params (fitment_id + fitment_only)', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(200, { items: [] })));
            const api = makeApi(fetchImpl);

            await api.getQuestions(12, { fitment_id: 87, fitment_only: true });

            expect(fetchImpl).toHaveBeenCalledWith(
                `${API}/questions/12?fitment_id=87&fitment_only=true`,
                { cache: 'no-cache' },
            );
        });

        it('getReviews omits null/undefined/empty params', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(200, {})));
            const api = makeApi(fetchImpl);

            await api.getReviews(12, {
                page: 1, rating: null, verified: undefined, media: '',
            });

            expect(fetchImpl).toHaveBeenCalledWith(`${API}/reviews/12?page=1`, { cache: 'no-cache' });
        });

        it('getQuestions builds the questions path', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(200, { items: [] })));
            const api = makeApi(fetchImpl);

            await api.getQuestions(12, { sort: 'date_asc' });

            expect(fetchImpl).toHaveBeenCalledWith(`${API}/questions/12?sort=date_asc`, { cache: 'no-cache' });
        });

        it('getOverview hits /overview with no query', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(200, { reviews: [] })));
            const api = makeApi(fetchImpl);

            await api.getOverview();

            expect(fetchImpl).toHaveBeenCalledWith(`${API}/overview`, { cache: 'no-cache' });
        });

        it('validateToken passes the token as ugc_token', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(200, { archetype_id: 12 })));
            const api = makeApi(fetchImpl);

            await api.validateToken('abc123');

            expect(fetchImpl).toHaveBeenCalledWith(`${API}/token/validate?ugc_token=abc123`, { cache: 'no-cache' });
        });

        it('de-dupes identical concurrent GETs into one network call', async () => {
            let resolveFetch;
            const fetchImpl = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
            const api = makeApi(fetchImpl);

            const first = api.getReviews(12, { page: 1 });
            const second = api.getReviews(12, { page: 1 });
            resolveFetch(mockResponse(200, { items: [] }));
            await Promise.all([first, second]);

            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });
    });

    describe('POST endpoints', () => {
        it('postReview sends a JSON body and returns normalized data on 201', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(201, { id: 99 })));
            const api = makeApi(fetchImpl);
            const payload = { archetype_id: 12, rating: 5, body: 'Great' };

            const result = await api.postReview(payload);

            expect(fetchImpl).toHaveBeenCalledWith(`${API}/reviews`, {
                method: 'POST',
                cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            expect(result).toEqual({ ok: true, status: 201, data: { id: 99 } });
        });

        it('postQuestion targets /questions', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(201, { id: 7 })));
            const api = makeApi(fetchImpl);

            await api.postQuestion({ archetype_id: 12, body: 'Fits F56?' });

            expect(fetchImpl.mock.calls[0][0]).toEqual(`${API}/questions`);
        });

        it('presignMedia derives filename and content_type from the File', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(200, { presigned_url: 'x', raw_url: 'y' })));
            const api = makeApi(fetchImpl);
            const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });

            await api.presignMedia(file);

            expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
                filename: 'photo.jpg',
                content_type: 'image/jpeg',
            });
        });

        it('confirmMedia sends raw_url', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(200, { confirmed: true })));
            const api = makeApi(fetchImpl);

            await api.confirmMedia('https://do/raw/uuid.jpg');

            expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ raw_url: 'https://do/raw/uuid.jpg' });
        });
    });

    describe('§3.6 error handling', () => {
        it('maps 429 to the too-many-submissions message', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(429, { error: 'rate limited' })));
            const api = makeApi(fetchImpl);

            const result = await api.postReview({});

            expect(result.ok).toBe(false);
            expect(result.status).toEqual(429);
            expect(result.message).toMatch(/too many submissions/i);
        });

        it('surfaces the envelope error on 400', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(400, { error: 'Turnstile validation failed' })));
            const api = makeApi(fetchImpl);

            const result = await api.postReview({});

            expect(result).toEqual({
                ok: false,
                status: 400,
                message: 'Turnstile validation failed',
                error: 'Turnstile validation failed',
            });
        });

        it('surfaces the envelope error on 422', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(422, { error: 'Media processing failure' })));
            const api = makeApi(fetchImpl);

            const result = await api.confirmMedia('https://do/raw/uuid.jpg');

            expect(result.ok).toBe(false);
            expect(result.message).toEqual('Media processing failure');
        });

        it('returns a generic message on 500', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(500, { error: 'boom' })));
            const api = makeApi(fetchImpl);

            const result = await api.getReviews(12);

            expect(result.ok).toBe(false);
            expect(result.status).toEqual(500);
            expect(result.message).toMatch(/something went wrong/i);
        });

        it('falls back to a generic message when an error status has no envelope', async () => {
            const fetchImpl = jest.fn(() => Promise.resolve(mockResponse(400, null)));
            const api = makeApi(fetchImpl);

            const result = await api.postQuestion({});

            expect(result.ok).toBe(false);
            expect(result.message).toMatch(/something went wrong/i);
            expect(result.error).toBeNull();
        });

        it('resolves (does not reject) when fetch itself fails', async () => {
            const fetchImpl = jest.fn(() => Promise.reject(new Error('network down')));
            const api = makeApi(fetchImpl);

            const result = await api.getOverview();

            expect(result).toEqual({
                ok: false,
                status: 0,
                message: 'Something went wrong. Please try again.',
                error: 'network down',
            });
        });
    });
});
