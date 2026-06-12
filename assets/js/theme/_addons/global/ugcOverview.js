/**
 * @file ugcOverview
 * @description Home-page overview photo wall (cs-ugc SRS §3.4.2, §3.2.3).
 * Fetches the latest approved reviews across all archetypes once via
 * GET /api/overview, then sorts, filters, and paginates that single dataset
 * entirely client-side (the product reviews list, by contrast, refetches the API
 * on every change). It mirrors the product reviews toolbar — sort, rating filter,
 * verified-purchasers and with-media toggles, plus the garage vehicle chip — all
 * composed over the in-memory feed. The "Write a review" button is omitted (no
 * single archetype to submit to from home). 12 cards per page, with controls
 * above and below the wall. Replaces the removed Stamped home wall.
 *
 * The toolbar is painted once; sort/filter/page/chip changes repaint only the
 * vehicle-chip slot and/or the wall region ([data-ugc-wall]) — never the toolbar
 * — so the controls keep focus and value, and the delegated click/change
 * listeners on the container survive every wall rebuild.
 *
 * SRS §3.4.2 formally defers home-wall filtering to v1.1; this client-side
 * divergence is accepted by the product owner (no cs-ugc change needed) — every
 * overview review already carries the fields used (rating, verified_purchaser,
 * media, date, fitment_id).
 *
 * Initialised from the home entry point (homeController.js).
 */

import ugcApi from './ugcApi';
import { escapeHtml } from './search/utils';
import { resolveGarageFitment } from './vehicleFitment';
import { pageWindow, PAGE_GAP, PAGE_GAP_HTML } from './ugcPagination';
import {
    starIcons,
    scoreBadge,
    verifiedBadge,
    editedBadge,
    countryFlag,
    formatReviewDate,
    MAX_STARS,
} from './ugcCard';

// 12 divides evenly by the 1 / 2 / 3 responsive column counts, so every full
// page forms complete rows — a neat rectangle with no trailing orphan card.
const PER_PAGE = 12;

// Accepted sort values, mirroring the product reviews toolbar (ugcProduct.js).
// Anything else falls back to date_desc — the honest newest-first default.
const SORT_VALUES = ['date_desc', 'date_asc', 'rating_desc', 'rating_asc'];

/**
 * A review's timestamp for date sorting. Unparseable / absent dates collapse to
 * 0 so the comparator stays a real number (never NaN) and the sort stays stable.
 * @param {Object} review
 * @returns {number}
 */
function reviewTime(review) {
    const t = new Date(review.date).getTime();
    return Number.isNaN(t) ? 0 : t;
}

/**
 * A review's whole-star rating as an integer (0 when absent/unparseable),
 * matching how the cards coerce `rating`. Used by the rating filter and the
 * rating sort comparators.
 * @param {Object} review
 * @returns {number}
 */
function reviewRating(review) {
    return parseInt(review.rating, 10) || 0;
}

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
 * Build the 5-star strip from the shared icon sprite — the same
 * icon--ratingFull / icon--ratingEmpty + #icon-star markup the product page
 * renders (ugcProduct.js), so stars look identical on both surfaces. The
 * sprite is injected unconditionally in layout/base.html, so #icon-star is
 * available on the home page.
 * @param {number} rating - Whole stars, 0-5.
 * @returns {string}
 */
export function buildStarIcons(rating) {
    return starIcons(rating);
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
     * @param {Object} [options.globalStateManager] - The site-wide StateManager
     *   singleton, source of the garage vehicle (`vehicle.selected`) and search
     *   `vehicle_registry` (`search.data`). Absent → the vehicle filter is inert
     *   (no chip), mirroring ugcProduct on a page with no garage.
     */
    constructor({ selector = '[data-ugc-overview]', api = ugcApi, globalStateManager = null } = {}) {
        this.container = document.querySelector(selector);
        this.api = api;
        this.globalStateManager = globalStateManager;

        this.reviews = [];
        this.page = 1;

        // Client-side toolbar state (mirrors the product reviews toolbar, but
        // composed over the pre-fetched feed rather than refetched). `rating` is
        // the star filter (int) or null for all ratings; `verified`/`media` are
        // the two checkbox filters; `sort` is one of SORT_VALUES.
        this.sort = 'date_desc';
        this.rating = null;
        this.verified = false;
        this.media = false;

        // Garage vehicle filter (mirrors the product chip, client-side over the
        // pre-fetched feed). fitmentId/Label come from resolving the global
        // garage selection against the search registry; fitmentOnly is the
        // opt-in hard filter — off by default (never auto-applied).
        this.fitmentId = null;
        this.fitmentLabel = null;
        this.fitmentOnly = false;
        this.unsubscribeGlobal = null;

        // Review lightbox state. The node is created lazily on first open and
        // lives on <body>, outside the wall's innerHTML churn. lightboxIndex is
        // an absolute index into the displayed (filtered) set (Decision A);
        // lightboxMediaIndex is which of the open review's media items is the
        // displayed hero (reset to 0 whenever the open review changes).
        this.lightbox = null;
        this.lightboxIndex = 0;
        this.lightboxMediaIndex = 0;
        this.lastFocused = null;

        this.handleControlClick = this.handleControlClick.bind(this);
        this.handleToolbarChange = this.handleToolbarChange.bind(this);
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
        this.subscribeGlobalFitment();
        this.render();
    }

    bindEvents() {
        this.container.addEventListener('click', this.handleControlClick);
        // Delegated so the toolbar's selects/checkboxes are reachable however the
        // wall region below them is rebuilt (the toolbar itself is painted once).
        this.container.addEventListener('change', this.handleToolbarChange);
    }

    /**
     * Subscribe to the global garage state and seed the initial fitment. No-op
     * without a GlobalStateManager (the vehicle filter is then inert). Resolves
     * once synchronously so the first render can show the chip, then re-resolves
     * on every change (a late-arriving registry or a garage swap).
     */
    subscribeGlobalFitment() {
        if (!this.globalStateManager) {
            return;
        }

        this.resolveFitmentFromGlobal(this.globalStateManager.getState());
        this.unsubscribeGlobal = this.globalStateManager.subscribe(
            state => this.onGlobalFitmentChange(state),
        );
    }

    /**
     * Resolve and store the garage fitment from a global state snapshot, without
     * re-rendering. Reads `vehicle.selected` + `search.data.vehicle_registry`
     * and resolves via the shared vehicleFitment resolver — the same inputs the
     * product page uses, both available on the home page.
     * @param {Object} [globalState]
     */
    resolveFitmentFromGlobal(globalState) {
        const vehicle = globalState && globalState.vehicle ? globalState.vehicle.selected : null;
        const registry = globalState && globalState.search && globalState.search.data
            ? globalState.search.data.vehicle_registry
            : null;

        const resolved = resolveGarageFitment(registry, vehicle);
        this.fitmentId = resolved ? resolved.fitment_id : null;
        this.fitmentLabel = resolved ? resolved.label : null;
    }

    /**
     * Global state changed. Re-resolve the garage fitment; if it changed (garage
     * swap, or the registry arriving and resolving a previously-unresolvable
     * selection), drop any active filter — a new vehicle context defaults to the
     * honest unfiltered view — reset to page 1, and re-render.
     * @param {Object} [globalState]
     */
    onGlobalFitmentChange(globalState) {
        const previousId = this.fitmentId;
        this.resolveFitmentFromGlobal(globalState);

        if (this.fitmentId === previousId) {
            return;
        }

        this.fitmentOnly = false;
        this.page = 1;
        this.renderFitmentChip();
        this.renderWall();
    }

    /**
     * Delegate clicks for the lightbox openers and pagination. Page changes
     * clamp within range. No network calls.
     * @param {MouseEvent} event
     */
    handleControlClick(event) {
        const opener = event.target.closest('[data-ugc-review-open]');
        if (opener) {
            this.openLightbox(parseInt(opener.dataset.ugcIndex, 10));
            return;
        }

        // "Select your vehicle to filter" prompt (shown when no vehicle is
        // resolved) — scroll to the home vehicle selector so the visitor can
        // set one, which then resolves the fitment and turns the chip on.
        if (event.target.closest('[data-ugc-fitment-prompt]')) {
            this.scrollToVehicleSelector();
            return;
        }

        // "For your <vehicle>" chip — toggle the opt-in vehicle hard filter on,
        // or clear it off. Either way reset to page 1 and repaint.
        const fitmentControl = event.target.closest('[data-ugc-fitment-toggle], [data-ugc-fitment-clear]');
        if (fitmentControl) {
            const isClear = fitmentControl.dataset.ugcFitmentClear !== undefined;
            const nextOnly = !isClear;
            if (nextOnly === this.fitmentOnly) {
                return;
            }

            this.fitmentOnly = nextOnly;
            this.page = 1;
            this.renderFitmentChip();
            this.renderWall();
            return;
        }

        const pageButton = event.target.closest('[data-ugc-page]');
        if (pageButton) {
            const target = parseInt(pageButton.dataset.ugcPage, 10);
            const max = pageCount(this.displayedReviews().length);
            const next = Math.min(Math.max(1, target), max);
            if (next === this.page) {
                return;
            }

            this.page = next;
            this.renderWall();
            // A page change from either control set would otherwise strand the
            // reader mid-wall — bring the wall top into view.
            this.scrollToTop();
        }
    }

    /**
     * Toolbar sort/filter change (mirrors the product page's onToolbarChange, but
     * over the in-memory feed). Reads which control fired from its
     * `data-ugc-control`, updates the matching state, resets to page 1, and
     * repaints only the wall — the toolbar itself is left in place so the changed
     * control keeps its focus and value.
     * @param {Event} event
     */
    handleToolbarChange(event) {
        const target = event.target;
        const control = target && target.dataset ? target.dataset.ugcControl : null;
        if (!control) {
            return;
        }

        if (control === 'sort') {
            this.sort = SORT_VALUES.indexOf(target.value) === -1 ? 'date_desc' : target.value;
        } else if (control === 'rating') {
            const parsed = parseInt(target.value, 10);
            this.rating = Number.isNaN(parsed) ? null : parsed;
        } else if (control === 'verified') {
            this.verified = target.checked;
        } else if (control === 'media') {
            this.media = target.checked;
        } else {
            return;
        }

        this.page = 1;
        this.renderWall();
    }

    /**
     * The reviews currently shown: the full feed run through every active toolbar
     * filter (vehicle → rating → verified → media) and then sorted. This is the
     * single set that pagination, the wall, and the lightbox all index into, so a
     * card opener's absolute index always lines up with the lightbox. The sort
     * always copies the list, so `this.reviews` is never mutated.
     * @returns {Object[]}
     */
    displayedReviews() {
        let list = this.reviews;

        if (this.fitmentOnly && this.fitmentId !== null) {
            list = list.filter(review => review.fitment_id === this.fitmentId);
        }

        if (this.rating !== null) {
            list = list.filter(review => reviewRating(review) === this.rating);
        }

        if (this.verified) {
            list = list.filter(review => review.verified_purchaser);
        }

        if (this.media) {
            list = list.filter(hasMedia);
        }

        return this.sortReviews(list);
    }

    /**
     * Sort a COPY of the list by the active sort. Date sorts compare timestamps;
     * the rating sorts break ties newest-first so equal-rated reviews stay in a
     * stable, sensible order. Never mutates the input (which may be the original
     * `this.reviews` reference when no filter ran).
     * @param {Object[]} list
     * @returns {Object[]}
     */
    sortReviews(list) {
        const sorted = [...list];

        switch (this.sort) {
        case 'date_asc':
            sorted.sort((a, b) => reviewTime(a) - reviewTime(b));
            break;
        case 'rating_desc':
            sorted.sort((a, b) => (reviewRating(b) - reviewRating(a))
                || (reviewTime(b) - reviewTime(a)));
            break;
        case 'rating_asc':
            sorted.sort((a, b) => (reviewRating(a) - reviewRating(b))
                || (reviewTime(b) - reviewTime(a)));
            break;
        case 'date_desc':
        default:
            sorted.sort((a, b) => reviewTime(b) - reviewTime(a));
            break;
        }

        return sorted;
    }

    /**
     * Paint the full surface: the toolbar (once) plus the wall region it scopes.
     * A truly-empty feed shows just the empty message — no toolbar to operate on
     * an empty set. Sort/filter/page/chip changes thereafter repaint only the
     * chip slot and/or the wall region, never the toolbar, so the controls keep
     * their focus and value across interactions.
     */
    render() {
        if (this.reviews.length === 0) {
            this.container.innerHTML = '<p class="cs-ugc-overview-empty">No reviews to show yet.</p>';
            return;
        }

        this.container.innerHTML = `
            ${this.buildToolbar()}
            <div data-ugc-wall></div>
        `;

        this.renderFitmentChip();
        this.renderWall();
    }

    /**
     * Repaint only the wall region (top pagination + cards + bottom pagination)
     * from the current displayed set. No-op if the region is absent (empty feed).
     */
    renderWall() {
        const wall = this.container.querySelector('[data-ugc-wall]');
        if (!wall) {
            return;
        }

        const all = this.displayedReviews();
        const items = paginate(all, this.page);
        const base = (this.page - 1) * PER_PAGE;

        wall.innerHTML = `
            ${this.buildPagination(all.length, 'top')}
            ${this.buildWall(items, base)}
            ${this.buildPagination(all.length, 'bottom')}
        `;
    }

    /**
     * The sort/filter toolbar, reusing the product reviews control markup/classes
     * (all bare classes in _cs-product.scss). Rendered once; the controls reflect
     * the current state so a full repaint never drops a selection. The "Write a
     * review" button is intentionally omitted (no single archetype to submit to
     * from home). The vehicle chip lives in the trailing slot, filled by
     * renderFitmentChip.
     * @returns {string}
     */
    buildToolbar() {
        const sortOptions = [
            ['date_desc', 'Newest'],
            ['date_asc', 'Oldest'],
            ['rating_desc', 'Highest rated'],
            ['rating_asc', 'Lowest rated'],
        ].map(([value, label]) => `<option value="${value}"${value === this.sort ? ' selected' : ''}>${label}</option>`).join('');

        const ratingOptions = ['', '5', '4', '3', '2', '1'].map((value) => {
            const label = value === '' ? 'All ratings' : value;
            const isSelected = value === '' ? this.rating === null : parseInt(value, 10) === this.rating;
            return `<option value="${value}"${isSelected ? ' selected' : ''}>${label}</option>`;
        }).join('');

        const verifiedChecked = this.verified ? ' checked' : '';
        const mediaChecked = this.media ? ' checked' : '';

        return `
            <div class="cs-reviews-toolbar cs-ugc-overview-toolbar">
                <label class="cs-reviews-control cs-reviews-control--sort">
                    <span class="cs-reviews-control-label">Sort by</span>
                    <select class="cs-reviews-select cs-form-select" data-ugc-control="sort">${sortOptions}</select>
                </label>
                <label class="cs-reviews-control cs-reviews-control--rating">
                    <span class="cs-reviews-control-label">Rating</span>
                    <select class="cs-reviews-select cs-form-select" data-ugc-control="rating">${ratingOptions}</select>
                </label>
                <label class="cs-reviews-control cs-reviews-control--toggle">
                    <input type="checkbox" data-ugc-control="verified"${verifiedChecked}>
                    <span class="cs-reviews-control-label">Verified purchasers</span>
                </label>
                <label class="cs-reviews-control cs-reviews-control--toggle">
                    <input type="checkbox" data-ugc-control="media"${mediaChecked}>
                    <span class="cs-reviews-control-label">With photos &amp; videos</span>
                </label>
                <div class="cs-fitment-chip-slot" data-ugc-fitment-chip></div>
            </div>
        `;
    }

    /**
     * Fill the toolbar's vehicle-chip slot from the current fitment state and flip
     * its reserved visibility (hidden by default in SCSS) to visible only when
     * populated — the CLS pattern the product page uses. No-op if the slot is
     * absent (empty feed); leaves it hidden when the filter is inert.
     */
    renderFitmentChip() {
        const slot = this.container.querySelector('[data-ugc-fitment-chip]');
        if (!slot) {
            return;
        }

        const html = this.buildFitmentChip();
        slot.innerHTML = html;
        slot.style.visibility = html ? 'visible' : 'hidden';
    }

    /**
     * The inner markup for the toolbar's vehicle-chip slot (mirrors the product
     * chip; SRS §3.4.1 phrasing, count dropped). Returned without a wrapper — the
     * `.cs-fitment-chip-slot` is the container. With no garage vehicle resolved it
     * is the "Select your vehicle" prompt (clicking scrolls to the home vehicle
     * selector). When a vehicle is resolved but no loaded review matches it, a
     * passive note explains the absent filter rather than leaving it silently
     * missing. Empty only when the vehicle filter is inert (no StateManager).
     * @returns {string}
     */
    buildFitmentChip() {
        if (!this.globalStateManager) {
            return '';
        }

        // No garage vehicle resolved yet — prompt the visitor to pick one, which
        // resolves the fitment and turns the chip on.
        if (this.fitmentId === null) {
            return '<button type="button" class="cs-fitment-prompt" data-ugc-fitment-prompt>Select your vehicle to filter</button>';
        }

        const label = escapeHtml(this.fitmentLabel || '');
        const matchCount = this.reviews.filter(review => review.fitment_id === this.fitmentId).length;

        if (matchCount <= 0) {
            return `<span class="cs-fitment-empty">No reviews yet for your ${label}</span>`;
        }

        const activeClass = this.fitmentOnly ? ' is-active' : '';
        const pressed = this.fitmentOnly ? 'true' : 'false';
        const clear = this.fitmentOnly
            ? '<button type="button" class="cs-fitment-chip-clear" data-ugc-fitment-clear aria-label="Clear vehicle filter">&times;</button>'
            : '';

        return `<button type="button" class="cs-fitment-chip${activeClass}" data-ugc-fitment-toggle aria-pressed="${pressed}"><span class="cs-fitment-chip-label">For your ${label}</span></button>${clear}`;
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
        const openLabel = escapeHtml(`Open review: ${review.title || 'customer review'}`);
        const hasPhoto = hasMedia(review);

        // The whole card opens the lightbox via a stretched, visually-empty
        // button (inset:0 in SCSS) so no-photo cards are openable too — not just
        // the photo. The product-link below sits above it (z-index) and still
        // navigates on its own click.
        return `
            <article class="cs-ugc-overview-card${hasPhoto ? ' cs-ugc-overview-card--media' : ''}">
                <button type="button" class="cs-ugc-overview-open" data-ugc-review-open data-ugc-index="${index}" aria-label="${openLabel}"></button>
                ${this.buildThumb(review)}
                <div class="cs-ugc-overview-card-body">
                    ${this.buildCardContent(review, title, author)}
                </div>
            </article>
        `;
    }

    /**
     * The shared review content block (header, vehicle badge, clamped body,
     * meta footer, product link) used by both the wall card and the lightbox.
     * Pre-escaped title/author are passed in; the rest is escaped here.
     * @param {Object} review
     * @param {string} title - Pre-escaped title.
     * @param {string} author - Pre-escaped author.
     * @returns {string}
     */
    buildCardContent(review, title, author) {
        const body = escapeHtml(review.body);
        const archetypeName = escapeHtml(review.archetype_name);
        const archetypeUrl = escapeHtml(review.archetype_url);
        const rating = parseInt(review.rating, 10) || 0;
        const date = formatReviewDate(review.date);

        return `
            <div class="cs-ugc-overview-header">
                <div class="cs-ugc-overview-stars" role="img" aria-label="${rating} out of ${MAX_STARS} stars">${starIcons(rating)}</div>
                ${scoreBadge(rating)}
            </div>
            ${title ? `<h3 class="cs-ugc-overview-title">${title}</h3>` : ''}
            ${buildVehicleBadge(review.vehicle_label)}
            <p class="cs-ugc-overview-text">${body}</p>
            <p class="cs-ugc-overview-meta">
                <span class="cs-ugc-overview-author">${author}</span>
                ${countryFlag(review.country)}
                ${date ? `<span class="cs-review-date">${date}</span>` : ''}
                ${verifiedBadge(review.verified_purchaser)}
                ${editedBadge(review.edited)}
            </p>
            ${archetypeUrl ? `<a class="cs-ugc-overview-product" href="${archetypeUrl}">${archetypeName}</a>` : ''}
        `;
    }

    /**
     * Render the first media item as the card thumbnail. Photos use the
     * thumbnail URL; videos fall back to the poster (SRS §3.2.7 / ReviewMedia).
     * Reviews with no media render no thumb at all — the card is text-forward
     * rather than reserving an empty placeholder slot.
     * @param {Object} review
     * @returns {string}
     */
    buildThumb(review) {
        if (!hasMedia(review)) {
            return '';
        }

        const media = review.media[0];
        const src = media.thumb_url || media.poster_url || media.medium_url || media.url;

        if (!src) {
            return '';
        }

        const alt = escapeHtml(review.title || review.archetype_name || 'Customer photo');
        return `<div class="cs-ugc-overview-media"><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" width="320" height="240"></div>`;
    }

    buildPagination(total, position) {
        const pages = pageCount(total);
        if (pages <= 1) return '';

        const buttons = [];
        buttons.push(this.pageButton('prev', this.page - 1, this.page <= 1, 'Previous'));

        pageWindow(this.page, pages).forEach((item) => {
            if (item === PAGE_GAP) {
                buttons.push(PAGE_GAP_HTML);
                return;
            }
            buttons.push(this.pageButton(item, item, false, String(item), item === this.page));
        });

        buttons.push(this.pageButton('next', this.page + 1, this.page >= pages, 'Next'));

        // Distinct accessible names per landmark (axe landmark-unique) — the two
        // navs are otherwise identical.
        return `<nav class="cs-ugc-overview-pagination cs-ugc-overview-pagination--${position}" aria-label="Reviews pagination, ${position} of wall">${buttons.join('')}</nav>`;
    }

    /**
     * A single numbered/prev/next page button, matching the product module's
     * `.cs-reviews-page` treatment (44px target, is-current/aria-current).
     * @param {string|number} key - Stable key for the slot (prev/next/page no.).
     * @param {number} page - The page the button targets.
     * @param {boolean} disabled
     * @param {string} label
     * @param {boolean} [isCurrent]
     * @returns {string}
     */
    pageButton(key, page, disabled, label, isCurrent = false) {
        const current = isCurrent ? ' is-current' : '';
        const aria = isCurrent ? ' aria-current="page"' : '';
        const disabledAttr = disabled ? ' disabled' : '';
        return `<button type="button" class="cs-ugc-overview-page${current}" data-ugc-page="${page}" data-page-key="${key}"${aria}${disabledAttr}>${label}</button>`;
    }

    /**
     * Smoothly bring the wall top into view after a page change. No-op when the
     * mount is absent or scrollIntoView is unavailable (jsdom).
     */
    scrollToTop() {
        if (this.container && typeof this.container.scrollIntoView === 'function') {
            this.container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    /**
     * Scroll the home vehicle selector into view and focus its first field, so
     * the "Select your vehicle" prompt leads straight to the picker. No-op when
     * the selector is absent or scrollIntoView is unavailable (jsdom).
     */
    scrollToVehicleSelector() {
        const make = document.querySelector('[data-car-selection-field="make"]');
        if (!make) {
            return;
        }

        if (typeof make.scrollIntoView === 'function') {
            make.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        make.focus({ preventScroll: true });
    }

    /**
     * The absolute-index list the lightbox steps through: the currently
     * displayed set (full feed, or the vehicle-filtered subset), in display
     * order (Decision A — includes reviews without photos). A card opener's
     * data-ugc-index points into this same list, so navigation stays aligned
     * whether or not the vehicle filter is active.
     * @returns {Object[]}
     */
    filteredReviews() {
        return this.displayedReviews();
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
        this.lightboxMediaIndex = 0;

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
        this.lightboxMediaIndex = 0;
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
        this.preloadLightboxMedia(review);

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
     * The review's media area: one displayed hero (sized to fit, never cropped)
     * plus — when the review carries more than one item — a small thumbnail strip
     * to swap which is shown. A review can hold at most a few photos + one video
     * (SRS media limits), so the whole set fits a single strip; stacking them all
     * full-size overflowed the dialog. Reviews without media render no block — the
     * text still shows, so arrow navigation never dead-ends on a no-photo review.
     * @param {Object} review
     * @returns {string}
     */
    buildLightboxMedia(review) {
        if (!hasMedia(review)) {
            return '';
        }

        return `<div class="cs-ugc-overview-lightbox-media" data-ugc-lightbox-media>${this.buildLightboxMediaInner(review)}</div>`;
    }

    /**
     * The hero + (optional) thumbnail strip for the currently displayed media of
     * a review. Split out from the wrapper so a thumbnail click can repaint just
     * this region without rebuilding the review text below.
     * @param {Object} review
     * @returns {string}
     */
    buildLightboxMediaInner(review) {
        const items = review.media;
        const index = Math.min(Math.max(0, this.lightboxMediaIndex), items.length - 1);
        const hero = this.buildLightboxHero(items[index], review);
        const strip = items.length > 1 ? this.buildLightboxThumbs(items, index) : '';
        return hero + strip;
    }

    /**
     * The large displayed media item (photo → medium/url, video → playable with
     * its poster). Sized in SCSS to fit within the dialog (object-fit, capped
     * height) so a tall item is shown whole rather than cut off.
     * @param {Object} media
     * @param {Object} review - For the accessible label.
     * @returns {string}
     */
    buildLightboxHero(media, review) {
        return `<div class="cs-ugc-overview-lightbox-hero">${this.buildLightboxHeroMedia(media, review)}</div>`;
    }

    /**
     * Just the hero's media element (no wrapper), so a thumbnail switch can swap
     * it in place without rebuilding the surrounding strip.
     * @param {Object} media
     * @param {Object} review - For the accessible label.
     * @returns {string}
     */
    buildLightboxHeroMedia(media, review) {
        const label = escapeHtml(review.title || review.archetype_name || 'Customer media');

        if (media.type === 'video') {
            const videoSrc = escapeHtml(media.url || '');
            const poster = media.poster_url ? ` poster="${escapeHtml(media.poster_url)}"` : '';
            return `<video class="cs-ugc-lightbox-video" src="${videoSrc}"${poster} controls playsinline aria-label="${label}"></video>`;
        }

        const imgSrc = escapeHtml(media.medium_url || media.url || media.thumb_url || '');
        return `<img class="cs-ugc-lightbox-img" src="${imgSrc}" alt="${label}" loading="lazy">`;
    }

    /**
     * The thumbnail strip for a multi-item review. Each thumb selects which item
     * is shown as the hero; the active one is marked. Videos show their poster
     * thumb with a play affordance so they read as video, not photo.
     * @param {Object[]} items
     * @param {number} activeIndex
     * @returns {string}
     */
    buildLightboxThumbs(items, activeIndex) {
        const thumbs = items.map((media, i) => {
            const src = escapeHtml(media.thumb_url || media.poster_url || media.medium_url || media.url || '');
            const isVideo = media.type === 'video';
            const isActive = i === activeIndex;
            const activeClass = isActive ? ' is-active' : '';
            const current = isActive ? ' aria-current="true"' : '';
            const label = escapeHtml(`Show ${isVideo ? 'video' : 'photo'} ${i + 1} of ${items.length}`);
            const play = isVideo ? '<span class="cs-ugc-overview-lightbox-thumb-play" aria-hidden="true"></span>' : '';
            return `<button type="button" class="cs-ugc-overview-lightbox-thumb${activeClass}" data-ugc-media-thumb data-ugc-media-thumb-index="${i}" aria-label="${label}"${current}><img src="${src}" alt="" loading="lazy">${play}</button>`;
        }).join('');

        return `<div class="cs-ugc-overview-lightbox-thumbs" role="group" aria-label="Review media">${thumbs}</div>`;
    }

    /**
     * Switch the displayed hero after a thumbnail click. Only the hero's media
     * element is swapped and the active marker moved — the thumbnail strip's DOM
     * (and its already-loaded images) stays put. Rebuilding the whole region
     * reloaded the thumbs and briefly collapsed the container, which is what
     * flashed on each switch.
     */
    renderLightboxMedia() {
        if (!this.lightbox) {
            return;
        }

        const review = this.filteredReviews()[this.lightboxIndex];
        if (!review || !hasMedia(review)) {
            return;
        }

        const items = review.media;
        const index = Math.min(Math.max(0, this.lightboxMediaIndex), items.length - 1);

        const hero = this.lightbox.querySelector('.cs-ugc-overview-lightbox-hero');
        if (hero) {
            hero.innerHTML = this.buildLightboxHeroMedia(items[index], review);
        }

        Array.from(this.lightbox.querySelectorAll('[data-ugc-media-thumb]')).forEach((thumb) => {
            const isActive = parseInt(thumb.dataset.ugcMediaThumbIndex, 10) === index;
            thumb.classList.toggle('is-active', isActive);
            if (isActive) {
                thumb.setAttribute('aria-current', 'true');
            } else {
                thumb.removeAttribute('aria-current');
            }
        });
    }

    /**
     * Warm the browser cache with the review's full-size photos as soon as the
     * lightbox paints, so switching the hero via the thumbnail strip is instant
     * (no blank-then-load flash). Videos stream on play, so they are skipped.
     * @param {Object} review
     */
    preloadLightboxMedia(review) {
        if (typeof Image === 'undefined' || !hasMedia(review)) {
            return;
        }

        review.media.forEach((media) => {
            if (media.type === 'video') {
                return;
            }

            const src = media.medium_url || media.url || media.thumb_url;
            if (src) {
                const img = new Image();
                img.src = src;
            }
        });
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
        // Same content block as the wall card; the body clamp is card-scoped in
        // SCSS, so the full review text shows here.
        return `<div class="cs-ugc-overview-lightbox-review">${this.buildCardContent(review, title, author)}</div>`;
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
            return;
        }

        // Thumbnail strip: swap which of the review's media is the displayed hero.
        const thumb = event.target.closest('[data-ugc-media-thumb]');
        if (thumb) {
            const target = parseInt(thumb.dataset.ugcMediaThumbIndex, 10);
            if (!Number.isNaN(target) && target !== this.lightboxMediaIndex) {
                this.lightboxMediaIndex = target;
                this.renderLightboxMedia();
            }
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
            this.container.removeEventListener('change', this.handleToolbarChange);
        }

        if (this.unsubscribeGlobal) {
            this.unsubscribeGlobal();
            this.unsubscribeGlobal = null;
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
