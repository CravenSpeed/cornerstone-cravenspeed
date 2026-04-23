import CartManager from '../cartManager';

export default class AddToCart {
    constructor(stateManager, productMessages) {
        this.state = stateManager;
        this.productMessages = productMessages;
        this.cartManager = new CartManager();

        this.button = document.querySelector('#product-add-button');
        this.form = document.querySelector('#product-selection');
        this.productIdInput = this.form ? this.form.querySelector('input[name="product_id"]') : null;

        if (!this.button || !this.form) {
            console.warn('AddToCart UI: Required elements not found.');
            return;
        }

        this.defaultButtonText = this.button.textContent;
        this.unsubscribe = null;
        this.submitHandler = null;
        this.scrollHandler = null;
        this.ticking = false;

        this.init();
    }

    init() {
        // Initial state: Disable button until alias is selected
        this.button.disabled = true;

        // Check for pre-existing alias (Universal products)
        this.updateButtonState(this.state.getState());

        this.bindEvents();
        this.initStickyBehavior();
    }

    initStickyBehavior() {
        this.container = document.getElementById('add-button-wrapper');
        this.stickyOffset = 15; // Space below button when sticky

        this.scrollHandler = () => {
            if (!this.ticking) {
                window.requestAnimationFrame(() => {
                    this.checkSticky();
                    this.ticking = false;
                });
                this.ticking = true;
            }
        };

        window.addEventListener('scroll', this.scrollHandler, { passive: true });
        window.addEventListener('resize', this.scrollHandler, { passive: true });

        // Initial check
        this.checkSticky();
    }

    checkSticky() {
        if (!this.container) return;
        const rect = this.container.getBoundingClientRect();

        if (rect.bottom < window.innerHeight - this.stickyOffset) {
            this.button.classList.add('is-sticky');
        } else {
            this.button.classList.remove('is-sticky');
        }
    }

    bindEvents() {
        // Watch for alias changes
        this.unsubscribe = this.state.subscribe((state) => this.updateButtonState(state));

        // Intercept form submission
        this.submitHandler = (event) => this.handleSubmit(event);
        this.form.addEventListener('submit', this.submitHandler);
    }

    updateButtonState(state) {
        if (this.productMessages) {
            this.productMessages.hideMessage('cart-error');
        }
        if (this.form) this.form.classList.remove('has-cart-error');

        const { aliasData, inventory, blemSelected } = state;

        // We expect alias to be an object with a 'bc_id' property representing the BC Product ID
        if (aliasData && aliasData.bc_id) {
            // Check inventory
            let isStocked = true;
            let targetId = aliasData.bc_id;
            let inventoryId = aliasData.base_id;

            if (blemSelected && aliasData.blem) {
                targetId = aliasData.blem.big_c_id;
                inventoryId = aliasData.blem.qty_id;
            }

            if (!targetId) {
                console.error('AddToCart: Target Product ID not found.');
                this.button.disabled = true;
                return;
            }

            if (inventory && inventory.global_inv && inventoryId) {
                const stockItem = inventory.global_inv[inventoryId];
                if (stockItem) {
                    const { av, a2b } = stockItem;
                    if (av <= 0 && a2b <= 0) {
                        isStocked = false;
                    }
                } else {
                    // base_id exists but not found in inventory -> Out of Stock
                    isStocked = false;
                }
            }

            if (isStocked) {
                const wasDisabled = this.button.disabled;

                // Enable button
                this.button.disabled = false;
                this.button.textContent = this.defaultButtonText;

                if (wasDisabled) {
                    this.button.classList.remove('cs-button-pop');
                    void this.button.offsetWidth; // Force reflow to restart animation
                    this.button.classList.add('cs-button-pop');
                }

                // Update the hidden product_id field with the Alias ID (swapping out the Archetype ID)
                if (this.productIdInput) {
                    this.productIdInput.value = targetId;
                }
            } else {
                // Alias selected but Out of Stock
                this.button.disabled = true;
                this.button.textContent = 'Out of Stock';
            }
        } else {
            // Disable button
            this.button.disabled = true;
            this.button.textContent = this.defaultButtonText;
        }
    }

    handleSubmit(event) {
        event.preventDefault();

        // Double check validation
        if (this.button.disabled) return;

        // Accessibility: Blur focus to prevent "aria-hidden" warning when modal opens
        if (document.activeElement) document.activeElement.blur();

        this.button.classList.add('loading');

        if (this.productMessages) {
            this.productMessages.hideMessage('cart-error');
        }
        this.form.classList.remove('has-cart-error');

        // Create FormData from the form element
        // This automatically captures the updated product_id value from the DOM
        const formData = new FormData(this.form);

        this.cartManager.addToCart(formData)
            .catch((error) => {
                const message = typeof error === 'string' ? error : 'There was a problem adding this item to your cart.';
                if (this.productMessages) {
                    this.productMessages.showMessage('cart-error', message);
                }
                this.form.classList.add('has-cart-error');
            })
            .finally(() => {
                this.button.classList.remove('loading');
            });
    }

    destroy() {
        if (this.unsubscribe) this.unsubscribe();
        if (this.form && this.submitHandler) {
            this.form.removeEventListener('submit', this.submitHandler);
        }
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler);
            window.removeEventListener('resize', this.scrollHandler);
        }
    }
}
