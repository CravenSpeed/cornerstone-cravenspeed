import initTabDeepLink from '../../../theme/_addons/product/utils/tabDeepLink';

describe('tabDeepLink', () => {
    const mountTabs = (activeTab = 'description') => {
        document.body.innerHTML = `
            <ul class="tabs" data-tab>
                <li class="tab ${activeTab === 'description' ? 'is-active' : ''}">
                    <a class="tab-title" href="#tab-description">Description</a>
                </li>
                <li class="tab ${activeTab === 'reviews' ? 'is-active' : ''}">
                    <a class="tab-title" href="#tab-reviews">Reviews</a>
                </li>
            </ul>
            <div class="tabs-contents">
                <div class="tab-content is-active" id="tab-description"></div>
                <div class="tab-content" id="tab-reviews"></div>
            </div>
        `;
    };

    beforeEach(() => {
        Element.prototype.scrollIntoView = jest.fn();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        window.location.hash = '';
        delete Element.prototype.scrollIntoView;
    });

    it('clicks the matching tab link for the location hash on init', () => {
        mountTabs();
        window.location.hash = '#tab-reviews';
        const link = () => document.querySelector('a[href="#tab-reviews"]');
        const onClick = jest.fn();
        link().addEventListener('click', onClick);

        initTabDeepLink();

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('does nothing when the hash tab is already active', () => {
        mountTabs('reviews');
        window.location.hash = '#tab-reviews';
        const onClick = jest.fn();
        document.querySelector('a[href="#tab-reviews"]').addEventListener('click', onClick);

        initTabDeepLink();

        expect(onClick).not.toHaveBeenCalled();
    });

    it('ignores hashes with no matching tab and malformed hashes', () => {
        mountTabs();
        window.location.hash = '#some-other-anchor';
        expect(() => initTabDeepLink()).not.toThrow();
    });

    it('activates tabs on in-page hash changes', () => {
        mountTabs();
        window.location.hash = '';
        initTabDeepLink();

        const onClick = jest.fn();
        document.querySelector('a[href="#tab-reviews"]').addEventListener('click', onClick);
        window.location.hash = '#tab-reviews';
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));

        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
