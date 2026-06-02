import { escapeHtml } from '../search/utils';

const MAX_STARS = 5;

export default class ProductGrid {
    constructor(options) {
        this.options = {
            ...{
                gridType: 'default', // 'default' or 'collapsible'
                title: 'Products',
                showAllText: 'Show All',
                showLessText: 'Show Less',
            },
            ...options,
        };

        this.container = document.querySelector('[data-product-grid]');
        this.header = document.querySelector('[data-product-grid-header]');
    }

    render(products, title) {
        if (!this.container) return;

        this._renderHeader(title);

        if (products.length === 0) {
            this.container.innerHTML = '<p>No products found.</p>';
            return;
        }

        if (this.options.gridType === 'collapsible') {
            this._renderCollapsibleGrid(products);
        } else {
            this._renderGrid(products);
        }
    }

    _renderHeader(title) {
        if (!this.header) return;
        this.header.innerHTML = `${escapeHtml(title || this.options.title)}`;
    }

    _renderGrid(products) {
        const gridHTML = products.map(product => this._buildCard(product)).join('');
        this.container.innerHTML = `<div class="productGrid">${gridHTML}</div>`;
    }

    _renderCollapsibleGrid(products) {
        const gridHTML = products.map(p => this._buildCard(p)).join('');

        const shouldCollapse = products.length > 6;
        const collapsedClass = shouldCollapse ? 'is-collapsed' : '';
        const buttonStyle = shouldCollapse ? '' : 'style="display: none;"';

        this.container.innerHTML = `
            <div class="cs-product-grid-wrapper ${collapsedClass}" id="product-grid-wrapper">
                <div class="productGrid ${collapsedClass}">${gridHTML}</div>
                <div class="cs-grid-fade"></div>
            </div>
            <div class="cs-grid-actions" ${buttonStyle}>
                <button class="button button--primary" id="grid-toggle-btn">${this.options.showAllText}</button>
            </div>
        `;

        if (shouldCollapse) {
            this._bindCollapsibleEvents();
        }
    }

    _bindCollapsibleEvents() {
        const toggleBtn = this.container.querySelector('#grid-toggle-btn');
        const wrapper = this.container.querySelector('#product-grid-wrapper');
        const grid = wrapper.querySelector('.productGrid');
        if (!toggleBtn || !wrapper || !grid) return;

        toggleBtn.addEventListener('click', () => {
            const isCollapsed = wrapper.classList.contains('is-collapsed');
            if (isCollapsed) {
                wrapper.classList.remove('is-collapsed');
                grid.classList.remove('is-collapsed');
                toggleBtn.textContent = this.options.showLessText;
            } else {
                wrapper.classList.add('is-collapsed');
                grid.classList.add('is-collapsed');
                toggleBtn.textContent = this.options.showAllText;
                wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    _buildCard(product) {
        const title = escapeHtml(product.title);
        const url = escapeHtml(product.url);
        const image = escapeHtml(product.image);
        const price = product.price; // Price is already HTML
        const rating = this._buildRating(product);

        return `
            <div class="cs-product-card">
                <div class="cs-product-card-image-wrapper">
                    <a href="${url}">
                        <img class="cs-product-card-image" src="${image}" alt="${title}" title="${title}" width="360" height="270">
                    </a>
                </div>
                <div class="cs-product-card-details">
                    <h4 class="cs-card-title">
                        <a href="${url}" class="cs-card-title-link">${title}</a>
                    </h4>
                    ${rating}
                    <div class="cs-card-price">
                        ${price}
                    </div>
                </div>
            </div>
        `;
    }

    // SRS §3.5: cards read rating_average / review_count straight from the
    // search JSON (baked in by QTY's daily ratings sync, §3.1.4) — no UGC fetch.
    // rating_average is null (or absent) for archetypes with zero approved
    // reviews; in that case the star block is omitted entirely ("no reviews yet").
    _buildRating(product) {
        const average = product.rating_average;
        if (average === null || average === undefined) return '';

        const count = product.review_count;
        const hasCount = typeof count === 'number';
        const countLabel = count === 1 ? '1 review' : `${count} reviews`;
        const label = hasCount
            ? `Rated ${average} out of ${MAX_STARS} stars, based on ${countLabel}`
            : `Rated ${average} out of ${MAX_STARS} stars`;

        return `
            <span class="cs-card-rating" role="img" aria-label="${label}">
                ${this._buildStars(average)}
                ${hasCount ? `<span class="cs-card-rating-count">${countLabel}</span>` : ''}
            </span>
        `;
    }

    _buildStars(average) {
        const rounded = Math.round(average);
        let stars = '';

        for (let i = 1; i <= MAX_STARS; i += 1) {
            const modifier = i <= rounded ? 'ratingFull' : 'ratingEmpty';
            stars += `<span class="icon icon--${modifier}"><svg><use href="#icon-star" /></svg></span>`;
        }

        return `<span class="cs-card-rating-stars">${stars}</span>`;
    }
}
