/**
 * Deep-link support for the product page tabs (#tab-reviews, #tab-shipping…).
 *
 * Foundation 5's own `deep_linking` option is enabled in global/foundation.js
 * but never fires on this theme: its hash handler requires the panes to be
 * `.content` inside `.tabs-content` (foundation.tab.js handle_location_hash_change),
 * while the custom product tabs use `.tab-content` inside `.tabs-contents`.
 * Clicking works (that path has no class checks), so this util resolves the
 * location hash to the matching tab link and clicks it — same code path the
 * user takes — then scrolls the tab strip into view.
 */

const HASH_PATTERN = /^#[\w-]+$/;

function activateTabFromHash() {
    const { hash } = window.location;

    if (!hash || !HASH_PATTERN.test(hash)) {
        return;
    }

    const link = document.querySelector(`ul.tabs a[href="${hash}"]`);

    if (!link || link.closest('.tab').classList.contains('is-active')) {
        return;
    }

    link.click();

    const pane = document.querySelector(hash);
    if (pane) {
        pane.scrollIntoView();
    }
}

/**
 * Activate the tab referenced by the current location hash (direct links)
 * and keep doing so on in-page hash changes (e.g. the rating summary's
 * #tab-reviews anchor).
 */
export default function initTabDeepLink() {
    activateTabFromHash();
    window.addEventListener('hashchange', activateTabFromHash);
}
