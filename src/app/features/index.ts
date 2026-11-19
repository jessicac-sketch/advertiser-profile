/**
 * Features Module
 * Export all feature modules from their respective folders.
 */

export * from './ad-analytics';
export * from './ads-gallery';
export * from './advertiser-profile';
export * from './analytics';
export * from './login';
export * from './ranking-data';
export * from './reports';
export * from './settings';

// Deliberately NOT re-exported here: dashboard, map-view and venue-profile all
// statically import the full `echarts` package (map-view directly, the other two
// via DailyAdsBarChartComponent). authenticated.routes.ts imports several other
// components from this same '@features' barrel eagerly - re-exporting any of
// them here would pull echarts into the initial bundle despite their routes
// using loadComponent(). Import '@features/dashboard', '@features/map-view' or
// '@features/venue-profile' directly (as authenticated.routes.ts already does).
