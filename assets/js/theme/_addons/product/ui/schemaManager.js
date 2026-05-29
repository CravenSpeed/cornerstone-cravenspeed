export default class SchemaManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.lastAliasId = null;
        this.lastBlemSelected = null;
        this.productScript = null;
        this.productSchema = null;
        this.unsubscribe = this.stateManager.subscribe(this.update.bind(this));
        this.update(this.stateManager.getState());
    }

    update(state) {
        if (state.aliasData && state.inventory) {
            const aliasId = state.aliasData.base_id;
            const { blemSelected } = state;
            if (aliasId !== this.lastAliasId || blemSelected !== this.lastBlemSelected) {
                this._patchAvailability(state.aliasData, state.inventory, blemSelected);
                this.lastAliasId = aliasId;
                this.lastBlemSelected = blemSelected;
            }
        }
    }

    _findProductSchema() {
        if (this.productScript) return true;
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'Product') {
                    this.productScript = script;
                    this.productSchema = data;
                    return true;
                }
            } catch (e) {
                // skip unparseable scripts
            }
        }
        return false;
    }

    _patchAvailability(aliasData, inventory, blemSelected) {
        if (!this._findProductSchema()) return;
        if (!this.productSchema.offers) return;

        const inventoryId = blemSelected && aliasData.blem
            ? aliasData.blem.qty_id
            : aliasData.base_id;

        const entry = inventory.global_inv?.[inventoryId];
        const isInStock = entry && (entry.av > 0 || entry.a2b > 0);

        this.productSchema.offers.availability = `https://schema.org/${isInStock ? 'InStock' : 'OutOfStock'}`;
        this.productScript.textContent = JSON.stringify(this.productSchema);
    }

    destroy() {
        if (this.unsubscribe) this.unsubscribe();
    }
}
