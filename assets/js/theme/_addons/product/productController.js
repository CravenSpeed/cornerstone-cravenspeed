import DataManager from '../global/dataManager';
import GlobalStateManager from '../global/stateManager';
import VehiclePersistence from '../global/vehiclePersistence';
import OptionsPersistence from '../global/optionsPersistence';
import StateManager from './stateManager';
import FulfillmentStatus from './ui/fulfillmentStatus';
import AliasSelection from './ui/aliasSelection';
import ProductDetails from './ui/productDetails';
import ImageGallery from './ui/imageGallery';
import AddToCart from './ui/addToCart';
import ProductMessages from './ui/productMessages';
import Badges from './ui/badges';
import BlemProducts from './ui/blemProducts';
import SchemaManager from './ui/schemaManager';
import UgcProduct from './ui/ugcProduct';
import ugcApi from '../global/ugcApi';
import { resolveUrlToSelection } from './utils/urlResolver';

export default class ProductController {
    constructor(context) {
        this.context = context;
        this.archetypeTitle = this._resolveArchetypeTitle();
        this.archetypeName = this._slugify(this.archetypeTitle);
        this.currentAliasFile = null;
        this.lastKnownVehicle = null;
        this.lastKnownOptions = null;
        this.unsubscribeGlobal = null;
        this.unsubscribeLocal = null;
    }

    onReady() {
        this.updateHeading();
        this.loadInitialData();
    }

    async loadInitialData() {
        try {
            const [archetypeData, inventoryData] = await Promise.all([
                DataManager.getArchetypeData(this.archetypeName),
                DataManager.getInventoryData(),
            ]);

            window.csDataVersions = window.csDataVersions || {};
            window.csDataVersions.archetype = { lastUpdate: archetypeData.last_json_update, name: this.archetypeName };
            archetypeData.archetypeName = this.archetypeName;

            const resolvedSelection = resolveUrlToSelection(window.location.pathname, archetypeData);

            if (resolvedSelection && Object.keys(resolvedSelection).length > 0) {
                const {
                    make, model, generation, ...options
                } = resolvedSelection;

                // Seed Vehicle Persistence if fitment is present in the URL
                if (make && model && generation) {
                    VehiclePersistence.save({ make, model, generation });
                }

                // Seed Options Persistence if options are present in the URL
                if (Object.keys(options).length > 0) {
                    OptionsPersistence.save(this.archetypeName, options);
                }
            }

            this.stateManager = new StateManager(archetypeData);
            this.stateManager.setInventoryData(inventoryData);

            this.productMessages = new ProductMessages();
            this.fulfillmentStatus = new FulfillmentStatus(this.stateManager);
            this.aliasSelection = new AliasSelection(this.stateManager, this.productMessages);
            this.productDetails = new ProductDetails(this.stateManager);
            this.imageGallery = new ImageGallery(this.stateManager);
            this.addToCart = new AddToCart(this.stateManager, this.productMessages);
            this.badges = new Badges(this.stateManager);
            this.blemProducts = new BlemProducts(this.stateManager);
            this.schemaManager = new SchemaManager(this.stateManager);
            this.ugcProduct = new UgcProduct(
                archetypeData.qty_archetype_id,
                this.stateManager,
                ugcApi,
                undefined,
                GlobalStateManager,
            );

            this.unsubscribeLocal = this.stateManager.subscribe(this.handleLocalStateChange.bind(this));

            this.unsubscribeGlobal = GlobalStateManager.subscribe(this.handleGlobalStateChange.bind(this));

            // Sync local tracking variables with global state before the initial check.
            // This prevents handleGlobalStateChange from calling setVehicle() and wiping our URL options.
            const initialGlobalState = GlobalStateManager.getState();
            this.lastKnownVehicle = initialGlobalState.vehicle?.selected;
            this.lastKnownOptions = initialGlobalState.options?.[this.archetypeName];

            this.handleGlobalStateChange(initialGlobalState);

            // Trigger the initial alias data fetch if a valid alias was resolved
            if (this.stateManager.getState().currentAlias) {
                this.handleLocalStateChange(this.stateManager.getState());
            }
        } catch (error) {
            console.error(`Failed to load archetype data for ${this.archetypeName}:`, error);
        }
    }

    handleGlobalStateChange(globalState) {
        const { selected: vehicle } = globalState.vehicle;
        if (JSON.stringify(vehicle) !== JSON.stringify(this.lastKnownVehicle)) {
            this.lastKnownVehicle = vehicle;
            this.stateManager.setVehicle(vehicle);
        }

        const { options } = globalState;
        if (options && options[this.archetypeName]) {
            const archetypeOptions = options[this.archetypeName];
            if (JSON.stringify(archetypeOptions) !== JSON.stringify(this.lastKnownOptions)) {
                this.lastKnownOptions = archetypeOptions;
                this.stateManager.setOptions(archetypeOptions);
            }
        }
    }

    async handleLocalStateChange(state) {
        const { currentAlias: newAliasFile } = state;

        if (newAliasFile === 'self' || newAliasFile === this.currentAliasFile) {
            return;
        }

        this.currentAliasFile = newAliasFile;

        if (newAliasFile) {
            try {
                const aliasData = await DataManager.getAliasData(this.archetypeName, newAliasFile);
                window.csDataVersions = window.csDataVersions || {};
                window.csDataVersions.alias = { lastUpdate: aliasData.last_json_update, file: newAliasFile };
                this.stateManager.setAliasData(aliasData);
            } catch (error) {
                console.error(`Failed to load alias data for ${newAliasFile}:`, error);
            }
        }
    }

    updateHeading() {
        const heading = document.querySelector('.cs-product-title');
        if (heading) {
            heading.textContent = this.archetypeTitle;
        }
    }

    _resolveArchetypeTitle() {
        if (this.context.productTitle) {
            const title = this.context.productTitle;
            if (this.context.breadcrumbs && this.context.breadcrumbs.length) {
                const parents = this.context.breadcrumbs.slice(0, -1).reverse();
                for (const breadcrumb of parents) {
                    const cleanName = breadcrumb.name.replace(/^Qty\s*-\s*/i, '').trim();
                    if (cleanName && title.toLowerCase().startsWith(cleanName.toLowerCase())) {
                        return cleanName;
                    }
                }
            }
            return title;
        }
        console.warn('No product title found in context. Defaulting to "Shift Knob".');
        return 'Shift Knob';
    }

    _slugify(text) {
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    destroy() {
        if (this.unsubscribeGlobal) this.unsubscribeGlobal();
        if (this.unsubscribeLocal) this.unsubscribeLocal();
        if (this.schemaManager) this.schemaManager.destroy();
        if (this.ugcProduct) this.ugcProduct.destroy();
    }
}
