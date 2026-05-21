export default class ProductDetails {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.lastAliasData = undefined;
        this.lastInventory = undefined;

        // Selectors
        this.descriptionElement = document.querySelector('[data-product-description]');
        this.instructionsElement = document.querySelector('[data-product-instructions]');
        this.skuElement = document.querySelector('[data-product-sku]');
        this.priceElement = document.querySelector('[data-product-price]');
        this.brandElement = document.querySelector('[data-product-brand]');
        this.fitmentNotesElement = document.querySelector('[data-fitment-notes]');

        this.unsubscribe = this.stateManager.subscribe(this.update.bind(this));
    }

    update(state) {
        const {
            aliasData, inventory, archetypeData, blemSelected,
        } = state;

        // Optimization: Only update DOM if relevant state (aliasData or inventory) has changed
        if (aliasData === this.lastAliasData && inventory === this.lastInventory && blemSelected === this.lastBlemSelected) return;
        this.lastAliasData = aliasData;
        this.lastInventory = inventory;
        this.lastBlemSelected = blemSelected;

        let dataToRender = {};

        if (aliasData) {
            dataToRender = { ...aliasData };

            // Override price if blem is selected
            if (blemSelected && aliasData.blem) {
                dataToRender.price = aliasData.blem.price;
                dataToRender.sale_price = null; // Reset sale price for blems to avoid confusion
            }

            // Calculate stock message if we have alias data and inventory
            if (inventory && inventory.global_inv && aliasData.base_id) {
                const stockItem = inventory.global_inv[aliasData.base_id];
                if (stockItem) {
                    dataToRender.stock_message = this._getStockMessage(stockItem);
                }
            }
        } else if (archetypeData) {
            // Fallback to archetype data for description and brand
            dataToRender.description = archetypeData.description;
            dataToRender.brand_name = archetypeData.brand_name;
        }

        this.render(dataToRender, archetypeData);
    }

    _getStockMessage(item) {
        const { av, a2b } = item;

        if (av > 10) return 'Plenty in stock';
        if (av > 0) return `Only ${av} left. Order soon!`;
        if (a2b > 0) return 'In Stock'; // Made to order
        return 'Out of Stock';
    }

    _formatPrice(price) {
        return typeof price === 'number'
            ? price.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
            : price;
    }

    _generateInstructionsHtml(url) {
        return `<a href="${url}" target="_blank" class="button button--primary">View Instructions</a>`;
    }

    _decodeHTML(html) {
        if (!html) return '';
        // fitment_notes (and possibly other fields) arrive double-encoded from the
        // CDN, so loop until the string is stable. textarea decodes entities without
        // parsing tags, preserving any intentional markup for innerHTML rendering.
        const txt = document.createElement('textarea');
        let current = html;
        for (let i = 0; i < 5; i += 1) {
            txt.innerHTML = current;
            const next = txt.value;
            if (next === current) break;
            current = next;
        }
        return current;
    }

    _animate(element) {
        if (!element) return;
        element.classList.remove('fade-in');
        void element.offsetWidth; // trigger reflow
        element.classList.add('fade-in');
    }

    render(data) {
        if (this.descriptionElement) this.descriptionElement.innerHTML = data.description || '';
        if (this.fitmentNotesElement) {
            if (data.fitment_notes) {
                // QTY currently double-encodes this field; the _decodeHTML loop unwraps
                // that. Once QTY serves plain Unicode, the decode becomes a no-op and
                // this call can be dropped.
                this.fitmentNotesElement.textContent = this._decodeHTML(data.fitment_notes);
                this.fitmentNotesElement.style.visibility = 'visible';
                this.fitmentNotesElement.style.display = '';
                this._animate(this.fitmentNotesElement);
            } else {
                this.fitmentNotesElement.textContent = '';
                this.fitmentNotesElement.style.visibility = 'hidden';
                this.fitmentNotesElement.style.display = '';
            }
        }
        if (this.instructionsElement) {
            if (data.instructions_url) {
                this.instructionsElement.innerHTML = this._generateInstructionsHtml(data.instructions_url);
                this.instructionsElement.style.visibility = 'visible';
                this.instructionsElement.style.display = '';
                this._animate(this.instructionsElement);
            } else {
                this.instructionsElement.innerHTML = '';
                this.instructionsElement.style.visibility = 'hidden';
                this.instructionsElement.style.display = '';
            }
        }
        if (this.skuElement) {
            if (data.base_sku) {
                this.skuElement.textContent = data.base_sku;
                this.skuElement.style.visibility = 'visible';
                this.skuElement.style.display = '';
                this._animate(this.skuElement);
            } else {
                this.skuElement.textContent = '';
                this.skuElement.style.visibility = '';
                this.skuElement.style.display = '';
            }
        }
        if (this.brandElement) {
            if (data.brand_name) {
                this.brandElement.textContent = this._decodeHTML(data.brand_name);
                this.brandElement.style.visibility = 'visible';
                this.brandElement.style.display = '';
                this._animate(this.brandElement);
            } else {
                this.brandElement.textContent = '';
                this.brandElement.style.visibility = 'hidden';
                this.brandElement.style.display = 'none';
            }
        }
        if (this.priceElement) {
            const price = data.price;
            const salePrice = data.sale_price;

            const isValid = (p) => p !== undefined && p !== null && p !== 0 && p !== '0' && !(typeof p === 'string' && p.includes('$0.00'));

            if (!isValid(price)) {
                this.priceElement.innerHTML = '';
                this.priceElement.style.visibility = '';
                this.priceElement.style.display = '';
            } else {
                const formattedPrice = this._formatPrice(price);

                if (isValid(salePrice) && salePrice < price) {
                    const formattedSalePrice = this._formatPrice(salePrice);
                    this.priceElement.innerHTML = `<span style="text-decoration: line-through; color: #757575; margin-right: 0.5rem; font-size: 0.8em;">${formattedPrice}</span><span>${formattedSalePrice}</span>`;
                } else {
                    this.priceElement.innerHTML = formattedPrice;
                }
                this.priceElement.style.visibility = 'visible';
                this.priceElement.style.display = '';
                this._animate(this.priceElement);
            }
        }
    }

    destroy() {
        if (this.unsubscribe) this.unsubscribe();
    }
}
