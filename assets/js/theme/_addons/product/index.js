/*
 Import all product specific js
 */
import PageManager from '../../page-manager';
import ProductController from './productController';
import initTabDeepLink from './utils/tabDeepLink';

export default class Product extends PageManager {
    onReady() {
        const product = new ProductController(this.context);
        product.onReady();
        initTabDeepLink();
    }
}
