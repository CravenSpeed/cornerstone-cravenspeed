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
 * slugs the vehicle selector persists.
 * @param {Object|null} registry - The `vehicle_registry` object.
 * @param {{make: string, model: string, generation: string}|null} garage
 * @returns {{fitment_id: (number|null), label: (string|null)}|null}
 *   `null` when there is no garage selection or no matching registry path;
 *   otherwise `fitment_id` is `null` for an un-filterable (no-id) generation,
 *   and `label` falls back to the make/model/generation slug string.
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

    const label = generationLabel(genNode);
    return {
        fitment_id: generationFitmentId(genNode),
        label: label || garage.generation,
    };
}

/**
 * Resolve a `fitment_id` to its display label by scanning the registry's
 * generation nodes. Used to render a vehicle label when only the id is known
 * (e.g. a verified token's fitment, or a card badge fallback).
 * @param {Object|null} registry - The `vehicle_registry` object.
 * @param {number|null} fitmentId
 * @returns {string|null} The matching generation's label, or `null`.
 */
export function fitmentIdToLabel(registry, fitmentId) {
    if (!registry || !registry.models || typeof fitmentId !== 'number') return null;

    const modelSlugs = Object.keys(registry.models);
    for (let i = 0; i < modelSlugs.length; i += 1) {
        const model = registry.models[modelSlugs[i]];
        const generations = model && model.generations;
        if (generations) {
            const genSlugs = Object.keys(generations);
            for (let j = 0; j < genSlugs.length; j += 1) {
                const node = generations[genSlugs[j]];
                if (generationFitmentId(node) === fitmentId) {
                    return generationLabel(node);
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
