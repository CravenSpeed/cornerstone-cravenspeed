import ProductGrid from '../../../theme/_addons/global/ui/productGrid';

const buildProduct = (overrides = {}) => ({
    title: 'Platypus License Plate Mount',
    url: '/platypus-mount/',
    image: 'https://cdn/platypus.jpg',
    price: '<span class="price">$49.99</span>',
    ...overrides,
});

const mountScaffold = () => {
    document.body.innerHTML = `
        <div data-product-grid-header></div>
        <div data-product-grid></div>
    `;
};

const renderOne = (productOverrides) => {
    const grid = new ProductGrid();
    grid.render([buildProduct(productOverrides)], 'Products');
    return document.querySelector('[data-product-grid]');
};

describe('ProductGrid card ratings (SRS §3.5)', () => {
    beforeEach(() => {
        mountScaffold();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('renders a star block when rating_average is present', () => {
        const container = renderOne({ rating_average: 4.6, review_count: 12 });
        const ratingEl = container.querySelector('.cs-card-rating');

        expect(ratingEl).not.toBeNull();
        expect(ratingEl.getAttribute('role')).toBe('img');
        expect(ratingEl.getAttribute('aria-label')).toBe(
            'Rated 4.6 out of 5 stars, based on 12 reviews',
        );
        // 4.6 rounds to 5 full stars, 0 empty.
        expect(container.querySelectorAll('.icon--ratingFull')).toHaveLength(5);
        expect(container.querySelectorAll('.icon--ratingEmpty')).toHaveLength(0);
        expect(container.querySelector('.cs-card-rating-count').textContent.trim())
            .toBe('12 reviews');
    });

    it('rounds the average to fill the correct number of stars', () => {
        const container = renderOne({ rating_average: 3.2, review_count: 8 });

        // 3.2 rounds to 3 full stars, 2 empty.
        expect(container.querySelectorAll('.icon--ratingFull')).toHaveLength(3);
        expect(container.querySelectorAll('.icon--ratingEmpty')).toHaveLength(2);
    });

    it('uses the singular review label when review_count is 1', () => {
        const container = renderOne({ rating_average: 5, review_count: 1 });

        expect(container.querySelector('.cs-card-rating-count').textContent.trim())
            .toBe('1 review');
        expect(container.querySelector('.cs-card-rating').getAttribute('aria-label'))
            .toBe('Rated 5 out of 5 stars, based on 1 review');
    });

    it('omits the star block when rating_average is null', () => {
        const container = renderOne({ rating_average: null, review_count: 0 });

        expect(container.querySelector('.cs-card-rating')).toBeNull();
        expect(container.querySelector('.cs-card-rating-stars')).toBeNull();
    });

    it('omits the star block when rating_average is missing', () => {
        const container = renderOne();

        expect(container.querySelector('.cs-card-rating')).toBeNull();
    });

    it('still renders the rest of the card when the rating is omitted', () => {
        const container = renderOne();

        expect(container.querySelector('.cs-card-title-link').textContent.trim())
            .toBe('Platypus License Plate Mount');
        expect(container.querySelector('.cs-card-price')).not.toBeNull();
    });
});
