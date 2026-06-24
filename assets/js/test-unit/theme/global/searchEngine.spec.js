import SearchEngine from '../../../theme/_addons/global/search/searchEngine';

// Object-only search-JSON registry (SRS §3.1.4 / Pass 27): each generation node
// is the canonical { name, fitment_id }. This branch reads it object-only — the
// tolerant string-or-object shim (#175) is retired at cutover, not carried here.
const data = {
    products: [
        {
            url: '/license-plate-mount/',
            title: 'License Plate Mount',
            sku: 'CS-AB828',
            compatibility_ids: ['cooperf56'],
            sort_order: 1,
        },
    ],
    vehicle_registry: {
        brands: {
            mini: { name: 'MINI', models: ['cooper'] },
        },
        models: {
            cooper: {
                name: 'Cooper',
                generations: {
                    cooperf56: { name: 'MINI Cooper F56', fitment_id: 87 },
                    cooperr56: { name: 'MINI Cooper R56', fitment_id: 42 },
                },
            },
        },
    },
};

describe('SearchEngine (object-only registry)', () => {
    describe('getVehicleName', () => {
        it('reads the generation label off the object node', () => {
            const engine = new SearchEngine(data);
            // make name + model name + generation node's `name` field.
            expect(engine.getVehicleName('mini', 'cooper', 'cooperf56')).toBe('MINI Cooper MINI Cooper F56');
        });

        it('falls back to the generation slug when the object node has no name', () => {
            const partial = {
                products: [],
                vehicle_registry: {
                    brands: { mini: { name: 'MINI', models: ['cooper'] } },
                    models: { cooper: { name: 'Cooper', generations: { cooperf56: { fitment_id: 87 } } } },
                },
            };
            const engine = new SearchEngine(partial);
            expect(engine.getVehicleName('mini', 'cooper', 'cooperf56')).toBe('MINI Cooper cooperf56');
        });
    });

    describe('vehicle index from object nodes', () => {
        it('indexes the generation label so a vehicle query matches', () => {
            const engine = new SearchEngine(data);
            const results = engine.search('F56');
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].sku).toBe('CS-AB828');
        });

        it('does not throw when a generation node is missing its name', () => {
            const partial = {
                products: [],
                vehicle_registry: {
                    brands: { mini: { name: 'MINI', models: ['cooper'] } },
                    models: { cooper: { name: 'Cooper', generations: { cooperf56: { fitment_id: 87 } } } },
                },
            };
            expect(() => new SearchEngine(partial)).not.toThrow();
        });
    });
});
