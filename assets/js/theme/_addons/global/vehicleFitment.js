/**
 * @file vehicleFitment
 * @description Resolves a vehicle to its QTY `fitment_id` and display label from
 * the published, object-shaped generation nodes (cs-ugc SRS §3.1.4 / change-log
 * Pass 27). The canonical generation node is `{ name, fitment_id }`, identical in
 * the search JSON's `vehicle_registry` and the archetype JSON's `make_model_index`.
 *
 * This module is OBJECT-ONLY. The tolerant string-or-object read for the live
 * store is the throwaway #175 shim that lives on theme `master`; it does NOT
 * belong here — this branch cuts over to the canonical object shape and retires
 * that shim on merge.
 *
 * Shared by the UGC modules: the garage filter (ugcProduct.js) resolves the
 * visitor's persisted make/model/generation to a `fitment_id`; the submission
 * modal (Slice B) builds an archetype-constrained make/model/generation list.
 *
 * Graceful degradation (SRS §3.1.4): a generation with `null`/absent `fitment_id`
 * is un-filterable — the resolver returns a `null` fitment_id, never throws.
 */

/**
 * Read the display label off a canonical object generation node.
 * @param {{name: string, fitment_id: (number|null)}|null|undefined} node
 * @returns {string|null} The node's `name`, or `null` when absent.
 */
export function generationLabel(node) {
    return (node && typeof node === 'object' && node.name) ? node.name : null;
}

/**
 * Read the `fitment_id` off a canonical object generation node.
 * @param {{name: string, fitment_id: (number|null)}|null|undefined} node
 * @returns {number|null} The integer fitment id, or `null` when absent/unresolvable.
 */
export function generationFitmentId(node) {
    if (!node || typeof node !== 'object') return null;
    const id = node.fitment_id;
    return (typeof id === 'number' && Number.isFinite(id)) ? id : null;
}

/**
 * Resolve the visitor's garage selection to its fitment identity from the search
 * JSON's `vehicle_registry`. The registry's `models` map is keyed by bare model
 * slug and each model's `generations` map by bare generation slug — the same
 * slugs the vehicle selector persists; the `brands` map is keyed by make slug.
 *
 * The display `label` is composed "<make> <model>" (e.g. "MINI Cooper") from the
 * brand and model display names. The generation node's own `name` is the
 * generation-only label (e.g. "F56 2014 to 2024"), so it is intentionally NOT
 * used here — naming the garage vehicle by make + model reads cleanly on the
 * "For your <vehicle>" chip. Make/model names fall back to their slugs if absent.
 * @param {Object|null} registry - The `vehicle_registry` object.
 * @param {{make: string, model: string, generation: string}|null} garage
 * @returns {{fitment_id: (number|null), label: string}|null}
 *   `null` when there is no garage selection or no matching registry path;
 *   otherwise `fitment_id` is `null` for an un-filterable (no-id) generation.
 */
export function resolveGarageFitment(registry, garage) {
    if (!registry || !garage || !garage.make || !garage.model || !garage.generation) {
        return null;
    }

    const models = registry.models || {};
    const model = models[garage.model];
    if (!model || !model.generations) return null;

    const genNode = model.generations[garage.generation];
    if (!genNode) return null;

    const brands = registry.brands || {};
    const brandNode = brands[garage.make];
    const makeName = (brandNode && brandNode.name) ? brandNode.name : garage.make;
    const modelName = model.name || garage.model;

    return {
        fitment_id: generationFitmentId(genNode),
        label: `${makeName} ${modelName}`,
    };
}

/**
 * Find the make (brand) display name for a model slug by reverse-lookup over the
 * registry's `brands` map: each brand's `models` array lists the model slugs it
 * owns. Returns the brand's `name`, or `null` when no brand claims the model.
 * @param {Object} registry - The `vehicle_registry` object.
 * @param {string} modelSlug
 * @returns {string|null}
 */
function makeNameForModel(registry, modelSlug) {
    const brands = registry.brands || {};
    const makeSlugs = Object.keys(brands);
    for (let i = 0; i < makeSlugs.length; i += 1) {
        const brand = brands[makeSlugs[i]];
        const models = brand && brand.models;
        if (Array.isArray(models) && models.indexOf(modelSlug) !== -1) {
            return brand.name || makeSlugs[i];
        }
    }
    return null;
}

/**
 * Resolve a `fitment_id` to its FULL CANONICAL display label (SRS §3.2.4,
 * Pass 35) by scanning the registry's generation nodes. The generation node's
 * own `name` is the generation-with-years segment only (e.g. "F56 2014 to
 * 2024"); the full label prepends the make and model display names — make from
 * the brand reverse-lookup, model from the owning `models[slug].name` — joined
 * by single spaces, empty parts dropped. Used by the verified silent-attach to
 * resolve the token fitment's submitted label.
 * @param {Object|null} registry - The `vehicle_registry` object.
 * @param {number|null} fitmentId
 * @returns {string|null} The full canonical "make model generation-with-years"
 *   label, or `null` when no generation node carries the id.
 */
export function fitmentIdToLabel(registry, fitmentId) {
    if (!registry || !registry.models || typeof fitmentId !== 'number') return null;

    const modelSlugs = Object.keys(registry.models);
    for (let i = 0; i < modelSlugs.length; i += 1) {
        const modelSlug = modelSlugs[i];
        const model = registry.models[modelSlug];
        const generations = model && model.generations;
        if (generations) {
            const genSlugs = Object.keys(generations);
            for (let j = 0; j < genSlugs.length; j += 1) {
                const node = generations[genSlugs[j]];
                if (generationFitmentId(node) === fitmentId) {
                    const makeName = makeNameForModel(registry, modelSlug);
                    const modelName = model.name || modelSlug;
                    const genName = generationLabel(node);
                    return [makeName, modelName, genName]
                        .filter(part => part)
                        .join(' ');
                }
            }
        }
    }
    return null;
}

function stripPrefix(key, prefix) {
    return (prefix && key.startsWith(prefix)) ? key.substring(prefix.length) : key;
}

/**
 * Build the make/model/generation fitment list constrained to a single
 * archetype's own fitments, from the archetype JSON's `make_model_index`. The
 * archetype tree keys its model and generation maps with a make-slug prefix; the
 * returned `model`/`generation` slugs are stripped of that prefix so they align
 * with the registry / garage slugs.
 *
 * Slice B (the non-verified submission dropdown) consumes this. Universal
 * products have no make/model/generation tree, so this returns an empty list.
 * @param {Object|null} archetypeData - The loaded archetype JSON.
 * @returns {Array<{
 *   make: string, model: string, generation: string,
 *   makeLabel: string, modelLabel: string, generationLabel: string,
 *   label: string, fitment_id: (number|null)
 * }>}
 */
export function buildArchetypeFitmentList(archetypeData) {
    const list = [];
    const index = archetypeData && archetypeData.make_model_index;
    if (!index || archetypeData.universal_product) return list;

    const makeSlugs = Object.keys(index);
    for (let m = 0; m < makeSlugs.length; m += 1) {
        const makeSlug = makeSlugs[m];
        const makeNode = index[makeSlug];
        if (makeNode && makeNode.models) {
            const makeLabel = makeNode.name || makeSlug;
            const modelKeys = Object.keys(makeNode.models);

            for (let mo = 0; mo < modelKeys.length; mo += 1) {
                const modelKey = modelKeys[mo];
                const modelNode = makeNode.models[modelKey];
                if (modelNode && modelNode.generations) {
                    const modelSlug = stripPrefix(modelKey, makeSlug);
                    const modelLabel = modelNode.name || modelSlug;
                    const genKeys = Object.keys(modelNode.generations);

                    for (let g = 0; g < genKeys.length; g += 1) {
                        const genKey = genKeys[g];
                        const genNode = modelNode.generations[genKey];
                        const genSlug = stripPrefix(genKey, makeSlug);
                        const genLabel = generationLabel(genNode) || genSlug;

                        list.push({
                            make: makeSlug,
                            model: modelSlug,
                            generation: genSlug,
                            makeLabel,
                            modelLabel,
                            generationLabel: genLabel,
                            label: `${makeLabel} ${modelLabel} ${genLabel}`,
                            fitment_id: generationFitmentId(genNode),
                        });
                    }
                }
            }
        }
    }

    return list;
}

/**
 * Group the flat `buildArchetypeFitmentList` output into a make → model →
 * generation tree that drives the submission modal's cascading waterfall
 * (SRS §3.4.1, issue #41 — mirrors the add-to-cart vehicle selector). Each tier
 * preserves first-seen order from the flat list; makes and models are sorted by
 * display label, generations by label descending (newest year range first) so
 * the cascade can auto-select the newest generation like the add-to-cart picker.
 *
 * Shape:
 *   [{ slug, label, models: [{ slug, label, generations: [{
 *        slug, label, fitment_id, vehicleLabel
 *   }] }] }]
 * where `vehicleLabel` is the full canonical "make model generation-with-years"
 * label submitted on the picked vehicle (SRS §3.2.4). A universal product / empty
 * fitment list yields an empty array.
 * @param {Array} fitmentList - Output of `buildArchetypeFitmentList`.
 * @returns {Array<Object>}
 */
export function buildArchetypeFitmentTree(fitmentList) {
    const list = Array.isArray(fitmentList) ? fitmentList : [];
    const makeMap = new Map();

    list.forEach((fitment) => {
        let makeNode = makeMap.get(fitment.make);
        if (!makeNode) {
            makeNode = {
                slug: fitment.make,
                label: fitment.makeLabel,
                modelMap: new Map(),
            };
            makeMap.set(fitment.make, makeNode);
        }

        let modelNode = makeNode.modelMap.get(fitment.model);
        if (!modelNode) {
            modelNode = {
                slug: fitment.model,
                label: fitment.modelLabel,
                generations: [],
            };
            makeNode.modelMap.set(fitment.model, modelNode);
        }

        modelNode.generations.push({
            slug: fitment.generation,
            label: fitment.generationLabel,
            fitment_id: fitment.fitment_id,
            vehicleLabel: fitment.label,
        });
    });

    return Array.from(makeMap.values())
        .map(makeNode => ({
            slug: makeNode.slug,
            label: makeNode.label,
            models: Array.from(makeNode.modelMap.values())
                .map(modelNode => ({
                    slug: modelNode.slug,
                    label: modelNode.label,
                    generations: modelNode.generations
                        .slice()
                        .sort((a, b) => b.label.localeCompare(a.label)),
                }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}
