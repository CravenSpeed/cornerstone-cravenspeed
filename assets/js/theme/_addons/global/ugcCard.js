/**
 * @file ugcCard
 * @description Shared, pure card-rendering primitives for the UGC surfaces — the
 * product reviews/Q&A lists (ugcProduct.js) and the home overview wall
 * (ugcOverview.js). Each returns an HTML-string fragment and emits the same
 * class names the product stylesheet already styles (cs-review-score / -flag /
 * -verified / -edited / -date), so both surfaces render these bits identically
 * from one source of truth (cs-ugc SRS §3.2.1, §3.4.1, §3.4.2).
 *
 * None of these escape free-text: star/score/verified/edited render fixed markup
 * or numbers, the country code is validated to `[a-z]{2}` before interpolation,
 * and the date is machine-formatted. Callers escape any free-text upstream. The
 * exception is `vehicleBadge`, which takes a free-text `label` and escapes it
 * internally (both its text and attribute contexts).
 */

import { escapeHtml } from './search/utils';

export const MAX_STARS = 5;

/**
 * The inner sprite-star spans for a whole-star count, split at `count` full
 * stars. Returns only the icons — callers wrap them in their own labelled
 * container. The sprite (#icon-star) is injected globally in layout/base.html.
 * @param {number} count - Whole filled stars, 0-5.
 * @returns {string}
 */
export function starIcons(count) {
    let stars = '';

    for (let i = 1; i <= MAX_STARS; i += 1) {
        const modifier = i <= count ? 'ratingFull' : 'ratingEmpty';
        stars += `<span class="icon icon--${modifier}"><svg><use href="#icon-star" /></svg></span>`;
    }

    return stars;
}

/**
 * The numeric-score pill that sits beside the stars.
 * @param {number} rating - The whole-star rating.
 * @returns {string}
 */
export function scoreBadge(rating) {
    return `<span class="cs-review-score">${rating}</span>`;
}

/**
 * The "Verified Purchaser" chip (SRS §3.2.1 `verified_purchaser`). Empty string
 * when the review is not a verified purchase.
 * @param {boolean} isVerified
 * @returns {string}
 */
export function verifiedBadge(isVerified) {
    return isVerified
        ? '<span class="cs-review-verified">Verified Purchaser</span>'
        : '';
}

/**
 * The staff-edit disclosure marker (SRS §3.2.1 `edited` / `edit_reason` / §3.1.1,
 * cs-ugc #145 / #305). Strict `=== true` so a missing flag on an older payload
 * renders nothing — the card must never break on an absent field, and it never
 * reveals who edited.
 *
 * `edit_reason` is a server-supplied, ready-to-display label (one of a fixed
 * enum) disclosing *why* the content was altered; it is `null` on reviews that
 * were never content-edited and absent on older payloads. When present it is
 * appended verbatim (no code→label mapping) after an em dash, escaped defensively
 * like `vehicleBadge`. A missing/null reason renders exactly as before.
 * @param {boolean} isEdited
 * @param {string|null} [reason] - The `edit_reason` label, or null/absent.
 * @returns {string}
 */
export function editedBadge(isEdited, reason) {
    if (isEdited !== true) {
        return '';
    }

    const suffix = reason ? ` — ${escapeHtml(reason)}` : '';
    return `<span class="cs-review-edited">Edited by CravenSpeed${suffix}</span>`;
}

/**
 * A small country flag from an ISO-3166 alpha-2 `country` (SRS §3.2.1, derived
 * server-side from the submission IP; null on imported/un-geolocated rows).
 * Served as SVG from flagcdn.com and lazy-loaded. Returns '' for any non
 * two-letter code, so older reviews simply show no flag. The code is validated
 * to `[a-z]{2}`, so it is safe to interpolate without further escaping.
 * @param {string} code
 * @returns {string}
 */
export function countryFlag(code) {
    if (typeof code !== 'string') {
        return '';
    }

    const cc = code.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(cc)) {
        return '';
    }

    const label = cc.toUpperCase();
    return `<img class="cs-review-flag" src="https://flagcdn.com/${cc}.svg" alt="${label}" title="${label}" loading="lazy">`;
}

/**
 * Format a review's ISO `date` as a localized MM/DD/YYYY string. Returns '' for
 * an empty or unparseable value so the card simply shows no date.
 * @param {string} value
 * @returns {string}
 */
export function formatReviewDate(value) {
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

/**
 * The structured-vehicle badge from a review's/question's system-generated
 * `vehicle_label` (SRS §3.2.4 — e.g. "MINI Cooper F56 2014 to 2024"). A null /
 * empty label renders nothing (no empty element to reserve space for), so a
 * universal product or an opted-out submitter simply has no badge.
 *
 * Unlike the sibling primitives, the label is free text, so it is escaped here:
 * `escapeHtml` covers `& < > " '`, making the single escaped value safe for both
 * the text content and the `data-fitment-label` attribute.
 *
 * When `clickable` is set and `fitmentId` resolves to a positive integer, the
 * badge is a `<button data-fitment-filter>` that drives the click-to-filter
 * interaction (issue #45); otherwise it is a static `<p>`.
 * @param {string|null|undefined} label - The system-generated `vehicle_label`.
 * @param {Object} [options]
 * @param {string} [options.modifier] - Surface-specific class (e.g. cs-review-vehicle).
 * @param {number|string|null} [options.fitmentId] - The item's `fitment_id`.
 * @param {boolean} [options.clickable] - Whether the badge filters on click.
 * @returns {string}
 */
export function vehicleBadge(label, { modifier = '', fitmentId = null, clickable = false } = {}) {
    if (!label) {
        return '';
    }

    const safe = escapeHtml(label);
    const id = parseInt(fitmentId, 10);
    if (clickable && Number.isInteger(id) && id > 0) {
        return `<button type="button" class="cs-ugc-vehicle-badge ${modifier}" data-fitment-filter="${id}" data-fitment-label="${safe}">${safe}</button>`;
    }

    return `<p class="cs-ugc-vehicle-badge ${modifier}">${safe}</p>`;
}
