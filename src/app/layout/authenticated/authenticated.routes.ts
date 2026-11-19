/** Angular Imports */
import { Routes } from '@angular/router';

/** Local Imports */
import {
    AdAnalyticsComponent,
    AdsGalleryComponent,
    AdvertiserDetailComponent,
    AdvertiserProfileComponent,
    AnalyticsComponent,
    RankingDataComponent,
    ReportsComponent,
    SettingsComponent,
} from '@features';
import { APP_NAME } from '@shared/models/app';

/**
 * Each route's `title` is the browser tab title ("Page · <APP_NAME>"), set by
 * Angular's router on navigation - same pattern as gbp-management-tool-ui.
 */
export const AUTHENTICATED_ROUTES: Routes = [
    {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
    },
    {
        // Lazy-loaded (kept out of the @features barrel), so its future charts stay out of the main bundle
        path: 'dashboard',
        title: `Dashboard · ${APP_NAME}`,
        loadComponent: () => import('@features/dashboard').then((m) => m.DashboardComponent),
    },
    {
        path: 'advertiser-profile',
        title: `Advertiser Profile · ${APP_NAME}`,
        component: AdvertiserProfileComponent,
    },
    {
        path: 'advertiser-profile/:id',
        title: `Advertiser · ${APP_NAME}`,
        component: AdvertiserDetailComponent,
    },
    {
        path: 'reports',
        title: `Reports · ${APP_NAME}`,
        component: ReportsComponent,
    },
    {
        path: 'ranking-data',
        title: `Ranking Data · ${APP_NAME}`,
        component: RankingDataComponent,
    },
    {
        path: 'programmatic-ads',
        title: `Ads Gallery · ${APP_NAME}`,
        component: AdsGalleryComponent,
    },
    {
        path: 'ad/:id',
        title: `Ad Analytics · ${APP_NAME}`,
        component: AdAnalyticsComponent,
    },
    {
        // Lazy-loaded: pulls in echarts (via DailyAdsBarChartComponent),
        // kept out of the main bundle for users who never visit this page.
        path: 'venue/:venueId',
        title: `Venue Profile · ${APP_NAME}`,
        loadComponent: () => import('@features/venue-profile').then((m) => m.VenueProfileComponent),
    },
    {
        path: 'analytics',
        title: `Analytics · ${APP_NAME}`,
        component: AnalyticsComponent,
    },
    {
        // Lazy-loaded: pulls in echarts/us-atlas, kept out of the main
        // bundle for users who never visit this page.
        path: 'map-view',
        title: `Map View · ${APP_NAME}`,
        loadComponent: () => import('@features/map-view').then((m) => m.MapViewComponent),
    },
    {
        path: 'settings',
        title: `Settings · ${APP_NAME}`,
        component: SettingsComponent,
    },
];
