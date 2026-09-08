// نام نمایشی نرم‌افزار — از VITE_APP_NAME_FA / VITE_APP_NAME_EN در .env خوانده می‌شود.
// (در vite.config.js با __APP_NAME_FA__ و __APP_NAME_EN__ تزریق شده است)

export const APP_NAME_FA = typeof __APP_NAME_FA__ !== 'undefined' ? __APP_NAME_FA__ : 'ویزیتیک';
export const APP_NAME_EN = typeof __APP_NAME_EN__ !== 'undefined' ? __APP_NAME_EN__ : 'Vizitik';
