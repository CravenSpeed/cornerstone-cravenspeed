import StateManager from '../global/stateManager';
import VehiclePersistence from '../global/vehiclePersistence';
import { generationLabel } from '../global/vehicleFitment';

export default class VehicleSelector {
    constructor(context) {
        this.context = context;
        this.registry = null;
        this.currentVehicle = null;

        this.form = document.querySelector('[data-car-selection-form]');
        this.makeSelect = document.querySelector('[data-car-selection-field="make"]');
        this.modelSelect = document.querySelector('[data-car-selection-field="model"]');
        this.yearSelect = document.querySelector('[data-car-selection-field="year"]');
        this.unsubscribe = null;
    }

    init() {
        this.bindEvents();
        this.unsubscribe = StateManager.subscribe(this.handleStateChange.bind(this));
    }

    bindEvents() {
        if (this.makeSelect) this.makeSelect.addEventListener('change', () => this.handleSelectionChange('make'));
        if (this.modelSelect) this.modelSelect.addEventListener('change', () => this.handleSelectionChange('model'));
        if (this.yearSelect) this.yearSelect.addEventListener('change', () => this.handleSelectionChange('year'));
    }

    setRegistry(registry) {
        this.registry = registry;
        this.populateMakes();
        // After registry is set, try to apply the current state
        const currentState = StateManager.getState();
        if (currentState.vehicle.selected) {
            this.currentVehicle = currentState.vehicle.selected;
            this.updateUI(this.currentVehicle);
        }
    }

    handleStateChange({ vehicle }) {
        // Check if vehicle in global state is different from component's current vehicle
        if (JSON.stringify(vehicle.selected) !== JSON.stringify(this.currentVehicle)) {
            this.currentVehicle = vehicle.selected;
            // Ensure registry is loaded before trying to update UI
            if (this.registry) {
                this.updateUI(vehicle.selected);
            }
        }
    }

    handleSelectionChange(level) {
        this.updateAvailableOptions(level);

        const make = this.makeSelect.value;
        const model = this.modelSelect.value;
        const generation = this.yearSelect.value;

        if (make && model && generation) {
            const selectedVehicle = { make, model, generation };
            this.currentVehicle = selectedVehicle; // Prevent component UI reset
            VehiclePersistence.save(selectedVehicle);
        } else if (this.currentVehicle !== null) {
            // Clear global state if the user changes an active selection to incomplete
            this.currentVehicle = null; // Prevent component UI reset
            VehiclePersistence.save(null);
        }
    }

    updateUI(vehicle) {
        if (!vehicle) {
            this.populateMakes(); // Resets all fields
            return;
        }

        // Set make and update models
        if (this.makeSelect.value !== vehicle.make) {
            this.makeSelect.value = vehicle.make;
        }
        this.updateAvailableOptions('make');

        // Set model and update years
        if (this.modelSelect.value !== vehicle.model) {
            this.modelSelect.value = vehicle.model;
        }
        this.updateAvailableOptions('model');

        // Set year
        if (this.yearSelect.value !== vehicle.generation) {
            this.yearSelect.value = vehicle.generation;
        }
    }

    updateAvailableOptions(level) {
        if (level === 'make') {
            this.clearSelect(this.modelSelect, 'Select Model');
            const makeSlug = this.makeSelect.value;
            if (makeSlug && this.registry.brands[makeSlug]) {
                const modelSlugs = this.registry.brands[makeSlug].models || [];
                const models = modelSlugs.map(slug => (this.registry.models[slug] ? { slug, name: this.registry.models[slug].name } : null))
                    .filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
                models.forEach(m => this.addOption(this.modelSelect, m.slug, m.name));

                // Auto-select if there is only one model available
                if (models.length === 1) {
                    this.modelSelect.value = models[0].slug;
                }
            }
        }

        if (level === 'make' || level === 'model') {
            this.clearSelect(this.yearSelect, 'Select Year');
            const modelSlug = this.modelSelect.value;
            if (modelSlug && this.registry.models[modelSlug]) {
                const generations = this.registry.models[modelSlug].generations || {};
                const gens = Object.entries(generations)
                    .map(([id, node]) => ({ id, name: generationLabel(node) || id }))
                    .sort((a, b) => b.name.localeCompare(a.name)); // Sort descending by name
                gens.forEach(g => this.addOption(this.yearSelect, g.id, g.name));

                // Auto-select the newest generation (first in the descending sorted list)
                if (gens.length > 0) {
                    this.yearSelect.value = gens[0].id;
                }
            }
        }
    }

    populateMakes() {
        if (!this.registry || !this.registry.brands) return;
        this.clearSelect(this.makeSelect, 'Select Make');
        this.clearSelect(this.modelSelect, 'Select Model');
        this.clearSelect(this.yearSelect, 'Select Year');

        const brands = Object.entries(this.registry.brands)
            .filter(([slug]) => slug !== 'allvehicles')
            .map(([slug, data]) => ({ slug, name: data.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        brands.forEach(brand => this.addOption(this.makeSelect, brand.slug, brand.name));
    }

    clearSelect(select, defaultText) {
        if (!select) return;
        select.innerHTML = `<option value="">${defaultText}</option>`;
        select.disabled = true;
    }

    addOption(select, value, text) {
        if (!select) return;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
        select.disabled = false;
    }

    destroy() {
        if (this.unsubscribe) this.unsubscribe();
    }
}
