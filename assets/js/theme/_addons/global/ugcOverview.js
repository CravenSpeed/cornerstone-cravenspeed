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
const MAX_STARS = 5;

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
 * Build the 5-star strip from the shared icon sprite — the same
 * icon--ratingFull / icon--ratingEmpty + #icon-star markup the product page
 * renders (ugcProduct.js), so stars look identical on both surfaces. The
 * sprite is injected unconditionally in layout/base.html, so #icon-star is
 * available on the home page.
 * @param {number} rating - Whole stars, 0-5.
 * @returns {string}
 */
export function buildStarIcons(rating) {
    let stars = '';

    for (let i = 1; i <= MAX_STARS; i += 1) {
        const modifier = i <= rating ? 'ratingFull' : 'ratingEmpty';
        stars += `<span class="icon icon--${modifier}"><svg><use href="#icon-star" /></svg></span>`;
    }

    return stars;
}

/**
 * Build the structured-vehicle badge from a review's system-generated
 * `vehicle_label` (cs-ugc SRS §3.4.2 / §3.2.1 — the display label the storefront
 * resolved at submit, e.g. "MINI Cooper F56"). Display-only on the home wall in
 * v1; garage-aware filtering of the wall is deferred to v1.1. A review with no
 * vehicle (universal product, or the submitter opted out) carries a `null` /
 * absent label — the badge is then omitted entirely (not an empty element), so
 * there is nothing to reserve space for.
 * @param {string|null|undefined} label
 * @returns {string}
 */
export function buildVehicleBadge(label) {
    if (!label) {
        return '';
    }

    return `<p class="cs-ugc-vehicle-badge cs-ugc-overview-vehicle">${escapeHtml(label)}</p>`;
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

        // Review lightbox state. The node is created lazily on first open and
        // lives on <body>, outside the wall's innerHTML churn. lightboxIndex is
        // an absolute index into the current filtered set (Decision A).
        this.lightbox = null;
        this.lightboxIndex = 0;
        this.lastFocused = null;

        this.handleControlClick = this.handleControlClick.bind(this);
        this.handleLightboxClick = this.handleLightboxClick.bind(this);
        this.handleLightboxKeydown = this.handleLightboxKeydown.bind(this);
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
        const opener = event.target.closest('[data-ugc-review-open]');
        if (opener) {
            this.openLightbox(parseInt(opener.dataset.ugcIndex, 10));
            return;
        }

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
        const base = (this.page - 1) * PER_PAGE;

        this.container.innerHTML = `
            ${this.buildFilters()}
            ${this.buildWall(items, base)}
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

    buildWall(items, base) {
        if (items.length === 0) {
            return '<p class="cs-ugc-overview-empty">No reviews to show yet.</p>';
        }

        const cards = items.map((review, i) => this.buildCard(review, base + i)).join('');
        return `<div class="cs-ugc-overview-wall">${cards}</div>`;
    }

    buildCard(review, index) {
        const author = escapeHtml(review.author);
        const title = escapeHtml(review.title);
        const body = escapeHtml(review.body);
        const archetypeName = escapeHtml(review.archetype_name);
        const archetypeUrl = escapeHtml(review.archetype_url);
        const rating = parseInt(review.rating, 10) || 0;
        const stars = buildStarIcons(rating);

        return `
            <article class="cs-ugc-overview-card">
                ${this.buildThumb(review, index)}
                <div class="cs-ugc-overview-card-body">
                    <div class="cs-ugc-overview-stars" role="img" aria-label="${rating} out of ${MAX_STARS} stars">${stars}</div>
                    ${title ? `<h3 class="cs-ugc-overview-title">${title}</h3>` : ''}
                    ${buildVehicleBadge(review.vehicle_label)}
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
     * layout-stable. When the review carries a photo the thumb is a button that
     * opens the review in the lightbox; the `index` is its absolute position in
     * the current filtered set, which the lightbox steps through.
     * @param {Object} review
     * @param {number} index
     * @returns {string}
     */
    buildThumb(review, index) {
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
            <button type="button" class="cs-ugc-overview-thumb" data-ugc-review-open data-ugc-index="${index}" aria-label="Open this review">
                <img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" width="200" height="200">
            </button>
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

    /**
     * The absolute-index list the lightbox steps through: the active filter
     * applied to the full feed, in display order (Decision A — includes reviews
     * without photos). A thumb's data-ugc-index points into this same list.
     * @returns {Object[]}
     */
    filteredReviews() {
        return applyFilter(this.reviews, this.filter, this.ratingValue);
    }

    /**
     * Lazily create the single lightbox node (appended to <body>, outside the
     * wall's innerHTML churn) and wire its delegated click handler. Reuses the
     * .cs-ugc-modal / .cs-ugc-lightbox shell from _cs-product.scss.
     * @returns {HTMLElement}
     */
    ensureLightbox() {
        if (this.lightbox) {
            return this.lightbox;
        }

        const el = document.createElement('div');
        el.className = 'cs-ugc-modal cs-ugc-overview-lightbox';
        el.dataset.ugcOverviewLightbox = '';
        el.hidden = true;
        el.innerHTML = `
            <div class="cs-ugc-modal-overlay" data-ugc-lightbox-close></div>
            <div class="cs-ugc-modal-dialog cs-ugc-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Customer review">
                <button type="button" class="cs-ugc-modal-close" data-ugc-lightbox-close aria-label="Close"><span aria-hidden="true">&times;</span></button>
                <button type="button" class="cs-ugc-lightbox-arrow cs-ugc-lightbox-arrow--prev" data-ugc-review-prev aria-label="Previous review"><span aria-hidden="true">&lsaquo;</span></button>
                <button type="button" class="cs-ugc-lightbox-arrow cs-ugc-lightbox-arrow--next" data-ugc-review-next aria-label="Next review"><span aria-hidden="true">&rsaquo;</span></button>
                <div class="cs-ugc-overview-lightbox-content" data-ugc-lightbox-content></div>
            </div>
        `;

        document.body.appendChild(el);
        el.addEventListener('click', this.handleLightboxClick);
        this.lightbox = el;
        return el;
    }

    /**
     * Open the lightbox at an absolute index into the filtered set and start
     * keyboard navigation. Out-of-range indices are ignored.
     * @param {number} index
     */
    openLightbox(index) {
        const reviews = this.filteredReviews();
        if (!Number.isInteger(index) || index < 0 || index >= reviews.length) {
            return;
        }

        this.lastFocused = document.activeElement;
        this.lightboxIndex = index;

        const el = this.ensureLightbox();
        this.renderLightbox();
        el.hidden = false;
        document.addEventListener('keydown', this.handleLightboxKeydown);

        const close = el.querySelector('[data-ugc-lightbox-close]');
        if (close) {
            close.focus();
        }
    }

    /**
     * Step the lightbox by delta within the filtered set, clamped to its ends
     * (no wrap — the arrows disable at the boundaries).
     * @param {number} delta
     */
    navigateLightbox(delta) {
        const reviews = this.filteredReviews();
        const target = this.lightboxIndex + delta;
        if (target < 0 || target >= reviews.length) {
            return;
        }

        this.lightboxIndex = target;
        this.renderLightbox();
    }

    /**
     * Paint the current review into the lightbox and set the arrow disabled
     * states for the current position.
     */
    renderLightbox() {
        if (!this.lightbox) {
            return;
        }

        const reviews = this.filteredReviews();
        const review = reviews[this.lightboxIndex];
        if (!review) {
            return;
        }

        const content = this.lightbox.querySelector('[data-ugc-lightbox-content]');
        content.innerHTML = this.buildLightboxMedia(review) + this.buildLightboxReview(review);
        content.scrollTop = 0;

        // Overview arrows stay visible and only disable at the ends (a single
        // filtered review disables both). This differs deliberately from the
        // product lightbox, which hides its arrows for a single-photo set —
        // here the review-stepping affordance reads better kept in place.
        const prev = this.lightbox.querySelector('[data-ugc-review-prev]');
        const next = this.lightbox.querySelector('[data-ugc-review-next]');
        prev.disabled = this.lightboxIndex <= 0;
        next.disabled = this.lightboxIndex >= reviews.length - 1;
    }

    /**
     * Hide the lightbox, clear its content (which also stops a playing video),
     * stop keyboard navigation, and restore focus to the thumb that opened it.
     */
    closeLightbox() {
        if (!this.lightbox || this.lightbox.hidden) {
            return;
        }

        this.lightbox.hidden = true;
        const content = this.lightbox.querySelector('[data-ugc-lightbox-content]');
        if (content) {
            content.innerHTML = '';
        }

        document.removeEventListener('keydown', this.handleLightboxKeydown);

        if (this.lastFocused && typeof this.lastFocused.focus === 'function') {
            this.lastFocused.focus();
        }
        this.lastFocused = null;
    }

    /**
     * All of a review's media, stacked and rendered large (photo → medium/url,
     * video → playable with its poster). Reviews without media render no media
     * block — the text still shows, so arrow navigation never dead-ends on a
     * no-photo review (SRS §3.2.1 safe media fields).
     * @param {Object} review
     * @returns {string}
     */
    buildLightboxMedia(review) {
        if (!hasMedia(review)) {
            return '';
        }

        const items = review.media.map((media) => {
            const label = escapeHtml(review.title || review.archetype_name || 'Customer media');

            if (media.type === 'video') {
                const videoSrc = escapeHtml(media.url || '');
                const poster = media.poster_url ? ` poster="${escapeHtml(media.poster_url)}"` : '';
                return `<video class="cs-ugc-lightbox-video" src="${videoSrc}"${poster} controls playsinline aria-label="${label}"></video>`;
            }

            const imgSrc = escapeHtml(media.medium_url || media.url || media.thumb_url || '');
            return `<img class="cs-ugc-lightbox-img" src="${imgSrc}" alt="${label}" loading="lazy">`;
        }).join('');

        return `<div class="cs-ugc-overview-lightbox-media">${items}</div>`;
    }

    /**
     * The review's text content, mirroring the wall card (stars, title, vehicle
     * badge, body, author + product link) but laid out for the wider lightbox.
     * @param {Object} review
     * @returns {string}
     */
    buildLightboxReview(review) {
        const author = escapeHtml(review.author);
        const title = escapeHtml(review.title);
        const body = escapeHtml(review.body);
        const archetypeName = escapeHtml(review.archetype_name);
        const archetypeUrl = escapeHtml(review.archetype_url);
        const rating = parseInt(review.rating, 10) || 0;
        const stars = buildStarIcons(rating);

        return `
            <div class="cs-ugc-overview-lightbox-review">
                <div class="cs-ugc-overview-stars" role="img" aria-label="${rating} out of ${MAX_STARS} stars">${stars}</div>
                ${title ? `<h3 class="cs-ugc-overview-lightbox-title">${title}</h3>` : ''}
                ${buildVehicleBadge(review.vehicle_label)}
                <p class="cs-ugc-overview-text">${body}</p>
                <p class="cs-ugc-overview-meta">
                    <span class="cs-ugc-overview-author">${author}</span>
                    ${archetypeUrl ? `<a class="cs-ugc-overview-product" href="${archetypeUrl}">${archetypeName}</a>` : ''}
                </p>
            </div>
        `;
    }

    handleLightboxClick(event) {
        if (event.target.closest('[data-ugc-lightbox-close]')) {
            this.closeLightbox();
            return;
        }

        if (event.target.closest('[data-ugc-review-prev]')) {
            this.navigateLightbox(-1);
            return;
        }

        if (event.target.closest('[data-ugc-review-next]')) {
            this.navigateLightbox(1);
        }
    }

    handleLightboxKeydown(event) {
        switch (event.key) {
        case 'Escape':
            this.closeLightbox();
            break;
        case 'ArrowLeft':
            this.navigateLightbox(-1);
            break;
        case 'ArrowRight':
            this.navigateLightbox(1);
            break;
        default:
            break;
        }
    }

    destroy() {
        if (this.container) {
            this.container.removeEventListener('click', this.handleControlClick);
        }

        // Close first if open, so teardown stays symmetric: restores focus,
        // removes the keydown listener, and clears the leaked lastFocused node.
        if (this.lightbox && !this.lightbox.hidden) {
            this.closeLightbox();
        }

        document.removeEventListener('keydown', this.handleLightboxKeydown);

        if (this.lightbox) {
            this.lightbox.removeEventListener('click', this.handleLightboxClick);
            this.lightbox.remove();
            this.lightbox = null;
        }
    }
}
