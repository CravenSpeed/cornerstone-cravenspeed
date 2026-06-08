/**
 * @file ugcApi
 * @description Shared helper for the CravenSpeed UGC API (reviews, questions,
 * overview, verified-purchaser token validation, and media presign/confirm).
 * Imported by ugcProduct.js and ugcOverview.js. See cs-ugc SRS §3.2, §3.4.3, §3.6.
 *
 * This module is the SINGLE source of the UGC API base URL — no other module
 * hardcodes it. The base resolves per environment (SRS §3.4.3): localhost dev
 * points at the local cs-ugc Flask app; everything else points at production.
 */

// The base URL literals live here and nowhere else.
const PROD_BASE_URL = 'https://ugc.cravenspeed.com';
const DEV_BASE_URL = 'http://localhost:5000';

// User-facing messages for the §3.6 status branches.
const MESSAGES = {
    rateLimit: 'You\'ve made too many submissions. Please try again later.',
    generic: 'Something went wrong. Please try again.',
};

/**
 * Resolve the API base URL for the current environment. Defaults to production;
 * only a local Stencil dev host (localhost / 127.0.0.1) targets the dev API.
 * @param {string} [hostname] - Host to test; defaults to the live location host.
 * @returns {string}
 */
export function resolveBaseUrl(hostname = window.location.hostname) {
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? DEV_BASE_URL : PROD_BASE_URL;
}

/**
 * Build a query string from a params object, skipping null/undefined/empty
 * values so optional filters are simply omitted.
 * @param {Object} [params]
 * @returns {string} A leading-`?` query string, or '' when there are no params.
 */
function buildQuery(params = {}) {
    const search = new URLSearchParams();
    Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value !== null && value !== undefined && value !== '') {
            search.append(key, value);
        }
    });
    const queryString = search.toString();
    return queryString ? `?${queryString}` : '';
}

export class UgcApi {
    /**
     * @param {Object} [options]
     * @param {string} [options.baseUrl] - Override the resolved base URL.
     * @param {Function} [options.fetchImpl] - Injectable fetch (for tests).
     */
    constructor({ baseUrl = resolveBaseUrl(), fetchImpl } = {}) {
        this.baseUrl = baseUrl;
        this.apiBase = `${baseUrl}/api`;
        this.fetch = fetchImpl || ((...args) => fetch(...args));

        // De-dupe identical in-flight GETs (mirrors DataManager). Results are
        // never cached past resolution — reviews/questions must stay fresh.
        this.pendingRequests = new Map();
    }

    /**
     * Normalize a fetch Response into the discriminated result shape callers
     * branch on. Applies the §3.6 status→message mapping.
     * @param {Response} response
     * @returns {Promise<Object>}
     */
    async handleResponse(response) {
        const { status } = response;
        let payload = null;

        try {
            payload = await response.json();
        } catch (e) {
            payload = null;
        }

        if (response.ok) {
            return { ok: true, status, data: payload };
        }

        const envelopeError = payload && payload.error ? payload.error : null;
        let message;

        if (status === 429) {
            message = MESSAGES.rateLimit;
        } else if (status === 400 || status === 422) {
            // Surface the human-readable message from the {"error":"..."} envelope.
            message = envelopeError || MESSAGES.generic;
        } else {
            message = MESSAGES.generic;
        }

        return {
            ok: false, status, message, error: envelopeError,
        };
    }

    /**
     * Issue a GET, de-duping identical concurrent requests. Resolves to the
     * normalized result shape; network/parse failures resolve as ok:false too.
     * @param {string} path - Path under the API base, e.g. '/reviews/12'.
     * @returns {Promise<Object>}
     */
    async get(path) {
        const url = `${this.apiBase}${path}`;
        if (this.pendingRequests.has(url)) {
            return this.pendingRequests.get(url);
        }

        const requestPromise = (async () => {
            try {
                const response = await this.fetch(url, { cache: 'no-cache' });
                return await this.handleResponse(response);
            } catch (error) {
                return {
                    ok: false, status: 0, message: MESSAGES.generic, error: error.message,
                };
            } finally {
                this.pendingRequests.delete(url);
            }
        })();

        this.pendingRequests.set(url, requestPromise);
        return requestPromise;
    }

    /**
     * Issue a POST with a JSON body. Resolves to the normalized result shape.
     * @param {string} path
     * @param {Object} body
     * @returns {Promise<Object>}
     */
    async post(path, body) {
        const url = `${this.apiBase}${path}`;
        try {
            const response = await this.fetch(url, {
                method: 'POST',
                cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            return await this.handleResponse(response);
        } catch (error) {
            return {
                ok: false, status: 0, message: MESSAGES.generic, error: error.message,
            };
        }
    }

    /**
     * Approved reviews for an archetype, pooled across its aliases (SRS §3.2.1).
     * @param {number|string} archetypeId
     * @param {Object} [params] - page, sort, rating, verified, media, and the
     *   fitment filter: `fitment_id` (integer — the visitor's garage vehicle,
     *   whose pre-filter match count returns as `fitment_review_count`) and
     *   `fitment_only` (boolean — when true, requires `fitment_id` and hard-filters
     *   to it). Null/empty params are dropped by buildQuery and simply omitted.
     * @returns {Promise<Object>}
     */
    getReviews(archetypeId, params = {}) {
        return this.get(`/reviews/${archetypeId}${buildQuery(params)}`);
    }

    /**
     * Approved questions and staff answers for an archetype (SRS §3.2.2).
     * @param {number|string} archetypeId
     * @param {Object} [params] - page, sort, and the fitment filter: `fitment_id`
     *   (integer — sets the fitment whose pre-filter match count returns as
     *   `fitment_question_count`) and `fitment_only` (boolean — when true, requires
     *   `fitment_id` and hard-filters to it).
     * @returns {Promise<Object>}
     */
    getQuestions(archetypeId, params = {}) {
        return this.get(`/questions/${archetypeId}${buildQuery(params)}`);
    }

    /**
     * Latest approved reviews across all archetypes for the photo wall (SRS §3.2.3).
     * @returns {Promise<Object>}
     */
    getOverview() {
        return this.get('/overview');
    }

    /**
     * Validate a verified-purchaser token (SRS §3.2.8).
     * @param {string} token
     * @returns {Promise<Object>}
     */
    validateToken(token) {
        return this.get(`/token/validate${buildQuery({ ugc_token: token })}`);
    }

    /**
     * Submit a review (SRS §3.2.4).
     * @param {Object} payload
     * @returns {Promise<Object>}
     */
    postReview(payload) {
        return this.post('/reviews', payload);
    }

    /**
     * Submit a question (SRS §3.2.5).
     * @param {Object} payload
     * @returns {Promise<Object>}
     */
    postQuestion(payload) {
        return this.post('/questions', payload);
    }

    /**
     * Request a presigned DO Spaces URL for a direct browser upload (SRS §3.2.6).
     * The actual PUT to DO Spaces is handled by the media-upload flow, not here.
     * @param {File} file
     * @returns {Promise<Object>}
     */
    presignMedia(file) {
        return this.post('/media/presign', {
            filename: file.name,
            content_type: file.type,
        });
    }

    /**
     * Confirm an uploaded raw file and trigger server-side processing (SRS §3.2.7).
     * @param {string} rawUrl
     * @returns {Promise<Object>}
     */
    confirmMedia(rawUrl) {
        return this.post('/media/confirm', { raw_url: rawUrl });
    }
}

// Default export: a ready-to-use singleton bound to the resolved environment.
const ugcApi = new UgcApi();

export default ugcApi;
