/**
 * The category set of the PHP app, in the order products.php renders it.
 * products.php: $defaultCategories = ['چوبی', 'قیفی', 'لیوانی', 'یخی', 'کترینگ و خانواده', 'سنتی و حصیری']
 * and the modal select adds «سایر». Kept in one place because the values are compared
 * against the product rows in the database: an invented label filters to nothing.
 */
export const DEFAULT_CATEGORIES = ['چوبی', 'قیفی', 'لیوانی', 'یخی', 'کترینگ و خانواده', 'سنتی و حصیری'];
export const CATEGORY_OPTIONS = [...DEFAULT_CATEGORIES, 'سایر'];

/** brands that products.php renders as fixed chips before the dynamic ones */
export const PRESET_BRANDS = ['میهن', 'پاندا'];
