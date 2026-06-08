import SearchEngine from '../../../theme/_addons/global/search/searchEngine';

// cs-ugc #175: the registry's vehicle_registry generation nodes are migrating
// from a bare string label to an object { name, fitment_id } (UGC-SRS §3.1.4 /
// change-log Pass 27). These tests pin the tolerant-read shim: the live store
// must render correct labels whether a generation node is a string OR an object,
// with no behavior change while QTY still publishes strings.

const buildRegistry = (generationNode) => ({
    vehicle_registry: {
        brands: {
            mini: { name: 'MINI', models: ['cooper'] },
        },
        models: {
            cooper: {
                name: 'Cooper',
                generations: { f56: generationNode },
            },
        },
    },
    products: [],
});

const STRING_NODE = 'F56 2014 to 2019';
const OBJECT_NODE = { name: 'F56 2014 to 2019', fitment_id: 87 };

describe('SearchEngine registry generation-node tolerance (cs-ugc #175 / SRS Pass 27)', () => {
    describe('getVehicleName()', () => {
        it('resolves the generation label from a bare-string node (current live shape)', () => {
            const engine = new SearchEngine(buildRegistry(STRING_NODE));
            expect(engine.getVehicleName('mini', 'cooper', 'f56')).toBe('MINI Cooper F56 2014 to 2019');
        });

        it('resolves the generation label from a { name, fitment_id } object node (post-flip shape)', () => {
            const engine = new SearchEngine(buildRegistry(OBJECT_NODE));
            expect(engine.getVehicleName('mini', 'cooper', 'f56')).toBe('MINI Cooper F56 2014 to 2019');
        });
    });

    describe('vehicle search index', () => {
        it('indexes the generation label token from a bare-string node', () => {
            const engine = new SearchEngine(buildRegistry(STRING_NODE));
            expect(engine.vehicleIndex.f56).toBeDefined();
            expect(Array.from(engine.vehicleIndex.f56)).toContain('f56');
        });

        it('indexes the generation label from an object node without throwing (pre-shim this crashed on .toLowerCase)', () => {
            let engine;
            expect(() => { engine = new SearchEngine(buildRegistry(OBJECT_NODE)); }).not.toThrow();
            expect(engine.vehicleIndex.f56).toBeDefined();
            expect(Array.from(engine.vehicleIndex.f56)).toContain('f56');
        });
    });
});
