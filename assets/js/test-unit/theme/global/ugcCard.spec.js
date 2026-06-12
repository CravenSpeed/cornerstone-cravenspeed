import {
    MAX_STARS,
    starIcons,
    scoreBadge,
    verifiedBadge,
    editedBadge,
    countryFlag,
    formatReviewDate,
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
});
