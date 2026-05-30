/**
 * @file ugcOverview
 * @description Home-page overview photo wall (cs-ugc SRS §3.4.2, §3.2.3).
 * Fetches the latest approved reviews across all archetypes once via
 * GET /api/overview, then paginates and filters that single dataset entirely
 * client-side at 10 per page. Replaces the removed Stamped home wall.
 *
 * Initialised from the home entry point (homeController.js).
 */

import ugcApi from './ugcApi';
import { escapeHtml } from './search/utils';

const PER_PAGE = 10;

// Client-side display filters (SRS §3.4.2). `rating` carries a 1-5 value when
// the user picks a star count; the others ignore it.
export const FILTERS = {
    ALL: 'all',
    BASIC: 'basic',
    WITH_PHOTOS: 'photos',
    RATING: 'rating',
};

/**
 * A review has media when its media array holds at least one entry. The
 * overview feed augments each review with the standard review fields, which
 * include the ordered `media` array (SRS §3.2.3 / §3.2.1 review objects).
 * @param {Object} review
 * @returns {boolean}
 */
function hasMedia(review) {
    return Array.isArray(review.media) && review.media.length > 0;
}

/**
 * Apply the active display filter to the full dataset. Pure — no fetches.
 * @param {Object[]} reviews
 * @param {string} filter - One of FILTERS.
 * @param {number|null} ratingValue - Star count when filter is RATING.
 * @returns {Object[]}
 */
export function applyFilter(reviews, filter, ratingValue = null) {
    if (filter === FILTERS.WITH_PHOTOS) {
        return reviews.filter(hasMedia);
    }

    if (filter === FILTERS.BASIC) {
        return reviews.filter(review => !hasMedia(review));
    }

    if (filter === FILTERS.RATING && ratingValue !== null) {
        return reviews.filter(review => review.rating === ratingValue);
    }

    return reviews;
}

/**
 * Slice a filtered dataset to a single page.
 * @param {Object[]} reviews
 * @param {number} page - 1-indexed.
 * @returns {Object[]}
 */
export function paginate(reviews, page) {
    const start = (page - 1) * PER_PAGE;
    return reviews.slice(start, start + PER_PAGE);
}

/**
 * Total page count for a filtered dataset (minimum 1 so the controls render
 * a stable "1 / 1" even when empty).
 * @param {number} total
 * @returns {number}
 */
export function pageCount(total) {
    return Math.max(1, Math.ceil(total / PER_PAGE));
}

export default class UgcOverview {
    /**
     * @param {Object} [options]
     * @param {string} [options.selector] - Mount-point selector.
     * @param {Object} [options.api] - Injectable UgcApi (defaults to singleton).
     */
    constructor({ selector = '[data-ugc-overview]', api = ugcApi } = {}) {
        this.container = document.querySelector(selector);
        this.api = api;

        this.reviews = [];
        this.filter = FILTERS.ALL;
        this.ratingValue = null;
        this.page = 1;

        this.handleControlClick = this.handleControlClick.bind(this);
    }

    /**
     * Fetch the overview feed once and render. Branches on `ok` first per the
     * ugcApi contract; any failure (network/parse → status 0, or a non-2xx)
     * renders the empty "no media yet" state, never a broken wall.
     * @returns {Promise<void>}
     */
    async init() {
        if (!this.container) return;

        const result = await this.api.getOverview();

        if (result.ok && result.data && Array.isArray(result.data.reviews)) {
            this.reviews = result.data.reviews;
        } else {
            this.reviews = [];
        }

        this.bindEvents();
        this.render();
    }

    bindEvents() {
        this.container.addEventListener('click', this.handleControlClick);
    }

    /**
     * Delegate clicks for filter buttons and pagination. Filter changes reset
     * to page 1; page changes clamp within range. No network calls.
     * @param {MouseEvent} event
     */
    handleControlClick(event) {
        const filterButton = event.target.closest('[data-ugc-filter]');
        if (filterButton) {
            const { ugcFilter, ugcRating } = filterButton.dataset;
            this.filter = ugcFilter;
            this.ratingValue = ugcRating ? parseInt(ugcRating, 10) : null;
            this.page = 1;
            this.render();
            return;
        }

        const pageButton = event.target.closest('[data-ugc-page]');
        if (pageButton) {
            const filtered = applyFilter(this.reviews, this.filter, this.ratingValue);
            const target = parseInt(pageButton.dataset.ugcPage, 10);
            const max = pageCount(filtered.length);
            this.page = Math.min(Math.max(1, target), max);
            this.render();
        }
    }

    render() {
        const filtered = applyFilter(this.reviews, this.filter, this.ratingValue);
        const items = paginate(filtered, this.page);

        this.container.innerHTML = `
            ${this.buildFilters()}
            ${this.buildWall(items)}
            ${this.buildPagination(filtered.length)}
        `;
    }

    buildFilters() {
        const options = [
            { filter: FILTERS.ALL, label: 'All', rating: null },
            { filter: FILTERS.WITH_PHOTOS, label: 'With Photos', rating: null },
            { filter: FILTERS.BASIC, label: 'No Photos', rating: null },
            { filter: FILTERS.RATING, label: '5 Stars', rating: 5 },
            { filter: FILTERS.RATING, label: '4 Stars', rating: 4 },
        ];

        const buttons = options.map((option) => {
            const isActive = this.filter === option.filter
                && this.ratingValue === option.rating;
            const ratingAttr = option.rating === null ? '' : ` data-ugc-rating="${option.rating}"`;
            return `
                <button
                    type="button"
                    class="cs-ugc-overview-filter${isActive ? ' is-active' : ''}"
                    data-ugc-filter="${option.filter}"${ratingAttr}
                    aria-pressed="${isActive}"
                >${option.label}</button>
            `;
        }).join('');

        return `<div class="cs-ugc-overview-filters" role="group" aria-label="Filter reviews">${buttons}</div>`;
    }

    buildWall(items) {
        if (items.length === 0) {
            return '<p class="cs-ugc-overview-empty">No reviews to show yet.</p>';
        }

        const cards = items.map(review => this.buildCard(review)).join('');
        return `<div class="cs-ugc-overview-wall">${cards}</div>`;
    }

    buildCard(review) {
        const author = escapeHtml(review.author);
        const title = escapeHtml(review.title);
        const body = escapeHtml(review.body);
        const archetypeName = escapeHtml(review.archetype_name);
        const archetypeUrl = escapeHtml(review.archetype_url);
        const rating = parseInt(review.rating, 10) || 0;
        const stars = '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));

        return `
            <article class="cs-ugc-overview-card">
                ${this.buildThumb(review)}
                <div class="cs-ugc-overview-card-body">
                    <div class="cs-ugc-overview-stars" aria-label="${rating} out of 5 stars">${stars}</div>
                    ${title ? `<h3 class="cs-ugc-overview-title">${title}</h3>` : ''}
                    <p class="cs-ugc-overview-text">${body}</p>
                    <p class="cs-ugc-overview-meta">
                        <span class="cs-ugc-overview-author">${author}</span>
                        ${archetypeUrl ? `<a class="cs-ugc-overview-product" href="${archetypeUrl}">${archetypeName}</a>` : ''}
                    </p>
                </div>
            </article>
        `;
    }

    /**
     * Render the first media item as the card thumbnail. Photos use the
     * thumbnail URL; videos fall back to the poster (SRS §3.2.7 / ReviewMedia).
     * The thumb slot reserves space even with no media so the wall stays
     * layout-stable.
     * @param {Object} review
     * @returns {string}
     */
    buildThumb(review) {
        if (!hasMedia(review)) {
            return '<div class="cs-ugc-overview-thumb is-empty" aria-hidden="true"></div>';
        }

        const media = review.media[0];
        const src = media.thumb_url || media.poster_url || media.medium_url || media.url;

        if (!src) {
            return '<div class="cs-ugc-overview-thumb is-empty" aria-hidden="true"></div>';
        }

        const alt = escapeHtml(review.title || review.archetype_name || 'Customer photo');
        return `
            <div class="cs-ugc-overview-thumb">
                <img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" width="200" height="200">
            </div>
        `;
    }

    buildPagination(total) {
        const pages = pageCount(total);
        if (pages <= 1) return '';

        const prevDisabled = this.page <= 1 ? ' disabled' : '';
        const nextDisabled = this.page >= pages ? ' disabled' : '';

        return `
            <div class="cs-ugc-overview-pagination">
                <button type="button" class="cs-ugc-overview-page" data-ugc-page="${this.page - 1}"${prevDisabled}>Previous</button>
                <span class="cs-ugc-overview-page-status">Page ${this.page} of ${pages}</span>
                <button type="button" class="cs-ugc-overview-page" data-ugc-page="${this.page + 1}"${nextDisabled}>Next</button>
            </div>
        `;
    }

    destroy() {
        if (this.container) {
            this.container.removeEventListener('click', this.handleControlClick);
        }
    }
}
