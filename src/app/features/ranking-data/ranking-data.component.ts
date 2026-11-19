/** Angular Imports */
import { DecimalPipe } from '@angular/common';
import {
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    type OnInit,
    signal,
    viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

/** Third Party Imports */
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
    Card,
    filterData,
    Skeleton,
    sortDataByField,
    Table,
    type TableColumn,
    type TableStateEvent,
    Tabs,
} from '@ntv360/component-pantry';
import { combineLatest, map, type Subscription } from 'rxjs';

/** Local Imports */
import {
    type CategoryRankingEntry,
    type DashboardAnalytics,
    type DashboardTopAd,
    type HostRankingEntry,
    type LocationData,
    MediaFilesService,
    type PlayRecordContent,
    type ProgrammaticAdsColumnFilters,
    type ProgrammaticAdsFilterOptions,
    type ProgrammaticAdsSortBy,
    type ProgrammaticAdsStats,
    type StateRankingEntry,
} from '@core';
import {
    buildAdRankingExportColumns,
    buildDashboardExportColumns,
    CATEGORY_RANKING_EXPORT_COLUMNS,
    STATE_RANKING_EXPORT_COLUMNS,
    VENUE_RANKING_EXPORT_COLUMNS,
} from '@features/ranking-data/ranking-data.constants';
import {
    buildCsvBlob,
    CopyButtonComponent,
    dateStampedFilename,
    downloadFile,
    DrillDownModalComponent,
    ExportButtonComponent,
    type ExportFormat,
    formatPopDuration as formatPopDurationUtil,
    POP_DURATION_LEGEND,
    type PopDurationBucket,
    popDurationRowColor as popDurationRowColorUtil,
    toCsvValue,
} from '@shared';
import { PageHeaderComponent } from '@shared/components/page-header';
import { RangeControlsComponent } from '@shared/components/range-controls';
import { RangeNoticeComponent } from '@shared/components/range-notice';
import { CARD_CONFIG } from '@shared/models/ui';
import { DashboardRangeService } from '@shared/services/dashboard';
import { TimeDisplayService } from '@shared/services/time-display';
import { toLocalDateRange } from '@shared/utils/utc-calendar-date.util';

/**
 * Stat-card-driven filter, mirroring what each of the four dashboard cards counts.
 * 'total' clears any active filter, since it counts every row.
 */
type StatCardFilter = 'total' | 'successful' | 'overdue' | 'recent';

/**
 * Any filter that can be applied to the raw Programmatic Ads table -
 * either a duration-color bucket (from the legend) or a stat-card filter.
 */
type RawAdsFilter = PopDurationBucket | 'successful' | 'overdue' | 'recent';

/**
 * Ranking Data page component (formerly the Dashboard).
 *
 * @remarks
 * Ad performance statistics and rankings: raw programmatic ads with proof-of-play
 * stats, plus Ad, Venue, State and Category rankings, each with its own date range
 * and export. Was the app's Dashboard; a new Dashboard focused on recent data
 * replaces it at /dashboard.
 */
@Component({
    selector: 'app-ranking-data',
    imports: [
        PageHeaderComponent,
        RangeControlsComponent,
        RangeNoticeComponent,
        Card,
        CopyButtonComponent,
        DecimalPipe,
        DrillDownModalComponent,
        ExportButtonComponent,
        RouterLink,
        Skeleton,
        Table,
        Tabs,
    ],
    templateUrl: './ranking-data.component.html',
    styleUrl: './ranking-data.component.scss',
    standalone: true,
})
export class RankingDataComponent implements OnInit {
    /**
     * Media files service for dashboard API calls.
     * @type {MediaFilesService}
     */
    private readonly mediaFilesService = inject(MediaFilesService);

    /**
     * Injected router for navigation.
     * @type {Router}
     */
    private readonly router = inject(Router);

    /**
     * Injected for unsubscribing the debounced venue-ranking range stream.
     * @type {DestroyRef}
     */
    private readonly destroyRef = inject(DestroyRef);

    /**
     * Configuration for statistics cards.
     *
     * @type {object}
     */
    statsCardConfig = CARD_CONFIG;

    /**
     * Total number of rows in programmatic_ads.
     * @type {number}
     */
    totalPlayRecords = 0;

    /**
     * Number of records that were played and successfully had proof-of-play sent.
     * @type {number}
     */
    successfulPopCount = 0;

    /**
     * Number of records fetched more than 5 minutes ago still awaiting proof-of-play.
     * @type {number}
     */
    pendingOverdueCount = 0;

    /**
     * Number of records fetched within the last 5 minutes still awaiting proof-of-play.
     * @type {number}
     */
    pendingRecentCount = 0;

    /**
     * Number of records with a proof-of-play duration of 1-5 minutes (rounded).
     * @type {number}
     */
    greenCount = 0;

    /**
     * Number of records with a proof-of-play duration of 6-10 minutes (rounded).
     * @type {number}
     */
    yellowCount = 0;

    /**
     * Number of records with a proof-of-play duration over 10 minutes (rounded).
     * @type {number}
     */
    redCount = 0;

    /**
     * Live dashboard analytics data.
     */
    dashboardAnalytics = signal<DashboardAnalytics | null>(null);

    /**
     * Loading state for the Ad Ranking table's own query - independent of
     * dashboardAnalytics(), since it's served by a dedicated, date-range-aware
     * endpoint instead of being baked into the main analytics call.
     */
    isLoadingAdRanking = signal(false);

    /**
     * Whether the Ads Ranking table has completed at least one load since
     * this component was created - see hasLoadedRawAdsOnce for why this matters.
     */
    hasLoadedAdsRankingOnce = signal(false);

    /**
     * Currently-selected date range for the Ad Ranking table, or null for
     * all-time (no range filter).
     */
    adRankingRange = signal<{ start: Date; end: Date } | null>(null);

    /**
     * Loading state for the Ad Ranking export action.
     */
    isExportingAdRanking = signal(false);

    /**
     * Whether Ad Ranking export is currently allowed - same rule as raw ads
     * and Venue Ranking export (a bounded date range must be set, and not
     * mid-reload), plus there must be data to export.
     */
    canExportAdRanking = computed(
        () =>
            this.isExportableRange(this.adRankingRange()) &&
            !this.isLoadingAdRanking() &&
            this.allAds().length > 0,
    );

    /**
     * Explains why Ad Ranking export is disabled, or null if it's currently
     * allowed. Shown as the export button's tooltip.
     */
    adRankingExportDisabledReason = computed(() => {
        if (!this.adRankingRange()) {
            return `Pick a date range (up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days) to export - "All time" can't be exported`;
        }
        if (this.isLoadingAdRanking()) {
            return 'Loading the selected date range...';
        }
        if (!this.isExportableRange(this.adRankingRange())) {
            return `Date range is too wide - export supports up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days`;
        }
        if (this.allAds().length === 0) {
            return 'No ads to export';
        }
        return null;
    });

    /**
     * Whether the last analytics load attempt failed. Drives the error/retry
     * state so a failed request doesn't leave the skeleton spinning forever.
     */
    analyticsLoadFailed = signal(false);

    /**
     * Table area tabs configuration.
     * @type {Array}
     */
    tabs = [
        { label: 'Received Playables' },
        { label: 'Ad Ranking' },
        { label: 'Venue Ranking' },
        { label: 'State Ranking' },
        { label: 'Category Ranking' },
    ];

    /**
     * Active table area tab index.
     * @type {number}
     */
    activeTabIndex = 0;

    /**
     * Column definitions for the raw Programmatic Ads table.
     *
     * @type {TableColumn[]}
     */
    rawAdsColumns: TableColumn[] = [
        {
            field: 'creative',
            header: 'Creative',
            width: '104px', // 80px thumbnail + cell padding
            filter: false,
        },
        {
            field: 'screenshot',
            header: 'Screenshot',
            width: '104px', // 80px thumbnail + cell padding
            filter: false,
        },
        {
            field: 'creativeId',
            header: 'Creative ID',
            width: '160px',
            filter: true,
            filterType: 'text',
        },
        {
            // Filters via metadata->>'trackerId' server-side (see
            // get_programmatic_ads_page.sql's tracker_id column filter) -
            // no sort support though, since it's not a real sortable column
            // in RAW_ADS_SORT_FIELD_MAP/the RPC's ORDER BY.
            field: 'trackerId',
            header: 'Tracking ID',
            width: '160px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'creativeSource',
            header: 'Creative Source',
            width: '150px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'venueId',
            header: 'Venue ID',
            width: '160px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'deviceId',
            header: 'Device ID',
            width: '160px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'fetchedAt',
            header: 'Fetched At',
            width: '180px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'proofOfPlaySent',
            header: 'Proof of Play Sent',
            width: '180px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'popDurationMinutes',
            header: 'POP Duration',
            width: '140px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'served',
            header: 'Served',
            width: '100px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'dateServed',
            header: 'Date Served',
            width: '180px',
            filter: true,
            filterType: 'date',
        },
        {
            // Optional - not every player-ui report includes these, and
            // older rows predate the columns entirely. Cell rendering below
            // shows "N/A" when null.
            field: 'slotPlaylistContentId',
            header: 'Slot Playlist Content ID',
            width: '180px',
            filter: false,
        },
        {
            field: 'slotPlaylistContentPosition',
            header: 'Slot Position',
            width: '120px',
            filter: false,
        },
    ];

    /**
     * Legend/filter definitions for proof-of-play duration buckets.
     * @type {PopDurationLegendEntry[]}
     */
    readonly popDurationLegend = POP_DURATION_LEGEND;

    /**
     * Currently active proof-of-play duration bucket filter, or null for no filter.
     * Applied server-side so it covers the full table, not just loaded rows.
     */
    activeBucketFilter = signal<RawAdsFilter | null>(null);

    /**
     * Current sort column for the raw Programmatic Ads table.
     * Applied server-side; defaults to most-recently-fetched first.
     */
    private activeSortBy: ProgrammaticAdsSortBy = 'fetched_at';

    /**
     * Current sort direction for the raw Programmatic Ads table.
     */
    private activeSortDir: 'asc' | 'desc' = 'desc';

    /**
     * Current search term for the raw Programmatic Ads table (creative ID,
     * venue ID, or device ID). Applied server-side so it covers the full table.
     */
    searchTerm = signal('');

    /**
     * Debounce timer for the search input.
     */
    private searchDebounce: ReturnType<typeof setTimeout> | undefined;

    /**
     * Current per-column filters for the raw Programmatic Ads table, driven by
     * ntv-table's built-in column filter UI. Applied server-side so it covers
     * the full table, not just loaded rows.
     */
    private activeColumnFilters: ProgrammaticAdsColumnFilters = {};

    /**
     * Debounce timer for column filter changes (the table emits on every keystroke).
     */
    private columnFilterDebounce: ReturnType<typeof setTimeout> | undefined;

    /**
     * Reference to the raw Programmatic Ads ntv-table, used to drive its built-in
     * append/filter loading overlay via showLoadingOverlay()/hideLoadingOverlay() -
     * visible feedback while a filter/sort/search reload is in flight.
     */
    private readonly rawAdsTable = viewChild<Table>('rawAdsTable');

    /**
     * Reference to the Ads Ranking ntv-table, used to drive its built-in
     * loading overlay while a date-range reload is in flight.
     */
    private readonly adsRankingTable = viewChild<Table>('adsRankingTable');

    /**
     * Reference to the Venue Ranking ntv-table, used to drive its built-in
     * loading overlay while a date-range reload is in flight.
     */
    private readonly venueRankingTable = viewChild<Table>('venueRankingTable');

    /**
     * Reference to the State Ranking ntv-table, used to drive its built-in
     * loading overlay while a date-range reload is in flight.
     */
    private readonly stateRankingTable = viewChild<Table>('stateRankingTable');

    /**
     * Reference to the Category Ranking ntv-table, used to drive its
     * built-in loading overlay while a date-range reload is in flight.
     */
    private readonly categoryRankingTable = viewChild<Table>('categoryRankingTable');

    /**
     * All three tables live inside @switch/@case blocks, so a viewChild ref
     * only exists once its tab is actually active - a plain
     * showLoadingOverlay() call made when a request starts (e.g. a stat-card
     * click switches to tab 0 and loads in the same synchronous call, before
     * Angular has re-rendered the newly-active case) silently no-ops against
     * an undefined ref. This re-syncs the overlay the moment a tab's table
     * mounts, in case its data was already in flight beforehand. One factory
     * for all three tables, rather than three copies of the same effect.
     *
     * @param {() => Table | undefined} table - The table's viewChild getter
     * @param {() => boolean} isLoading - Whether that table's data is currently loading
     * @returns {void}
     */
    private syncTableLoadingOverlay(
        table: () => Table | undefined,
        isLoading: () => boolean,
    ): void {
        effect(() => {
            if (table() && isLoading()) {
                table()?.showLoadingOverlay('Loading...');
            }
        });
    }

    private readonly initRawAdsOverlaySync = this.syncTableLoadingOverlay(
        () => this.rawAdsTable(),
        () => this.isLoadingRawAds(),
    );

    private readonly initAdsRankingOverlaySync = this.syncTableLoadingOverlay(
        () => this.adsRankingTable(),
        () => this.isLoadingAdRanking(),
    );

    private readonly initVenueRankingOverlaySync = this.syncTableLoadingOverlay(
        () => this.venueRankingTable(),
        () => this.isLoadingVenueRanking(),
    );

    private readonly initStateRankingOverlaySync = this.syncTableLoadingOverlay(
        () => this.stateRankingTable(),
        () => this.isLoadingStateRanking(),
    );

    private readonly initCategoryRankingOverlaySync = this.syncTableLoadingOverlay(
        () => this.categoryRankingTable(),
        () => this.isLoadingCategoryRanking(),
    );

    /**
     * Raw programmatic_ads rows loaded so far.
     *
     * @type {PlayRecordContent[]}
     */
    rawAdsData = signal<PlayRecordContent[]>([]);

    /**
     * Loading state for the initial raw Programmatic Ads load.
     */
    isLoadingRawAds = signal(false);

    /**
     * Whether the raw Programmatic Ads table has completed at least one load
     * (success or error) since this component was created. ntv-table's own
     * loading overlay can only render on top of already-visible rows
     * (sortedData().length > 0) - it has no way to indicate loading while
     * genuinely empty, so this table shows a skeleton instead until its
     * first load settles, then relies on the overlay for every reload after.
     */
    hasLoadedRawAdsOnce = signal(false);

    /**
     * Currently-selected date range for the raw Programmatic Ads table, or
     * null for all-time (no range filter).
     */
    rawAdsRange = signal<{ start: Date; end: Date } | null>(null);

    /**
     * Loading state for the raw Programmatic Ads export action.
     */
    isExporting = signal(false);

    /**
     * Widest date range allowed for export (about a month) - an unscoped or
     * overly wide export can pull an unbounded number of rows, which is slow
     * for both the server (paginating the whole matching set) and the
     * requester. Shared by every exportable table, enforced both here and
     * (since these endpoints are reachable directly) server-side.
     */
    private static readonly MAX_EXPORT_RANGE_DAYS = 31;

    /**
     * Whether a date range is set and within MAX_EXPORT_RANGE_DAYS - the
     * shared rule behind every table's export eligibility.
     *
     * @param {{ start: Date; end: Date } | null} range - Date range to check
     * @returns {boolean} Whether the range is export-eligible
     */
    private isExportableRange(range: { start: Date; end: Date } | null): boolean {
        if (!range) {
            return false;
        }

        const spanDays =
            Math.round((range.end.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
        return spanDays <= RankingDataComponent.MAX_EXPORT_RANGE_DAYS;
    }

    /**
     * Whether the current raw Programmatic Ads date range is eligible for
     * export - a range must be set, span at most MAX_EXPORT_RANGE_DAYS, and
     * that range's own request must have finished loading, so the button's
     * enabled state doesn't flash true while the table is still catching up
     * to the just-picked range.
     */
    canExportRawAds = computed(
        () => this.isExportableRange(this.rawAdsRange()) && !this.isLoadingRawAds(),
    );

    /**
     * Explains why export is disabled, or null if it's currently allowed.
     * Shown as the export button's tooltip.
     */
    exportDisabledReason = computed(() => {
        if (!this.rawAdsRange()) {
            return `Pick a date range (up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days) to export - "All time" can't be exported`;
        }
        if (this.isLoadingRawAds()) {
            return 'Loading the selected date range...';
        }
        if (!this.canExportRawAds()) {
            return `Date range is too wide - export supports up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days`;
        }
        return null;
    });

    /**
     * Loading state for the Venue Ranking export action.
     */
    isExportingVenueRanking = signal(false);

    /**
     * Whether Venue Ranking export is currently allowed - same rule as raw
     * ads export (a bounded date range must be set, and not mid-reload),
     * plus there must be data to export.
     */
    canExportVenueRanking = computed(
        () =>
            this.isExportableRange(this.venueRankingRange()) &&
            !this.isLoadingVenueRanking() &&
            this.hostRanking().length > 0,
    );

    /**
     * Explains why Venue Ranking export is disabled, or null if it's
     * currently allowed. Shown as the export button's tooltip.
     */
    venueRankingExportDisabledReason = computed(() => {
        if (!this.venueRankingRange()) {
            return `Pick a date range (up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days) to export - "All time" can't be exported`;
        }
        if (this.isLoadingVenueRanking()) {
            return 'Loading the selected date range...';
        }
        if (!this.isExportableRange(this.venueRankingRange())) {
            return `Date range is too wide - export supports up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days`;
        }
        if (this.hostRanking().length === 0) {
            return 'No venues to export';
        }
        return null;
    });

    /**
     * Loading state for the State Ranking export action.
     */
    isExportingStateRanking = signal(false);

    /**
     * Whether State Ranking export is currently allowed - same rule as Venue Ranking's
     * (an exportable range, not mid-reload, and rows to export).
     */
    canExportStateRanking = computed(
        () =>
            this.isExportableRange(this.stateRankingRange()) &&
            !this.isLoadingStateRanking() &&
            this.stateRanking().length > 0,
    );

    /**
     * Explains why State Ranking export is disabled, or null if it's currently
     * allowed. Shown as the export button's tooltip.
     */
    stateRankingExportDisabledReason = computed(() => {
        if (!this.stateRankingRange()) {
            return `Pick a date range (up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days) to export - "All time" can't be exported`;
        }
        if (this.isLoadingStateRanking()) {
            return 'Loading the selected date range...';
        }
        if (!this.isExportableRange(this.stateRankingRange())) {
            return `Date range is too wide - export supports up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days`;
        }
        if (this.stateRanking().length === 0) {
            return 'No states to export';
        }
        return null;
    });

    /**
     * Loading state for the Category Ranking export action.
     */
    isExportingCategoryRanking = signal(false);

    /**
     * Whether Category Ranking export is currently allowed - same rule as Venue Ranking's
     * (an exportable range, not mid-reload, and rows to export).
     */
    canExportCategoryRanking = computed(
        () =>
            this.isExportableRange(this.categoryRankingRange()) &&
            !this.isLoadingCategoryRanking() &&
            this.categoryRanking().length > 0,
    );

    /**
     * Explains why Category Ranking export is disabled, or null if it's currently
     * allowed. Shown as the export button's tooltip.
     */
    categoryRankingExportDisabledReason = computed(() => {
        if (!this.categoryRankingRange()) {
            return `Pick a date range (up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days) to export - "All time" can't be exported`;
        }
        if (this.isLoadingCategoryRanking()) {
            return 'Loading the selected date range...';
        }
        if (!this.isExportableRange(this.categoryRankingRange())) {
            return `Date range is too wide - export supports up to ${RankingDataComponent.MAX_EXPORT_RANGE_DAYS} days`;
        }
        if (this.categoryRanking().length === 0) {
            return 'No categories to export';
        }
        return null;
    });

    /**
     * Loading state for the "Show More" action.
     */
    isLoadingMoreRawAds = signal(false);

    /**
     * Total number of rows in programmatic_ads, per the server.
     * Passed to ntv-table as totalDataLength to enable its built-in "Show More" button.
     * @type {number}
     */
    rawAdsTotalCount = signal(0);

    /**
     * Number of rows loaded per "Show More" page.
     * @type {number}
     */
    private readonly rawAdsPageSize = 20;

    /**
     * Number of raw Programmatic Ads rows currently loaded.
     * @type {number}
     */
    private rawAdsOffset = 0;

    /**
     * Table column definitions.
     *
     * @type {TableColumn[]}
     */
    tableColumns: TableColumn[] = [
        {
            field: 'thumbnail',
            header: 'Thumbnail',
            width: '100px',
            filter: false,
        },
        {
            field: 'contentId',
            header: 'Content ID',
            width: '120px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'title',
            header: 'Filename',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'location',
            header: 'Location',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'plays',
            header: 'Play Count',
            width: '120px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'source',
            header: 'Source',
            width: '150px',
            filter: true,
            filterType: 'select',
        },
        {
            field: 'fetchedDate',
            header: 'Date Created',
            width: '180px',
            filter: true,
            filterType: 'date',
        },
    ];

    /**
     * Table data - top-performing programmatic ads.
     *
     * @type {DashboardTopAd[]}
     */
    allAds = signal<DashboardTopAd[]>([]);

    /**
     * Number of rows revealed per "Show More" click, and the initial page size.
     * @type {number}
     */
    readonly pageSize = 20;

    /**
     * Number of allAds rows currently revealed to ntv-table's native
     * "Show More" pagination. All rows are already loaded client-side
     * (via the analytics call), so "Show More" just slices further in -
     * no extra network request needed.
     * @type {number}
     */
    visibleAdsCount = signal(this.pageSize);

    /**
     * Current per-column filters and sort for the Ad Ranking table, driven
     * by ntv-table's built-in column filter/sort UI. Ad Ranking has no
     * server-side filter/sort endpoint (it's fully loaded client-side per
     * date range already), so these are applied in-memory against allAds()
     * with the library's own filterData/sortDataByField helpers - the same
     * logic ntv-table would apply itself if it weren't in server-pagination
     * mode (required here for "Show More" via totalDataLength).
     */
    private adRankingFilters = signal<Record<string, unknown>>({});
    private adRankingSortField = signal<string | null>(null);
    private adRankingSortOrder = signal<'asc' | 'desc'>('asc');

    /**
     * All ads matching the current Ad Ranking column filters, sorted by the
     * current column sort - the full set "Show More" pages through.
     * @type {DashboardTopAd[]}
     */
    filteredSortedAds = computed(() => {
        const filtered = filterData(
            this.allAds(),
            this.adRankingFilters(),
            this.tableColumns,
            true,
        );
        return sortDataByField(
            filtered,
            this.adRankingSortField() ?? '',
            this.adRankingSortOrder(),
            this.tableColumns,
        ) as DashboardTopAd[];
    });

    /**
     * Ads currently visible in the "Programmatic Ads Ranking" table.
     * @type {DashboardTopAd[]}
     */
    tableData = computed(() => this.filteredSortedAds().slice(0, this.visibleAdsCount()));

    /**
     * Handles sort/filter/page state changes from the Ad Ranking table.
     * Applied fully client-side against allAds() - see filteredSortedAds.
     *
     * @param {TableStateEvent} event - Table state change event
     * @returns {void}
     */
    onAdRankingStateChange(event: TableStateEvent): void {
        this.adRankingFilters.set(event.filters);
        this.adRankingSortField.set(event.sortField);
        this.adRankingSortOrder.set(event.sortOrder);
        this.visibleAdsCount.set(this.pageSize);
    }

    /**
     * Column definitions for the "Programmatic Host Ranking" table.
     * @type {TableColumn[]}
     */
    hostRankingColumns: TableColumn[] = [
        {
            field: 'screenshotUrl',
            header: 'Latest Play',
            width: '70px',
            filter: false,
        },
        {
            field: 'venueId',
            header: 'Venue ID',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'hostName',
            header: 'Host Business Name',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'city',
            header: 'City',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'state',
            header: 'State',
            width: '120px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'category',
            header: 'Category',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'businessHoursSchedule',
            header: 'Business Hours',
            width: '160px',
            filter: false,
        },
        {
            field: 'totalAds',
            header: 'Total Ads',
            width: '150px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'slotCount',
            header: 'Slot Count',
            width: '130px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'expectedRequests',
            header: 'Expected Reqs',
            width: '150px',
            filter: true,
            filterType: 'date',
        },
    ];

    /**
     * All venues ("hosts"), ranked by play-record count, descending, enriched
     * with host details (business name, city, state, category).
     * @type {HostRankingEntry[]}
     */
    hostRanking = signal<HostRankingEntry[]>([]);

    /**
     * Number of hostRanking rows currently revealed to ntv-table's native
     * "Show More" pagination - same all-loaded-client-side pattern as
     * the "Programmatic Ads Ranking" table.
     * @type {number}
     */
    visibleHostRankingCount = signal(this.pageSize);

    /**
     * Host ranking rows currently visible in the "Venue Ranking" table.
     * @type {HostRankingEntry[]}
     */
    /**
     * Current per-column filters and sort for the Venue Ranking table -
     * same fully-client-side pattern as adRankingFilters/tableColumns above,
     * since Venue Ranking is likewise loaded whole per date range with no
     * server-side filter/sort endpoint.
     */
    private venueRankingFilters = signal<Record<string, unknown>>({});
    private venueRankingSortField = signal<string | null>(null);
    private venueRankingSortOrder = signal<'asc' | 'desc'>('asc');

    /**
     * All host ranking rows matching the current Venue Ranking column
     * filters, sorted by the current column sort - the full set "Show More"
     * pages through.
     * @type {HostRankingEntry[]}
     */
    filteredSortedHostRanking = computed(() => {
        const filtered = filterData(
            this.hostRanking(),
            this.venueRankingFilters(),
            this.hostRankingColumns,
            true,
        );
        return sortDataByField(
            filtered,
            this.venueRankingSortField() ?? '',
            this.venueRankingSortOrder(),
            this.hostRankingColumns,
        ) as HostRankingEntry[];
    });

    hostRankingTableData = computed(() =>
        this.filteredSortedHostRanking().slice(0, this.visibleHostRankingCount()),
    );

    /**
     * Handles sort/filter/page state changes from the Venue Ranking table.
     * Applied fully client-side against hostRanking() - see
     * filteredSortedHostRanking.
     *
     * @param {TableStateEvent} event - Table state change event
     * @returns {void}
     */
    onVenueRankingStateChange(event: TableStateEvent): void {
        this.venueRankingFilters.set(event.filters);
        this.venueRankingSortField.set(event.sortField);
        this.venueRankingSortOrder.set(event.sortOrder);
        this.visibleHostRankingCount.set(this.pageSize);
    }

    /**
     * Loading state for the Venue Ranking table's own query - independent of
     * dashboardAnalytics(), since it's served by a dedicated, date-range-aware
     * endpoint instead of being baked into the main analytics call.
     */
    isLoadingVenueRanking = signal(false);

    /**
     * Whether Venue Ranking has completed at least one load since this
     * component was created - see hasLoadedRawAdsOnce for why this matters.
     */
    hasLoadedVenueRankingOnce = signal(false);

    /**
     * Currently-selected date range for the Venue Ranking table, or null for
     * all-time (no range filter).
     */
    venueRankingRange = signal<{ start: Date; end: Date } | null>(null);

    /**
     * The page's date range, shared with the Dashboard and the top bar's totals (set by
     * the range controls in the page header)
     * @type {DashboardRangeService}
     */
    private readonly rangeService = inject(DashboardRangeService);

    /**
     * Global "Eastern Time / UTC" display preference, read by the template
     * to format every table's raw timestamp columns.
     * @type {TimeDisplayService}
     */
    protected readonly timeDisplayService = inject(TimeDisplayService);

    /**
     * The page header's subtitle, naming whichever zone is currently active
     * - the underlying day boundaries (and so every tab's numbers) actually
     * shift with this, not just the label.
     * @type {Signal<string>}
     */
    protected readonly subtitle = computed(
        () =>
            `Ad plays, proof of play and rankings across the network. Every tab follows the date range (${
                this.timeDisplayService.mode() === 'eastern' ? 'Eastern Time' : 'UTC'
            } days).`,
    );

    /**
     * The shared range as a stream (null for "All time"), for reloading every tab when it
     * changes - combined with the "Eastern Time / UTC" display mode, since a quick range
     * like "Yesterday" can resolve to the exact same calendar-date label in both zones for
     * most of the day (they only disagree for the ~4-5 hours after UTC midnight before
     * Eastern's own midnight) while still meaning a genuinely different UTC instant window
     * underneath that label (resolve-date-zone.middleware.ts) - reacting to the range alone
     * would silently skip reloading whenever the label happens to match, leaving every
     * tab's numbers computed in the old zone.
     * @type {Observable<DashboardRange | null>}
     */
    private readonly sharedRange$ = combineLatest([
        toObservable(this.rangeService.pageRange),
        toObservable(this.timeDisplayService.mode),
    ]).pipe(map(([range]) => range));

    /**
     * In-flight request per table (and the stat cards). A reload (new date range, search,
     * filter or retry) cancels the previous one, so a slower response for an older
     * request can't overwrite newer data.
     */
    private analyticsRequest?: Subscription;
    private rawAdsRequest?: Subscription;
    private adRankingRequest?: Subscription;
    private venueRankingRequest?: Subscription;
    private stateRankingRequest?: Subscription;
    private categoryRankingRequest?: Subscription;

    /**
     * Angular lifecycle hook that loads live dashboard data.
     *
     * @returns {void}
     */
    ngOnInit(): void {
        // Cancel whatever is still in flight when the page is left
        this.destroyRef.onDestroy(() => {
            for (const request of [
                this.analyticsRequest,
                this.rawAdsRequest,
                this.adRankingRequest,
                this.venueRankingRequest,
                this.stateRankingRequest,
                this.categoryRankingRequest,
            ]) {
                request?.unsubscribe();
            }
        });

        // The stat cards and every tab follow the page's one date range (shared with the
        // Dashboard and the top bar's totals): the first value loads them all, and each
        // new range reloads them all. Setting the same range again is ignored by the
        // range service. "All time" arrives as null: every record, no range.
        this.sharedRange$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((shared) => {
            const range = shared ? toLocalDateRange(shared) : null;

            this.rawAdsRange.set(range);
            this.loadAnalytics();
            this.loadRawAds();
            this.loadAdRanking(range);
            this.loadVenueRanking(range);
            this.loadStateRanking(range);
            this.loadCategoryRanking(range);
        });
    }

    /**
     * Loads the stat cards' numbers for the page's date range, tracking failure so the
     * UI can show a retry state instead of leaving the skeleton loading forever.
     *
     * @returns {void}
     */
    loadAnalytics(): void {
        this.analyticsLoadFailed.set(false);
        // Back to the skeletons while the new range loads - the old numbers belong to
        // the previous range
        this.dashboardAnalytics.set(null);

        this.analyticsRequest?.unsubscribe();
        this.analyticsRequest = this.mediaFilesService
            .getDashboardAnalytics(this.rawAdsDateParams())
            .subscribe({
                next: (analytics: DashboardAnalytics) => this.applyAnalytics(analytics),
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load analytics:', error);
                    this.analyticsLoadFailed.set(true);
                },
            });
    }

    /**
     * Loads the Venue Ranking table's data, optionally scoped to a date range.
     * Independent of the main analytics call - the Ad Ranking tab and stat
     * cards don't reload just because this table's range changed.
     *
     * @param {{ start: Date; end: Date } | null} [range] - Date range to scope to, or omit for all-time
     * @returns {void}
     */
    loadVenueRanking(range?: { start: Date; end: Date } | null): void {
        this.isLoadingVenueRanking.set(true);
        this.venueRankingRange.set(range ?? null);
        this.venueRankingTable()?.showLoadingOverlay('Loading...');

        this.venueRankingRequest?.unsubscribe();
        this.venueRankingRequest = this.mediaFilesService
            .getVenueRanking({
                // The exact calendar date(s) picked, e.g. "2026-09-01" - not
                // an ISO instant, since converting a local midnight to UTC
                // bakes in the browser's own timezone offset, shifting both
                // the DB query window and the resolved weekday depending on
                // where the browser happens to be (a browser in PH and a
                // venue in the US can land on different calendar days, or a
                // different 24h window, for what looks like the same date).
                startDate: range ? this.formatCalendarDate(range.start) : undefined,
                endDate: range ? this.formatCalendarDate(range.end) : undefined,
            })
            .subscribe({
                next: (data) => {
                    this.hostRanking.set(data);
                    this.visibleHostRankingCount.set(this.pageSize);
                    this.venueRankingFilters.set({});
                    this.venueRankingSortField.set(null);
                    this.isLoadingVenueRanking.set(false);
                    this.hasLoadedVenueRankingOnce.set(true);
                    this.venueRankingTable()?.hideLoadingOverlay();
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load venue ranking:', error);
                    this.isLoadingVenueRanking.set(false);
                    this.hasLoadedVenueRankingOnce.set(true);
                    this.venueRankingTable()?.hideLoadingOverlay();
                },
            });
    }

    /**
     * Formats a Date's own local calendar components as "YYYY-MM-DD" -
     * deliberately not toISOString(), which converts to UTC and can shift
     * the date backward or forward a day depending on the browser's offset.
     *
     * @param {Date} date - Date to format
     * @returns {string} "YYYY-MM-DD"
     */
    private formatCalendarDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Column definitions for the "State Ranking" table - a many-venues-to-
     * one-state rollup of Venue Ranking, so most per-venue columns (host
     * name, city, category, business hours, screenshot) don't generalize
     * and are dropped in favor of venueCount.
     * @type {TableColumn[]}
     */
    stateRankingColumns: TableColumn[] = [
        { field: 'state', header: 'State', width: '150px', filter: true, filterType: 'text' },
        {
            field: 'venueCount',
            header: 'Venue Count',
            width: '150px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'totalAds',
            header: 'Total Ads',
            width: '150px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'uniqueAdsPlayed',
            header: 'Unique Ads Played',
            width: '160px',
            filter: true,
            filterType: 'date',
        },
    ];

    /**
     * Column definitions for the "Category Ranking" table - a many-venues-to-
     * one-category rollup, same shape as stateRankingColumns with `category`
     * in place of `state`.
     * @type {TableColumn[]}
     */
    categoryRankingColumns: TableColumn[] = [
        { field: 'category', header: 'Category', width: '150px', filter: true, filterType: 'text' },
        {
            field: 'venueCount',
            header: 'Venue Count',
            width: '150px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'totalAds',
            header: 'Total Ads',
            width: '150px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'uniqueAdsPlayed',
            header: 'Unique Ads Played',
            width: '160px',
            filter: true,
            filterType: 'date',
        },
    ];

    /**
     * All states, ranked by play-record count, descending - each row sums
     * totalAds/expectedRequests across every venue the Hosts API resolved
     * to that state.
     * @type {StateRankingEntry[]}
     */
    stateRanking = signal<StateRankingEntry[]>([]);

    /**
     * Per-venue breakdown each stateRanking row was rolled up from - the
     * same HostRankingEntry shape Venue Ranking itself uses, filtered by
     * state for the "Total Ads" drill-down modal.
     * @type {HostRankingEntry[]}
     */
    stateRankingVenues = signal<HostRankingEntry[]>([]);

    /**
     * Number of stateRanking rows currently revealed to ntv-table's native
     * "Show More" pagination - same all-loaded-client-side pattern as
     * Venue Ranking.
     * @type {number}
     */
    visibleStateRankingCount = signal(this.pageSize);

    /**
     * Current per-column filters and sort for the State Ranking table -
     * same fully-client-side pattern as venueRankingFilters above.
     */
    private stateRankingFilters = signal<Record<string, unknown>>({});
    private stateRankingSortField = signal<string | null>(null);
    private stateRankingSortOrder = signal<'asc' | 'desc'>('asc');

    /**
     * All state ranking rows matching the current State Ranking column
     * filters, sorted by the current column sort - the full set "Show More"
     * pages through.
     * @type {StateRankingEntry[]}
     */
    filteredSortedStateRanking = computed(() => {
        const filtered = filterData(
            this.stateRanking(),
            this.stateRankingFilters(),
            this.stateRankingColumns,
            true,
        );
        return sortDataByField(
            filtered,
            this.stateRankingSortField() ?? '',
            this.stateRankingSortOrder(),
            this.stateRankingColumns,
        ) as StateRankingEntry[];
    });

    stateRankingTableData = computed(() =>
        this.filteredSortedStateRanking().slice(0, this.visibleStateRankingCount()),
    );

    /**
     * Handles sort/filter/page state changes from the State Ranking table.
     * Applied fully client-side against stateRanking() - see
     * filteredSortedStateRanking.
     *
     * @remarks
     * The table's own showMore()/showLess() also emits this same
     * tableStateChange event (via its internal emitTableState()) right
     * after emitting showMoreRequested/showLessRequested - so this fires on
     * every "Show More" click too, not just on an actual filter/sort
     * change. Resetting visibleStateRankingCount unconditionally here was
     * clobbering the increment showMoreStateRanking() had just applied a
     * moment earlier in the same click, making "Show More" appear to do
     * nothing. Only reset the page when the filters/sort actually changed.
     *
     * @param {TableStateEvent} event - Table state change event
     * @returns {void}
     */
    onStateRankingStateChange(event: TableStateEvent): void {
        const filtersChanged =
            JSON.stringify(event.filters) !== JSON.stringify(this.stateRankingFilters());
        const sortChanged =
            event.sortField !== this.stateRankingSortField() ||
            event.sortOrder !== this.stateRankingSortOrder();

        this.stateRankingFilters.set(event.filters);
        this.stateRankingSortField.set(event.sortField);
        this.stateRankingSortOrder.set(event.sortOrder);

        if (filtersChanged || sortChanged) {
            this.visibleStateRankingCount.set(this.pageSize);
        }
    }

    /**
     * Loading state for the State Ranking table's own query - independent
     * of dashboardAnalytics() and Venue Ranking, since it has its own
     * dedicated, date-range-aware endpoint and its own independent range.
     */
    isLoadingStateRanking = signal(false);

    /**
     * Whether State Ranking has completed at least one load since this
     * component was created - see hasLoadedRawAdsOnce for why this matters.
     */
    hasLoadedStateRankingOnce = signal(false);

    /**
     * Currently-selected date range for the State Ranking table, or null for
     * all-time (no range filter) - independent of Venue Ranking's own range.
     */
    stateRankingRange = signal<{ start: Date; end: Date } | null>(null);

    /**
     * Loads the State Ranking table's data, optionally scoped to a date
     * range. Independent of Venue Ranking - changing one tab's range
     * doesn't reload the other.
     *
     * @param {{ start: Date; end: Date } | null} [range] - Date range to scope to, or omit for all-time
     * @returns {void}
     */
    loadStateRanking(range?: { start: Date; end: Date } | null): void {
        this.isLoadingStateRanking.set(true);
        this.stateRankingRange.set(range ?? null);
        this.stateRankingTable()?.showLoadingOverlay('Loading...');

        this.stateRankingRequest?.unsubscribe();
        this.stateRankingRequest = this.mediaFilesService
            .getStateRanking({
                startDate: range ? this.formatCalendarDate(range.start) : undefined,
                endDate: range ? this.formatCalendarDate(range.end) : undefined,
            })
            .subscribe({
                next: ({ states, venues }) => {
                    this.stateRanking.set(states);
                    this.stateRankingVenues.set(venues);
                    this.visibleStateRankingCount.set(this.pageSize);
                    this.stateRankingFilters.set({});
                    this.stateRankingSortField.set(null);
                    this.isLoadingStateRanking.set(false);
                    this.hasLoadedStateRankingOnce.set(true);
                    this.stateRankingTable()?.hideLoadingOverlay();
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load state ranking:', error);
                    this.isLoadingStateRanking.set(false);
                    this.hasLoadedStateRankingOnce.set(true);
                    this.stateRankingTable()?.hideLoadingOverlay();
                },
            });
    }

    /**
     * Reveals the next page of already-loaded state ranking rows. Bound to
     * ntv-table's native showMoreRequested output for the "State Ranking" tab.
     *
     * @returns {void}
     */
    showMoreStateRanking(): void {
        this.visibleStateRankingCount.update((count) =>
            Math.min(count + this.pageSize, this.stateRanking().length),
        );
    }

    /**
     * State whose "Total Ads" detail modal is currently open, or null if closed.
     */
    selectedStateForVenuesModal = signal<StateRankingEntry | null>(null);

    /**
     * Venues within the currently-open state breakdown modal's state -
     * filtered from stateRankingVenues(), no extra fetch needed since the
     * State Ranking load already returned every venue behind every state.
     * @type {HostRankingEntry[]}
     */
    stateVenuesModalData = computed(() => {
        const state = this.selectedStateForVenuesModal();
        if (!state) {
            return [];
        }

        return this.stateRankingVenues().filter(
            (venue) => (venue.state ?? 'Unknown') === state.state,
        );
    });

    /**
     * Opens the "Total Ads" detail modal for a state, listing every venue
     * rolled into it.
     *
     * @param {StateRankingEntry} entry - The state row that was clicked
     * @returns {void}
     */
    openStateVenuesModal(entry: StateRankingEntry): void {
        this.selectedStateForVenuesModal.set(entry);
    }

    /**
     * Closes the state breakdown modal.
     *
     * @returns {void}
     */
    closeStateVenuesModal(): void {
        this.selectedStateForVenuesModal.set(null);
    }

    /**
     * Loading state for the state-venues modal's export action.
     */
    isExportingStateVenues = signal(false);

    /**
     * Whether the state-venues modal's export is currently allowed. Unlike
     * the raw Programmatic Ads/Venue Ranking exports, this doesn't require
     * an explicit bounded date range first - the modal's venue list is
     * already loaded and bounded to one state regardless of range (the
     * State Ranking table itself has no required-range restriction either),
     * so an export of what's already on screen shouldn't invent one.
     */
    canExportStateVenues = computed(() => this.stateVenuesModalData().length > 0);

    /**
     * Explains why the state-venues modal's export is disabled, or null if
     * it's currently allowed. Shown as the export button's tooltip.
     */
    stateVenuesExportDisabledReason = computed(() =>
        this.stateVenuesModalData().length === 0 ? 'No venues to export' : null,
    );

    /**
     * Exports the currently-open state-venues modal's venues - CSV is built
     * client-side from the already-loaded stateVenuesModalData() (no extra
     * fetch); XLSX round-trips to the server for the styled workbook,
     * scoped to this state and the State Ranking tab's active range.
     *
     * @param {ExportFormat} format - 'csv' or 'xlsx'
     * @returns {void}
     */
    exportStateVenues(format: ExportFormat): void {
        const state = this.selectedStateForVenuesModal();
        if (!state || this.isExportingStateVenues() || !this.canExportStateVenues()) {
            return;
        }

        this.isExportingStateVenues.set(true);

        if (format === 'xlsx') {
            this.mediaFilesService
                .getStateVenuesExportXlsx(state.state, this.dateParamsFor(this.stateRankingRange()))
                .subscribe({
                    next: (file) => {
                        downloadFile(file, dateStampedFilename(`${state.state}-venues`, 'xlsx'));
                        this.isExportingStateVenues.set(false);
                    },
                    error: (error: unknown) => {
                        console.error('[Ranking Data] Failed to export state venues:', error);
                        this.isExportingStateVenues.set(false);
                    },
                });
            return;
        }

        const headers = VENUE_RANKING_EXPORT_COLUMNS.map((column) => column.header);
        const rows = this.stateVenuesModalData().map((entry) =>
            VENUE_RANKING_EXPORT_COLUMNS.map((column) =>
                toCsvValue(column.format ? column.format(entry) : entry[column.key]),
            ),
        );
        downloadFile(
            buildCsvBlob(headers, rows),
            dateStampedFilename(`${state.state}-venues`, 'csv'),
        );
        this.isExportingStateVenues.set(false);
    }

    /**
     * Drills one level deeper from the state breakdown modal into a single
     * venue's own ad list - closes the state modal first (only one modal
     * visible at a time) and opens the venue-ads modal scoped to the State
     * Ranking tab's own active range, not Venue Ranking's.
     *
     * @param {HostRankingEntry} venue - The venue row clicked inside the state breakdown
     * @returns {void}
     */
    openVenueAdsModalFromStateBreakdown(venue: HostRankingEntry): void {
        this.closeStateVenuesModal();
        this.openVenueAdsModalForVenue(venue, this.stateRankingRange());
    }

    /**
     * State whose "Unique Ads Played" detail modal is currently open, or
     * null if closed.
     */
    selectedStateForAdsModal = signal<StateRankingEntry | null>(null);

    /**
     * Ads played anywhere in the currently-open state-ads modal's state,
     * ranked by play count - powers the "Unique Ads Played" drill-down.
     * @type {DashboardTopAd[]}
     */
    stateAdsModalData = signal<DashboardTopAd[]>([]);

    /**
     * Loading state for the state-ads modal.
     */
    isLoadingStateAdsModal = signal(false);

    /**
     * Opens the "Unique Ads Played" detail modal for a state and loads the
     * ads played at any venue in that state, scoped to the State Ranking
     * table's active date range. Restricts to exactly the venues
     * stateRankingVenues() already resolved for this state - no second
     * Hosts API round trip needed.
     *
     * @param {StateRankingEntry} entry - The state row that was clicked
     * @returns {void}
     */
    openStateAdsModal(entry: StateRankingEntry): void {
        this.selectedStateForAdsModal.set(entry);
        this.stateAdsModalData.set([]);
        this.isLoadingStateAdsModal.set(true);

        const venueIds = this.stateRankingVenues()
            .filter((venue) => (venue.state ?? 'Unknown') === entry.state)
            .map((venue) => venue.venueId);

        this.mediaFilesService
            .getAdsByVenues(venueIds, this.dateParamsFor(this.stateRankingRange()))
            .subscribe({
                next: (ads) => {
                    this.stateAdsModalData.set(ads);
                    this.isLoadingStateAdsModal.set(false);
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load state ads:', error);
                    this.isLoadingStateAdsModal.set(false);
                },
            });
    }

    /**
     * Closes the state-ads modal.
     *
     * @returns {void}
     */
    closeStateAdsModal(): void {
        this.selectedStateForAdsModal.set(null);
        this.stateAdsModalData.set([]);
    }

    /**
     * All categories, ranked by play-record count, descending - each row
     * sums totalAds/expectedRequests across every venue the Hosts API
     * resolved to that category. Mirrors stateRanking.
     * @type {CategoryRankingEntry[]}
     */
    categoryRanking = signal<CategoryRankingEntry[]>([]);

    /**
     * Per-venue breakdown each categoryRanking row was rolled up from - the
     * same HostRankingEntry shape Venue Ranking itself uses, filtered by
     * category for the drill-down modals.
     * @type {HostRankingEntry[]}
     */
    categoryRankingVenues = signal<HostRankingEntry[]>([]);

    /**
     * Number of categoryRanking rows currently revealed to ntv-table's
     * native "Show More" pagination.
     * @type {number}
     */
    visibleCategoryRankingCount = signal(this.pageSize);

    /**
     * Current per-column filters and sort for the Category Ranking table -
     * same fully-client-side pattern as stateRankingFilters above.
     */
    private categoryRankingFilters = signal<Record<string, unknown>>({});
    private categoryRankingSortField = signal<string | null>(null);
    private categoryRankingSortOrder = signal<'asc' | 'desc'>('asc');

    /**
     * All category ranking rows matching the current Category Ranking
     * column filters, sorted by the current column sort - the full set
     * "Show More" pages through.
     * @type {CategoryRankingEntry[]}
     */
    filteredSortedCategoryRanking = computed(() => {
        const filtered = filterData(
            this.categoryRanking(),
            this.categoryRankingFilters(),
            this.categoryRankingColumns,
            true,
        );
        return sortDataByField(
            filtered,
            this.categoryRankingSortField() ?? '',
            this.categoryRankingSortOrder(),
            this.categoryRankingColumns,
        ) as CategoryRankingEntry[];
    });

    categoryRankingTableData = computed(() =>
        this.filteredSortedCategoryRanking().slice(0, this.visibleCategoryRankingCount()),
    );

    /**
     * Handles sort/filter/page state changes from the Category Ranking
     * table. Applied fully client-side against categoryRanking() - see
     * filteredSortedCategoryRanking.
     *
     * @param {TableStateEvent} event - Table state change event
     * @returns {void}
     */
    onCategoryRankingStateChange(event: TableStateEvent): void {
        this.categoryRankingFilters.set(event.filters);
        this.categoryRankingSortField.set(event.sortField);
        this.categoryRankingSortOrder.set(event.sortOrder);
        this.visibleCategoryRankingCount.set(this.pageSize);
    }

    /**
     * Loading state for the Category Ranking table's own query - independent
     * of the other tabs, since it has its own dedicated, date-range-aware
     * endpoint and its own independent range.
     */
    isLoadingCategoryRanking = signal(false);

    /**
     * Whether Category Ranking has completed at least one load since this
     * component was created - see hasLoadedRawAdsOnce for why this matters.
     */
    hasLoadedCategoryRankingOnce = signal(false);

    /**
     * Currently-selected date range for the Category Ranking table, or null
     * for all-time (no range filter) - independent of the other tabs' own
     * ranges.
     */
    categoryRankingRange = signal<{ start: Date; end: Date } | null>(null);

    /**
     * Loads the Category Ranking table's data, optionally scoped to a date
     * range. Independent of the other tabs - changing one tab's range
     * doesn't reload another.
     *
     * @param {{ start: Date; end: Date } | null} [range] - Date range to scope to, or omit for all-time
     * @returns {void}
     */
    loadCategoryRanking(range?: { start: Date; end: Date } | null): void {
        this.isLoadingCategoryRanking.set(true);
        this.categoryRankingRange.set(range ?? null);
        this.categoryRankingTable()?.showLoadingOverlay('Loading...');

        this.categoryRankingRequest?.unsubscribe();
        this.categoryRankingRequest = this.mediaFilesService
            .getCategoryRanking({
                startDate: range ? this.formatCalendarDate(range.start) : undefined,
                endDate: range ? this.formatCalendarDate(range.end) : undefined,
            })
            .subscribe({
                next: ({ categories, venues }) => {
                    this.categoryRanking.set(categories);
                    this.categoryRankingVenues.set(venues);
                    this.visibleCategoryRankingCount.set(this.pageSize);
                    this.categoryRankingFilters.set({});
                    this.categoryRankingSortField.set(null);
                    this.isLoadingCategoryRanking.set(false);
                    this.hasLoadedCategoryRankingOnce.set(true);
                    this.categoryRankingTable()?.hideLoadingOverlay();
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load category ranking:', error);
                    this.isLoadingCategoryRanking.set(false);
                    this.hasLoadedCategoryRankingOnce.set(true);
                    this.categoryRankingTable()?.hideLoadingOverlay();
                },
            });
    }

    /**
     * Reveals the next page of already-loaded category ranking rows. Bound
     * to ntv-table's native showMoreRequested output for the "Category
     * Ranking" tab.
     *
     * @returns {void}
     */
    showMoreCategoryRanking(): void {
        this.visibleCategoryRankingCount.update((count) =>
            Math.min(count + this.pageSize, this.categoryRanking().length),
        );
    }

    /**
     * Category whose venue breakdown modal is currently open, or null if closed.
     */
    selectedCategoryForVenuesModal = signal<CategoryRankingEntry | null>(null);

    /**
     * Venues within the currently-open category breakdown modal's category -
     * filtered from categoryRankingVenues(), no extra fetch needed since the
     * Category Ranking load already returned every venue behind every
     * category.
     * @type {HostRankingEntry[]}
     */
    categoryVenuesModalData = computed(() => {
        const category = this.selectedCategoryForVenuesModal();
        if (!category) {
            return [];
        }

        return this.categoryRankingVenues().filter(
            (venue) => (venue.category ?? 'Unknown') === category.category,
        );
    });

    /**
     * Opens the venue breakdown modal for a category, listing every venue
     * rolled into it.
     *
     * @param {CategoryRankingEntry} entry - The category row that was clicked
     * @returns {void}
     */
    openCategoryVenuesModal(entry: CategoryRankingEntry): void {
        this.selectedCategoryForVenuesModal.set(entry);
    }

    /**
     * Closes the category breakdown modal.
     *
     * @returns {void}
     */
    closeCategoryVenuesModal(): void {
        this.selectedCategoryForVenuesModal.set(null);
    }

    /**
     * Drills one level deeper from the category breakdown modal into a
     * single venue's own ad list - closes the category modal first (only
     * one modal visible at a time) and opens the venue-ads modal scoped to
     * the Category Ranking tab's own active range.
     *
     * @param {HostRankingEntry} venue - The venue row clicked inside the category breakdown
     * @returns {void}
     */
    openVenueAdsModalFromCategoryBreakdown(venue: HostRankingEntry): void {
        this.closeCategoryVenuesModal();
        this.openVenueAdsModalForVenue(venue, this.categoryRankingRange());
    }

    /**
     * Category whose "Unique Ads Played" detail modal is currently open, or
     * null if closed.
     */
    selectedCategoryForAdsModal = signal<CategoryRankingEntry | null>(null);

    /**
     * Ads played anywhere in the currently-open category-ads modal's
     * category, ranked by play count - powers the "Unique Ads Played"
     * drill-down.
     * @type {DashboardTopAd[]}
     */
    categoryAdsModalData = signal<DashboardTopAd[]>([]);

    /**
     * Loading state for the category-ads modal.
     */
    isLoadingCategoryAdsModal = signal(false);

    /**
     * Opens the "Unique Ads Played" detail modal for a category and loads
     * the ads played at any venue in that category, scoped to the Category
     * Ranking table's active date range. Restricts to exactly the venues
     * categoryRankingVenues() already resolved for this category - no
     * second Hosts API round trip needed.
     *
     * @param {CategoryRankingEntry} entry - The category row that was clicked
     * @returns {void}
     */
    openCategoryAdsModal(entry: CategoryRankingEntry): void {
        this.selectedCategoryForAdsModal.set(entry);
        this.categoryAdsModalData.set([]);
        this.isLoadingCategoryAdsModal.set(true);

        const venueIds = this.categoryRankingVenues()
            .filter((venue) => (venue.category ?? 'Unknown') === entry.category)
            .map((venue) => venue.venueId);

        this.mediaFilesService
            .getAdsByVenues(venueIds, this.dateParamsFor(this.categoryRankingRange()))
            .subscribe({
                next: (ads) => {
                    this.categoryAdsModalData.set(ads);
                    this.isLoadingCategoryAdsModal.set(false);
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load category ads:', error);
                    this.isLoadingCategoryAdsModal.set(false);
                },
            });
    }

    /**
     * Closes the category-ads modal.
     *
     * @returns {void}
     */
    closeCategoryAdsModal(): void {
        this.selectedCategoryForAdsModal.set(null);
        this.categoryAdsModalData.set([]);
    }

    /**
     * Converts a date range into startDate/endDate query params as
     * "YYYY-MM-DD" calendar dates - shared by every table's date-range
     * filtering and export, so they all resolve dates the same way.
     *
     * @param {{ start: Date; end: Date } | null} range - Date range, or null for all-time
     * @returns {{ startDate?: string; endDate?: string }} Date params, empty if no range is given
     */
    private dateParamsFor(range: { start: Date; end: Date } | null): {
        startDate?: string;
        endDate?: string;
    } {
        if (!range) {
            return {};
        }

        return {
            startDate: this.formatCalendarDate(range.start),
            endDate: this.formatCalendarDate(range.end),
        };
    }

    /**
     * Builds the startDate/endDate query params for the raw Programmatic Ads
     * table from rawAdsRange, as "YYYY-MM-DD" calendar dates.
     *
     * @returns {{ startDate?: string; endDate?: string }} Date params, empty if no range is set
     */
    private rawAdsDateParams(): { startDate?: string; endDate?: string } {
        return this.dateParamsFor(this.rawAdsRange());
    }

    /**
     * Retries loading dashboard analytics and the raw ads table after a failed load.
     *
     * @returns {void}
     */
    retryDashboardLoad(): void {
        this.loadAnalytics();
        this.loadRawAds();
    }

    /**
     * Applies aggregate API data to dashboard cards and the top-ads table.
     *
     * @param analytics - Aggregate dashboard data
     * @returns {void}
     */
    private applyAnalytics(analytics: DashboardAnalytics): void {
        this.totalPlayRecords = analytics.totalPlayRecords;
        this.successfulPopCount = analytics.successfulPopCount;
        this.pendingOverdueCount = analytics.pendingOverdueCount;
        this.pendingRecentCount = analytics.pendingRecentCount;
        this.greenCount = analytics.greenCount;
        this.yellowCount = analytics.yellowCount;
        this.redCount = analytics.redCount;
        this.dashboardAnalytics.set(analytics);
    }

    /**
     * Loads the Ad Ranking table's data, optionally scoped to a date range.
     * Independent of the main analytics call - the stat cards and Analytics
     * page's top-5 widget don't reload just because this table's range changed.
     *
     * @param {{ start: Date; end: Date } | null} [range] - Date range to scope to, or omit for all-time
     * @returns {void}
     */
    loadAdRanking(range?: { start: Date; end: Date } | null): void {
        this.isLoadingAdRanking.set(true);
        this.adRankingRange.set(range ?? null);
        this.adsRankingTable()?.showLoadingOverlay('Loading...');

        this.adRankingRequest?.unsubscribe();
        this.adRankingRequest = this.mediaFilesService
            .getAdRanking(this.dateParamsFor(range ?? null))
            .subscribe({
                next: (data) => {
                    this.allAds.set(data);
                    this.visibleAdsCount.set(this.pageSize);
                    this.adRankingFilters.set({});
                    this.adRankingSortField.set(null);
                    this.isLoadingAdRanking.set(false);
                    this.hasLoadedAdsRankingOnce.set(true);
                    this.adsRankingTable()?.hideLoadingOverlay();
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load ad ranking:', error);
                    this.isLoadingAdRanking.set(false);
                    this.hasLoadedAdsRankingOnce.set(true);
                    this.adsRankingTable()?.hideLoadingOverlay();
                },
            });
    }

    /**
     * Exports the currently-loaded Ad Ranking rows (already the full,
     * unpaginated set matching the active date range - no extra fetch needed
     * for CSV). XLSX still round-trips to the server, to reuse the same
     * styled-workbook builder as every other export.
     *
     * @param format - Export file format
     * @returns {void}
     */
    exportAdRanking(format: ExportFormat): void {
        if (this.isExportingAdRanking() || !this.canExportAdRanking()) {
            return;
        }

        this.isExportingAdRanking.set(true);

        if (format === 'xlsx') {
            this.mediaFilesService
                .getAdRankingExportXlsx(this.dateParamsFor(this.adRankingRange()))
                .subscribe({
                    next: (file) => {
                        downloadFile(file, dateStampedFilename('ad-ranking', 'xlsx'));
                        this.isExportingAdRanking.set(false);
                    },
                    error: (error: unknown) => {
                        console.error('[Ranking Data] Failed to export ad ranking:', error);
                        this.isExportingAdRanking.set(false);
                    },
                });
            return;
        }

        const columns = buildAdRankingExportColumns(this.timeDisplayService.zoneId());
        const headers = columns.map((column) => column.header);
        const rows = this.allAds().map((ad) =>
            columns.map((column) => toCsvValue(column.format ? column.format(ad) : ad[column.key])),
        );
        downloadFile(buildCsvBlob(headers, rows), dateStampedFilename('ad-ranking', 'csv'));
        this.isExportingAdRanking.set(false);
    }

    /**
     * Builds the current Programmatic Ads table filters (bucket, sort,
     * search, column filters, date range) for export, so an export always
     * matches whatever's currently filtered/shown in the table.
     *
     * @returns {ProgrammaticAdsFilterOptions} Current filter state
     */
    private currentRawAdsFilters(): ProgrammaticAdsFilterOptions {
        return {
            bucket: this.activeBucketFilter() ?? undefined,
            sortBy: this.activeSortBy,
            sortDir: this.activeSortDir,
            search: this.searchTerm() || undefined,
            columnFilters: this.activeColumnFilters,
            ...this.rawAdsDateParams(),
        };
    }

    /**
     * Exports every programmatic_ads row matching the current Programmatic
     * Ads table filters, with resolved creative media fields.
     *
     * @param format - Export file format
     * @returns {void}
     */
    exportProgrammaticAds(format: ExportFormat): void {
        if (this.isExporting() || !this.canExportRawAds()) {
            return;
        }

        this.isExporting.set(true);
        const filters = this.currentRawAdsFilters();

        if (format === 'xlsx') {
            this.mediaFilesService.getProgrammaticAdsExportXlsx(filters).subscribe({
                next: (file) => {
                    downloadFile(file, dateStampedFilename('received-playables', 'xlsx'));
                    this.isExporting.set(false);
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to export programmatic ads:', error);
                    this.isExporting.set(false);
                },
            });
            return;
        }

        this.mediaFilesService.getProgrammaticAdsExport(filters).subscribe({
            next: (records: PlayRecordContent[]) => {
                const columns = buildDashboardExportColumns(this.timeDisplayService.zoneId());
                const headers = columns.map((column) => column.header);
                const rows = records.map((record) =>
                    columns.map((column) =>
                        toCsvValue(column.format ? column.format(record) : record[column.key]),
                    ),
                );
                downloadFile(
                    buildCsvBlob(headers, rows),
                    dateStampedFilename('received-playables', 'csv'),
                );
                this.isExporting.set(false);
            },
            error: (error: unknown) => {
                console.error('[Ranking Data] Failed to export programmatic ads:', error);
                this.isExporting.set(false);
            },
        });
    }

    /**
     * Exports the currently-loaded Venue Ranking rows (already the full,
     * unpaginated set matching the active date range - no extra fetch needed
     * for CSV). XLSX still round-trips to the server, to reuse the same
     * styled-workbook builder as every other export.
     *
     * @param format - Export file format
     * @returns {void}
     */
    exportVenueRanking(format: ExportFormat): void {
        if (this.isExportingVenueRanking() || !this.canExportVenueRanking()) {
            return;
        }

        this.isExportingVenueRanking.set(true);

        if (format === 'xlsx') {
            this.mediaFilesService
                .getVenueRankingExportXlsx(this.dateParamsFor(this.venueRankingRange()))
                .subscribe({
                    next: (file) => {
                        downloadFile(file, dateStampedFilename('venue-ranking', 'xlsx'));
                        this.isExportingVenueRanking.set(false);
                    },
                    error: (error: unknown) => {
                        console.error('[Ranking Data] Failed to export venue ranking:', error);
                        this.isExportingVenueRanking.set(false);
                    },
                });
            return;
        }

        const headers = VENUE_RANKING_EXPORT_COLUMNS.map((column) => column.header);
        const rows = this.hostRanking().map((entry) =>
            VENUE_RANKING_EXPORT_COLUMNS.map((column) =>
                toCsvValue(column.format ? column.format(entry) : entry[column.key]),
            ),
        );
        downloadFile(buildCsvBlob(headers, rows), dateStampedFilename('venue-ranking', 'csv'));
        this.isExportingVenueRanking.set(false);
    }

    /**
     * Exports the State Ranking table for the page's date range: XLSX from the server,
     * CSV built here from the loaded rows.
     *
     * @param format - File format to export
     * @returns {void}
     */
    exportStateRanking(format: ExportFormat): void {
        if (this.isExportingStateRanking() || !this.canExportStateRanking()) {
            return;
        }

        this.isExportingStateRanking.set(true);

        if (format === 'xlsx') {
            this.mediaFilesService
                .getStateRankingExportXlsx(this.dateParamsFor(this.stateRankingRange()))
                .subscribe({
                    next: (file) => {
                        downloadFile(file, dateStampedFilename('state-ranking', 'xlsx'));
                        this.isExportingStateRanking.set(false);
                    },
                    error: (error: unknown) => {
                        console.error('[Ranking Data] Failed to export state ranking:', error);
                        this.isExportingStateRanking.set(false);
                    },
                });
            return;
        }

        const headers = STATE_RANKING_EXPORT_COLUMNS.map((column) => column.header);
        const rows = this.stateRanking().map((entry) =>
            STATE_RANKING_EXPORT_COLUMNS.map((column) =>
                toCsvValue(column.format ? column.format(entry) : entry[column.key]),
            ),
        );
        downloadFile(buildCsvBlob(headers, rows), dateStampedFilename('state-ranking', 'csv'));
        this.isExportingStateRanking.set(false);
    }

    /**
     * Exports the Category Ranking table for the page's date range: XLSX from the server,
     * CSV built here from the loaded rows.
     *
     * @param format - File format to export
     * @returns {void}
     */
    exportCategoryRanking(format: ExportFormat): void {
        if (this.isExportingCategoryRanking() || !this.canExportCategoryRanking()) {
            return;
        }

        this.isExportingCategoryRanking.set(true);

        if (format === 'xlsx') {
            this.mediaFilesService
                .getCategoryRankingExportXlsx(this.dateParamsFor(this.categoryRankingRange()))
                .subscribe({
                    next: (file) => {
                        downloadFile(file, dateStampedFilename('category-ranking', 'xlsx'));
                        this.isExportingCategoryRanking.set(false);
                    },
                    error: (error: unknown) => {
                        console.error('[Ranking Data] Failed to export category ranking:', error);
                        this.isExportingCategoryRanking.set(false);
                    },
                });
            return;
        }

        const headers = CATEGORY_RANKING_EXPORT_COLUMNS.map((column) => column.header);
        const rows = this.categoryRanking().map((entry) =>
            CATEGORY_RANKING_EXPORT_COLUMNS.map((column) =>
                toCsvValue(column.format ? column.format(entry) : entry[column.key]),
            ),
        );
        downloadFile(buildCsvBlob(headers, rows), dateStampedFilename('category-ranking', 'csv'));
        this.isExportingCategoryRanking.set(false);
    }

    /**
     * Loads the first page of raw programmatic_ads rows from the server.
     * Loading feedback is always ntv-table's own built-in overlay - covers
     * everything from the initial load to filter/sort/search reloads.
     *
     * @returns {void}
     */
    private loadRawAds(): void {
        this.isLoadingRawAds.set(true);
        this.rawAdsOffset = 0;
        this.rawAdsTable()?.showLoadingOverlay('Loading...');

        this.rawAdsRequest?.unsubscribe();
        this.rawAdsRequest = this.mediaFilesService
            .getProgrammaticAdsList({
                limit: this.rawAdsPageSize,
                offset: this.rawAdsOffset,
                bucket: this.activeBucketFilter() ?? undefined,
                sortBy: this.activeSortBy,
                sortDir: this.activeSortDir,
                search: this.searchTerm() || undefined,
                columnFilters: this.activeColumnFilters,
                ...this.rawAdsDateParams(),
            })
            .subscribe({
                next: ({ data, count }) => {
                    this.rawAdsData.set(data);
                    this.rawAdsOffset = data.length;
                    this.rawAdsTotalCount.set(count);
                    this.isLoadingRawAds.set(false);
                    this.hasLoadedRawAdsOnce.set(true);
                    this.rawAdsTable()?.hideLoadingOverlay();
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load programmatic ads:', error);
                    this.isLoadingRawAds.set(false);
                    this.hasLoadedRawAdsOnce.set(true);
                    this.rawAdsTable()?.hideLoadingOverlay();
                },
            });
    }

    /**
     * Loads the next page of raw programmatic_ads rows and appends them.
     * Bound to ntv-table's built-in showMoreRequested output.
     *
     * @returns {void}
     */
    loadMoreRawAds(): void {
        if (this.isLoadingMoreRawAds() || this.rawAdsOffset >= this.rawAdsTotalCount()) {
            return;
        }

        this.isLoadingMoreRawAds.set(true);
        this.rawAdsTable()?.showLoadingOverlay('Loading more...');

        this.mediaFilesService
            .getProgrammaticAdsList({
                limit: this.rawAdsPageSize,
                offset: this.rawAdsOffset,
                bucket: this.activeBucketFilter() ?? undefined,
                sortBy: this.activeSortBy,
                sortDir: this.activeSortDir,
                search: this.searchTerm() || undefined,
                columnFilters: this.activeColumnFilters,
                ...this.rawAdsDateParams(),
            })
            .subscribe({
                next: ({ data, count }) => {
                    this.rawAdsData.set([...this.rawAdsData(), ...data]);
                    this.rawAdsOffset += data.length;
                    this.rawAdsTotalCount.set(count);
                    this.isLoadingMoreRawAds.set(false);
                    this.rawAdsTable()?.hideLoadingOverlay();
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load more programmatic ads:', error);
                    this.isLoadingMoreRawAds.set(false);
                    this.rawAdsTable()?.hideLoadingOverlay();
                },
            });
    }

    /**
     * Handles input on the search field, debouncing before reloading from the server.
     *
     * @param {Event} event - Input event
     * @returns {void}
     */
    onSearchInput(event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.searchTerm.set(value);

        if (this.searchDebounce) {
            clearTimeout(this.searchDebounce);
        }

        this.searchDebounce = setTimeout(() => this.loadRawAds(), 400);
    }

    /**
     * Maps each sortable rawAdsColumns field to the backend sort key
     * get_programmatic_ads_page understands - one entry per column with
     * `filter: true` in rawAdsColumns (the only columns the table shows a
     * Sort control for).
     */
    private static readonly RAW_ADS_SORT_FIELD_MAP: Partial<Record<string, ProgrammaticAdsSortBy>> =
        {
            fetchedAt: 'fetched_at',
            popDurationMinutes: 'pop_duration',
            proofOfPlaySent: 'proof_of_play_sent',
            dateServed: 'date_served',
            creativeId: 'creative_id',
            creativeSource: 'creative_source',
            venueId: 'venue_id',
            deviceId: 'device_id',
            served: 'served',
        };

    /**
     * Handles sort/filter/page state changes from the raw Programmatic Ads
     * table. Every sortable column is re-sent to the server as a real sort,
     * via RAW_ADS_SORT_FIELD_MAP. Column filters (creative ID/source, venue
     * ID, device ID) are re-sent to the server on every change too, since
     * the table's built-in filtering only sees whatever rows are currently
     * loaded, not the full table.
     *
     * @param {TableStateEvent} event - Table state change event
     * @returns {void}
     */
    onRawAdsStateChange(event: TableStateEvent): void {
        const mappedSortBy = event.sortField
            ? RankingDataComponent.RAW_ADS_SORT_FIELD_MAP[event.sortField]
            : undefined;
        const nextSortBy = mappedSortBy ?? 'fetched_at';
        const nextSortDir = mappedSortBy ? event.sortOrder : 'desc';
        const nextColumnFilters = this.extractColumnFilters(event.filters);

        const sortChanged = nextSortBy !== this.activeSortBy || nextSortDir !== this.activeSortDir;
        const filtersChanged =
            JSON.stringify(nextColumnFilters) !== JSON.stringify(this.activeColumnFilters);

        if (!sortChanged && !filtersChanged) {
            return;
        }

        this.activeSortBy = nextSortBy;
        this.activeSortDir = nextSortDir;
        this.activeColumnFilters = nextColumnFilters;

        if (this.columnFilterDebounce) {
            clearTimeout(this.columnFilterDebounce);
        }

        if (filtersChanged) {
            // The table emits on every keystroke - debounce like the search box.
            this.columnFilterDebounce = setTimeout(() => this.loadRawAds(), 400);
        } else {
            // In-table sort click - same subtle loading treatment as column filters.
            this.loadRawAds();
        }
    }

    /**
     * Picks the supported column filters out of a table state event, coercing
     * values to trimmed strings and dropping anything empty or unsupported.
     *
     * @param {Record<string, unknown>} filters - Raw filters from a TableStateEvent
     * @returns {ProgrammaticAdsColumnFilters} Supported, non-empty column filters
     */
    private extractColumnFilters(filters: Record<string, unknown>): ProgrammaticAdsColumnFilters {
        const result: ProgrammaticAdsColumnFilters = {};
        const fields: (keyof ProgrammaticAdsColumnFilters)[] = [
            'creativeId',
            'creativeSource',
            'venueId',
            'deviceId',
            'trackerId',
        ];

        for (const field of fields) {
            const value = filters[field];
            if (typeof value === 'string' && value.trim()) {
                result[field] = value.trim();
            }
        }

        return result;
    }

    /**
     * Reveals the next page of already-loaded ads. Bound to ntv-table's
     * native showMoreRequested output for the "Programmatic Ads Ranking" tab.
     *
     * @returns {void}
     */
    showMoreTableData(): void {
        this.visibleAdsCount.update((count) =>
            Math.min(count + this.pageSize, this.allAds().length),
        );
    }

    /**
     * Reveals the next page of already-loaded host ranking rows. Bound to
     * ntv-table's native showMoreRequested output for the "Programmatic
     * Host Ranking" tab.
     *
     * @returns {void}
     */
    showMoreHostRanking(): void {
        this.visibleHostRankingCount.update((count) =>
            Math.min(count + this.pageSize, this.hostRanking().length),
        );
    }

    /**
     * Column definitions for the "Total Ads" detail modal's table - the same
     * fields as rawAdsColumns (same PlayRecordContent row shape), minus
     * Venue ID (redundant - every row in the modal is the same venue,
     * already named in the modal header) and without any filter/sort
     * config, since this is a supplementary read-only view rather than a
     * primary table.
     * @type {TableColumn[]}
     */
    venueAdsModalColumns: TableColumn[] = [
        { field: 'creative', header: 'Creative', width: '70px', filter: false },
        { field: 'screenshot', header: 'Screenshot', width: '70px', filter: false },
        {
            field: 'creativeId',
            header: 'Creative ID',
            width: '160px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'trackerId',
            header: 'Tracking ID',
            width: '160px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'creativeSource',
            header: 'Creative Source',
            width: '150px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'deviceId',
            header: 'Device ID',
            width: '160px',
            filter: true,
            filterType: 'text',
        },
        {
            field: 'fetchedAt',
            header: 'Fetched At',
            width: '180px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'proofOfPlaySent',
            header: 'Proof of Play Sent',
            width: '180px',
            filter: true,
            filterType: 'date',
        },
        {
            field: 'popDurationMinutes',
            header: 'POP Duration',
            width: '140px',
            filter: true,
            filterType: 'date',
        },
        { field: 'served', header: 'Served', width: '100px', filter: true, filterType: 'date' },
        {
            field: 'dateServed',
            header: 'Date Served',
            width: '180px',
            filter: true,
            filterType: 'date',
        },
    ];

    /**
     * Title shown in the currently-open "ad records" modal (a venue's
     * name/ID, or a state code), or null if closed.
     */
    venueAdsModalTitle = signal<string | null>(null);

    /**
     * Venue IDs the currently-open "ad records" modal is scoped to - one
     * venue when opened from Venue Ranking or a state's venue breakdown,
     * every venue in a state when opened from State Ranking's own "Total
     * Ads" column.
     */
    private venueAdsModalVenueIds: string[] = [];

    /**
     * Play records loaded so far for the currently-open venue-ads modal.
     */
    venueAdsModalData = signal<PlayRecordContent[]>([]);

    /**
     * Total number of play records matching the currently-open venue-ads
     * modal's venue (and the Venue Ranking table's active date range), per
     * the server. Passed to ntv-table as totalDataLength for "Show More".
     */
    venueAdsModalTotalCount = signal(0);

    /**
     * Loading state for the venue-ads modal's initial load.
     */
    isLoadingVenueAdsModal = signal(false);

    /**
     * Loading state for the venue-ads modal's "Show More" action.
     */
    isLoadingMoreVenueAdsModal = signal(false);

    /**
     * Number of venue-ads modal rows currently loaded, for "Show More" offset.
     */
    private venueAdsModalOffset = 0;

    /**
     * Number of rows loaded per "Show More" page in the venue-ads modal.
     */
    private readonly venueAdsModalPageSize = 20;

    /**
     * Total/green/yellow/red proof-of-play duration counts for the venue-ads
     * modal's venue (and the Venue Ranking table's active date range) - the
     * same mini stat row shown above the raw Programmatic Ads table, scoped
     * to just this venue. Clicking a stat filters the modal's table, exactly
     * like the raw Programmatic Ads table's own mini stats.
     */
    venueAdsModalStats = signal<ProgrammaticAdsStats | null>(null);

    /**
     * Active duration-bucket filter for the venue-ads modal's table, or null
     * for no filter. Mirrors activeBucketFilter, scoped to this modal.
     */
    activeVenueAdsModalBucketFilter = signal<RawAdsFilter | null>(null);

    /**
     * Current sort column/direction for the venue-ads modal's table. Mirrors
     * activeSortBy/activeSortDir, scoped to this modal.
     */
    private activeVenueAdsModalSortBy: ProgrammaticAdsSortBy = 'fetched_at';
    private activeVenueAdsModalSortDir: 'asc' | 'desc' = 'desc';

    /**
     * Current per-column filters for the venue-ads modal's table. Mirrors
     * activeColumnFilters, scoped to this modal.
     */
    private activeVenueAdsModalColumnFilters: ProgrammaticAdsColumnFilters = {};

    /**
     * Debounce timer for the venue-ads modal's column filter changes.
     */
    private venueAdsModalColumnFilterDebounce: ReturnType<typeof setTimeout> | undefined;

    /**
     * Date range the currently-open venue-ads modal is scoped to. Defaults
     * to the Venue Ranking table's own range (when opened from there), but
     * the State Ranking breakdown modal passes its own independent range
     * instead, so a venue opened from a state's breakdown reflects that
     * state tab's range, not whatever Venue Ranking's range happens to be.
     */
    private activeVenueAdsModalRange: { start: Date; end: Date } | null = null;

    /**
     * Opens the "ad records" modal for a single venue - convenience wrapper
     * around the shared opener for the common single-venue case (Venue
     * Ranking's own table, and the state-venues breakdown modal).
     *
     * @param {HostRankingEntry} venue - The venue row that was clicked
     * @param {{ start: Date; end: Date } | null} range - Date range to scope to; defaults to venueRankingRange()
     * @returns {void}
     */
    openVenueAdsModalForVenue(
        venue: HostRankingEntry,
        range: { start: Date; end: Date } | null = this.venueRankingRange(),
    ): void {
        this.openAdRecordsModal(venue.hostName || venue.venueId, [venue.venueId], range);
    }

    /**
     * Opens the "ad records" modal for a state - every programmatic_ads
     * record across every venue rolled into that state, scoped to the
     * State Ranking table's own active date range.
     *
     * @param {StateRankingEntry} entry - The state row that was clicked
     * @returns {void}
     */
    openStateAdsRecordsModal(entry: StateRankingEntry): void {
        const venueIds = this.stateRankingVenues()
            .filter((venue) => (venue.state ?? 'Unknown') === entry.state)
            .map((venue) => venue.venueId);

        this.openAdRecordsModal(entry.state, venueIds, this.stateRankingRange());
    }

    /**
     * Opens the "ad records" modal for a category - every programmatic_ads
     * record across every venue rolled into that category, scoped to the
     * Category Ranking table's own active date range.
     *
     * @param {CategoryRankingEntry} entry - The category row that was clicked
     * @returns {void}
     */
    openCategoryAdsRecordsModal(entry: CategoryRankingEntry): void {
        const venueIds = this.categoryRankingVenues()
            .filter((venue) => (venue.category ?? 'Unknown') === entry.category)
            .map((venue) => venue.venueId);

        this.openAdRecordsModal(entry.category, venueIds, this.categoryRankingRange());
    }

    /**
     * Shared opener behind openVenueAdsModalForVenue/openStateAdsRecordsModal -
     * loads the first page of play records for the given venue set, scoped
     * to the given date range, so the modal's total count matches the
     * number the user clicked.
     *
     * @param {string} title - Modal heading (venue name/ID, or state code)
     * @param {string[]} venueIds - Venue IDs to restrict to
     * @param {{ start: Date; end: Date } | null} range - Date range to scope to
     * @returns {void}
     */
    private openAdRecordsModal(
        title: string,
        venueIds: string[],
        range: { start: Date; end: Date } | null,
    ): void {
        this.venueAdsModalTitle.set(title);
        this.venueAdsModalVenueIds = venueIds;
        this.activeVenueAdsModalRange = range;
        this.venueAdsModalData.set([]);
        this.venueAdsModalTotalCount.set(0);
        this.venueAdsModalOffset = 0;
        this.venueAdsModalStats.set(null);
        this.activeVenueAdsModalBucketFilter.set(null);
        this.activeVenueAdsModalSortBy = 'fetched_at';
        this.activeVenueAdsModalSortDir = 'desc';
        this.activeVenueAdsModalColumnFilters = {};
        this.isLoadingVenueAdsModal.set(true);

        this.loadVenueAdsModalStats();
        this.loadVenueAdsModal();
    }

    /**
     * Loads the ad-records modal's mini stat row for the currently-open
     * venue set, scoped to activeVenueAdsModalRange.
     *
     * @returns {void}
     */
    private loadVenueAdsModalStats(): void {
        if (this.venueAdsModalVenueIds.length === 0) {
            return;
        }

        this.mediaFilesService
            .getProgrammaticAdsStats({
                venueIds: this.venueAdsModalVenueIds,
                ...this.dateParamsFor(this.activeVenueAdsModalRange),
            })
            .subscribe({
                next: (stats) => this.venueAdsModalStats.set(stats),
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load venue ads stats:', error);
                    this.venueAdsModalStats.set(null);
                },
            });
    }

    /**
     * Loads the first page of play records for the open ad-records modal,
     * applying the modal's own active bucket/sort/column-filter state -
     * mirrors loadRawAds, scoped to this modal's venue set and activeVenueAdsModalRange.
     *
     * @returns {void}
     */
    private loadVenueAdsModal(): void {
        if (this.venueAdsModalVenueIds.length === 0) {
            return;
        }

        this.isLoadingVenueAdsModal.set(true);
        this.venueAdsModalOffset = 0;

        this.mediaFilesService
            .getProgrammaticAdsList({
                venueIds: this.venueAdsModalVenueIds,
                limit: this.venueAdsModalPageSize,
                offset: 0,
                bucket: this.activeVenueAdsModalBucketFilter() ?? undefined,
                sortBy: this.activeVenueAdsModalSortBy,
                sortDir: this.activeVenueAdsModalSortDir,
                columnFilters: this.activeVenueAdsModalColumnFilters,
                ...this.dateParamsFor(this.activeVenueAdsModalRange),
            })
            .subscribe({
                next: ({ data, count }) => {
                    this.venueAdsModalData.set(data);
                    this.venueAdsModalOffset = data.length;
                    this.venueAdsModalTotalCount.set(count);
                    this.isLoadingVenueAdsModal.set(false);
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load venue play records:', error);
                    this.isLoadingVenueAdsModal.set(false);
                },
            });
    }

    /**
     * Loads the next page of play records for the open ad-records modal.
     * Bound to ntv-table's native showMoreRequested output.
     *
     * @returns {void}
     */
    loadMoreVenueAdsModal(): void {
        if (this.venueAdsModalVenueIds.length === 0 || this.isLoadingMoreVenueAdsModal()) {
            return;
        }
        if (this.venueAdsModalOffset >= this.venueAdsModalTotalCount()) {
            return;
        }

        this.isLoadingMoreVenueAdsModal.set(true);

        this.mediaFilesService
            .getProgrammaticAdsList({
                venueIds: this.venueAdsModalVenueIds,
                limit: this.venueAdsModalPageSize,
                offset: this.venueAdsModalOffset,
                bucket: this.activeVenueAdsModalBucketFilter() ?? undefined,
                sortBy: this.activeVenueAdsModalSortBy,
                sortDir: this.activeVenueAdsModalSortDir,
                columnFilters: this.activeVenueAdsModalColumnFilters,
                ...this.dateParamsFor(this.activeVenueAdsModalRange),
            })
            .subscribe({
                next: ({ data, count }) => {
                    this.venueAdsModalData.set([...this.venueAdsModalData(), ...data]);
                    this.venueAdsModalOffset += data.length;
                    this.venueAdsModalTotalCount.set(count);
                    this.isLoadingMoreVenueAdsModal.set(false);
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load more venue play records:', error);
                    this.isLoadingMoreVenueAdsModal.set(false);
                },
            });
    }

    /**
     * Handles sort/filter/page state changes from the venue-ads modal's
     * table - mirrors onRawAdsStateChange, scoped to this modal's venue.
     *
     * @param {TableStateEvent} event - Table state change event
     * @returns {void}
     */
    onVenueAdsModalStateChange(event: TableStateEvent): void {
        const mappedSortBy = event.sortField
            ? RankingDataComponent.RAW_ADS_SORT_FIELD_MAP[event.sortField]
            : undefined;
        const nextSortBy = mappedSortBy ?? 'fetched_at';
        const nextSortDir = mappedSortBy ? event.sortOrder : 'desc';
        const nextColumnFilters = this.extractColumnFilters(event.filters);

        const sortChanged =
            nextSortBy !== this.activeVenueAdsModalSortBy ||
            nextSortDir !== this.activeVenueAdsModalSortDir;
        const filtersChanged =
            JSON.stringify(nextColumnFilters) !==
            JSON.stringify(this.activeVenueAdsModalColumnFilters);

        if (!sortChanged && !filtersChanged) {
            return;
        }

        this.activeVenueAdsModalSortBy = nextSortBy;
        this.activeVenueAdsModalSortDir = nextSortDir;
        this.activeVenueAdsModalColumnFilters = nextColumnFilters;

        if (this.venueAdsModalColumnFilterDebounce) {
            clearTimeout(this.venueAdsModalColumnFilterDebounce);
        }

        if (filtersChanged) {
            this.venueAdsModalColumnFilterDebounce = setTimeout(
                () => this.loadVenueAdsModal(),
                400,
            );
        } else {
            this.loadVenueAdsModal();
        }
    }

    /**
     * Toggles the venue-ads modal's active duration-bucket filter. Clicking
     * the currently-active filter clears it - mirrors toggleBucketFilter.
     *
     * @param {RawAdsFilter} filter - Filter to apply
     * @returns {void}
     */
    toggleVenueAdsModalBucketFilter(filter: RawAdsFilter): void {
        this.activeVenueAdsModalBucketFilter.set(
            this.activeVenueAdsModalBucketFilter() === filter ? null : filter,
        );
        this.loadVenueAdsModal();
    }

    /**
     * Clears the venue-ads modal's active duration-bucket filter - bound to
     * its "Total" mini stat, mirroring filterByStatCard('total').
     *
     * @returns {void}
     */
    clearVenueAdsModalBucketFilter(): void {
        this.activeVenueAdsModalBucketFilter.set(null);
        this.loadVenueAdsModal();
    }

    /**
     * Closes the "Total Ads" detail modal.
     *
     * @returns {void}
     */
    closeVenueAdsModal(): void {
        this.venueAdsModalTitle.set(null);
        this.venueAdsModalVenueIds = [];
        this.venueAdsModalData.set([]);
        this.venueAdsModalTotalCount.set(0);
        this.venueAdsModalOffset = 0;
        this.venueAdsModalStats.set(null);
        this.activeVenueAdsModalBucketFilter.set(null);
    }

    /**
     * Column definitions for the "Play Count" detail modal's table - the
     * same fields as Ad Analytics' Locations tab, without filter/sort config
     * since this is a supplementary read-only view rather than a primary table.
     * @type {TableColumn[]}
     */
    adLocationsModalColumns: TableColumn[] = [
        { field: 'venueId', header: 'Venue ID', width: '150px', filter: false },
        { field: 'name', header: 'Name', width: '220px', filter: false },
        { field: 'city', header: 'City', width: '140px', filter: false },
        { field: 'state', header: 'State', width: '100px', filter: false },
        { field: 'category', header: 'Category', width: '150px', filter: false },
        { field: 'playCount', header: 'Plays', width: '110px', filter: false },
        { field: 'totalDuration', header: 'Duration', width: '130px', filter: false },
        { field: 'latestPlay', header: 'Latest Play', width: '180px', filter: false },
    ];

    /**
     * Ad whose "Play Count" detail modal is currently open, or null if closed.
     */
    selectedAdForLocationsModal = signal<DashboardTopAd | null>(null);

    /**
     * Locations (venues) loaded for the currently-open Play Count modal,
     * scoped to the Ad Ranking table's active date range - so the sum of
     * these venues' play counts matches the number the user clicked.
     */
    adLocationsModalData = signal<LocationData[]>([]);

    /**
     * Loading state for the Play Count detail modal.
     */
    isLoadingAdLocationsModal = signal(false);

    /**
     * Opens the "Play Count" detail modal for an ad and loads the locations
     * (venues) that make up its play count, scoped to the Ad Ranking table's
     * active date range.
     *
     * @param {DashboardTopAd} ad - The ad row that was clicked
     * @returns {void}
     */
    openAdLocationsModal(ad: DashboardTopAd): void {
        this.selectedAdForLocationsModal.set(ad);
        this.adLocationsModalData.set([]);
        this.isLoadingAdLocationsModal.set(true);

        this.mediaFilesService
            .getLocations(ad.contentId, this.dateParamsFor(this.adRankingRange()))
            .subscribe({
                next: (locations) => {
                    this.adLocationsModalData.set(locations);
                    this.isLoadingAdLocationsModal.set(false);
                },
                error: (error: unknown) => {
                    console.error('[Ranking Data] Failed to load ad locations:', error);
                    this.isLoadingAdLocationsModal.set(false);
                },
            });
    }

    /**
     * Closes the "Play Count" detail modal.
     *
     * @returns {void}
     */
    closeAdLocationsModal(): void {
        this.selectedAdForLocationsModal.set(null);
        this.adLocationsModalData.set([]);
    }

    /**
     * Formats a duration in seconds as "Xh Ym Zs", omitting zero-valued
     * leading units - mirrors ad-analytics.component.ts's formatDuration().
     *
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted duration
     */
    formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const parts: string[] = [];
        if (hours > 0) {
            parts.push(`${hours}h`);
        }
        if (minutes > 0) {
            parts.push(`${minutes}m`);
        }
        if (secs > 0 || parts.length === 0) {
            parts.push(`${secs}s`);
        }

        return parts.join(' ');
    }

    /**
     * Navigates to ad analytics page.
     *
     * @param {Record<string, unknown>} rowData - The row data from the table.
     * @returns {void}
     */
    viewContent(rowData: Record<string, unknown>): void {
        const contentId = rowData['contentId'] as string;
        if (contentId) {
            this.router.navigate(['/ad', contentId]);
        } else {
            console.error('No contentId found in rowData');
        }
    }

    /**
     * Currently-shown Venue Ranking "Business Hours" tooltip, positioned in
     * viewport coordinates and rendered at the top level of the template -
     * ntv-table's cells clip overflow for ellipsis truncation, so a tooltip
     * nested inside a cell would get cut off instead of floating above it.
     * @type {{ top: number; left: number; schedule: { day: string; hours: string }[] } | null}
     */
    scheduleTooltip = signal<{
        top: number;
        left: number;
        schedule: { day: string; hours: string }[];
    } | null>(null);

    /**
     * Shows the weekly business-hours tooltip for a Venue Ranking row,
     * positioned just below the hovered cell.
     *
     * @param {MouseEvent} event - The mouseenter event from the schedule cell
     * @param {Record<string, unknown>} rowData - The hovered row's data
     * @returns {void}
     */
    onScheduleHover(event: MouseEvent, rowData: Record<string, unknown>): void {
        const schedule = (rowData['weeklySchedule'] as { day: string; hours: string }[]) ?? [];
        if (schedule.length === 0) {
            return;
        }

        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const tooltipWidth = 220;
        const left = Math.min(rect.left, window.innerWidth - tooltipWidth - 8);

        this.scheduleTooltip.set({
            top: rect.bottom + 6,
            left: Math.max(8, left),
            schedule,
        });
    }

    /**
     * Hides the weekly business-hours tooltip.
     *
     * @returns {void}
     */
    onScheduleLeave(): void {
        this.scheduleTooltip.set(null);
    }

    /**
     * Truncates a string to a maximum length, appending an ellipsis if cut short.
     *
     * @param {string | null | undefined} value - Value to truncate
     * @param {number} maxLength - Maximum number of characters to keep
     * @returns {string} Truncated string
     */
    truncate(value: string | null | undefined, maxLength: number = 15): string {
        if (!value) {
            return '';
        }

        return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
    }

    /**
     * Opens a media asset URL in a new tab.
     *
     * @param {Event} event - Click event, stopped from bubbling to the row
     * @param {string | null | undefined} url - Media asset URL to open
     * @returns {void}
     */
    openMedia(event: Event, url: string | null | undefined): void {
        event.stopPropagation();

        if (!url) {
            return;
        }

        try {
            const mediaUrl = new URL(url);
            if (mediaUrl.protocol !== 'http:' && mediaUrl.protocol !== 'https:') {
                return;
            }

            const link = document.createElement('a');
            link.href = mediaUrl.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.click();
        } catch {
            console.error('[Ranking Data] Ignored invalid media URL.');
        }
    }

    /**
     * Formats the proof-of-play duration for display.
     *
     * @param {Record<string, unknown>} rowData - Raw Programmatic Ads row
     * @returns {string} Formatted duration (e.g. "3m", "1h 5m"), or "--" if not computable
     */
    formatPopDuration(rowData: Record<string, unknown>): string {
        return formatPopDurationUtil(rowData['popDurationMinutes'] as number | null);
    }

    /**
     * Gets the row's proof-of-play duration bucket color as an "r, g, b" string,
     * for use with the --pop-row-color CSS variable. Returns null if no bucket applies.
     *
     * @param {Record<string, unknown>} rowData - Raw Programmatic Ads row
     * @returns {string | null} "r, g, b" string, or null if no bucket applies
     */
    popDurationRowColor(rowData: Record<string, unknown>): string | null {
        return popDurationRowColorUtil(rowData['popDurationMinutes'] as number | null);
    }

    /**
     * Toggles the active raw Programmatic Ads filter (a duration bucket or a
     * stat-card filter), switching to the Programmatic Ads tab so the
     * filtered rows are visible. Clicking the currently-active filter clears it.
     *
     * @param {RawAdsFilter} filter - Filter to apply
     * @returns {void}
     */
    toggleBucketFilter(filter: RawAdsFilter): void {
        this.activeTabIndex = 0;
        this.activeBucketFilter.set(this.activeBucketFilter() === filter ? null : filter);
        this.loadRawAds();
    }

    /**
     * Applies the filter represented by a stat card, switching to the
     * Programmatic Ads tab so the filtered rows are visible.
     *
     * @param {StatCardFilter} filter - Which card was clicked
     * @returns {void}
     */
    filterByStatCard(filter: StatCardFilter): void {
        this.activeTabIndex = 0;
        this.activeBucketFilter.set(filter === 'total' ? null : filter);
        this.loadRawAds();
    }
}
