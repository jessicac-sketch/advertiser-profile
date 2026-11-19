/**
 * Shared Components
 * Export all shared components from their respective folders.
 */

export * from './brand';
export * from './copy-button/copy-button.component';
export * from './dialog';
export * from './drill-down-modal/drill-down-modal.component';
export * from './export-button/export-button.component';
export * from './filter-list';
export * from './metric';
export * from './page-header';
export * from './range-controls';
export * from './range-menu';
export * from './range-notice';
export * from './section-error';
export * from './share-list';
export * from './show-more';
export * from './social-badge';
export * from './sort-control';
export * from './summary-card';

// Deliberately NOT re-exported here: UsStatesMapComponent and
// DailyAdsBarChartComponent both statically import the full `echarts`
// package. This barrel is imported by eagerly loaded pages - re-exporting
// either here would pull echarts into the initial bundle for every page,
// not just Map View / Venue Profile. Import them directly via
// '@shared/components/us-states-map/us-states-map.component' and
// '@shared/components/daily-ads-bar-chart/daily-ads-bar-chart.component'
// instead.
