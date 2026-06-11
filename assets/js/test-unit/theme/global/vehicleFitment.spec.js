import {
    generationLabel,
    generationFitmentId,
    resolveGarageFitment,
    fitmentIdToLabel,
    buildArchetypeFitmentList,
} from '../../../theme/_addons/global/vehicleFitment';

// Object-only search-JSON vehicle_registry (SRS §3.1.4 / Pass 27): every
// generation node is the canonical { name, fitment_id }. Model/generation maps
// are keyed by bare slug (the slugs the vehicle selector persists).
const registry = {
    brands: {
        mini: { name: 'MINI', models: ['cooper'] },
    },
    models: {
        cooper: {
            name: 'Cooper',
            generations: {
                cooperf56: { name: 'MINI Cooper F56', fitment_id: 87 },
                cooperr56: { name: 'MINI Cooper R56', fitment_id: 42 },
                coopernoid: { name: 'MINI Cooper (unmapped)', fitment_id: null },
            },
        },
    },
};

describe('vehicleFitment', () => {
    describe('generationLabel', () => {
        it('reads name off the object node', () => {
            expect(generationLabel({ name: 'MINI Cooper F56', fitment_id: 87 })).toBe('MINI Cooper F56');
        });

        it('returns null for null/undefined/string/missing-name nodes', () => {
            expect(generationLabel(null)).toBeNull();
            expect(generationLabel(undefined)).toBeNull();
            expect(generationLabel('MINI Cooper F56')).toBeNull();
            expect(generationLabel({ fitment_id: 87 })).toBeNull();
        });
    });

    describe('generationFitmentId', () => {
        it('reads an integer fitment_id', () => {
            expect(generationFitmentId({ name: 'x', fitment_id: 87 })).toBe(87);
        });

        it('returns null when fitment_id is null/absent/non-numeric', () => {
            expect(generationFitmentId({ name: 'x', fitment_id: null })).toBeNull();
            expect(generationFitmentId({ name: 'x' })).toBeNull();
            expect(generationFitmentId({ name: 'x', fitment_id: 'nope' })).toBeNull();
            expect(generationFitmentId(null)).toBeNull();
        });
    });

    describe('resolveGarageFitment', () => {
        it('resolves a complete garage selection to fitment_id + a make/model label', () => {
            const result = resolveGarageFitment(registry, { make: 'mini', model: 'cooper', generation: 'cooperf56' });
            expect(result).toEqual({ fitment_id: 87, label: 'MINI Cooper' });
        });

        it('returns null fitment_id (un-filterable) when the node has no id, label still resolves', () => {
            const result = resolveGarageFitment(registry, { make: 'mini', model: 'cooper', generation: 'coopernoid' });
            expect(result).toEqual({ fitment_id: null, label: 'MINI Cooper' });
        });

        it('returns null for an incomplete garage selection', () => {
            expect(resolveGarageFitment(registry, { make: 'mini', model: 'cooper' })).toBeNull();
            expect(resolveGarageFitment(registry, null)).toBeNull();
        });

        it('returns null when the model/generation slug is not in the registry', () => {
            expect(resolveGarageFitment(registry, { make: 'mini', model: 'nope', generation: 'cooperf56' })).toBeNull();
            expect(resolveGarageFitment(registry, { make: 'mini', model: 'cooper', generation: 'nope' })).toBeNull();
        });

        it('returns null when there is no registry', () => {
            expect(resolveGarageFitment(null, { make: 'mini', model: 'cooper', generation: 'cooperf56' })).toBeNull();
        });

        it('falls back to make/model slugs for the label when brand/model names are absent', () => {
            const noName = { models: { cooper: { generations: { cooperf56: { fitment_id: 87 } } } } };
            const result = resolveGarageFitment(noName, { make: 'mini', model: 'cooper', generation: 'cooperf56' });
            expect(result).toEqual({ fitment_id: 87, label: 'mini cooper' });
        });
    });

    describe('fitmentIdToLabel', () => {
        it('resolves a known fitment_id to its label', () => {
            expect(fitmentIdToLabel(registry, 42)).toBe('MINI Cooper R56');
        });

        it('returns null for an unknown id, a null id, or a missing registry', () => {
            expect(fitmentIdToLabel(registry, 999)).toBeNull();
            expect(fitmentIdToLabel(registry, null)).toBeNull();
            expect(fitmentIdToLabel(null, 42)).toBeNull();
        });
    });

    describe('buildArchetypeFitmentList', () => {
        // Archetype JSON make_model_index: model/generation maps keyed with a
        // make-slug prefix; generation nodes are objects with name + fitment_id
        // plus the option/alias subtree.
        const archetype = {
            make_model_index: {
                mini: {
                    name: 'MINI',
                    models: {
                        minicooper: {
                            name: 'Cooper',
                            generations: {
                                minicooperf56: { name: 'F56 2014-2024', fitment_id: 87, alias: 'a.json' },
                                minicooperr56: { name: 'R56 2007-2013', fitment_id: 42, alias: 'b.json' },
                            },
                        },
                    },
                },
            },
        };

        it('flattens the archetype tree into make/model/generation rows with stripped slugs', () => {
            const list = buildArchetypeFitmentList(archetype);
            expect(list).toHaveLength(2);
            expect(list[0]).toEqual({
                make: 'mini',
                model: 'cooper',
                generation: 'cooperf56',
                makeLabel: 'MINI',
                modelLabel: 'Cooper',
                generationLabel: 'F56 2014-2024',
                label: 'MINI Cooper F56 2014-2024',
                fitment_id: 87,
            });
            expect(list[1].fitment_id).toBe(42);
        });

        it('carries a null fitment_id through for an unmapped generation', () => {
            const a = {
                make_model_index: {
                    mini: {
                        name: 'MINI',
                        models: {
                            minicooper: {
                                name: 'Cooper',
                                generations: { minicooperf56: { name: 'MINI Cooper F56', fitment_id: null } },
                            },
                        },
                    },
                },
            };
            expect(buildArchetypeFitmentList(a)[0].fitment_id).toBeNull();
        });

        it('returns an empty list for universal products and for missing data', () => {
            expect(buildArchetypeFitmentList({ make_model_index: archetype.make_model_index, universal_product: true })).toEqual([]);
            expect(buildArchetypeFitmentList({})).toEqual([]);
            expect(buildArchetypeFitmentList(null)).toEqual([]);
        });
    });
});
