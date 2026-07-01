import {
    MAX_STARS,
    starIcons,
    scoreBadge,
    verifiedBadge,
    editedBadge,
    countryFlag,
    formatReviewDate,
    vehicleBadge,
} from '../../../theme/_addons/global/ugcCard';

const countOf = (html, needle) => html.split(needle).length - 1;

describe('ugcCard shared primitives', () => {
    describe('starIcons', () => {
        it('renders five sprite stars split at the rating', () => {
            const html = starIcons(3);
            expect(countOf(html, 'icon--ratingFull')).toBe(3);
            expect(countOf(html, 'icon--ratingEmpty')).toBe(MAX_STARS - 3);
        });

        it('renders all empty stars for a zero rating', () => {
            const html = starIcons(0);
            expect(countOf(html, 'icon--ratingFull')).toBe(0);
            expect(countOf(html, 'icon--ratingEmpty')).toBe(MAX_STARS);
        });
    });

    describe('scoreBadge', () => {
        it('wraps the rating in the shared score class', () => {
            expect(scoreBadge(4)).toBe('<span class="cs-review-score">4</span>');
        });
    });

    describe('verifiedBadge', () => {
        it('renders the chip only for a verified purchase', () => {
            expect(verifiedBadge(true)).toContain('cs-review-verified');
            expect(verifiedBadge(false)).toBe('');
        });
    });

    describe('editedBadge', () => {
        it('renders only on a strict true (never on a missing/falsey flag)', () => {
            expect(editedBadge(true)).toContain('cs-review-edited');
            expect(editedBadge(false)).toBe('');
            expect(editedBadge(undefined)).toBe('');
            expect(editedBadge('true')).toBe('');
        });

        it('appends the edit_reason label verbatim when edited with a reason', () => {
            const html = editedBadge(true, 'Customer request');
            expect(html).toBe('<span class="cs-review-edited">Edited by CravenSpeed — Customer request</span>');
        });

        it('renders the bare marker when edited without a reason', () => {
            expect(editedBadge(true, null)).toBe('<span class="cs-review-edited">Edited by CravenSpeed</span>');
            expect(editedBadge(true, undefined)).toBe('<span class="cs-review-edited">Edited by CravenSpeed</span>');
            expect(editedBadge(true, '')).toBe('<span class="cs-review-edited">Edited by CravenSpeed</span>');
        });

        it('never renders when not edited, even if a reason is present', () => {
            expect(editedBadge(false, 'Customer request')).toBe('');
        });

        it('escapes the reason before interpolation', () => {
            const html = editedBadge(true, '<b>x</b> & "y"');
            expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
            expect(html).not.toContain('<b>');
        });
    });

    describe('countryFlag', () => {
        it('builds a flagcdn SVG from a valid alpha-2 code, case-insensitive', () => {
            const html = countryFlag('DE');
            expect(html).toContain('src="https://flagcdn.com/de.svg"');
            expect(html).toContain('cs-review-flag');
        });

        it('returns empty for non-string or non alpha-2 codes', () => {
            expect(countryFlag(null)).toBe('');
            expect(countryFlag('XYZ')).toBe('');
            expect(countryFlag('1')).toBe('');
            expect(countryFlag('')).toBe('');
        });
    });

    describe('formatReviewDate', () => {
        it('formats an ISO date as MM/DD/YYYY', () => {
            expect(formatReviewDate('2026-06-09T15:00:00')).toBe('06/09/2026');
        });

        it('returns empty for missing or unparseable values', () => {
            expect(formatReviewDate('')).toBe('');
            expect(formatReviewDate(null)).toBe('');
            expect(formatReviewDate('not-a-date')).toBe('');
        });
    });

    describe('vehicleBadge', () => {
        it('renders a static <p> with the modifier and escaped label by default', () => {
            const html = vehicleBadge('MINI Cooper F56', { modifier: 'cs-ugc-overview-vehicle' });
            expect(html).toContain('<p class="cs-ugc-vehicle-badge cs-ugc-overview-vehicle">');
            expect(html).toContain('MINI Cooper F56');
            expect(html).not.toContain('<button');
            expect(html).not.toContain('data-fitment-filter');
        });

        it('renders a clickable <button> with filter data for a positive fitmentId', () => {
            const html = vehicleBadge('MINI Cooper F56', {
                modifier: 'cs-review-vehicle', fitmentId: 42, clickable: true,
            });
            expect(html).toContain('<button type="button"');
            expect(html).toContain('data-fitment-filter="42"');
            expect(html).toContain('data-fitment-label="MINI Cooper F56"');
        });

        it('falls back to a static <p> when clickable but the fitmentId is missing or not positive', () => {
            expect(vehicleBadge('MINI Cooper F56', { clickable: true, fitmentId: null })).toContain('<p');
            expect(vehicleBadge('MINI Cooper F56', { clickable: true, fitmentId: 0 })).toContain('<p');
            expect(vehicleBadge('MINI Cooper F56', { clickable: true, fitmentId: -1 })).toContain('<p');
            expect(vehicleBadge('MINI Cooper F56', { clickable: true, fitmentId: 'nope' })).toContain('<p');
        });

        it('returns empty for a null / undefined / empty label', () => {
            expect(vehicleBadge(null)).toBe('');
            expect(vehicleBadge(undefined)).toBe('');
            expect(vehicleBadge('')).toBe('');
        });

        it('escapes the label internally (no XSS via vehicle_label)', () => {
            const html = vehicleBadge('<img src=x onerror=alert(1)>', {
                fitmentId: 7, clickable: true,
            });
            expect(html).not.toContain('<img');
            expect(html).toContain('&lt;img');
        });
    });
});
