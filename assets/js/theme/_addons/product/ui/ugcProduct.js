/**
 * @file ugcProduct
 * @description Product-page UGC component (SRS §3.4.1). Slices 6a + 6b: module
 * bootstrap, rating-summary override, the reviews list, and server-side sort,
 * filter, and pagination.
 *
 * Initialised by ProductController after archetype data loads, with the QTY
 * archetype id (`qty_archetype_id` from the archetype JSON — the QTY
 * ProductArchetypes.id, NOT the BigCommerce product.id; SRS §1.3, §3.1.4). On
 * init it fetches GET /api/reviews/{archetype_id} via the shared ugcApi helper
 * and:
 *   - renders the rating summary from the envelope's archetype_rating_average /
 *     archetype_review_count, overriding the (up to 24h stale) archetype-JSON
 *     values for in-page display (SRS §2.2, §3.2.1);
 *   - caches those aggregates ONCE — they are the unfiltered archetype-wide
 *     aggregates and are constant under filters, so the summary block is never
 *     repainted from a filtered page (SRS §3.2.1);
 *   - renders the current page of reviews into #product-reviews.
 *
 * Unlike the home overview wall (ugcOverview.js), which fetches once and filters
 * client-side, the product reviews list refetches the API on every sort, filter,
 * and page change. The visible list and pagination are driven entirely by the
 * envelope's total / page / per_page (SRS §3.2.1) — never by slicing a local
 * array.
 *
 * Slice 6c (#18) adds the Q&A tab: a separate GET /api/questions/{archetype_id}
 * list (SRS §3.2.2) with its own sort (date_desc / date_asc) and pagination,
 * driven entirely by that endpoint's { items, total, page, per_page } envelope.
 * It mirrors the reviews list/sort/pagination pattern but has no filters and
 * renders each approved question with its single staff answer (§4.1 Question).
 *
 * Slice 6d (#7) adds alias-aware sorting. The module already subscribes to the
 * local StateManager; on each notify it reads the selected alias's published
 * `qty_alias_index` (SRS §3.1.4) off state.aliasData and, when it changes,
 * refetches BOTH reviews and questions with `sort_alias={qty_alias_index}` so
 * alias-matching items float to the top WITHIN the current sort, without
 * excluding non-matching items (SRS §3.2.1, §3.2.2, §3.4.1). Deselecting the
 * alias (aliasData cleared, or no integer index) drops the param. The active
 * sort and filters are preserved across the transition; only the page resets to
 * 1, since the relevance ordering shifts.
 *
 * The submission modal (#8) is a separate slice and intentionally out of scope.
 */

const MAX_STARS = 5;

const DEFAULT_SORT = 'date_desc';

const SORT_VALUES = ['date_desc', 'date_asc', 'rating_desc', 'rating_asc'];

// Questions support only date sorts (SRS §3.2.2) — no rating/verified/media.
const QUESTION_SORT_VALUES = ['date_desc', 'date_asc'];

const MESSAGES = {
    noReviews: 'No reviews yet. Be the first to review this product.',
    noMatches: 'No reviews match the selected filters.',
    loadError: 'Reviews are unavailable right now. Please try again later.',
    noQuestions: 'No questions yet. Be the first to ask about this product.',
    questionsError: 'Questions are unavailable right now. Please try again later.',
    anonymous: 'Anonymous',
};

export default class UgcProduct {
    /**
     * @param {number|string} archetypeId - QTY archetype id, from the archetype
     *   JSON's `qty_archetype_id` (= ProductArchetypes.id; SRS §1.3, §3.4.1).
     * @param {Object} stateManager - Local product StateManager.
     * @param {Object} api - The ugcApi helper (injectable for tests).
     */
    constructor(archetypeId, stateManager, api) {
        this.archetypeId = archetypeId;
        this.stateManager = stateManager;
        this.api = api;
        this.unsubscribe = null;

        // Cached unfiltered aggregates from the reviews envelope. Constant under
        // filters, so the rating summary is painted once and never refetched
        // (SRS §3.2.1).
        this.ratingAverage = null;
        this.reviewCount = 0;
        this.summaryPainted = false;

        // Server-side query state (SRS §3.2.1 params). `rating` is the star
        // filter (int) or null; `verified`/`media` are literal `true` only when
        // toggled on, else null so ugcApi's buildQuery omits them.
        this.query = {
            page: 1,
            sort: DEFAULT_SORT,
            rating: null,
            verified: null,
            media: null,
        };

        // Pagination derived from the latest envelope.
        this.total = 0;
        this.perPage = 0;

        // Q&A query state (SRS §3.2.2 params). Only `page` and `sort` apply —
        // questions have no rating/verified/media filters.
        this.questionQuery = {
            page: 1,
            sort: DEFAULT_SORT,
        };
        this.questionTotal = 0;
        this.questionPerPage = 0;
        this.questionCount = 0;
        this.questionsLoaded = false;

        // The integer alias index currently driving sort_alias (SRS §3.1.4 /
        // §3.4.1), or null when no alias is selected. Tracked so an alias-driven
        // refetch only fires when the selection actually changes.
        this.sortAlias = null;
        this.reviewsLoaded = false;

        this.ratingElement = document.querySelector('[data-product-rating]');
        this.listElement = document.querySelector('#product-reviews');
        this.toolbarElement = document.querySelector('[data-reviews-toolbar]');
        this.paginationElement = document.querySelector('[data-reviews-pagination]');

        this.questionsElement = document.querySelector('#product-questions');
        this.questionsToolbarElement = document.querySelector('[data-questions-toolbar]');
        this.questionsPaginationElement = document.querySelector('[data-questions-pagination]');

        this.onToolbarChange = this.onToolbarChange.bind(this);
        this.onPaginationClick = this.onPaginationClick.bind(this);
        this.onQuestionsToolbarChange = this.onQuestionsToolbarChange.bind(this);
        this.onQuestionsPaginationClick = this.onQuestionsPaginationClick.bind(this);

        const hasReviewsDom = this.ratingElement || this.listElement;

        if (this.archetypeId && (hasReviewsDom || this.questionsElement)) {
            this.unsubscribe = this.stateManager.subscribe(this.update.bind(this));
            this.bindControls();

            if (hasReviewsDom) {
                this.init();
            }

            if (this.questionsElement) {
                this.initQuestions();
            }
        }
    }

    bindControls() {
        if (this.toolbarElement) {
            this.toolbarElement.addEventListener('change', this.onToolbarChange);
        }

        if (this.paginationElement) {
            this.paginationElement.addEventListener('click', this.onPaginationClick);
        }

        if (this.questionsToolbarElement) {
            this.questionsToolbarElement.addEventListener('change', this.onQuestionsToolbarChange);
        }

        if (this.questionsPaginationElement) {
            this.questionsPaginationElement.addEventListener('click', this.onQuestionsPaginationClick);
        }
    }

    async init() {
        const result = await this.api.getReviews(this.archetypeId, this.buildParams());

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
        this.summaryPainted = true;
        this.reviewsLoaded = true;
        this.renderPage(data);
    }

    /**
     * Refetch the current query and render the resulting page + pagination. The
     * summary aggregates are NOT touched here — they stay at the cached
     * unfiltered values from init (SRS §3.2.1).
     */
    async fetchReviews() {
        const result = await this.api.getReviews(this.archetypeId, this.buildParams());

        if (!result.ok) {
            this.renderListError();
            return;
        }

        this.renderPage(result.data || {});
    }

    /**
     * Assemble the §3.2.1 query params from the current state. null/undefined
     * values are dropped downstream by ugcApi's buildQuery, so disabled filters
     * are simply omitted.
     * @returns {Object}
     */
    buildParams() {
        return {
            page: this.query.page,
            sort: this.query.sort,
            rating: this.query.rating,
            verified: this.query.verified,
            media: this.query.media,
            sort_alias: this.sortAlias,
        };
    }

    renderPage(data) {
        this.total = Number.isFinite(data.total) ? data.total : 0;
        this.perPage = Number.isFinite(data.per_page) ? data.per_page : 0;
        this.query.page = Number.isFinite(data.page) ? data.page : this.query.page;

        this.renderList(Array.isArray(data.items) ? data.items : []);
        this.renderPagination();
    }

    /**
     * StateManager subscriber. Re-paints the cached summary so the block stays
     * consistent across re-renders, then applies any alias-driven sort change.
     * @param {Object} [state] - The local StateManager snapshot.
     */
    update(state) {
        if (this.summaryPainted) {
            this.renderSummary();
        }

        this.applyAliasSort(state);
    }

    /**
     * Reconcile the active `sort_alias` with the alias currently selected on the
     * local StateManager (SRS §3.4.1). On a change — select, deselect, or switch
     * between aliases — refetch BOTH the reviews and questions lists so
     * alias-matching items float to the top within the current sort, preserving
     * the active sort and filters and resetting only the page (the relevance
     * order shifts). No-ops when the selection is unchanged, so unrelated state
     * notifications never trigger a refetch.
     * @param {Object} [state] - The local StateManager snapshot.
     */
    applyAliasSort(state) {
        const nextAlias = this._resolveAliasIndex(state);
        if (nextAlias === this.sortAlias) {
            return;
        }

        this.sortAlias = nextAlias;

        // Only refetch a list that has completed its initial load, so the
        // alias-driven refetch layers on top of an established list rather than
        // racing the in-flight init fetch (which reads sort_alias live anyway).
        if (this.reviewsLoaded) {
            this.query.page = 1;
            this.fetchReviews();
        }

        if (this.questionsLoaded) {
            this.questionQuery.page = 1;
            this.fetchQuestions();
        }
    }

    /**
     * Pull the published alias index (SRS §3.1.4 `qty_alias_index`) off the
     * selected alias and normalize it to an integer, or null when no alias is
     * selected / the field is absent or non-numeric. The value is passed
     * verbatim as the API `sort_alias` param.
     * @param {Object} [state] - The local StateManager snapshot.
     * @returns {number|null}
     */
    _resolveAliasIndex(state) {
        const aliasData = state && state.aliasData;
        if (!aliasData) {
            return null;
        }

        const index = parseInt(aliasData.qty_alias_index, 10);
        return Number.isNaN(index) ? null : index;
    }

    onToolbarChange(event) {
        const target = event.target;
        if (!target || !target.dataset) {
            return;
        }

        const { reviewsControl } = target.dataset;
        if (!reviewsControl) {
            return;
        }

        if (reviewsControl === 'sort') {
            this.query.sort = SORT_VALUES.indexOf(target.value) === -1
                ? DEFAULT_SORT
                : target.value;
        } else if (reviewsControl === 'rating') {
            const parsed = parseInt(target.value, 10);
            this.query.rating = Number.isNaN(parsed) ? null : parsed;
        } else if (reviewsControl === 'verified') {
            this.query.verified = target.checked ? true : null;
        } else if (reviewsControl === 'media') {
            this.query.media = target.checked ? true : null;
        } else {
            return;
        }

        // Any sort or filter change resets to the first page (SRS §3.2.1).
        this.query.page = 1;
        this.fetchReviews();
    }

    onPaginationClick(event) {
        const button = event.target.closest('[data-reviews-page]');
        if (!button || !this.paginationElement.contains(button)) {
            return;
        }

        event.preventDefault();

        const page = parseInt(button.dataset.reviewsPage, 10);
        if (Number.isNaN(page) || page === this.query.page) {
            return;
        }

        this.query.page = page;
        this.fetchReviews();
    }

    /**
     * Initial Q&A fetch (SRS §3.2.2). Tracks the unfiltered question count so the
     * empty state can be rendered correctly; questions have no filters, so the
     * envelope `total` IS the full count.
     */
    async initQuestions() {
        const result = await this.api.getQuestions(this.archetypeId, this.buildQuestionParams());

        if (!result.ok) {
            this.renderQuestionsError();
            return;
        }

        this.questionsLoaded = true;
        this.renderQuestionsPage(result.data || {});
    }

    /**
     * Refetch the current Q&A query and render the resulting page + pagination.
     */
    async fetchQuestions() {
        const result = await this.api.getQuestions(this.archetypeId, this.buildQuestionParams());

        if (!result.ok) {
            this.renderQuestionsError();
            return;
        }

        this.renderQuestionsPage(result.data || {});
    }

    /**
     * Assemble the §3.2.2 query params from the current Q&A state.
     * @returns {Object}
     */
    buildQuestionParams() {
        return {
            page: this.questionQuery.page,
            sort: this.questionQuery.sort,
            sort_alias: this.sortAlias,
        };
    }

    renderQuestionsPage(data) {
        this.questionTotal = Number.isFinite(data.total) ? data.total : 0;
        this.questionPerPage = Number.isFinite(data.per_page) ? data.per_page : 0;
        this.questionCount = this.questionTotal;
        this.questionQuery.page = Number.isFinite(data.page) ? data.page : this.questionQuery.page;

        this.renderQuestionsList(Array.isArray(data.items) ? data.items : []);
        this.renderQuestionsPagination();
    }

    onQuestionsToolbarChange(event) {
        const target = event.target;
        if (!target || !target.dataset) {
            return;
        }

        const { questionsControl } = target.dataset;
        if (questionsControl !== 'sort') {
            return;
        }

        this.questionQuery.sort = QUESTION_SORT_VALUES.indexOf(target.value) === -1
            ? DEFAULT_SORT
            : target.value;
        this.questionQuery.page = 1;
        this.fetchQuestions();
    }

    onQuestionsPaginationClick(event) {
        const button = event.target.closest('[data-questions-page]');
        if (!button || !this.questionsPaginationElement.contains(button)) {
            return;
        }

        event.preventDefault();

        const page = parseInt(button.dataset.questionsPage, 10);
        if (Number.isNaN(page) || page === this.questionQuery.page) {
            return;
        }

        this.questionQuery.page = page;
        this.fetchQuestions();
    }

    renderQuestionsList(items) {
        if (!this.questionsElement) {
            return;
        }

        if (!items.length) {
            this.questionsElement.innerHTML = `<p class="cs-questions-empty">${MESSAGES.noQuestions}</p>`;
            return;
        }

        this.questionsElement.innerHTML = items.map(question => this._buildQuestion(question)).join('');
    }

    renderQuestionsPagination() {
        if (!this.questionsPaginationElement) {
            return;
        }

        const pageCount = this.questionPerPage > 0
            ? Math.ceil(this.questionTotal / this.questionPerPage)
            : 0;

        if (pageCount <= 1) {
            this.questionsPaginationElement.innerHTML = '';
            this.questionsPaginationElement.style.visibility = 'hidden';
            return;
        }

        const current = this.questionQuery.page;
        const buttons = [];

        buttons.push(this._questionPageButton('prev', current - 1, current <= 1, 'Previous'));

        for (let page = 1; page <= pageCount; page += 1) {
            buttons.push(this._questionPageButton(page, page, false, String(page), page === current));
        }

        buttons.push(this._questionPageButton('next', current + 1, current >= pageCount, 'Next'));

        this.questionsPaginationElement.innerHTML = `<nav class="cs-questions-pages" aria-label="Questions pagination">${buttons.join('')}</nav>`;
        this.questionsPaginationElement.style.visibility = 'visible';
    }

    _questionPageButton(key, page, disabled, label, isCurrent = false) {
        const current = isCurrent ? ' is-current' : '';
        const aria = isCurrent ? ' aria-current="page"' : '';
        const disabledAttr = disabled ? ' disabled' : '';
        return `<button type="button" class="cs-questions-page${current}" data-questions-page="${page}" data-page-key="${key}"${aria}${disabledAttr}>${label}</button>`;
    }

    renderQuestionsError() {
        if (this.questionsElement) {
            this.questionsElement.innerHTML = `<p class="cs-questions-error">${MESSAGES.questionsError}</p>`;
        }

        if (this.questionsPaginationElement) {
            this.questionsPaginationElement.innerHTML = '';
            this.questionsPaginationElement.style.visibility = 'hidden';
        }
    }

    /**
     * Render one approved question and its single staff answer (SRS §4.1). The
     * answer block only renders when `staff_answer` is present — approval
     * requires it (§3.3.1), but null is defended against regardless.
     * @param {Object} question
     * @returns {string}
     */
    _buildQuestion(question) {
        const author = this._escape(question.author) || MESSAGES.anonymous;
        const body = this._escape(question.body);
        const vehicle = this._escape(question.vehicle_label);
        const date = this._formatDate(question.date);
        const answerAuthor = this._escape(question.staff_answer_author) || 'CravenSpeed';
        const answer = question.staff_answer
            ? `<div class="cs-question-answer"><strong>${answerAuthor}:</strong> ${this._escape(question.staff_answer)}</div>`
            : '';

        return `
            <article class="cs-question">
                <p class="cs-question-meta">
                    <span class="cs-question-author">${author}</span>
                    ${date ? `<span class="cs-question-date">${date}</span>` : ''}
                </p>
                ${vehicle ? `<p class="cs-question-vehicle">${vehicle}</p>` : ''}
                <p class="cs-question-body">${body}</p>
                ${answer}
            </article>`;
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
            // Distinguish an archetype with no reviews from a filter that simply
            // matched nothing — the summary aggregates tell us which.
            const empty = this.reviewCount > 0 ? MESSAGES.noMatches : MESSAGES.noReviews;
            this.listElement.innerHTML = `<p class="cs-reviews-empty">${empty}</p>`;
            return;
        }

        this.listElement.innerHTML = items.map(review => this._buildReview(review)).join('');
    }

    renderPagination() {
        if (!this.paginationElement) {
            return;
        }

        const pageCount = this.perPage > 0 ? Math.ceil(this.total / this.perPage) : 0;

        if (pageCount <= 1) {
            this.paginationElement.innerHTML = '';
            this.paginationElement.style.visibility = 'hidden';
            return;
        }

        const current = this.query.page;
        const buttons = [];

        buttons.push(this._pageButton('prev', current - 1, current <= 1, 'Previous'));

        for (let page = 1; page <= pageCount; page += 1) {
            buttons.push(this._pageButton(page, page, false, String(page), page === current));
        }

        buttons.push(this._pageButton('next', current + 1, current >= pageCount, 'Next'));

        this.paginationElement.innerHTML = `<nav class="cs-reviews-pages" aria-label="Reviews pagination">${buttons.join('')}</nav>`;
        this.paginationElement.style.visibility = 'visible';
    }

    _pageButton(key, page, disabled, label, isCurrent = false) {
        const current = isCurrent ? ' is-current' : '';
        const aria = isCurrent ? ' aria-current="page"' : '';
        const disabledAttr = disabled ? ' disabled' : '';
        return `<button type="button" class="cs-reviews-page${current}" data-reviews-page="${page}" data-page-key="${key}"${aria}${disabledAttr}>${label}</button>`;
    }

    renderError() {
        if (this.ratingElement) {
            this.ratingElement.innerHTML = '';
            this.ratingElement.style.visibility = 'hidden';
        }

        this.renderListError();
    }

    renderListError() {
        if (this.listElement) {
            this.listElement.innerHTML = `<p class="cs-reviews-error">${MESSAGES.loadError}</p>`;
        }

        if (this.paginationElement) {
            this.paginationElement.innerHTML = '';
            this.paginationElement.style.visibility = 'hidden';
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

        if (this.toolbarElement) {
            this.toolbarElement.removeEventListener('change', this.onToolbarChange);
        }

        if (this.paginationElement) {
            this.paginationElement.removeEventListener('click', this.onPaginationClick);
        }

        if (this.questionsToolbarElement) {
            this.questionsToolbarElement.removeEventListener('change', this.onQuestionsToolbarChange);
        }

        if (this.questionsPaginationElement) {
            this.questionsPaginationElement.removeEventListener('click', this.onQuestionsPaginationClick);
        }
    }
}
