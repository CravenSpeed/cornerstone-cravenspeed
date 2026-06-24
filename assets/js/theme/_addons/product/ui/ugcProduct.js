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
 * Slice 6d (#7) tracked the selected alias's published `qty_alias_index`
 * (SRS §3.1.4) off state.aliasData and rode it as `alias_id` on submissions.
 * That still holds — `alias_id` is retained as nullable provenance (SRS §3.1.4,
 * change-log Pass 25). What was REMOVED in M9 Slice A (#158) is the old
 * "my vehicle first" relevance sort: the `sort_alias` param and its opt-in
 * toggle are gone, superseded by the fitment filter below at the correct grain
 * (a fitment spans many aliases; the alias-keyed sort floated only the
 * currently-viewed variant — SRS change-log Pass 25/27).
 *
 * Slice A (#158) makes the lists fitment-aware (SRS §3.4.1, §3.2.1, §3.2.2).
 * The module resolves the visitor's persisted garage vehicle (make/model/
 * generation slugs) to a QTY `fitment_id` from the search JSON's
 * `vehicle_registry` (via the shared vehicleFitment resolver), reading both the
 * garage selection and the registry off the injected GlobalStateManager. That
 * `fitment_id` rides on EVERY getReviews / getQuestions call (omitted when
 * un-resolvable or on a universal product — buildQuery drops null), so the
 * envelopes return `fitment_review_count` / `fitment_question_count`. When that
 * count is > 0 the module renders a "For your <vehicle>" filter chip naming the
 * vehicle; clicking it refetches with `fitment_only=true` (composing with the
 * active sort/rating/verified/media, resetting to page 1) and shows a selected
 * state, and clearing it drops the flag. The honest default view stays
 * newest-first — the chip is off by default. No chip when the count is 0 or on
 * universal-product pages. A late-arriving registry or a garage change re-runs
 * the resolution and refetches so the chip stays correct.
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
 * M9 (#41) tailors the submission vehicle field to the reviewer's scenario
 * (SRS §3.4.1, §3.2.4, §3.2.5; canonical label rule §3.2.4 Pass 35). There is no
 * free-text vehicle input and NO append/opt-in checkbox anywhere — the field's
 * presence and required-ness are determined by the path:
 *   - VERIFIED review (GET /api/token/validate returned a `fitment_id`, §3.2.8):
 *     NO vehicle UI at all (no checkbox, no confirmation line — fully silent).
 *     The token's `fitment_id` + its full-canonical label (resolved via
 *     fitmentIdToLabel(registry, tokenFitmentId)) are attached to the payload
 *     silently. The server overrides `fitment_id` from the token regardless.
 *   - NON-VERIFIED review (fitment product): a make → model → generation
 *     WATERFALL (three dependent <select>s) constrained to the archetype's own
 *     fitments, REQUIRED — submit is blocked until a generation is chosen.
 *   - Q&A (any, fitment product): the SAME waterfall, but OPTIONAL — submit is
 *     allowed with no vehicle.
 *   - UNIVERSAL products (any path): no vehicle field — the archetype fitment
 *     tree is empty, so the section stays absent and submission is unbroken.
 *   - VERIFIED token without `fitment_id` (edge): falls back to the non-verified
 *     waterfall.
 * The waterfall mirrors the add-to-cart vehicle selector: picking a make
 * repopulates models, a model repopulates generations, single options auto-
 * select, and the newest generation auto-selects. It pre-fills all three tiers
 * from the garage vehicle when it is one of the archetype's fitments (still
 * required for reviews — pre-fill just saves a step). On submit the chosen
 * generation's `fitment_id` + its full-canonical `vehicle_label` (make + model +
 * generation-with-years, §3.2.4) ride on the payload.
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

import {
    resolveGarageFitmentFromState,
    fitmentIdToLabel,
    buildArchetypeFitmentList,
    buildArchetypeFitmentTree,
} from '../../global/vehicleFitment';
import {
    starIcons,
    scoreBadge,
    verifiedBadge,
    editedBadge,
    countryFlag,
    formatReviewDate,
    vehicleBadge,
} from '../../global/ugcCard';
import { renderPaginationNav } from '../../global/ugcPagination';

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
    fitmentChipClear: 'Clear filter',
    fitmentPrompt: 'Select your vehicle to filter',
    vehicleSectionLabel: 'Your Vehicle',
    vehicleSectionLabelOptional: 'Your Vehicle (optional)',
    vehicleMakeDefault: 'Select Make',
    vehicleModelDefault: 'Select Model',
    vehicleGenerationDefault: 'Select Generation',
    vehicleRequiredError: 'Please select your vehicle.',
};

// "For your <vehicle>" fitment filter chip label (SRS §3.4.1). The vehicle name
// is the resolver's label.
const fitmentChipLabel = vehicle => `For your ${vehicle}`;

// Active click-filter chip label (issue #45) — names the clicked review/question
// vehicle that the list is currently restricted to.
const showingChipLabel = vehicle => `Showing: ${vehicle}`;

// Passive status shown in place of the chip when a resolved garage vehicle has
// no matching reviews/questions on this product — explains why no filter chip
// is offered. `noun` is 'reviews' or 'questions'.
const noFitmentMatchLabel = (vehicle, noun) => `No ${noun} yet for your ${vehicle}`;

export default class UgcProduct {
    /**
     * @param {number|string} archetypeId - QTY archetype id, from the archetype
     *   JSON's `qty_archetype_id` (= ProductArchetypes.id; SRS §1.3, §3.4.1).
     * @param {Object} stateManager - Local product StateManager.
     * @param {Object} api - The ugcApi helper (injectable for tests).
     * @param {Function} [mediaPut] - fetch impl for the raw PUT to the DO Spaces
     *   presigned URL. Bypasses ugcApi's base entirely (the URL is absolute and
     *   external); injectable so tests never hit the network.
     * @param {Object} [globalStateManager] - The site-wide GlobalStateManager
     *   (getState/subscribe). Source of the persisted garage vehicle
     *   (`vehicle.selected`) and the search-JSON `vehicle_registry`
     *   (`search.data.vehicle_registry`) used to resolve the garage `fitment_id`
     *   for the fitment filter (SRS §3.4.1). Omitted in tests with no garage —
     *   the lists simply carry no `fitment_id` and no chip renders.
     * @param {Object} [archetypeData] - The loaded archetype JSON. Source of the
     *   archetype-constrained make/model/generation fitment list for the
     *   non-verified submission dropdown (SRS §3.4.1, via buildArchetypeFitmentList).
     *   Universal products yield an empty list, so the vehicle section is absent.
     */
    constructor(archetypeId, stateManager, api, mediaPut, globalStateManager, archetypeData) {
        this.archetypeId = archetypeId;
        this.stateManager = stateManager;
        this.api = api;
        this.mediaPut = mediaPut || ((...args) => fetch(...args));
        this.globalStateManager = globalStateManager || null;
        this.unsubscribe = null;
        this.unsubscribeGlobal = null;

        // Archetype-constrained fitment list + its make → model → generation
        // tree for the structured submission waterfall (SRS §3.4.1, issue #41).
        // Both empty on universal products / when no archetype data is injected —
        // the vehicle section is then absent and submission stays unbroken.
        this.archetypeFitments = buildArchetypeFitmentList(archetypeData || null);
        this.fitmentTree = buildArchetypeFitmentTree(this.archetypeFitments);

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
        // alias is selected. Provenance only — rides on submissions as
        // `alias_id` (the former sort_alias relevance sort was removed in M9).
        this.aliasIndex = null;

        // Garage fitment (SRS §3.4.1, §3.2.1/§3.2.2). `fitmentId` is the QTY
        // `fitment_id` resolved from the persisted garage vehicle against the
        // search-JSON registry; it rides on every reviews/questions fetch.
        // `fitmentLabel` names the vehicle on the chip. `fitmentOnly` is the
        // chip's hard-filter flag — off by default, so the honest view is
        // newest-first. The two `fitment*Count` values come from the envelopes
        // and drive each chip's show-at->0 rule.
        this.fitmentId = null;
        this.fitmentLabel = null;
        this.fitmentOnly = false;
        this.fitmentReviewCount = 0;
        this.fitmentQuestionCount = 0;
        this.reviewsLoaded = false;

        // Click-to-filter overlay (issue #45): when the visitor clicks a
        // review/question vehicle badge, this holds that badge's `fitment_id` +
        // label and takes over the chip slot ("Showing: <vehicle>"), driving the
        // same `fitment_only` query at the clicked fitment instead of the garage
        // one. Null = no click-filter, so the garage chip behaves as before.
        this.clickFilterId = null;
        this.clickFilterLabel = null;

        // Init-race guard (Slice A review nit): a garage/registry change can fire
        // between seeding the fitment and the initial fetch completing, while
        // `reviewsLoaded`/`questionsLoaded` are still false. The change updates
        // `fitmentId` but its refetch is dropped by the loaded guards, leaving the
        // in-flight init fetch (whose params were already captured) stale. This
        // flag records that a deferred refetch is owed; init runs it once the list
        // has loaded so the chip/list reflect the latest fitment.
        this.pendingReviewsFitmentRefetch = false;
        this.pendingQuestionsFitmentRefetch = false;

        // Verified-purchaser token (SRS §3.4.1, §3.2.8). Held in memory for the
        // session only once GET /api/token/validate confirms it; sent as
        // `ugc_token` on review submit so the server stamps verified_purchaser=true.
        // Stays null on absent/invalid/expired token — submission still proceeds,
        // just unverified.
        this.verifiedPurchaserToken = null;

        // The token's authoritative `fitment_id` (SRS §3.2.8), held alongside the
        // token once validated. Drives the verified reviewer's SILENT vehicle
        // attach in the review modal — no UI at all (SRS §3.4.1, issue #41). Null
        // until a valid token carries a fitment.
        this.verifiedFitmentId = null;

        // The verified reviewer's resolved silent-attach vehicle (issue #41):
        // { fitment_id, vehicle_label }, stashed by _renderVehicleSection on a
        // review modal open when a token fitment resolves to a label. Null on the
        // non-verified / Q&A / universal paths, where the waterfall (or nothing)
        // is shown instead. Read straight onto the payload on submit.
        this.verifiedSilentVehicle = null;

        // Turnstile widget ids returned by window.turnstile.render, per modal.
        // Tracked so the widget is rendered once and reset after each submit.
        this.reviewTurnstileId = null;
        this.questionTurnstileId = null;
        this.turnstileScriptPromise = null;

        this.ratingElement = document.querySelector('[data-product-rating]');
        this.listElement = document.querySelector('#product-reviews');
        this.toolbarElement = document.querySelector('[data-reviews-toolbar]');
        // One container above the list and one below — both painted in lockstep.
        this.paginationElements = Array.from(document.querySelectorAll('[data-reviews-pagination]'));

        this.questionsElement = document.querySelector('#product-questions');
        this.questionsToolbarElement = document.querySelector('[data-questions-toolbar]');
        // One container above the list and one below — both painted in lockstep.
        this.questionsPaginationElements = Array.from(document.querySelectorAll('[data-questions-pagination]'));

        // "For your <vehicle>" fitment chip containers (SRS §3.4.1), one per
        // list. Space is reserved in SCSS (visibility, not display) so the
        // async chip paint never shifts the toolbar.
        this.reviewsFitmentChipElement = document.querySelector('[data-reviews-fitment-chip]');
        this.questionsFitmentChipElement = document.querySelector('[data-questions-fitment-chip]');

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
        // Index of the gridMedia entry the lightbox is showing, so prev/next can
        // step through the customer-photo set. -1 when the lightbox was opened
        // from a per-review strip tile (no index → no navigation).
        this.lightboxIndex = -1;
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

        // Structured-vehicle section containers (SRS §3.4.1, issue #41), one per
        // modal. Populated on open by _renderVehicleSection — empty for the
        // verified reviewer (silent token attach) or the archetype-constrained
        // make → model → generation waterfall otherwise. Reserved in SCSS so the
        // async paint never shifts the form.
        this.reviewVehicleElement = this.reviewFormElement
            ? this.reviewFormElement.querySelector('[data-review-vehicle]')
            : null;
        this.questionVehicleElement = this.questionFormElement
            ? this.questionFormElement.querySelector('[data-question-vehicle]')
            : null;

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
        this.onLightboxKeydown = this.onLightboxKeydown.bind(this);
        this.onGalleryModalClick = this.onGalleryModalClick.bind(this);
        this.onFitmentChipClick = this.onFitmentChipClick.bind(this);
        this.onVehicleBadgeClick = this.onVehicleBadgeClick.bind(this);
        this.onReviewVehicleChange = this.onReviewVehicleChange.bind(this);
        this.onQuestionVehicleChange = this.onQuestionVehicleChange.bind(this);

        const hasReviewsDom = this.ratingElement || this.listElement;

        if (this.archetypeId && (hasReviewsDom || this.questionsElement)) {
            this.unsubscribe = this.stateManager.subscribe(this.update.bind(this));

            // Resolve the garage fitment_id BEFORE the first fetch so it rides
            // on the initial reviews/questions calls (SRS §3.4.1), and subscribe
            // so a late-arriving registry or a garage change re-resolves and
            // refetches.
            this.subscribeGlobalFitment();

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

        this.paginationElements.forEach((el) => {
            el.addEventListener('click', this.onPaginationClick);
        });

        if (this.questionsToolbarElement) {
            this.questionsToolbarElement.addEventListener('change', this.onQuestionsToolbarChange);
        }

        this.questionsPaginationElements.forEach((el) => {
            el.addEventListener('click', this.onQuestionsPaginationClick);
        });

        // Fitment chip clicks are delegated on the chip containers so the chip
        // survives every re-render without rebinding (SRS §3.4.1).
        if (this.reviewsFitmentChipElement) {
            this.reviewsFitmentChipElement.addEventListener('click', this.onFitmentChipClick);
        }

        if (this.questionsFitmentChipElement) {
            this.questionsFitmentChipElement.addEventListener('click', this.onFitmentChipClick);
        }

        // Media tile clicks are delegated so per-review strips and the grid
        // survive every innerHTML re-render without rebinding (issue #30).
        if (this.listElement) {
            this.listElement.addEventListener('click', this.onMediaTileClick);
        }

        // Vehicle-badge clicks filter the lists to that review/question's vehicle
        // (issue #45), delegated on each list so the badges survive re-renders.
        if (this.listElement) {
            this.listElement.addEventListener('click', this.onVehicleBadgeClick);
        }

        if (this.questionsElement) {
            this.questionsElement.addEventListener('click', this.onVehicleBadgeClick);
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

        // Waterfall cascade: a tier change repopulates its dependents. Delegated
        // on the vehicle container so it survives each _renderVehicleSection
        // rebuild without rebinding (SRS §3.4.1, issue #41).
        if (this.reviewVehicleElement) {
            this.reviewVehicleElement.addEventListener('change', this.onReviewVehicleChange);
        }

        if (this.questionVehicleElement) {
            this.questionVehicleElement.addEventListener('change', this.onQuestionVehicleChange);
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
        this._renderVehicleSection(modal === this.reviewModalElement ? 'review' : 'question');

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
     * Read the search-JSON `vehicle_registry` off the GlobalStateManager, used to
     * resolve a `fitment_id` (e.g. the verified token's) to its display label
     * (SRS §3.4.1). Null when no GlobalStateManager / registry is available.
     * @returns {Object|null}
     */
    _registry() {
        if (!this.globalStateManager) {
            return null;
        }

        const state = this.globalStateManager.getState();
        return state && state.search && state.search.data
            ? state.search.data.vehicle_registry
            : null;
    }

    /**
     * Resolve a `fitment_id` to its full canonical `vehicle_label` from this
     * archetype's `make_model_index` (cs-ugc #209). Unlike the global registry,
     * the archetype index is make-namespaced, so a model slug shared across two
     * makes (Mazda 3 vs Polestar 3, etc.) resolves to the correct make. Returns
     * '' when the fitment isn't one of this archetype's fitments.
     * @param {number} fitmentId
     * @returns {string}
     */
    _labelFromArchetype(fitmentId) {
        const match = this.archetypeFitments.find(f => f.fitment_id === fitmentId);
        return match ? match.label : '';
    }

    /**
     * Paint the vehicle section for a submission modal, tailored to the reviewer's
     * scenario (SRS §3.4.1, issue #41). There is no free-text input and no
     * append/opt-in checkbox:
     *   - VERIFIED review (a token `fitment_id` is held and resolves to a label):
     *     NO UI at all — the token's fitment + full-canonical label are stashed
     *     for a silent attach on submit.
     *   - NON-VERIFIED review + ALL Q&A (fitment product): a make → model →
     *     generation waterfall constrained to the archetype's own fitments, pre-
     *     filled from the garage vehicle when it is one of them.
     *   - UNIVERSAL products / no fitment tree: empty section — no field.
     *   - VERIFIED token without a resolvable fitment label: falls through to the
     *     waterfall.
     * @param {string} kind - 'review' | 'question'.
     */
    _renderVehicleSection(kind) {
        const container = kind === 'review' ? this.reviewVehicleElement : this.questionVehicleElement;
        if (!container) {
            return;
        }

        // Reset any prior silent-attach for this modal so a reopened modal starts
        // from the current trust tier.
        if (kind === 'review') {
            this.verifiedSilentVehicle = null;
        }

        if (kind === 'review' && this.verifiedFitmentId !== null) {
            // Resolve the token's fitment from the archetype's make_model_index
            // first (make-namespaced), not the global registry — the registry's
            // models map is keyed by bare model slug, so for the handful of model
            // names shared across two makes (e.g. Mazda 3 vs Polestar 3) it can
            // resolve the wrong make (cs-ugc #209). The registry stays a fallback
            // for the edge where the token's fitment isn't in this archetype.
            const label = this._labelFromArchetype(this.verifiedFitmentId)
                || fitmentIdToLabel(this._registry(), this.verifiedFitmentId);
            if (label) {
                // Fully silent: no UI, attach on submit (SRS §3.4.1, issue #41).
                this.verifiedSilentVehicle = {
                    fitment_id: this.verifiedFitmentId,
                    vehicle_label: label,
                };
                container.innerHTML = '';
                return;
            }
        }

        container.innerHTML = this._buildVehicleWaterfall(kind);
        this._prefillWaterfall(container);
    }

    /**
     * Build the make → model → generation waterfall (three dependent <select>s)
     * constrained to the archetype's own fitments (SRS §3.4.1, issue #41). Mirrors
     * the add-to-cart vehicle selector. Empty string when the archetype has no
     * fitments (universal product). The model/generation selects start disabled
     * and empty; _populateWaterfall fills them once a make is chosen / pre-filled.
     * @param {string} kind - 'review' | 'question'.
     * @returns {string}
     */
    _buildVehicleWaterfall(kind) {
        if (!this.fitmentTree.length) {
            return '';
        }

        // The non-verified review requires a vehicle; Q&A is optional.
        const required = kind === 'review';
        const sectionLabel = this._escape(
            required ? MESSAGES.vehicleSectionLabel : MESSAGES.vehicleSectionLabelOptional,
        );
        const makeOptions = this.fitmentTree
            .map(make => `<option value="${this._escapeAttr(make.slug)}">${this._escape(make.label)}</option>`)
            .join('');

        return `<div class="cs-ugc-vehicle-picker"${required ? ' data-vehicle-required' : ''}>
                    <span class="cs-ugc-field-label">${sectionLabel}</span>
                    <div class="cs-car-selection cs-ugc-vehicle-waterfall">
                        <div class="cs-car-selection-field">
                            <select class="cs-car-selection-dropdown cs-ugc-vehicle-tier" data-vehicle-tier="make" aria-label="${this._escapeAttr(MESSAGES.vehicleMakeDefault)}">
                                <option value="">${this._escape(MESSAGES.vehicleMakeDefault)}</option>
                                ${makeOptions}
                            </select>
                        </div>
                        <div class="cs-car-selection-field">
                            <select class="cs-car-selection-dropdown cs-ugc-vehicle-tier" data-vehicle-tier="model" aria-label="${this._escapeAttr(MESSAGES.vehicleModelDefault)}" disabled>
                                <option value="">${this._escape(MESSAGES.vehicleModelDefault)}</option>
                            </select>
                        </div>
                        <div class="cs-car-selection-field">
                            <select class="cs-car-selection-dropdown cs-ugc-vehicle-tier" data-vehicle-tier="generation" aria-label="${this._escapeAttr(MESSAGES.vehicleGenerationDefault)}" disabled>
                                <option value="">${this._escape(MESSAGES.vehicleGenerationDefault)}</option>
                            </select>
                        </div>
                    </div>
                </div>`;
    }

    /**
     * Read a tier <select> from a vehicle container.
     * @param {HTMLElement} container
     * @param {string} tier - 'make' | 'model' | 'generation'.
     * @returns {HTMLSelectElement|null}
     */
    _tierSelect(container, tier) {
        return container ? container.querySelector(`[data-vehicle-tier="${tier}"]`) : null;
    }

    /**
     * Reset a tier <select> to its single placeholder option and disable it.
     * @param {HTMLSelectElement|null} select
     * @param {string} placeholder
     */
    _resetTier(select, placeholder) {
        if (!select) {
            return;
        }
        select.innerHTML = `<option value="">${this._escape(placeholder)}</option>`;
        select.disabled = true;
    }

    /**
     * Append an <option> to a tier <select> and enable it. Optional dataset entries
     * carry the generation's fitment_id + full-canonical label for submit-read.
     * @param {HTMLSelectElement} select
     * @param {string} value
     * @param {string} text
     * @param {Object} [data]
     */
    _addTierOption(select, value, text, data) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        if (data) {
            Object.keys(data).forEach((key) => { option.dataset[key] = data[key]; });
        }
        select.appendChild(option);
        select.disabled = false;
    }

    /**
     * Repopulate the model tier from the chosen make (and clear generation), or
     * repopulate the generation tier from the chosen model. Mirrors the add-to-cart
     * cascade: a single option auto-selects, and the newest generation (first in
     * the tree's descending order) auto-selects, in turn cascading downward.
     * @param {HTMLElement} container
     * @param {string} tier - the tier that just changed ('make' | 'model').
     */
    _populateWaterfall(container, tier) {
        const makeSelect = this._tierSelect(container, 'make');
        const modelSelect = this._tierSelect(container, 'model');
        const generationSelect = this._tierSelect(container, 'generation');

        if (tier === 'make') {
            this._resetTier(modelSelect, MESSAGES.vehicleModelDefault);
            this._resetTier(generationSelect, MESSAGES.vehicleGenerationDefault);

            const make = this.fitmentTree.find(m => m.slug === makeSelect.value);
            if (!make) {
                return;
            }

            make.models.forEach((model) => {
                this._addTierOption(modelSelect, model.slug, model.label);
            });

            if (make.models.length === 1) {
                modelSelect.value = make.models[0].slug;
                this._populateWaterfall(container, 'model');
            }
            return;
        }

        // tier === 'model'
        this._resetTier(generationSelect, MESSAGES.vehicleGenerationDefault);

        const make = this.fitmentTree.find(m => m.slug === makeSelect.value);
        const model = make ? make.models.find(mo => mo.slug === modelSelect.value) : null;
        if (!model) {
            return;
        }

        model.generations.forEach((generation) => {
            const value = generation.fitment_id === null ? '' : String(generation.fitment_id);
            this._addTierOption(generationSelect, value, generation.label, {
                vehicleLabel: generation.vehicleLabel,
            });
        });

        // Auto-select the newest generation (first in the descending-sorted list),
        // matching the add-to-cart picker.
        if (model.generations.length) {
            const newest = model.generations[0];
            generationSelect.value = newest.fitment_id === null ? '' : String(newest.fitment_id);
        }
    }

    /**
     * Pre-fill the waterfall from the visitor's garage vehicle when it is one of
     * the archetype's fitments (SRS §3.4.1, issue #41 — reuses the garage slug
     * match). Each tier is set and its dependents cascaded. No-op when there is no
     * garage match — the cascade then waits on the first user pick.
     * @param {HTMLElement} container
     */
    _prefillWaterfall(container) {
        const garage = this._garageVehicle();
        if (!garage) {
            return;
        }

        const makeSelect = this._tierSelect(container, 'make');
        const modelSelect = this._tierSelect(container, 'model');
        const generationSelect = this._tierSelect(container, 'generation');
        if (!makeSelect) {
            return;
        }

        makeSelect.value = garage.make;
        this._populateWaterfall(container, 'make');
        if (makeSelect.value !== garage.make) {
            return;
        }

        modelSelect.value = garage.model;
        this._populateWaterfall(container, 'model');
        if (modelSelect.value !== garage.model) {
            return;
        }

        // _populateWaterfall already auto-selected the newest generation; override
        // it with the garage generation when present.
        generationSelect.value = generationSelect.querySelector(`option[value="${garage.fitmentValue}"]`)
            ? garage.fitmentValue
            : generationSelect.value;
    }

    /**
     * Resolve the visitor's garage selection to bare make/model/generation slugs
     * plus the matching archetype fitment's id-as-string, but ONLY when the garage
     * vehicle is one of this archetype's fitments (SRS §3.4.1). Null otherwise.
     * @returns {{make: string, model: string, generation: string, fitmentValue: string}|null}
     */
    _garageVehicle() {
        if (!this.globalStateManager) {
            return null;
        }

        const state = this.globalStateManager.getState();
        const vehicle = state && state.vehicle ? state.vehicle.selected : null;
        if (!vehicle || !vehicle.make || !vehicle.model || !vehicle.generation) {
            return null;
        }

        const match = this.archetypeFitments.find(
            fitment => fitment.make === vehicle.make
                && fitment.model === vehicle.model
                && fitment.generation === vehicle.generation,
        );
        if (!match) {
            return null;
        }

        return {
            make: vehicle.make,
            model: vehicle.model,
            generation: vehicle.generation,
            fitmentValue: match.fitment_id === null ? '' : String(match.fitment_id),
        };
    }

    onReviewVehicleChange(event) {
        this._onVehicleTierChange(this.reviewVehicleElement, event);
    }

    onQuestionVehicleChange(event) {
        this._onVehicleTierChange(this.questionVehicleElement, event);
    }

    /**
     * Cascade handler for a waterfall tier change: a make change repopulates
     * models + generations; a model change repopulates generations. A generation
     * change needs no cascade (SRS §3.4.1).
     * @param {HTMLElement} container
     * @param {Event} event
     */
    _onVehicleTierChange(container, event) {
        const select = event.target.closest('[data-vehicle-tier]');
        if (!container || !select || !container.contains(select)) {
            return;
        }

        const tier = select.dataset.vehicleTier;
        if (tier === 'make' || tier === 'model') {
            this._populateWaterfall(container, tier);
        }
    }

    /**
     * Read the chosen structured vehicle off a submission modal (SRS §3.4.1,
     * issue #41). Returns { fitment_id, vehicle_label } when a vehicle is resolved,
     * or null when none is chosen. The verified review path returns the stashed
     * silent-attach; the waterfall path reads the selected generation <option>. A
     * non-positive / unparseable fitment_id resolves to null (un-filterable
     * generation, never attached).
     * @param {string} kind - 'review' | 'question'.
     * @returns {{fitment_id: number, vehicle_label: string}|null}
     */
    _readVehicleSelection(kind) {
        if (kind === 'review' && this.verifiedSilentVehicle) {
            return this.verifiedSilentVehicle;
        }

        const container = kind === 'review' ? this.reviewVehicleElement : this.questionVehicleElement;
        const generationSelect = this._tierSelect(container, 'generation');
        if (!generationSelect) {
            return null;
        }

        const option = generationSelect.options[generationSelect.selectedIndex];
        const fitmentId = parseInt(generationSelect.value, 10);
        if (Number.isNaN(fitmentId) || fitmentId <= 0) {
            return null;
        }

        const label = option ? option.dataset.vehicleLabel : '';
        return { fitment_id: fitmentId, vehicle_label: label || '' };
    }

    /**
     * Whether the modal's vehicle waterfall is required but unsatisfied (SRS
     * §3.4.1, issue #41). True only for the non-verified review waterfall with no
     * generation chosen — Q&A is optional, the verified silent-attach has no UI,
     * and universal products have no waterfall.
     * @param {string} kind - 'review' | 'question'.
     * @returns {boolean}
     */
    _vehicleRequiredUnmet(kind) {
        const container = kind === 'review' ? this.reviewVehicleElement : this.questionVehicleElement;
        if (!container || !container.querySelector('[data-vehicle-required]')) {
            return false;
        }
        return this._readVehicleSelection(kind) === null;
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

        // The non-verified review waterfall is required (SRS §3.4.1, issue #41):
        // block submit until a generation is chosen. The verified silent-attach,
        // Q&A, and universal paths never set this.
        if (this._vehicleRequiredUnmet('review')) {
            this._setError(modal, MESSAGES.vehicleRequiredError);
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

            // The token's authoritative fitment (SRS §3.2.8) is attached
            // silently for the verified reviewer — no vehicle UI is shown
            // (§3.4.1, issue #41). null when the purchased alias had no
            // resolvable fitment — then the verified reviewer falls through
            // to the waterfall path.
            const data = result.data || {};
            const fitmentId = parseInt(data.fitment_id, 10);
            this.verifiedFitmentId = (!Number.isNaN(fitmentId) && fitmentId > 0)
                ? fitmentId
                : null;
        }

        // Arrived from the email's tokenized review link — take the customer
        // straight to writing. Done after validate resolves so the modal's
        // vehicle section reflects verified (silent attach) vs unverified
        // (waterfall); opened regardless of validity, since an expired token
        // still means they came to leave a review (just unverified).
        this._openReviewSubmissionFromToken();
    }

    /**
     * Activate the reviews tab and open the submission modal, for a visitor who
     * landed via the tokenized email link (SRS §3.2.8). The tab is switched the
     * same way a click does (mirrors tabDeepLink), so closing the modal leaves
     * them on the reviews tab rather than the description. No-op when the page
     * has no review modal (e.g. a questions-only layout).
     */
    _openReviewSubmissionFromToken() {
        if (!this.reviewModalElement) {
            return;
        }

        const reviewsTab = document.querySelector('ul.tabs a[href="#tab-reviews"]');
        if (reviewsTab) {
            reviewsTab.click();
        }

        this.openModal(this.reviewModalElement, this.reviewFormElement);
        // Mirror onReviewOpenClick: the modal opened here programmatically (not via
        // the open-button click) must still mount the Turnstile widget. Verified
        // purchasers are not exempt — the API requires cf_turnstile_token on every
        // submission, validating it before the token (SRS §3.2.6, §3.4.5, cs-ugc#257).
        this.renderTurnstile('review');
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
     * fields (`alias_id`, `fitment_id` + `vehicle_label`, `ugc_token`) are included
     * only when present so the API receives a clean body; the honeypot `website`
     * and `cf_turnstile_token` are always sent. The structured vehicle (SRS §3.4.1,
     * issue #41) rides along as `fitment_id` + its full-canonical `vehicle_label`:
     * the verified silent-attach always provides one; the non-verified review
     * waterfall is required (so one is always present by the time submit runs);
     * Q&A/universal omit it when none is chosen. Never a typed string. On the
     * verified path the server overrides `fitment_id` from the token regardless
     * (§3.2.4). A held verified-purchaser token rides along as `ugc_token`.
     * Confirmed media (SRS §3.4.4) rides as the ordered `media_urls` array — index
     * = sort_order — omitted when no files were attached.
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

        const vehicle = this._readVehicleSelection('review');
        if (vehicle) {
            payload.fitment_id = vehicle.fitment_id;
            if (vehicle.vehicle_label) {
                payload.vehicle_label = vehicle.vehicle_label;
            }
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
     * Questions have no token path, so the structured vehicle (SRS §3.4.1) is
     * always the archetype-constrained waterfall's choice — `fitment_id` + its
     * full-canonical `vehicle_label`, sent only when a vehicle is chosen (Q&A is
     * optional).
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

        const vehicle = this._readVehicleSelection('question');
        if (vehicle) {
            payload.fitment_id = vehicle.fitment_id;
            if (vehicle.vehicle_label) {
                payload.vehicle_label = vehicle.vehicle_label;
            }
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
     * flat object keyed by field name (rating/title/body/author/website); absent
     * fields resolve to ''. The vehicle is captured by the structured section
     * (SRS §3.4.1), NOT a free-text field, so it is read separately on submit.
     * @param {HTMLFormElement} form
     * @returns {Object}
     */
    _readFields(form) {
        const fields = {};
        if (!form) {
            return fields;
        }

        const names = ['rating', 'title', 'body', 'author', 'website'];
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

        // A garage/registry change arrived mid-init — its refetch was deferred
        // (Slice A review nit). Run it now against the latest fitment.
        if (this.pendingReviewsFitmentRefetch) {
            this.pendingReviewsFitmentRefetch = false;
            this.query.page = 1;
            this.fetchReviews();
        }
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
        const fitment = this._fitmentParams();
        return {
            page: this.query.page,
            sort: this.query.sort,
            rating: this.query.rating,
            verified: this.query.verified,
            media: this.query.media,
            fitment_id: fitment.fitment_id,
            fitment_only: fitment.fitment_only,
        };
    }

    /**
     * Resolve the `fitment_id` + `fitment_only` to send on a list fetch. An
     * active click-filter (a clicked review/question vehicle, issue #45) wins —
     * it hard-filters at that fitment. Otherwise the garage fitment drives the
     * query, with `fitment_only` gated on a resolved id (Slice A review nit: the
     * API requires `fitment_id` for `fitment_only`, so never send the flag
     * without one).
     * @returns {{fitment_id: number|null, fitment_only: boolean|null}}
     */
    _fitmentParams() {
        if (this.clickFilterId !== null) {
            return { fitment_id: this.clickFilterId, fitment_only: true };
        }

        const fitmentOnly = (this.fitmentOnly && this.fitmentId !== null) ? true : null;
        return { fitment_id: this.fitmentId, fitment_only: fitmentOnly };
    }

    renderPage(data) {
        this.total = Number.isFinite(data.total) ? data.total : 0;
        this.perPage = Number.isFinite(data.per_page) ? data.per_page : 0;
        this.query.page = Number.isFinite(data.page) ? data.page : this.query.page;

        // Pre-filter match count for the garage fitment (SRS §3.2.1) — drives
        // the reviews "For your <vehicle>" chip's show-at->0 rule.
        this.fitmentReviewCount = Number.isFinite(data.fitment_review_count)
            ? data.fitment_review_count
            : 0;
        this.renderFitmentChip('reviews');

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
     * Local StateManager subscriber. Re-paints the cached summary so the block
     * stays consistent across re-renders and tracks the selected alias's
     * `qty_alias_index` so it rides on submissions as `alias_id` (provenance;
     * SRS §3.1.4). No fetch is triggered here — the fitment filter is driven by
     * the GLOBAL garage state, not the locally-selected alias.
     * @param {Object} [state] - The local StateManager snapshot.
     */
    update(state) {
        if (this.summaryPainted) {
            this.renderSummary();
        }

        this.aliasIndex = this._resolveAliasIndex(state);
    }

    /**
     * Subscribe to the global garage state and resolve the garage vehicle to its
     * QTY `fitment_id` (SRS §3.4.1). Reads the persisted garage selection
     * (`vehicle.selected`) and the search-JSON `vehicle_registry`
     * (`search.data.vehicle_registry`) off the GlobalStateManager and resolves
     * via the shared vehicleFitment resolver. Runs once synchronously to seed
     * the initial fetches, then on every global state change so a late-arriving
     * registry or a garage swap re-resolves. Absent GlobalStateManager (tests
     * with no garage) leaves `fitmentId` null — the lists carry no `fitment_id`
     * and no chip renders.
     */
    subscribeGlobalFitment() {
        if (!this.globalStateManager) {
            return;
        }

        this.resolveFitmentFromGlobal(this.globalStateManager.getState());
        this.unsubscribeGlobal = this.globalStateManager.subscribe(
            globalState => this.onGlobalFitmentChange(globalState),
        );
    }

    /**
     * Resolve and store the garage fitment from a global state snapshot, WITHOUT
     * refetching. Used to seed state before the initial fetch.
     * @param {Object} [globalState]
     */
    resolveFitmentFromGlobal(globalState) {
        const resolved = resolveGarageFitmentFromState(globalState);
        this.fitmentId = resolved ? resolved.fitment_id : null;
        this.fitmentLabel = resolved ? resolved.label : null;
    }

    /**
     * Global state changed. Re-resolve the garage fitment; if the resolved
     * `fitment_id` changed (garage swap, or the registry arriving and resolving
     * a previously-unresolvable selection), drop any active hard-filter and
     * refetch both loaded lists from page 1 so the envelopes return fresh
     * `fitment_*_count` values and the chip re-renders (SRS §3.4.1).
     * @param {Object} [globalState]
     */
    onGlobalFitmentChange(globalState) {
        const previousId = this.fitmentId;
        this.resolveFitmentFromGlobal(globalState);

        if (this.fitmentId === previousId) {
            return;
        }

        // The new vehicle's chip starts unselected — the honest default is the
        // unfiltered newest-first view (SRS §3.4.1). A garage swap is a fresh
        // vehicle context, so also drop any active click-to-filter takeover
        // (issue #45) rather than leaving the view pinned to a clicked vehicle.
        this.fitmentOnly = false;
        this.clickFilterId = null;
        this.clickFilterLabel = null;

        // Before a list has loaded, the in-flight init fetch already captured the
        // prior params — defer the refetch until init completes rather than drop
        // it (Slice A review nit).
        if (this.reviewsLoaded) {
            this.query.page = 1;
            this.fetchReviews();
        } else {
            this.pendingReviewsFitmentRefetch = true;
        }

        if (this.questionsLoaded) {
            this.questionQuery.page = 1;
            this.fetchQuestions();
        } else {
            this.pendingQuestionsFitmentRefetch = true;
        }
    }

    /**
     * Toggle the "For your <vehicle>" hard filter (SRS §3.4.1). A click on an
     * inactive chip turns `fitment_only` on; a click on the clear control turns
     * it off. Either way both loaded lists refetch from page 1, composing with
     * the active sort/rating/verified/media. No-op when the chip isn't actually
     * shown (no resolved fitment).
     * @param {Event} event
     */
    onFitmentChipClick(event) {
        // "Select your vehicle to filter" prompt (shown when no vehicle is
        // resolved) — scroll to the make/model/generation picker so the visitor
        // can set one, which then resolves the garage fitment and the chip.
        if (event.target.closest('[data-fitment-prompt]')) {
            event.preventDefault();
            this._scrollToVehiclePicker();
            return;
        }

        const trigger = event.target.closest('[data-fitment-chip-toggle], [data-fitment-chip-clear]');
        if (!trigger) {
            return;
        }

        event.preventDefault();

        const isClear = trigger.dataset.fitmentChipClear !== undefined;

        // Clearing while a clicked-vehicle filter is active drops back to the
        // default view — the garage chip reappears (issue #45).
        if (isClear && this.clickFilterId !== null) {
            this.clickFilterId = null;
            this.clickFilterLabel = null;
            this.fitmentOnly = false;
            this._refilter();
            return;
        }

        // Garage chip toggle — needs a resolved garage fitment.
        if (this.fitmentId === null) {
            return;
        }

        const nextOnly = !isClear;
        if (nextOnly === this.fitmentOnly) {
            return;
        }

        this.fitmentOnly = nextOnly;
        this._refilter();
    }

    /**
     * Scroll the make/model/generation picker into view (and focus Make) from
     * the "Select your vehicle to filter" prompt. Selecting a vehicle there
     * drives the global garage state, which resolves the fitment and swaps the
     * prompt for the live chip. No-op if the picker is absent.
     */
    _scrollToVehiclePicker() {
        const make = document.querySelector('[data-product-option="make"]');
        if (!make) {
            return;
        }

        if (typeof make.scrollIntoView === 'function') {
            make.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        if (!make.disabled) {
            make.focus({ preventScroll: true });
        }
    }

    /**
     * Smoothly align a list section's header to the top of the viewport after a
     * page change. No-op when the anchor is absent or scrollIntoView is
     * unavailable (jsdom).
     * @param {Element} element - The section anchor (its toolbar).
     */
    _scrollSectionToTop(element) {
        if (element && typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    /**
     * Filter both lists to a clicked review/question vehicle (issue #45). The
     * badge carries the review's own `fitment_id` (SRS §3.2.1) — guaranteed
     * present whenever the badge renders, since `vehicle_label` is null whenever
     * `fitment_id` is. Clicking the visitor's own garage vehicle just activates
     * the garage chip rather than a redundant "Showing:" takeover.
     * @param {Event} event
     */
    onVehicleBadgeClick(event) {
        const badge = event.target.closest('[data-fitment-filter]');
        if (!badge) {
            return;
        }

        event.preventDefault();

        const fitmentId = parseInt(badge.dataset.fitmentFilter, 10);
        if (!Number.isInteger(fitmentId) || fitmentId <= 0) {
            return;
        }

        if (fitmentId === this.fitmentId) {
            this.clickFilterId = null;
            this.clickFilterLabel = null;
            this.fitmentOnly = true;
        } else {
            this.clickFilterId = fitmentId;
            this.clickFilterLabel = badge.dataset.fitmentLabel || '';
        }

        this._refilter();

        // The filter resets the list to page 1, so the reader would otherwise be
        // stranded mid-list — bring the clicked card's section header into view,
        // matching the bottom page controls' scroll.
        const anchor = badge.classList.contains('cs-question-vehicle')
            ? this.questionsToolbarElement
            : this.toolbarElement;
        this._scrollSectionToTop(anchor);
    }

    /**
     * Re-render both fitment chips and refetch both loaded lists from page 1
     * under the current fitment filter (garage toggle or click-filter, issue
     * #45). Composes with the active sort/rating/verified/media.
     */
    _refilter() {
        this.renderFitmentChip('reviews');
        this.renderFitmentChip('questions');

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
     * Render (or hide) a list's fitment chip (SRS §3.4.1). Shows the
     * "For your <vehicle>" chip only when the matching pre-filter count is > 0
     * (which is also 0 on universal products / unresolved fitment). When the
     * hard filter is active the chip carries a selected state plus a clear
     * control. Space is reserved in SCSS, so toggling visibility never shifts
     * the toolbar.
     * @param {string} kind - 'reviews' | 'questions'.
     */
    renderFitmentChip(kind) {
        const container = kind === 'questions'
            ? this.questionsFitmentChipElement
            : this.reviewsFitmentChipElement;
        if (!container) {
            return;
        }

        // An active click-filter (a clicked review/question vehicle, issue #45)
        // takes over the slot with a "Showing: <vehicle>" label + clear control,
        // replacing the garage chip until cleared. Shown regardless of count —
        // it is an explicit choice, not the count-gated discovery affordance.
        if (this.clickFilterId !== null) {
            const showing = this._escape(showingChipLabel(this.clickFilterLabel));
            const clearControl = `<button type="button" class="cs-fitment-chip-clear" data-fitment-chip-clear aria-label="${this._escapeAttr(MESSAGES.fitmentChipClear)}">&times;</button>`;
            container.innerHTML = `<span class="cs-fitment-showing">${showing}</span>${clearControl}`;
            container.style.visibility = 'visible';
            return;
        }

        // No garage vehicle resolved yet. On a fitment-capable product, prompt
        // the visitor to pick one so the filter becomes available; on a universal
        // product (no archetype fitments) there is nothing to filter, so stay
        // hidden. The prompt scrolls to the make/model/generation picker on click.
        if (this.fitmentId === null) {
            if (this.archetypeFitments.length > 0) {
                container.innerHTML = `<button type="button" class="cs-fitment-prompt" data-fitment-prompt>${this._escape(MESSAGES.fitmentPrompt)}</button>`;
                container.style.visibility = 'visible';
            } else {
                container.innerHTML = '';
                container.style.visibility = 'hidden';
            }
            return;
        }

        // Garage vehicle resolved but with no matching items on this product —
        // surface a passive "No reviews yet for your <vehicle>" status so the
        // absent filter chip is explained rather than silently missing.
        const count = kind === 'questions' ? this.fitmentQuestionCount : this.fitmentReviewCount;
        if (count <= 0) {
            const noun = kind === 'questions' ? 'questions' : 'reviews';
            const message = this._escape(noFitmentMatchLabel(this.fitmentLabel, noun));
            container.innerHTML = `<span class="cs-fitment-empty">${message}</span>`;
            container.style.visibility = 'visible';
            return;
        }

        const label = this._escape(fitmentChipLabel(this.fitmentLabel));
        const active = this.fitmentOnly;
        const activeClass = active ? ' is-active' : '';
        const pressed = active ? 'true' : 'false';
        const clear = active
            ? `<button type="button" class="cs-fitment-chip-clear" data-fitment-chip-clear aria-label="${this._escapeAttr(MESSAGES.fitmentChipClear)}">&times;</button>`
            : '';

        container.innerHTML = `<button type="button" class="cs-fitment-chip${activeClass}" data-fitment-chip-toggle aria-pressed="${pressed}"><span class="cs-fitment-chip-label">${label}</span><span class="cs-fitment-chip-count">${count}</span></button>${clear}`;
        container.style.visibility = 'visible';
    }

    /**
     * Pull the published alias index (SRS §3.1.4 `qty_alias_index`) off the
     * selected alias and normalize it to an integer, or null when no alias is
     * selected / the field is absent or non-numeric. Retained as nullable
     * provenance — it rides on submissions as `alias_id` (the former
     * `sort_alias` relevance sort was removed in M9).
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
        if (!button) {
            return;
        }

        event.preventDefault();

        const page = parseInt(button.dataset.reviewsPage, 10);
        if (Number.isNaN(page) || page === this.query.page) {
            return;
        }

        this.query.page = page;
        this.fetchReviews();

        // A page change from the bottom controls would otherwise strand the
        // reader at the foot of the new page — bring the list header into view.
        this._scrollSectionToTop(this.toolbarElement);
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

        // A garage/registry change arrived mid-init — its refetch was deferred
        // (Slice A review nit). Run it now against the latest fitment.
        if (this.pendingQuestionsFitmentRefetch) {
            this.pendingQuestionsFitmentRefetch = false;
            this.questionQuery.page = 1;
            this.fetchQuestions();
        }
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
        const fitment = this._fitmentParams();
        return {
            page: this.questionQuery.page,
            sort: this.questionQuery.sort,
            fitment_id: fitment.fitment_id,
            fitment_only: fitment.fitment_only,
        };
    }

    renderQuestionsPage(data) {
        this.questionTotal = Number.isFinite(data.total) ? data.total : 0;
        this.questionPerPage = Number.isFinite(data.per_page) ? data.per_page : 0;
        this.questionCount = this.questionTotal;
        this.questionQuery.page = Number.isFinite(data.page) ? data.page : this.questionQuery.page;

        // Pre-filter match count for the garage fitment (SRS §3.2.2) — drives
        // the Q&A "For your <vehicle>" chip's show-at->0 rule.
        this.fitmentQuestionCount = Number.isFinite(data.fitment_question_count)
            ? data.fitment_question_count
            : 0;
        this.renderFitmentChip('questions');

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
        if (!button) {
            return;
        }

        event.preventDefault();

        const page = parseInt(button.dataset.questionsPage, 10);
        if (Number.isNaN(page) || page === this.questionQuery.page) {
            return;
        }

        this.questionQuery.page = page;
        this.fetchQuestions();

        this._scrollSectionToTop(this.questionsToolbarElement);
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
        if (!this.questionsPaginationElements.length) {
            return;
        }

        const pageCount = this.questionPerPage > 0
            ? Math.ceil(this.questionTotal / this.questionPerPage)
            : 0;

        if (pageCount <= 1) {
            this._hidePagination(this.questionsPaginationElements);
            return;
        }

        const current = this.questionQuery.page;

        // Distinct accessible names per landmark (axe landmark-unique) — the two
        // navs are otherwise identical.
        this.questionsPaginationElements.forEach((el) => {
            const position = el.classList.contains('cs-questions-pagination--top') ? 'top' : 'bottom';
            el.innerHTML = renderPaginationNav({
                current,
                pageCount,
                pageClass: 'cs-questions-page',
                dataAttr: 'data-questions-page',
                navClass: 'cs-questions-pages',
                ariaLabel: `Questions pagination, ${position} of list`,
            });
            el.style.visibility = 'visible';
        });
    }

    renderQuestionsError() {
        if (this.questionsElement) {
            this.questionsElement.innerHTML = `<p class="cs-questions-error">${MESSAGES.questionsError}</p>`;
        }

        this._hidePagination(this.questionsPaginationElements);
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
        const date = formatReviewDate(question.date);
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
                ${vehicleBadge(question.vehicle_label, { modifier: 'cs-question-vehicle', fitmentId: question.fitment_id, clickable: true })}
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
        if (!this.paginationElements.length) {
            return;
        }

        const pageCount = this.perPage > 0 ? Math.ceil(this.total / this.perPage) : 0;

        if (pageCount <= 1) {
            this._hidePagination(this.paginationElements);
            return;
        }

        const current = this.query.page;

        // Distinct accessible names per landmark (axe landmark-unique) — the two
        // navs are otherwise identical.
        this.paginationElements.forEach((el) => {
            const position = el.classList.contains('cs-reviews-pagination--top') ? 'top' : 'bottom';
            el.innerHTML = renderPaginationNav({
                current,
                pageCount,
                pageClass: 'cs-reviews-page',
                dataAttr: 'data-reviews-page',
                navClass: 'cs-reviews-pages',
                ariaLabel: `Reviews pagination, ${position} of list`,
            });
            el.style.visibility = 'visible';
        });
    }

    _hidePagination(elements) {
        elements.forEach((el) => {
            el.innerHTML = '';
            el.style.visibility = 'hidden';
        });
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

        // If the lightbox is open on a navigable entry, the freshly appended
        // media extends the set — refresh the arrow disabled state so a
        // now-reachable neighbour isn't stranded until the next interaction.
        if (this.lightboxElement && !this.lightboxElement.hidden && this.lightboxIndex >= 0) {
            this._updateLightboxNav();
        }

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
            return;
        }

        if (event.target.closest('[data-ugc-lightbox-prev]')) {
            this._navLightbox(-1);
            return;
        }

        if (event.target.closest('[data-ugc-lightbox-next]')) {
            this._navLightbox(1);
        }
    }

    /**
     * Keyboard navigation while the lightbox is open: arrows step the photo
     * set, Escape closes. Bound on open, removed on close.
     * @param {KeyboardEvent} event
     */
    onLightboxKeydown(event) {
        switch (event.key) {
        case 'Escape':
            this.closeLightbox();
            break;
        case 'ArrowLeft':
            this._navLightbox(-1);
            break;
        case 'ArrowRight':
            this._navLightbox(1);
            break;
        default:
            break;
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
        // full owning review under the media, and enable prev/next to step the
        // photo set. Per-review strip tiles don't (their review is already on
        // screen), so they stay media-only with no arrows.
        let review = '';
        const index = dataset.ugcMediaIndex === undefined
            ? -1
            : parseInt(dataset.ugcMediaIndex, 10);
        const entry = index >= 0 ? this.gridMedia[index] : null;
        if (entry && entry.review) {
            review = `<div class="cs-ugc-lightbox-review">${this._buildReview(entry.review, false, false)}</div>`;
        }

        content.innerHTML = media + review;
        this.lightboxIndex = entry ? index : -1;
        this._updateLightboxNav();
        this.lightboxElement.hidden = false;
        document.addEventListener('keydown', this.onLightboxKeydown);
    }

    /**
     * Re-render the lightbox at another gridMedia entry (prev/next navigation):
     * its media plus the full owning review, mirroring an indexed-tile open.
     * @param {number} index - The target gridMedia index.
     */
    _renderLightboxEntry(index) {
        const content = this.lightboxElement
            ? this.lightboxElement.querySelector('[data-ugc-lightbox-content]')
            : null;
        const entry = this.gridMedia[index];
        if (!content || !entry) {
            return;
        }

        this.lightboxIndex = index;
        const review = `<div class="cs-ugc-lightbox-review">${this._buildReview(entry.review, false, false)}</div>`;
        content.innerHTML = this._buildLightboxMedia(entry.media, entry.review.author) + review;
        this._updateLightboxNav();
    }

    /**
     * Build the large lightbox media markup from a §3.2.1 media object (photo →
     * medium/url, video → url + poster). Mirrors the open-from-dataset path so
     * navigated and clicked media render identically.
     * @param {Object} media
     * @param {string} [author] - Owning review author, for the label.
     * @returns {string}
     */
    _buildLightboxMedia(media, author) {
        const source = author ? `${author}'s review` : 'a customer review';

        if (media.type === 'video') {
            const src = this._escapeAttr(media.url || '');
            const poster = media.poster_url ? ` poster="${this._escapeAttr(media.poster_url)}"` : '';
            const label = this._escapeAttr(`Video from ${source}`);
            return `<video class="cs-ugc-lightbox-video" src="${src}"${poster} controls autoplay playsinline aria-label="${label}"></video>`;
        }

        const src = this._escapeAttr(media.medium_url || media.url || '');
        const label = this._escapeAttr(`Photo from ${source}`);
        return `<img class="cs-ugc-lightbox-img" src="${src}" alt="${label}">`;
    }

    /**
     * Step the lightbox by delta through the gridMedia photo set, clamped to its
     * ends. No-op when the current view isn't navigable (per-review strip open).
     * @param {number} delta
     */
    _navLightbox(delta) {
        if (this.lightboxIndex < 0) {
            return;
        }

        const target = this.lightboxIndex + delta;
        if (target < 0 || target >= this.gridMedia.length) {
            return;
        }

        this._renderLightboxEntry(target);
    }

    /**
     * Show/hide the prev/next arrows and set their disabled state for the
     * current position. Arrows appear only for a navigable entry with more than
     * one photo in the set.
     */
    _updateLightboxNav() {
        if (!this.lightboxElement) {
            return;
        }

        const prev = this.lightboxElement.querySelector('[data-ugc-lightbox-prev]');
        const next = this.lightboxElement.querySelector('[data-ugc-lightbox-next]');
        if (!prev || !next) {
            return;
        }

        const navigable = this.lightboxIndex >= 0 && this.gridMedia.length > 1;
        prev.hidden = !navigable;
        next.hidden = !navigable;

        if (navigable) {
            prev.disabled = this.lightboxIndex <= 0;
            next.disabled = this.lightboxIndex >= this.gridMedia.length - 1;
        }
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
        this.lightboxIndex = -1;
        document.removeEventListener('keydown', this.onLightboxKeydown);
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

        this._hidePagination(this.paginationElements);

        // The reviews list is unavailable, so hide the overview panel with it
        // and re-arm the gallery load for the next successful render.
        this.gridMedia = [];
        this.galleryRequested = false;
        this.galleryPagesFetched = 0;
        this.galleryExhausted = false;
        this._paintMediaGrid();
    }

    _buildStars(average) {
        return `<span class="cs-rating-stars" role="img" aria-label="${average} out of ${MAX_STARS} stars">${starIcons(Math.round(average))}</span>`;
    }

    _countLabel(count) {
        return count === 1 ? '1 review' : `${count} reviews`;
    }

    _buildReview(review, includeMedia = true, clickableVehicle = true) {
        const author = this._escape(review.author) || MESSAGES.anonymous;
        const title = this._escape(review.title);
        const body = this._escape(review.body);
        const date = formatReviewDate(review.date);
        const verified = verifiedBadge(review.verified_purchaser);
        // Public disclosure that staff edited this review's content (SRS §3.2.1
        // `edited` / §3.1.1, cs-ugc #145). Strict `=== true` so a missing field
        // on an older payload is treated as false and nothing renders — the card
        // must never break on an absent flag, and it never reveals who edited or
        // how many times (only the derived boolean is exposed).
        const edited = editedBadge(review.edited);
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
                    ${scoreBadge(review.rating || 0)}
                    ${title ? `<h3 class="cs-review-title">${title}</h3>` : ''}
                </div>
                <p class="cs-review-meta">
                    <span class="cs-review-author">${author}</span>
                    ${countryFlag(review.country)}
                    ${verified}
                    ${edited}
                </p>
                ${vehicleBadge(review.vehicle_label, { modifier: 'cs-review-vehicle', fitmentId: review.fitment_id, clickable: clickableVehicle })}
                <p class="cs-review-body">${body}</p>
                ${media}
                ${staff}
            </article>`;
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
        if (this.unsubscribeGlobal) this.unsubscribeGlobal();

        if (this.gridResizeObserver) {
            this.gridResizeObserver.disconnect();
        }

        if (this.toolbarElement) {
            this.toolbarElement.removeEventListener('change', this.onToolbarChange);
        }

        this.paginationElements.forEach((el) => {
            el.removeEventListener('click', this.onPaginationClick);
        });

        if (this.questionsToolbarElement) {
            this.questionsToolbarElement.removeEventListener('change', this.onQuestionsToolbarChange);
        }

        this.questionsPaginationElements.forEach((el) => {
            el.removeEventListener('click', this.onQuestionsPaginationClick);
        });

        if (this.reviewsFitmentChipElement) {
            this.reviewsFitmentChipElement.removeEventListener('click', this.onFitmentChipClick);
        }

        if (this.questionsFitmentChipElement) {
            this.questionsFitmentChipElement.removeEventListener('click', this.onFitmentChipClick);
        }

        if (this.listElement) {
            this.listElement.removeEventListener('click', this.onMediaTileClick);
            this.listElement.removeEventListener('click', this.onVehicleBadgeClick);
        }

        if (this.questionsElement) {
            this.questionsElement.removeEventListener('click', this.onVehicleBadgeClick);
        }

        if (this.mediaGridElement) {
            this.mediaGridElement.removeEventListener('click', this.onMediaTileClick);
        }

        if (this.lightboxElement) {
            this.lightboxElement.removeEventListener('click', this.onLightboxClick);
        }

        document.removeEventListener('keydown', this.onLightboxKeydown);

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

        if (this.reviewVehicleElement) {
            this.reviewVehicleElement.removeEventListener('change', this.onReviewVehicleChange);
        }

        if (this.questionVehicleElement) {
            this.questionVehicleElement.removeEventListener('change', this.onQuestionVehicleChange);
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
