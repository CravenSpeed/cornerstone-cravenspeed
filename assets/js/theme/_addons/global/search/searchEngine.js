// cs-ugc #175 shim: registry generation nodes are migrating from a bare string
// label to { name, fitment_id } (UGC-SRS §3.1.4 / change-log Pass 27). Tolerate
// either shape until the object-only cutover overwrites these reads; retires then.
const generationLabel = (node) => (node && typeof node === 'object' ? node.name : node);

export default class SearchEngine {
    constructor(data) {
        this.data = data || {};
        this.products = this._normalizeProducts(data);
        this.vehicleIndex = this._buildVehicleIndex(data ? data.vehicle_registry : null);
    }

    /**
     * Main search method
     * @param {string} query - User input
     * @param {number|null} limit - Max results to return (default null for all)
     * @returns {Array} - Top 8 matching products
     */
    search(query, limit = null) {
        const tokens = this.tokenize(query);
        if (!tokens.length) return [];

        if (this.products.length === 0) {
            return [];
        }

        let results = this.products
            .map(product => {
                const score = this.calculateScore(product, tokens);
                return { product, score };
            })
            .filter(result => result.score > 0)
            .sort((a, b) => b.score - a.score);

        if (limit) {
            results = results.slice(0, limit);
        }

        return results.map(result => result.product);
    }

    /**
     * Finds related products based on vehicle or archetype compatibility
     * @param {string} currentUrl - The URL of the current product (archetype)
     * @param {string|null} vehicleId - The selected vehicle generation ID (e.g. "cooperf56")
     * @param {number} limit - Max results
     * @returns {Array}
     */
    findRelated(currentUrl, vehicleId = null, limit = 12) {
        // Normalize currentUrl to match keys (ensure trailing slash if keys have them, or strip)
        // The JSON keys have trailing slashes (e.g. "/product/").
        const normalizedUrl = currentUrl.endsWith('/') ? currentUrl : `${currentUrl}/`;

        const currentProduct = this.products.find(p => p.url === normalizedUrl);

        // If no vehicle selected AND no current product found, we can't do anything.
        if (!currentProduct && !vehicleId) return [];

        let related = [];

        if (vehicleId) {
            // Strategy 1: Prioritize products that fit the selected vehicle OR are universal
            related = this.products.filter(p => {
                const isNotCurrent = currentProduct ? p.url !== currentProduct.url : true;
                if (!isNotCurrent) return false;

                const compatIds = p.compatibility_ids || [];
                const isUniversal = compatIds.length === 0 || (compatIds.length === 1 && compatIds[0] === '');
                const hasCompat = compatIds.includes(vehicleId);

                return isUniversal || hasCompat;
            });
        } else {
            // Strategy 2: Fallback to products that share ANY compatibility with the current one
            if (!currentProduct) return [];

            const currentIds = currentProduct.compatibility_ids || [];
            related = this.products.filter(p =>
                p.url !== currentProduct.url &&
                p.compatibility_ids &&
                p.compatibility_ids.some(id => currentIds.includes(id)),
            );
        }

        // Sort by sort_order (ascending)
        related.sort((a, b) => (a.sort_order || 10000) - (b.sort_order || 10000));

        return related.slice(0, limit);
    }

    /**
     * Returns a human-readable vehicle string from slugs
     * @param {string} makeSlug
     * @param {string} modelSlug
     * @param {string} genSlug
     * @returns {string|null}
     */
    getVehicleName(makeSlug, modelSlug, genSlug) {
        if (!this.data || !this.data.vehicle_registry) return null;
        const registry = this.data.vehicle_registry;

        let makeName = makeSlug;
        let modelName = modelSlug;
        let genName = genSlug;

        // Brand
        if (makeSlug && registry.brands && registry.brands[makeSlug]) {
            makeName = registry.brands[makeSlug].name || makeSlug;
        }

        // Model & Generation
        if (modelSlug && registry.models && registry.models[modelSlug]) {
            modelName = registry.models[modelSlug].name || modelSlug;
            if (genSlug && registry.models[modelSlug].generations && registry.models[modelSlug].generations[genSlug]) {
                genName = generationLabel(registry.models[modelSlug].generations[genSlug]);
            }
        }

        const parts = [makeName, modelName, genName].filter(Boolean);
        return parts.length > 0 ? parts.join(' ') : null;
    }

    tokenize(query) {
        return query.toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove special characters
            .split(/\s+/) // Split by whitespace
            .filter(t => t.length > 0);
    }

    calculateScore(product, tokens) {
        let score = 0;
        // Use pre-computed search fields to avoid overhead in the loop
        const title = product._search_title;
        const sku = product._search_sku;
        const keywords = product._search_keywords;
        const searchSkus = product._search_skus || [];

        // Compatibility Check
        const productIds = product.compatibility_ids || [];
        // Universal if empty array or array with empty string
        const isUniversal = productIds.length === 0 || (productIds.length === 1 && productIds[0] === '');

        tokens.forEach(token => {
            // Scoring Weights
            if (sku.includes(token)) score += 20; // High priority for SKU/Part #
            if (searchSkus.some(s => s.includes(token))) score += 20; // High priority for alias SKUs
            if (title.includes(token)) score += 10;
            if (keywords.some(k => k.includes(token))) score += 5;

            // Vehicle Match
            if (this.vehicleIndex[token]) {
                if (isUniversal) {
                    score += 5; // Universal products match vehicle queries lightly
                } else if (productIds.some(id => this.vehicleIndex[token].has(id))) {
                    score += 15; // Strong match for specific vehicle
                }
            }
        });

        return score;
    }

    _normalizeProducts(data) {
        let products = [];
        if (!data) return [];

        if (Array.isArray(data)) { // Case 1: Data is the array (Flat list)
            products = data;
        } else if (data && data.products) {
            if (Array.isArray(data.products)) { // Case 2: Data has a products key
                products = data.products;
            } else if (typeof data.products === 'object') { // Case 3: Products is an object map (URL -> Product)
                products = Object.entries(data.products).map(([url, product]) => ({ ...product, url }));
            }
        } else {
            console.warn('SearchEngine: Could not parse products from data', data);
            return [];
        }

        // Pre-compute search fields for performance
        return products.map(p => ({
            ...p,
            _search_title: (p.title || '').toLowerCase(),
            _search_sku: (p.sku || '').toLowerCase().replace(/[^\w\s]/g, ''),
            _search_keywords: (typeof p.general_keywords === 'string')
                ? p.general_keywords.toLowerCase().split(',').map(k => k.trim())
                : [],
            _search_skus: Array.isArray(p.search_skus)
                ? p.search_skus.map(s => s.toLowerCase().replace(/[^\w\s]/g, ''))
                : [],
        }));
    }

    _buildVehicleIndex(registry) {
        const index = {};
        if (!registry) return index;

        const addIds = (term, ids) => {
            if (!term) return;

            // Tokenize the term in the same way the main search tokenizer does.
            // This ensures that a search for "Miata" will match a vehicle named "MX-5 Miata"
            // by indexing both "mx5" and "miata" as keywords pointing to the same vehicle IDs.
            const tokens = term.toLowerCase()
                .replace(/[^\w\s]/g, '') // Clean, but keep spaces for splitting
                .split(/\s+/)
                .filter(t => t.length > 0);

            tokens.forEach(token => {
                if (!index[token]) {
                    index[token] = new Set();
                }
                ids.forEach(id => index[token].add(id));
            });
        };

        // Helper to get IDs for a model
        const getModelIds = (modelSlug) => {
            const model = registry.models && registry.models[modelSlug];
            if (!model || !model.generations) return [];
            return Object.keys(model.generations);
        };

        // Index Brands
        if (registry.brands) {
            Object.entries(registry.brands).forEach(([brandSlug, brandData]) => {
                const modelSlugs = brandData.models || [];
                const brandIds = modelSlugs.reduce((acc, slug) => acc.concat(getModelIds(slug)), []);

                addIds(brandSlug, brandIds);
                if (brandData.name) addIds(brandData.name, brandIds);
            });
        }

        // Index Models
        if (registry.models) {
            Object.entries(registry.models).forEach(([modelSlug, modelData]) => {
                const ids = getModelIds(modelSlug);
                addIds(modelSlug, ids);
                if (modelData.name) addIds(modelData.name, ids);

                if (modelData.generations) {
                    Object.entries(modelData.generations).forEach(([genId, genNode]) => {
                        addIds(generationLabel(genNode), [genId]);
                    });
                }
            });
        }

        return index;
    }
}
