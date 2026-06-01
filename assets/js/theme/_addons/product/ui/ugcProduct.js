/**
 * @file ugcProduct
 * @description Product-page UGC component (SRS §3.4.1). Slice 6a: module
 * bootstrap, rating-summary override, and the first page of the reviews list.
 *
 * Initialised by ProductController after archetype data loads, with the
 * archetype id (BigCommerce product.id, injected to context). On init it
 * fetches GET /api/reviews/{archetype_id} via the shared ugcApi helper and:
 *   - renders the rating summary from the envelope's archetype_rating_average /
 *     archetype_review_count, overriding the (up to 24h stale) archetype-JSON
 *     values for in-page display (SRS §2.2, §3.2.1);
 *   - caches those aggregates (they are constant under filters, §3.2.1);
 *   - renders the first page of reviews into #product-reviews.
 *
 * Sort/filter/pagination (#16), Q&A (#17), alias-sort refetch (#7) and the
 * submission modal (#8) are separate slices and intentionally out of scope here.
 */

const MAX_STARS = 5;

const MESSAGES = {
    noReviews: 'No reviews yet. Be the first to review this product.',
    loadError: 'Reviews are unavailable right now. Please try again later.',
    anonymous: 'Anonymous',
};

export default class UgcProduct {
    /**
     * @param {number|string} archetypeId - BigCommerce product.id (SRS §3.4.1).
     * @param {Object} stateManager - Local product StateManager.
     * @param {Object} api - The ugcApi helper (injectable for tests).
     */
    constructor(archetypeId, stateManager, api) {
        this.archetypeId = archetypeId;
        this.stateManager = stateManager;
        this.api = api;
        this.unsubscribe = null;

        // Cached unfiltered aggregates from the reviews envelope. Constant under
        // filters, so the rating summary never refetches them (SRS §3.2.1).
        this.ratingAverage = null;
        this.reviewCount = 0;

        this.ratingElement = document.querySelector('[data-product-rating]');
        this.listElement = document.querySelector('#product-reviews');

        if (this.archetypeId && (this.ratingElement || this.listElement)) {
            this.unsubscribe = this.stateManager.subscribe(this.update.bind(this));
            this.init();
        }
    }

    async init() {
        const result = await this.api.getReviews(this.archetypeId, { page: 1 });

        // Branch on `ok` first: network/parse failures resolve to status 0, so a
        // status check alone would misbehave (carried forward from #5 review).
        if (!result.ok) {
            this.renderError();
            return;
        }

        const data = result.data || {};
        const average = data.archetype_rating_average;
        const count = data.archetype_review_count;
        this.ratingAverage = average === undefined ? null : average;
        this.reviewCount = count === null || count === undefined ? 0 : count;

        this.renderSummary();
        this.renderList(Array.isArray(data.items) ? data.items : []);
    }

    /**
     * StateManager subscriber. Slice 6a only re-paints the cached summary so the
     * block stays consistent across re-renders; alias-driven refetch is #7.
     */
    update() {
        this.renderSummary();
    }

    renderSummary() {
        if (!this.ratingElement) {
            return;
        }

        if (this.ratingAverage === null) {
            this.ratingElement.innerHTML = `<span class="cs-rating-empty">${MESSAGES.noReviews}</span>`;
            this.ratingElement.style.visibility = 'visible';
            return;
        }

        this.ratingElement.innerHTML = `${this._buildStars(this.ratingAverage)}<span class="rating-count">${this._countLabel(this.reviewCount)}</span>`;
        this.ratingElement.style.visibility = 'visible';
    }

    renderList(items) {
        if (!this.listElement) {
            return;
        }

        if (!items.length) {
            this.listElement.innerHTML = `<p class="cs-reviews-empty">${MESSAGES.noReviews}</p>`;
            return;
        }

        this.listElement.innerHTML = items.map(review => this._buildReview(review)).join('');
    }

    renderError() {
        if (this.ratingElement) {
            this.ratingElement.innerHTML = '';
            this.ratingElement.style.visibility = 'hidden';
        }

        if (this.listElement) {
            this.listElement.innerHTML = `<p class="cs-reviews-error">${MESSAGES.loadError}</p>`;
        }
    }

    _buildStars(average) {
        const rounded = Math.round(average);
        let stars = '';

        for (let i = 1; i <= MAX_STARS; i += 1) {
            const modifier = i <= rounded ? 'ratingFull' : 'ratingEmpty';
            stars += `<span class="icon icon--${modifier}"><svg><use href="#icon-star" /></svg></span>`;
        }

        return `<span class="cs-rating-stars" role="img" aria-label="${average} out of ${MAX_STARS} stars">${stars}</span>`;
    }

    _countLabel(count) {
        return count === 1 ? '1 review' : `${count} reviews`;
    }

    _buildReview(review) {
        const author = this._escape(review.author) || MESSAGES.anonymous;
        const title = this._escape(review.title);
        const body = this._escape(review.body);
        const vehicle = this._escape(review.vehicle_label);
        const date = this._formatDate(review.date);
        const verified = review.verified_purchaser
            ? '<span class="cs-review-verified">Verified Purchaser</span>'
            : '';
        const staff = review.staff_response
            ? `<div class="cs-review-staff"><strong>CravenSpeed:</strong> ${this._escape(review.staff_response)}</div>`
            : '';

        return `
            <article class="cs-review">
                ${this._buildStars(review.rating || 0)}
                ${title ? `<h3 class="cs-review-title">${title}</h3>` : ''}
                <p class="cs-review-meta">
                    <span class="cs-review-author">${author}</span>
                    ${verified}
                    ${date ? `<span class="cs-review-date">${date}</span>` : ''}
                </p>
                ${vehicle ? `<p class="cs-review-vehicle">${vehicle}</p>` : ''}
                <p class="cs-review-body">${body}</p>
                ${staff}
            </article>`;
    }

    _formatDate(value) {
        if (!value) {
            return '';
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return '';
        }

        return parsed.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    }

    _escape(value) {
        if (value === null || value === undefined) {
            return '';
        }

        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    }

    destroy() {
        if (this.unsubscribe) this.unsubscribe();
    }
}
