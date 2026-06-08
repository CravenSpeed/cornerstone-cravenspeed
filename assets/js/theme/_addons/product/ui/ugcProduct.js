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
 * Slice 6d (#7) adds alias-aware sorting; the 2026-06-05 visuals pass made it
 * OPT-IN. The module subscribes to the local StateManager and tracks the
 * selected alias's published `qty_alias_index` (SRS §3.1.4) off
 * state.aliasData, but floating is user-controlled: a "My vehicle first"
 * toggle in each toolbar (enabled only while an alias is selected). Only when
 * the toggle is on do reviews and questions refetch with
 * `sort_alias={qty_alias_index}`, floating alias-matching items WITHIN the
 * current sort without excluding others (SRS §3.2.1, §3.2.2). Automatic
 * floating was rejected as quietly misrepresenting the default order — this
 * deviates from §3.4.1 as written (flagged to the cs-ugc PM for an SRS
 * amendment). The active sort and filters are preserved across the
 * transition; only the page resets to 1, since the relevance ordering
 * shifts. The selected alias index itself still rides on submissions as
 * `alias_id` regardless of the toggle.
 *
 * Slice 6e (#8) adds the submission modal: review and question forms posted to
 * POST /api/reviews and POST /api/questions via ugcApi (SRS §3.2.4, §3.2.5). Each
 * form carries the three spam-protection layers (SRS §3.4.5): a visually hidden
 * `website` honeypot (CSS-hidden, NOT type=hidden), a Cloudflare Turnstile widget
 * producing `cf_turnstile_token`, and client-side required-field validation. The
 * Turnstile site key is config-driven (theme_settings.ugc_turnstile_site_key on
 * the widget container's data-ugc-turnstile-sitekey attribute); the Cloudflare
 * always-passes test key is the dev fallback when no prod key is configured
 * (HITL #13 is a cutover gate, not a dev blocker). Submission outcomes are
 * surfaced inline per the §3.6 status branches normalized by ugcApi.
 *
 * Slice 6f (#10) adds verified-purchaser token capture: when `ugc_token` is in
 * the URL it is stripped via history.replaceState (SRS §3.4.1) and validated via
 * GET /api/token/validate (SRS §3.2.8); on success the token is held in memory
 * and sent as `ugc_token` on review submit so the server sets verified_purchaser
 * (SRS §3.2.4). An invalid/expired token degrades gracefully — submission still
 * proceeds, unverified.
 *
 * Slice #9 adds the review media-upload flow (SRS §3.4.4, §3.2.6, §3.2.7). Files
 * attached to the review form are validated client-side (type/size/count) BEFORE
 * any network call, then per accepted file: POST /api/media/presign → PUT the raw
 * bytes directly to the returned DO Spaces presigned URL (a raw fetch, NOT through
 * ugcApi's base) → POST /api/media/confirm. The confirmed canonical `url` + `type`
 * are held in upload order and sent as the ordered `media_urls` array on review
 * submit (array index = sort_order; index 0 = first displayed). Media is
 * reviews-only — questions carry none. The confirm call can take 10-30s for video,
 * so a "Processing…" state is surfaced (CLS-safe) while it runs.
 *
 * Slice #30 adds review media DISPLAY (SRS §3.4.1, §3.2.1): a top-level photo
 * thumbnail grid between the rating summary and the review/question tabs,
 * sourced from the media of the fetched reviews, plus a per-review thumbnail
 * strip inside each review. Each review's `media` array arrives ordered by
 * sort_order (index 0 first; SRS §3.2.1) and that order is preserved. A media
 * item's `type` is "photo" or "video" (NOT "image"); the single-thumbnail
 * fallback chain is thumb_url → poster_url → medium_url → url. The grid caps at
 * MEDIA_GRID_MAX tiles with a "+N" tile that expands it; clicking any tile opens
 * the shared lightbox (photo → medium_url/url, video → plays with poster_url as
 * poster). Both the grid and per-review strips rebuild on every render pass, so
 * alias-aware refetches stay consistent. Only the §3.2.1 public payload fields
 * are consumed — never `status` or other internal fields.
 */

const MAX_STARS = 5;

const DEFAULT_SORT = 'date_desc';

// Client-side media constraints (SRS §3.4.4). Enforced before any presign so an
// invalid file never touches the network.
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_PHOTOS = 3;
const MAX_VIDEOS = 1;

// Cloudflare Turnstile always-passes test site key (SRS dev environment / issue
// #8). Used as the dev fallback when no prod key is configured on the widget
// container. The prod key is config-driven and never hardcoded.
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

const SORT_VALUES = ['date_desc', 'date_asc', 'rating_desc', 'rating_asc'];

// Questions support only date sorts (SRS §3.2.2) — no rating/verified/media.
const QUESTION_SORT_VALUES = ['date_desc', 'date_asc'];

// Top-level media grid fallback cap (issue #30): the collapsed grid normally
// fills exactly the two-row band beside the featured tile, sized from the
// grid's measured column count. This cap only applies when that measurement
// is unavailable (no layout yet, or no ResizeObserver): at most this many
// tiles render before the trailing "+N" tile that expands the grid.
const MEDIA_GRID_MAX = 8;

// Upper bound on §3.2.1 `media=true` pages the gallery fetches while topping
// up the band — 30 media-bearing reviews covers any realistic band size.
const GALLERY_MAX_PAGES = 3;

const MESSAGES = {
    mediaGridTitle: 'Customer Photos &amp; Videos',
    noReviews: 'No reviews yet. Be the first to review this product.',
    noMatches: 'No reviews match the selected filters.',
    loadError: 'Reviews are unavailable right now. Please try again later.',
    noQuestions: 'No questions yet. Be the first to ask about this product.',
    questionsError: 'Questions are unavailable right now. Please try again later.',
    anonymous: 'Anonymous',
    requiredError: 'Please fill in all required fields.',
    turnstileError: 'Please complete the verification challenge.',
    submitting: 'Submitting…',
    mediaType: 'Unsupported file type. Photos must be JPEG, PNG, GIF, or WebP; video must be MP4 or MOV.',
    mediaPhotoSize: 'Each photo must be 10 MB or smaller.',
    mediaVideoSize: 'The video must be 50 MB or smaller.',
    mediaPhotoCount: 'You can attach up to 3 photos.',
    mediaVideoCount: 'You can attach up to 1 video.',
    mediaUploadError: 'A file failed to upload. Please remove it and try again.',
    mediaProcessing: 'Processing media… this can take up to 30 seconds for video.',
};

export default class UgcProduct {
    /**
     * @param {number|string} archetypeId - QTY archetype id, from the archetype
     *   JSON's `qty_archetype_id` (= ProductArchetypes.id; SRS §1.3, §3.4.1).
     * @param {Object} stateManager - Local product StateManager.
     * @param {Object} api - The ugcApi helper (injectable for tests).
     * @param {Function} [mediaPut] - fetch impl for the raw PUT to the DO Spaces
     *   presigned URL. Bypasses ugcApi's base entirely (the URL is absolute and
     *   external); injectable so tests never hit the network.
     */
    constructor(archetypeId, stateManager, api, mediaPut) {
        this.archetypeId = archetypeId;
        this.stateManager = stateManager;
        this.api = api;
        this.mediaPut = mediaPut || ((...args) => fetch(...args));
        this.unsubscribe = null;

        // Cached unfiltered aggregates from the reviews envelope. Constant under
        // filters, so the rating summary is painted once and never refetched
        // (SRS §3.2.1).
        this.ratingAverage = null;
        this.reviewCount = 0;
        this.ratingBreakdown = null;
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

        // The selected alias's integer index (SRS §3.1.4), or null when no
        // alias is selected. Rides on submissions as alias_id regardless of
        // the float toggle.
        this.aliasIndex = null;

        // "My vehicle first" toggle state, and the effective sort_alias param
        // derived from it: aliasIndex while the toggle is on AND an alias is
        // selected, else null. Floating is opt-in — automatic floating reads
        // as misrepresenting the default order.
        this.vehicleFirst = false;
        this.sortAlias = null;
        this.reviewsLoaded = false;

        // The vehicle label of the currently selected alias, kept in sync from
        // StateManager so a submission can default `vehicle_label` to it (SRS
        // §3.2.4, §3.2.5 — both optional). Null when no alias is selected.
        this.vehicleLabel = null;

        // Verified-purchaser token (SRS §3.4.1, §3.2.8). Held in memory for the
        // session only once GET /api/token/validate confirms it; sent as
        // `ugc_token` on review submit so the server stamps verified_purchaser=true.
        // Stays null on absent/invalid/expired token — submission still proceeds,
        // just unverified.
        this.verifiedPurchaserToken = null;

        // Turnstile widget ids returned by window.turnstile.render, per modal.
        // Tracked so the widget is rendered once and reset after each submit.
        this.reviewTurnstileId = null;
        this.questionTurnstileId = null;
        this.turnstileScriptPromise = null;

        this.ratingElement = document.querySelector('[data-product-rating]');
        this.listElement = document.querySelector('#product-reviews');
        this.toolbarElement = document.querySelector('[data-reviews-toolbar]');
        this.paginationElement = document.querySelector('[data-reviews-pagination]');

        this.questionsElement = document.querySelector('#product-questions');
        this.questionsToolbarElement = document.querySelector('[data-questions-toolbar]');
        this.questionsPaginationElement = document.querySelector('[data-questions-pagination]');

        // Review media display (issue #30, SRS §3.4.1): the overview panel
        // container and the shared lightbox. The gallery is its own data
        // batch — the most recent media-bearing reviews (§3.2.1 media=true,
        // date_desc), fetched once after the first list render and topped up
        // page-by-page while the measured band has room. It is stable across
        // the visible list's sort/filter/pagination. The band never expands
        // in place — its "+N" tile opens the gallery modal.
        this.mediaGridElement = document.querySelector('[data-ugc-media-grid]');
        this.lightboxElement = document.querySelector('[data-ugc-lightbox]');
        this.galleryModalElement = document.querySelector('[data-ugc-gallery]');
        this.gridMedia = [];
        this.galleryRequested = false;
        this.galleryLoading = false;
        this.galleryExhausted = false;
        this.galleryPagesFetched = 0;

        // The collapsed grid fills exactly the two-row band beside the 2×2
        // featured tile, so its capacity depends on the laid-out column count.
        // A ResizeObserver re-measures when the grid first gains layout (the
        // Reviews tab is hidden on load) and on viewport resizes.
        this.gridCapacity = null;
        if (this.mediaGridElement && typeof ResizeObserver !== 'undefined') {
            this.gridResizeObserver = new ResizeObserver(() => this._onGridResize());
            this.gridResizeObserver.observe(this.mediaGridElement);
        }

        // Confirmed media held in upload order (SRS §3.4.4): each entry is the
        // canonical { url, type } returned by /api/media/confirm. Sent verbatim as
        // the ordered `media_urls` array on submit; index = sort_order.
        this.confirmedMedia = [];

        this.reviewModalElement = document.querySelector('[data-review-modal]');
        this.reviewFormElement = document.querySelector('[data-review-form]');
        this.questionModalElement = document.querySelector('[data-question-modal]');
        this.questionFormElement = document.querySelector('[data-question-form]');

        this.onToolbarChange = this.onToolbarChange.bind(this);
        this.onPaginationClick = this.onPaginationClick.bind(this);
        this.onQuestionsToolbarChange = this.onQuestionsToolbarChange.bind(this);
        this.onQuestionsPaginationClick = this.onQuestionsPaginationClick.bind(this);
        this.onReviewModalClick = this.onReviewModalClick.bind(this);
        this.onQuestionModalClick = this.onQuestionModalClick.bind(this);
        this.onReviewSubmit = this.onReviewSubmit.bind(this);
        this.onQuestionSubmit = this.onQuestionSubmit.bind(this);
        this.onReviewOpenClick = this.onReviewOpenClick.bind(this);
        this.onQuestionOpenClick = this.onQuestionOpenClick.bind(this);
        this.onMediaTileClick = this.onMediaTileClick.bind(this);
        this.onLightboxClick = this.onLightboxClick.bind(this);
        this.onGalleryModalClick = this.onGalleryModalClick.bind(this);

        const hasReviewsDom = this.ratingElement || this.listElement;

        if (this.archetypeId && (hasReviewsDom || this.questionsElement)) {
            this.unsubscribe = this.stateManager.subscribe(this.update.bind(this));
            this.bindControls();
            this.bindModals();
            this.captureVerifiedPurchaserToken();

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

        // Media tile clicks are delegated so per-review strips and the grid
        // survive every innerHTML re-render without rebinding (issue #30).
        if (this.listElement) {
            this.listElement.addEventListener('click', this.onMediaTileClick);
        }

        if (this.mediaGridElement) {
            this.mediaGridElement.addEventListener('click', this.onMediaTileClick);
        }

        if (this.lightboxElement) {
            this.lightboxElement.addEventListener('click', this.onLightboxClick);
        }

        if (this.galleryModalElement) {
            this.galleryModalElement.addEventListener('click', this.onGalleryModalClick);
        }
    }

    /**
     * Wire the review and question submission modals: open triggers, overlay /
     * close-button dismissal (delegated off the modal root), and form submit.
     */
    bindModals() {
        const reviewOpen = document.querySelector('[data-review-modal-open]');
        if (reviewOpen && this.reviewModalElement) {
            reviewOpen.addEventListener('click', this.onReviewOpenClick);
            this.reviewModalElement.addEventListener('click', this.onReviewModalClick);
        }

        if (this.reviewFormElement) {
            this.reviewFormElement.addEventListener('submit', this.onReviewSubmit);
        }

        const questionOpen = document.querySelector('[data-question-modal-open]');
        if (questionOpen && this.questionModalElement) {
            questionOpen.addEventListener('click', this.onQuestionOpenClick);
            this.questionModalElement.addEventListener('click', this.onQuestionModalClick);
        }

        if (this.questionFormElement) {
            this.questionFormElement.addEventListener('submit', this.onQuestionSubmit);
        }
    }

    onReviewOpenClick() {
        this.openModal(this.reviewModalElement, this.reviewFormElement);
        this.renderTurnstile('review');
    }

    onQuestionOpenClick() {
        this.openModal(this.questionModalElement, this.questionFormElement);
        this.renderTurnstile('question');
    }

    onReviewModalClick(event) {
        if (event.target.closest('[data-review-modal-close]')) {
            this.closeModal(this.reviewModalElement);
        }
    }

    onQuestionModalClick(event) {
        if (event.target.closest('[data-question-modal-close]')) {
            this.closeModal(this.questionModalElement);
        }
    }

    /**
     * Reveal a submission modal. Clears any prior error/success state and the
     * field values so a reopened modal starts fresh. Uses the `hidden` attribute
     * (not display:none in JS) so the styled overlay handles presentation.
     * @param {HTMLElement} modal
     * @param {HTMLFormElement} form
     */
    openModal(modal, form) {
        if (!modal) {
            return;
        }

        if (form) {
            form.reset();
        }

        this._setError(modal, '');
        this._setSuccess(modal, false);
        this._setFieldsHidden(modal, false);
        this._prefillVehicle(form);

        if (modal === this.reviewModalElement) {
            this.confirmedMedia = [];
            this._setProcessing(false);
        }

        modal.hidden = false;
    }

    closeModal(modal) {
        if (modal) {
            modal.hidden = true;
        }
    }

    /**
     * Default the optional vehicle_label input to the selected alias's vehicle
     * label, when present (SRS §3.2.4, §3.2.5). The user can still edit or clear it.
     * @param {HTMLFormElement} form
     */
    _prefillVehicle(form) {
        if (!form || !this.vehicleLabel) {
            return;
        }

        const input = form.querySelector('[name="vehicle_label"]');
        if (input) {
            input.value = this.vehicleLabel;
        }
    }

    /**
     * Gather the files attached to the review form's media input into a plain
     * ordered array. The input order is the user's intended display order
     * (SRS §3.4.4). Returns [] when there is no input or no selection.
     * @returns {File[]}
     */
    _collectMediaFiles() {
        const form = this.reviewFormElement;
        const input = form ? form.querySelector('[name="media"]') : null;
        if (!input || !input.files) {
            return [];
        }

        return Array.from(input.files);
    }

    /**
     * Classify a file as 'photo' / 'video' / null from its MIME type against the
     * SRS §3.4.4 allowed sets.
     * @param {File} file
     * @returns {string|null}
     */
    _mediaKind(file) {
        if (PHOTO_TYPES.indexOf(file.type) !== -1) {
            return 'photo';
        }

        if (VIDEO_TYPES.indexOf(file.type) !== -1) {
            return 'video';
        }

        return null;
    }

    /**
     * Validate the attached files against the SRS §3.4.4 type, size, and count
     * limits before any presign. Returns the first user-facing error message, or
     * null when every file is acceptable.
     * @param {File[]} files
     * @returns {string|null}
     */
    _validateMediaFiles(files) {
        let photoCount = 0;
        let videoCount = 0;

        for (let i = 0; i < files.length; i += 1) {
            const file = files[i];
            const kind = this._mediaKind(file);

            if (kind === null) {
                return MESSAGES.mediaType;
            }

            if (kind === 'photo') {
                if (file.size > MAX_PHOTO_BYTES) {
                    return MESSAGES.mediaPhotoSize;
                }
                photoCount += 1;
            } else {
                if (file.size > MAX_VIDEO_BYTES) {
                    return MESSAGES.mediaVideoSize;
                }
                videoCount += 1;
            }
        }

        if (photoCount > MAX_PHOTOS) {
            return MESSAGES.mediaPhotoCount;
        }

        if (videoCount > MAX_VIDEOS) {
            return MESSAGES.mediaVideoCount;
        }

        return null;
    }

    /**
     * Run the presign → PUT → confirm pipeline for each accepted file in order
     * (SRS §3.4.4 / §3.2.6 / §3.2.7), appending each confirmed { url, type } to
     * confirmedMedia so upload order is preserved as sort_order. Returns true when
     * every file confirmed, false on the first failure (leaving the partial set in
     * confirmedMedia is harmless — submit is aborted by the caller).
     * @param {File[]} files
     * @returns {Promise<boolean>}
     */
    async _uploadMediaFiles(files) {
        this.confirmedMedia = [];

        for (let i = 0; i < files.length; i += 1) {
            // Intentionally sequential: confirm blocks for the duration of the
            // server-side pipeline (SRS §3.2.7), and one failure must abort the
            // rest rather than fan out parallel uploads behind it.
            // eslint-disable-next-line no-await-in-loop
            const confirmed = await this._uploadOne(files[i]);
            if (!confirmed) {
                return false;
            }

            this.confirmedMedia.push(confirmed);
        }

        return true;
    }

    /**
     * Presign, PUT to DO Spaces, and confirm a single file. The PUT goes directly
     * to the absolute presigned URL via the injected mediaPut (NOT ugcApi's base).
     * Resolves to the canonical { url, type } on success, or null on any failure
     * (presign not-ok, PUT non-2xx / network error, confirm not-ok).
     * @param {File} file
     * @returns {Promise<Object|null>}
     */
    async _uploadOne(file) {
        const presign = await this.api.presignMedia(file);
        if (!presign.ok || !presign.data || !presign.data.presigned_url) {
            return null;
        }

        const { presigned_url: presignedUrl, raw_url: rawUrl } = presign.data;

        try {
            const putResponse = await this.mediaPut(presignedUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type },
            });

            if (!putResponse || !putResponse.ok) {
                return null;
            }
        } catch (error) {
            return null;
        }

        const confirm = await this.api.confirmMedia(rawUrl);
        if (!confirm.ok || !confirm.data || !confirm.data.url) {
            return null;
        }

        return { url: confirm.data.url, type: confirm.data.type };
    }

    /**
     * Toggle the "Processing…" state during the confirm pipeline (SRS §3.4.4 —
     * video can take 10-30s). Reveals the always-present, space-reserving status
     * element via the `hidden` attribute so layout does not shift (CLS-safe).
     * @param {boolean} processing
     */
    _setProcessing(processing) {
        const modal = this.reviewModalElement;
        if (!modal) {
            return;
        }

        const el = modal.querySelector('[data-review-processing]');
        if (el) {
            el.textContent = processing ? MESSAGES.mediaProcessing : '';
            el.hidden = !processing;
        }
    }

    async onReviewSubmit(event) {
        event.preventDefault();

        const modal = this.reviewModalElement;
        const fields = this._readFields(this.reviewFormElement);

        if (!fields.rating || !fields.title || !fields.body || !fields.author) {
            this._setError(modal, MESSAGES.requiredError);
            return;
        }

        const token = this.getTurnstileToken('review');
        if (!token) {
            this._setError(modal, MESSAGES.turnstileError);
            return;
        }

        // Validate any attached files client-side before touching the network
        // (SRS §3.4.4). A validation failure surfaces inline and aborts submit.
        const files = this._collectMediaFiles();
        const validationError = this._validateMediaFiles(files);
        if (validationError) {
            this._setError(modal, validationError);
            return;
        }

        // Upload + confirm each accepted file in order, surfacing the "Processing…"
        // state for the duration. Any per-file failure aborts the whole submit so
        // the user never posts a review referencing media that never landed.
        if (files.length) {
            this._setError(modal, '');
            this._setSubmitting(modal, true);
            this._setProcessing(true);

            const uploaded = await this._uploadMediaFiles(files);

            this._setProcessing(false);
            this._setSubmitting(modal, false);

            if (!uploaded) {
                this._setError(modal, MESSAGES.mediaUploadError);
                this.resetTurnstile('review');
                return;
            }
        }

        const payload = this.buildReviewPayload(fields, token);
        await this._submit(modal, () => this.api.postReview(payload), 'review');
    }

    async onQuestionSubmit(event) {
        event.preventDefault();

        const modal = this.questionModalElement;
        const fields = this._readFields(this.questionFormElement);

        if (!fields.body || !fields.author) {
            this._setError(modal, MESSAGES.requiredError);
            return;
        }

        const token = this.getTurnstileToken('question');
        if (!token) {
            this._setError(modal, MESSAGES.turnstileError);
            return;
        }

        const payload = this.buildQuestionPayload(fields, token);
        await this._submit(modal, () => this.api.postQuestion(payload), 'question');
    }

    /**
     * Verified-purchaser token capture (SRS §3.4.1, §3.2.8). If `ugc_token` is
     * present in the URL, strip it immediately via history.replaceState so it
     * never lingers in the address bar / shareable URL, then validate it. The
     * token is held in memory only after GET /api/token/validate confirms it
     * (HTTP 200); an invalid/expired token (HTTP 400) leaves it null so the
     * session stays unverified and submission still proceeds.
     *
     * The strip happens before the async validate resolves — the contract is
     * "strip the param", independent of validity — and a held token is never
     * exposed back into the URL.
     * @returns {Promise<void>}
     */
    async captureVerifiedPurchaserToken() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('ugc_token');

        if (!token) {
            return;
        }

        this.stripTokenFromUrl(params);

        const result = await this.api.validateToken(token);
        if (result.ok) {
            this.verifiedPurchaserToken = token;
        }
    }

    /**
     * Remove the `ugc_token` query param from the current URL without a reload,
     * preserving any other params, path, and hash (SRS §3.4.1).
     * @param {URLSearchParams} params - Parsed copy of window.location.search.
     */
    stripTokenFromUrl(params) {
        params.delete('ugc_token');
        const query = params.toString();
        const { pathname, hash } = window.location;
        const newUrl = `${pathname}${query ? `?${query}` : ''}${hash}`;
        window.history.replaceState(window.history.state, '', newUrl);
    }

    /**
     * Shape the review submission body to the frozen SRS §3.2.4 contract. Optional
     * fields (`alias_id`, `vehicle_label`, `ugc_token`) are included only when
     * present so the API receives a clean body; the honeypot `website` and
     * `cf_turnstile_token` are always sent. A held verified-purchaser token
     * (SRS §3.4.1) rides along as `ugc_token` so the server sets
     * verified_purchaser=true. Confirmed media (SRS §3.4.4) rides along as the
     * ordered `media_urls` array — array index = sort_order — and the field is
     * omitted entirely when no files were attached.
     * @param {Object} fields
     * @param {string} token
     * @returns {Object}
     */
    buildReviewPayload(fields, token) {
        const payload = {
            archetype_id: this.archetypeId,
            author: fields.author,
            rating: parseInt(fields.rating, 10),
            title: fields.title,
            body: fields.body,
            cf_turnstile_token: token,
            website: fields.website,
        };

        if (this.aliasIndex !== null) {
            payload.alias_id = this.aliasIndex;
        }

        if (fields.vehicle_label) {
            payload.vehicle_label = fields.vehicle_label;
        }

        if (this.verifiedPurchaserToken) {
            payload.ugc_token = this.verifiedPurchaserToken;
        }

        if (this.confirmedMedia.length) {
            payload.media_urls = this.confirmedMedia.map(media => media.url);
        }

        return payload;
    }

    /**
     * Shape the question submission body to the frozen SRS §3.2.5 contract.
     * @param {Object} fields
     * @param {string} token
     * @returns {Object}
     */
    buildQuestionPayload(fields, token) {
        const payload = {
            archetype_id: this.archetypeId,
            author: fields.author,
            body: fields.body,
            cf_turnstile_token: token,
            website: fields.website,
        };

        if (this.aliasIndex !== null) {
            payload.alias_id = this.aliasIndex;
        }

        if (fields.vehicle_label) {
            payload.vehicle_label = fields.vehicle_label;
        }

        return payload;
    }

    /**
     * Run a submission request, manage the submitting/disabled state, and surface
     * the outcome. On success the form is replaced by the success state; on
     * failure the §3.6 message normalized by ugcApi (429 → too-many, 400/422 →
     * the API `error` envelope, 500/network → generic) is shown inline and the
     * Turnstile widget is reset so the user can retry with a fresh token.
     * @param {HTMLElement} modal
     * @param {Function} request - Returns the ugcApi result promise.
     * @param {string} kind - 'review' | 'question'.
     */
    async _submit(modal, request, kind) {
        this._setError(modal, '');
        this._setSubmitting(modal, true);

        const result = await request();

        this._setSubmitting(modal, false);

        if (result.ok) {
            this._setFieldsHidden(modal, true);
            this._setSuccess(modal, true);
            return;
        }

        this._setError(modal, result.message || MESSAGES.requiredError);
        this.resetTurnstile(kind);
    }

    /**
     * Read the submission form's named fields, trimming text values. Returns a
     * flat object keyed by field name (rating/title/body/author/vehicle_label/
     * website); absent fields resolve to ''.
     * @param {HTMLFormElement} form
     * @returns {Object}
     */
    _readFields(form) {
        const fields = {};
        if (!form) {
            return fields;
        }

        const names = ['rating', 'title', 'body', 'author', 'vehicle_label', 'website'];
        names.forEach((name) => {
            const input = form.querySelector(`[name="${name}"]`);
            fields[name] = input ? input.value.trim() : '';
        });

        return fields;
    }

    _setError(modal, message) {
        if (!modal) {
            return;
        }

        const el = modal.querySelector('[data-review-error], [data-question-error]');
        if (el) {
            el.textContent = message;
            el.hidden = !message;
        }
    }

    _setSuccess(modal, show) {
        if (!modal) {
            return;
        }

        const el = modal.querySelector('[data-review-success], [data-question-success]');
        if (el) {
            el.hidden = !show;
        }
    }

    _setFieldsHidden(modal, hidden) {
        if (!modal) {
            return;
        }

        const el = modal.querySelector('[data-review-fields], [data-question-fields]');
        if (el) {
            el.hidden = hidden;
        }
    }

    _setSubmitting(modal, submitting) {
        if (!modal) {
            return;
        }

        const button = modal.querySelector('[data-review-submit], [data-question-submit]');
        if (button) {
            button.disabled = submitting;
        }
    }

    /**
     * Resolve the configured Turnstile site key for a modal, falling back to the
     * Cloudflare always-passes test key when no prod key is configured (HITL #13
     * cutover gate; SRS §3.4.5, issue #8). The prod key is never hardcoded — it
     * arrives via theme_settings on the widget container's data attribute.
     * @param {HTMLElement} container
     * @returns {string}
     */
    _resolveSiteKey(container) {
        const configured = container && container.dataset
            ? (container.dataset.ugcTurnstileSitekey || '').trim()
            : '';
        return configured || TURNSTILE_TEST_SITE_KEY;
    }

    /**
     * Lazily inject the Cloudflare Turnstile API script (explicit-render mode) and
     * render the widget for the given modal once. No-ops in environments without a
     * widget container or document (e.g. tests), where the token is read directly
     * off the form field instead.
     * @param {string} kind - 'review' | 'question'.
     */
    renderTurnstile(kind) {
        const container = document.querySelector(`[data-${kind}-turnstile]`);
        if (!container) {
            return;
        }

        const idKey = kind === 'review' ? 'reviewTurnstileId' : 'questionTurnstileId';
        if (this[idKey] !== null) {
            return;
        }

        this._loadTurnstileScript().then(() => {
            if (!window.turnstile || this[idKey] !== null) {
                return;
            }

            this[idKey] = window.turnstile.render(container, {
                sitekey: this._resolveSiteKey(container),
            });
        }).catch(() => {});
    }

    _loadTurnstileScript() {
        if (window.turnstile) {
            return Promise.resolve();
        }

        if (this.turnstileScriptPromise) {
            return this.turnstileScriptPromise;
        }

        this.turnstileScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = TURNSTILE_SCRIPT_URL;
            script.async = true;
            script.defer = true;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });

        return this.turnstileScriptPromise;
    }

    /**
     * Read the Turnstile token for a modal: prefer the live widget response,
     * falling back to the form's `cf_turnstile_token` field (which the widget
     * populates, and which tests can seed directly).
     * @param {string} kind - 'review' | 'question'.
     * @returns {string}
     */
    getTurnstileToken(kind) {
        const idKey = kind === 'review' ? 'reviewTurnstileId' : 'questionTurnstileId';
        if (window.turnstile && this[idKey] !== null) {
            const response = window.turnstile.getResponse(this[idKey]);
            if (response) {
                return response;
            }
        }

        const form = kind === 'review' ? this.reviewFormElement : this.questionFormElement;
        const field = form ? form.querySelector('[name="cf_turnstile_token"]') : null;
        return field ? field.value.trim() : '';
    }

    resetTurnstile(kind) {
        const idKey = kind === 'review' ? 'reviewTurnstileId' : 'questionTurnstileId';
        if (window.turnstile && this[idKey] !== null) {
            window.turnstile.reset(this[idKey]);
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
        // Per-score counts (§3.2.1 archetype_rating_breakdown): filter-constant
        // like the two aggregates above, zero-filled with all five keys when
        // served. Null until the UGC API ships it — the histogram simply
        // doesn't render then.
        this.ratingBreakdown = data.archetype_rating_breakdown || null;

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

        const items = Array.isArray(data.items) ? data.items : [];
        this.renderList(items);
        this.renderPagination();

        // The gallery is its own data batch, independent of this render pass —
        // kick off its one-time load after the first successful list render.
        if (this.mediaGridElement && !this.galleryRequested) {
            this.galleryRequested = true;
            this._loadGalleryMedia();
        }
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

        this.vehicleLabel = this._resolveVehicleLabel(state);
        this.applyAliasSort(state);
    }

    /**
     * Pull a human-readable vehicle label off the selected alias to pre-fill the
     * optional `vehicle_label` submission field (SRS §3.2.4, §3.2.5). Returns null
     * when no alias is selected or the field is absent.
     * @param {Object} [state] - The local StateManager snapshot.
     * @returns {string|null}
     */
    _resolveVehicleLabel(state) {
        const aliasData = state && state.aliasData;
        if (!aliasData || !aliasData.vehicle_label) {
            return null;
        }

        return String(aliasData.vehicle_label);
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
        if (nextAlias === this.aliasIndex) {
            return;
        }

        this.aliasIndex = nextAlias;
        this._syncVehicleToggles();
        this._applySortAlias();
    }

    /**
     * The "My vehicle first" toggle changed (either toolbar). Both lists
     * share the one preference.
     * @param {boolean} checked
     */
    _setVehicleFirst(checked) {
        this.vehicleFirst = checked;
        this._syncVehicleToggles();
        this._applySortAlias();
    }

    /**
     * Re-derive the effective sort_alias (toggle on AND alias selected) and,
     * when it changes, refetch both lists so alias-matching items float to
     * the top within the current sort, preserving the active sort and filters
     * and resetting only the page (the relevance order shifts).
     */
    _applySortAlias() {
        const effective = this.vehicleFirst && this.aliasIndex !== null ? this.aliasIndex : null;
        if (effective === this.sortAlias) {
            return;
        }

        this.sortAlias = effective;

        // Only refetch a list that has completed its initial load, so the
        // refetch layers on top of an established list rather than racing the
        // in-flight init fetch (which reads sort_alias live anyway).
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
     * Mirror the shared toggle state onto both toolbars' checkboxes: checked
     * follows the preference, disabled while no alias is selected (the
     * control is meaningless without a vehicle).
     */
    _syncVehicleToggles() {
        const toggles = document.querySelectorAll(
            '[data-reviews-control="vehicle_first"], [data-questions-control="vehicle_first"]',
        );

        for (let i = 0; i < toggles.length; i += 1) {
            toggles[i].checked = this.vehicleFirst;
            toggles[i].disabled = this.aliasIndex === null;
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
        } else if (reviewsControl === 'vehicle_first') {
            // Shared toggle — refetches both lists itself when the effective
            // sort_alias changes.
            this._setVehicleFirst(target.checked);
            return;
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

        if (questionsControl === 'vehicle_first') {
            // Shared toggle — refetches both lists itself when the effective
            // sort_alias changes.
            this._setVehicleFirst(target.checked);
            return;
        }

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

    /**
     * Rebuild the top-level thumbnail grid from the media of the fetched
     * reviews (issue #30, SRS §3.4.1). Runs on every render pass — including
     * alias-aware refetches — so the grid always mirrors the current list. The
     * "+N" expansion collapses back on each rebuild.
     * @param {Object[]} items - The current page of review objects (§3.2.1).
     */
    /**
     * Fetch the next page of the gallery's own data batch (§3.2.1
     * `media=true`, newest first): the most recent media-bearing reviews,
     * independent of the visible list's sort/filter/page. Appends to
     * gridMedia and resolves true when a page landed; a failed fetch marks
     * the batch exhausted and resolves false.
     * @returns {Promise<boolean>}
     */
    async _fetchGalleryPage() {
        if (this.galleryLoading || this.galleryExhausted) {
            return false;
        }

        this.galleryLoading = true;
        const result = await this.api.getReviews(this.archetypeId, {
            media: true,
            sort: 'date_desc',
            page: this.galleryPagesFetched + 1,
        });
        this.galleryLoading = false;

        if (!result.ok) {
            this.galleryExhausted = true;
            return false;
        }

        const data = result.data || {};
        const items = Array.isArray(data.items) ? data.items : [];
        this.galleryPagesFetched += 1;

        const total = Number.isFinite(data.total) ? data.total : null;
        const perPage = Number.isFinite(data.per_page) ? data.per_page : items.length;

        if (!items.length || (total !== null && this.galleryPagesFetched * perPage >= total)) {
            this.galleryExhausted = true;
        }

        this.gridMedia = this.gridMedia.concat(this._collectGridMedia(items));
        return true;
    }

    /**
     * Top the band up one page at a time (bounded by GALLERY_MAX_PAGES)
     * while the measured band has unfilled cells, repainting after every
     * landed page. A failed fetch stops quietly — the panel shows whatever
     * it already has.
     */
    async _loadGalleryMedia() {
        const capacity = this.gridCapacity || MEDIA_GRID_MAX + 1;

        if (this.galleryPagesFetched >= GALLERY_MAX_PAGES || this.gridMedia.length >= capacity) {
            return;
        }

        const fetched = await this._fetchGalleryPage();
        this._paintMediaGrid();

        if (fetched) {
            await this._loadGalleryMedia();
        }
    }

    /**
     * Flatten the reviews' media arrays into grid entries, preserving review
     * order and each array's server-supplied sort_order ordering (index 0
     * first; SRS §3.2.1). Items without a usable `url` are dropped
     * defensively. Each entry keeps its owning review so the lightbox can
     * show the full review beside the media.
     * @param {Object[]} items
     * @returns {Object[]} Entries of { media, review }.
     */
    _collectGridMedia(items) {
        const collected = [];

        items.forEach((review) => {
            const media = Array.isArray(review.media) ? review.media : [];
            media.forEach((item) => {
                if (item && item.url) {
                    collected.push({ media: item, review });
                }
            });
        });

        return collected;
    }

    /**
     * Paint the reviews-overview panel: the archetype rating summary header
     * plus the media collage from gridMedia. The panel renders
     * whenever the archetype has reviews — with no media it carries the
     * summary alone. With neither, the container keeps its reserved space but
     * hides via visibility (CLS rule — it populates async, so it never
     * collapses with display:none). When more media exists than the band
     * holds — locally or still on the server — a trailing "+N" tile opens
     * the browsable gallery modal.
     */
    _paintMediaGrid() {
        if (!this.mediaGridElement) {
            return;
        }

        const summary = this._buildPanelSummary();
        const total = this.gridMedia.length;

        if (!total && !summary) {
            this.mediaGridElement.innerHTML = '';
            this.mediaGridElement.style.visibility = 'hidden';
            return;
        }

        let gallery = '';

        if (total) {
            // Capacity counts grid elements (tiles plus any "+N") that fill the
            // two-row band exactly; when unmeasured, fall back to the fixed cap.
            // The band never grows in place — "+N" opens the gallery modal,
            // and it also shows when the server holds more media than the
            // batch has fetched so far.
            const capacity = this.gridCapacity || MEDIA_GRID_MAX + 1;
            const overflow = total > capacity || !this.galleryExhausted;
            const visible = overflow ? this.gridMedia.slice(0, capacity - 1) : this.gridMedia;
            const tiles = visible.map((entry, index) => this._buildMediaTile(entry.media, entry.review.author, index));

            if (overflow) {
                const hidden = total - visible.length;
                const text = hidden > 0 ? `+${hidden}` : '&hellip;';
                tiles.push(`<button type="button" class="cs-media-tile cs-media-tile--more" data-ugc-media-expand aria-label="View all customer photos and videos">${text}</button>`);
            }

            gallery = `<div class="cs-ugc-media-gallery" data-ugc-media-gallery><h3 class="cs-ugc-media-grid-title">${MESSAGES.mediaGridTitle} (${total})</h3>${tiles.join('')}</div>`;
        }

        this.mediaGridElement.innerHTML = summary + gallery;
        this.mediaGridElement.style.visibility = 'visible';
    }

    /**
     * Re-measure the collapsed grid's capacity after layout changes (tab
     * activation, viewport resize) and repaint only when it actually changed.
     * An expanded grid keeps showing everything until the next render pass.
     */
    _onGridResize() {
        const capacity = this._measureGridCapacity();

        if (capacity !== this.gridCapacity) {
            this.gridCapacity = capacity;
            this._paintMediaGrid();

            // A wider band may want more tiles than the batch holds.
            if (this.galleryRequested) {
                this._loadGalleryMedia();
            }
        }
    }

    /**
     * Derive how many grid elements fill the two-row band from the browser's
     * resolved column tracks (authoritative — no duplication of the SCSS
     * auto-fill math). The 2×2 featured tile occupies four cells, so a
     * cols-wide band holds (cols * 2) - 3 elements. Returns null when the grid
     * has no resolved layout yet (e.g. inside the inactive Reviews tab).
     * @returns {?number}
     */
    _measureGridCapacity() {
        const gallery = this.mediaGridElement.querySelector('[data-ugc-media-gallery]');

        if (!gallery) {
            return null;
        }

        const style = window.getComputedStyle(gallery);
        const tracks = (style.gridTemplateColumns || '').split(' ').filter(track => track.endsWith('px'));
        const cols = tracks.length;

        if (cols < 3) {
            return null;
        }

        return (cols * 2) - 3;
    }

    /**
     * Archetype-wide rating header for the overview panel: average stars, the
     * numeric average, and the review count (the cached, filter-constant
     * envelope aggregates). Empty string before the first envelope lands or
     * when the archetype has no approved reviews. A breakdown by score joins
     * here once the §3.2.1 envelope serves an aggregate for it.
     * @returns {string}
     */
    _buildPanelSummary() {
        if (this.ratingAverage === null || !this.reviewCount) {
            return '';
        }

        const average = Math.round(this.ratingAverage * 10) / 10;
        const rating = `<div class="cs-ugc-summary-rating">${this._buildStars(this.ratingAverage)}<span class="cs-ugc-summary-average">${average}</span><span class="cs-ugc-summary-count">${this._countLabel(this.reviewCount)}</span></div>`;
        return `<div class="cs-ugc-media-grid-summary">${rating}${this._buildBreakdown()}</div>`;
    }

    /**
     * Per-score histogram from the cached §3.2.1 archetype_rating_breakdown,
     * rendered 5★ down to 1★ with bars proportional to the review count.
     * Empty string until the UGC API serves the field. The spec guarantees
     * all five keys zero-filled and sum == archetype_review_count, so bar
     * math needs no per-key guards.
     * @returns {string}
     */
    _buildBreakdown() {
        if (!this.ratingBreakdown || !this.reviewCount) {
            return '';
        }

        const rows = [];

        for (let score = MAX_STARS; score >= 1; score -= 1) {
            const count = this.ratingBreakdown[String(score)];
            const percent = Math.round((count / this.reviewCount) * 100);
            const noun = count === 1 ? 'review' : 'reviews';
            const starNoun = score === 1 ? 'star' : 'stars';
            rows.push(`<div class="cs-ugc-breakdown-row" role="img" aria-label="${count} ${noun} at ${score} ${starNoun}"><span class="cs-ugc-breakdown-label" aria-hidden="true">${score}★</span><span class="cs-ugc-breakdown-bar" aria-hidden="true"><span class="cs-ugc-breakdown-fill" style="width: ${percent}%"></span></span><span class="cs-ugc-breakdown-count" aria-hidden="true">${count}</span></div>`);
        }

        return `<div class="cs-ugc-summary-breakdown">${rows.join('')}</div>`;
    }

    /**
     * Build one clickable media tile (shared by the top-level grid and the
     * per-review strips). The thumbnail uses the §3.2.1 single-thumbnail
     * fallback chain thumb_url → poster_url → medium_url → url; the dataset
     * carries what the lightbox needs (photo → medium_url/url, video → url +
     * poster_url). Photos get descriptive alt text; videos a play affordance
     * with an aria-label, since the poster image alone names nothing.
     * @param {Object} media - A §3.2.1 media item.
     * @param {string} [author] - The owning review's author, for labels.
     * @param {number} [index] - The entry's gridMedia index. Present on band
     *     and gallery-modal tiles, where the lightbox shows the full owning
     *     review; absent on per-review strips (their review is already on
     *     screen).
     * @returns {string}
     */
    _buildMediaTile(media, author, index) {
        const isVideo = media.type === 'video';
        const thumb = media.thumb_url || media.poster_url || media.medium_url || media.url;
        const src = isVideo ? media.url : (media.medium_url || media.url);
        const source = author ? `${author}'s review` : 'a customer review';
        const label = isVideo ? `Video from ${source}` : `Photo from ${source}`;
        const escapedLabel = this._escapeAttr(label);
        const indexAttr = index === undefined ? '' : ` data-ugc-media-index="${index}"`;
        const common = `data-ugc-media-tile${indexAttr} data-ugc-media-type="${isVideo ? 'video' : 'photo'}" data-ugc-media-src="${this._escapeAttr(src)}" data-ugc-media-label="${escapedLabel}"`;

        if (isVideo) {
            const poster = media.poster_url ? ` data-ugc-media-poster="${this._escapeAttr(media.poster_url)}"` : '';
            const playLabel = this._escapeAttr(`Play video from ${source}`);
            return `<button type="button" class="cs-media-tile cs-media-tile--video" ${common}${poster} aria-label="${playLabel}"><img class="cs-media-tile-thumb" src="${this._escapeAttr(thumb)}" alt="" loading="lazy"><span class="cs-media-tile-play" aria-hidden="true"></span></button>`;
        }

        return `<button type="button" class="cs-media-tile" ${common}><img class="cs-media-tile-thumb" src="${this._escapeAttr(thumb)}" alt="${escapedLabel}" loading="lazy"></button>`;
    }

    /**
     * Build the per-review thumbnail strip rendered after the review body
     * (issue #30). Empty string when the review carries no media, so reviews
     * without media render exactly as before.
     * @param {Object} review - A §3.2.1 review object.
     * @returns {string}
     */
    _buildReviewMedia(review) {
        const media = Array.isArray(review.media) ? review.media : [];
        const tiles = media
            .filter(item => item && item.url)
            .map(item => this._buildMediaTile(item, review.author));

        if (!tiles.length) {
            return '';
        }

        return `<div class="cs-review-media">${tiles.join('')}</div>`;
    }

    /**
     * Delegated click handler for media tiles in the grid and the per-review
     * strips. The "+N" tile opens the gallery modal; any other tile opens
     * the lightbox from its dataset.
     * @param {MouseEvent} event
     */
    onMediaTileClick(event) {
        if (event.target.closest('[data-ugc-media-expand]')) {
            this.openGalleryModal();
            return;
        }

        const tile = event.target.closest('[data-ugc-media-tile]');
        if (tile) {
            this.openLightbox(tile.dataset);
        }
    }

    onLightboxClick(event) {
        if (event.target.closest('[data-ugc-lightbox-close]')) {
            this.closeLightbox();
        }
    }

    /**
     * Delegated click handler for the all-media gallery modal: dismissal,
     * Load more paging, and tiles opening the lightbox (which layers above
     * the modal).
     * @param {MouseEvent} event
     */
    onGalleryModalClick(event) {
        if (event.target.closest('[data-ugc-gallery-close]')) {
            this.closeGalleryModal();
            return;
        }

        if (event.target.closest('[data-ugc-gallery-more]')) {
            this._loadMoreGalleryMedia();
            return;
        }

        const tile = event.target.closest('[data-ugc-media-tile]');
        if (tile) {
            this.openLightbox(tile.dataset);
        }
    }

    /**
     * Open the browsable gallery of every fetched media item. The panel's
     * band stays capped — browsing all media (archetypes can carry hundreds
     * of items) happens here instead of growing the page in place.
     */
    openGalleryModal() {
        if (!this.galleryModalElement) {
            return;
        }

        this._paintGalleryModal();
        this.galleryModalElement.hidden = false;
    }

    closeGalleryModal() {
        if (this.galleryModalElement) {
            this.galleryModalElement.hidden = true;
        }
    }

    /**
     * Paint the modal's grid from the full fetched batch and toggle Load
     * more on whether the server has more media-bearing reviews (§3.2.1
     * `total` vs pages fetched).
     */
    _paintGalleryModal() {
        if (!this.galleryModalElement) {
            return;
        }

        const gridElement = this.galleryModalElement.querySelector('[data-ugc-gallery-grid]');
        if (gridElement) {
            gridElement.innerHTML = this.gridMedia.map((entry, index) => this._buildMediaTile(entry.media, entry.review.author, index)).join('');
        }

        const more = this.galleryModalElement.querySelector('[data-ugc-gallery-more]');
        if (more) {
            more.hidden = this.galleryExhausted;
        }
    }

    /**
     * User-driven paging from the modal's Load more button: one further
     * §3.2.1 media=true page per click, unbounded by the band's
     * GALLERY_MAX_PAGES top-up budget. Repaints both the modal grid and the
     * panel band ("+N" count grows with the batch).
     */
    async _loadMoreGalleryMedia() {
        const fetched = await this._fetchGalleryPage();

        if (fetched) {
            this._paintMediaGrid();
        }

        this._paintGalleryModal();
    }

    /**
     * Show the clicked media large in the shared lightbox: photos render the
     * medium-size image (already resolved into the tile's dataset), videos play
     * with the extracted poster frame as poster (SRS §3.2.1). Dataset values
     * come back browser-decoded, so they are re-escaped here before insertion.
     * @param {DOMStringMap} dataset - The clicked tile's dataset.
     */
    openLightbox(dataset) {
        const content = this.lightboxElement
            ? this.lightboxElement.querySelector('[data-ugc-lightbox-content]')
            : null;
        if (!content) {
            return;
        }

        const src = this._escapeAttr(dataset.ugcMediaSrc || '');
        const label = this._escapeAttr(dataset.ugcMediaLabel || '');
        let media;

        if (dataset.ugcMediaType === 'video') {
            const poster = dataset.ugcMediaPoster ? ` poster="${this._escapeAttr(dataset.ugcMediaPoster)}"` : '';
            media = `<video class="cs-ugc-lightbox-video" src="${src}"${poster} controls autoplay playsinline aria-label="${label}"></video>`;
        } else {
            media = `<img class="cs-ugc-lightbox-img" src="${src}" alt="${label}">`;
        }

        // Band and gallery-modal tiles carry their gridMedia index — show the
        // full owning review under the media. Per-review strip tiles don't
        // (their review is already on screen).
        let review = '';
        const entry = dataset.ugcMediaIndex === undefined
            ? null
            : this.gridMedia[parseInt(dataset.ugcMediaIndex, 10)];
        if (entry && entry.review) {
            review = `<div class="cs-ugc-lightbox-review">${this._buildReview(entry.review, false)}</div>`;
        }

        content.innerHTML = media + review;
        this.lightboxElement.hidden = false;
    }

    /**
     * Hide the lightbox and clear its content — emptying the container is what
     * stops a playing video, not just hiding it.
     */
    closeLightbox() {
        if (!this.lightboxElement) {
            return;
        }

        const content = this.lightboxElement.querySelector('[data-ugc-lightbox-content]');
        if (content) {
            content.innerHTML = '';
        }

        this.lightboxElement.hidden = true;
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

        // The reviews list is unavailable, so hide the overview panel with it
        // and re-arm the gallery load for the next successful render.
        this.gridMedia = [];
        this.galleryRequested = false;
        this.galleryPagesFetched = 0;
        this.galleryExhausted = false;
        this._paintMediaGrid();
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

    _buildReview(review, includeMedia = true) {
        const author = this._escape(review.author) || MESSAGES.anonymous;
        const title = this._escape(review.title);
        const body = this._escape(review.body);
        const vehicle = this._escape(review.vehicle_label);
        const date = this._formatDate(review.date);
        const verified = review.verified_purchaser
            ? '<span class="cs-review-verified">Verified Purchaser</span>'
            : '';
        // Public disclosure that staff edited this review's content (SRS §3.2.1
        // `edited` / §3.1.1, cs-ugc #145). Strict `=== true` so a missing field
        // on an older payload is treated as false and nothing renders — the card
        // must never break on an absent flag, and it never reveals who edited or
        // how many times (only the derived boolean is exposed).
        const edited = review.edited === true
            ? '<span class="cs-review-edited">Edited by CravenSpeed</span>'
            : '';
        const staff = review.staff_response
            ? `<div class="cs-review-staff"><strong>CravenSpeed:</strong> ${this._escape(review.staff_response)}</div>`
            : '';
        // The lightbox renders the review beside the media itself — its strip
        // would just be inert duplicate thumbnails there.
        const media = includeMedia ? this._buildReviewMedia(review) : '';

        return `
            <article class="cs-review">
                <div class="cs-review-heading">
                    ${date ? `<span class="cs-review-date">${date}</span>` : ''}
                    ${this._buildStars(review.rating || 0)}
                    <span class="cs-review-score">${review.rating || 0}</span>
                    ${title ? `<h3 class="cs-review-title">${title}</h3>` : ''}
                </div>
                <p class="cs-review-meta">
                    <span class="cs-review-author">${author}</span>
                    ${verified}
                    ${edited}
                </p>
                ${vehicle ? `<p class="cs-review-vehicle">${vehicle}</p>` : ''}
                <p class="cs-review-body">${body}</p>
                ${media}
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
            month: '2-digit',
            day: '2-digit',
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

    /**
     * Escape a value for a double-quoted HTML attribute context. _escape covers
     * & < > via textContent, but NOT double quotes — a URL or label containing
     * `"` would otherwise break out of the attribute (issue #30).
     * @param {*} value
     * @returns {string}
     */
    _escapeAttr(value) {
        return this._escape(value).replace(/"/g, '&quot;');
    }

    destroy() {
        if (this.unsubscribe) this.unsubscribe();

        if (this.gridResizeObserver) {
            this.gridResizeObserver.disconnect();
        }

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

        if (this.listElement) {
            this.listElement.removeEventListener('click', this.onMediaTileClick);
        }

        if (this.mediaGridElement) {
            this.mediaGridElement.removeEventListener('click', this.onMediaTileClick);
        }

        if (this.lightboxElement) {
            this.lightboxElement.removeEventListener('click', this.onLightboxClick);
        }

        if (this.galleryModalElement) {
            this.galleryModalElement.removeEventListener('click', this.onGalleryModalClick);
        }

        const reviewOpen = document.querySelector('[data-review-modal-open]');
        if (reviewOpen) {
            reviewOpen.removeEventListener('click', this.onReviewOpenClick);
        }

        if (this.reviewModalElement) {
            this.reviewModalElement.removeEventListener('click', this.onReviewModalClick);
        }

        if (this.reviewFormElement) {
            this.reviewFormElement.removeEventListener('submit', this.onReviewSubmit);
        }

        const questionOpen = document.querySelector('[data-question-modal-open]');
        if (questionOpen) {
            questionOpen.removeEventListener('click', this.onQuestionOpenClick);
        }

        if (this.questionModalElement) {
            this.questionModalElement.removeEventListener('click', this.onQuestionModalClick);
        }

        if (this.questionFormElement) {
            this.questionFormElement.removeEventListener('submit', this.onQuestionSubmit);
        }
    }
}
