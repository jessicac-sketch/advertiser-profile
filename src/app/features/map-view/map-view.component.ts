/** Angular Imports */
import { DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

/** Third Party Imports */
import { Card, Skeleton } from '@ntv360/component-pantry';
import { combineLatest, Subscription } from 'rxjs';

/** Local Imports */
import {
    type DailyAdsSummaryEntry,
    type HostRankingEntry,
    MediaFilesService,
    type StateRankingEntry,
} from '@core';
import { PageHeaderComponent } from '@shared/components/page-header';
import { RangeControlsComponent } from '@shared/components/range-controls';
import { RangeNoticeComponent } from '@shared/components/range-notice';
import { SectionErrorComponent } from '@shared/components/section-error';
import { ShareListComponent } from '@shared/components/share-list';
import { SortControlComponent } from '@shared/components/sort-control';
import { SummaryCardComponent } from '@shared/components/summary-card';
import type { DashboardAds, DashboardAdShare } from '@shared/interfaces/dashboard';
import type { ShareItem } from '@shared/interfaces/ui';
import type { SelectOption } from '@shared/interfaces/ui/select-option.interface';
import { CARD_CONFIG } from '@shared/models/ui';
import { DashboardRangeService, DashboardSummaryService } from '@shared/services/dashboard';
import { TimeDisplayService } from '@shared/services/time-display';
import { truncateMiddle } from '@shared/utils/truncate-middle.util';
import { toLocalDateRange } from '@shared/utils/utc-calendar-date.util';
// Deliberately bypasses the '@shared'/'@shared/components' barrels - see the
// note in shared/components/index.ts on why UsStatesMapComponent/
// DailyAdsBarChartComponent (and the echarts import they carry) aren't
// re-exported from there.
import { DailyAdsBarChartComponent } from '@shared/components/daily-ads-bar-chart/daily-ads-bar-chart.component';
import { UsStatesMapComponent } from '@shared/components/us-states-map/us-states-map.component';

/**
 * Which of Map View's three breakdown cards is currently shown - unlike the Dashboard's
 * own switcher, this has no "States" option: the map itself is already the state
 * breakdown (clicking a state IS picking one), so a second "rank every state" tab would
 * just duplicate that.
 */
type MapViewBreakdownView = 'categories' | 'venues' | 'ads';

/** Choices for the breakdown switcher below the map, in display order. */
const MAP_VIEW_BREAKDOWN_VIEW_OPTIONS: readonly SelectOption<MapViewBreakdownView>[] = [
    { value: 'categories', label: 'Category' },
    { value: 'venues', label: 'Venues' },
    { value: 'ads', label: 'Ads' },
];

/**
 * Standalone "Map View" page - a US choropleth of ad plays per state, with
 * a click-through panel showing the venues and ads played in the clicked
 * state.
 *
 * @remarks
 * Reuses the same `getStateRanking()` endpoint Ranking Data's State Ranking tab
 * uses for the map and the floating state badge, and the Dashboard's own
 * `dashboard/ads` (by-venues variant) for the Ads → Categories → Venues
 * breakdown card, scoped to the clicked state's venues - not a new data source.
 */
@Component({
    selector: 'app-map-view',
    standalone: true,
    imports: [
        PageHeaderComponent,
        RangeControlsComponent,
        RangeNoticeComponent,
        SectionErrorComponent,
        ShareListComponent,
        SortControlComponent,
        SummaryCardComponent,
        Card,
        DailyAdsBarChartComponent,
        DecimalPipe,
        Skeleton,
        UsStatesMapComponent,
    ],
    templateUrl: './map-view.component.html',
    styleUrl: './map-view.component.scss',
})
export class MapViewComponent {
    private readonly mediaFilesService = inject(MediaFilesService);
    private readonly dashboardSummaryService = inject(DashboardSummaryService);

    /** Rows shown before "Show all" in each breakdown column. */
    protected readonly topLimit = 10;

    /** Standard flat, outlined card look. */
    protected readonly cardConfig = CARD_CONFIG;

    /** Number of rows revealed per "Show More" page, for the right-panel tables. */
    private readonly pageSize = 10;

    /** States ranked by total ad plays, plus the per-venue breakdown they were rolled up from. */
    private readonly stateRanking = signal<StateRankingEntry[]>([]);
    private readonly stateRankingVenues = signal<HostRankingEntry[]>([]);

    /** Map data: two-letter state code + total ad plays + venue count, excluding the "Unknown" bucket (no geography to plot it against). */
    mapData = computed(() =>
        this.stateRanking()
            .filter((entry) => entry.state !== 'Unknown')
            .map((entry) => ({
                code: entry.state,
                value: entry.totalAds,
                venueCount: entry.venueCount,
            })),
    );

    /**
     * Total programmatic ads across every state (including the "Unknown"
     * bucket) for the current range - shown at the right of the filters
     * row. Summed from stateRanking() rather than a separate stats call,
     * since that data is already fetched for the map/panels.
     */
    programmaticAdsTotal = computed(() =>
        this.stateRanking().reduce((sum, entry) => sum + entry.totalAds, 0),
    );

    /**
     * Choices for the breakdown switcher below the map - Category, Venues, Ads (no
     * "States": the map itself already is the state breakdown).
     * @type {readonly SelectOption<MapViewBreakdownView>[]}
     */
    protected readonly breakdownViewOptions = MAP_VIEW_BREAKDOWN_VIEW_OPTIONS;

    /** Which breakdown card is currently shown. */
    protected readonly activeBreakdown = signal<MapViewBreakdownView>('categories');

    /**
     * The page's date range, shared with the Dashboard, Ranking Data and the top bar's
     * totals (set by the range controls in the page header; Yesterday by default)
     * @type {DashboardRangeService}
     */
    private readonly rangeService = inject(DashboardRangeService);

    /**
     * Global "Eastern Time / UTC" display preference, read here only for
     * the page subtitle's "(... days)" line, which should say whichever
     * zone the days (and this page's numbers) actually are.
     * @type {TimeDisplayService}
     */
    protected readonly timeDisplayService = inject(TimeDisplayService);

    /**
     * The page header's subtitle, naming whichever zone is currently active.
     * @type {Signal<string>}
     */
    protected readonly subtitle = computed(
        () =>
            `Ad plays by state - click a state for its venues and ads (${
                this.timeDisplayService.mode() === 'eastern' ? 'Eastern Time' : 'UTC'
            } days)`,
    );

    /** The selected range as local dates (how this page reads and sends it), or null for "All time". */
    range = computed((): { start: Date; end: Date } | null => {
        const shared = this.rangeService.pageRange();
        return shared ? toLocalDateRange(shared) : null;
    });

    /** Loading state - dims the map and shows the Ads Played table's own loading overlay while a range reloads. */
    isLoading = signal(false);

    /** Two-letter code of the currently-selected state, or null if none clicked yet. */
    selectedState = signal<string | null>(null);

    /**
     * The selected state's own row from stateRanking() - venueCount/totalAds
     * here match the map's own label exactly, unlike selectedStateVenues(),
     * which is just the (differently-scoped) count of venues the breakdown
     * card was fetched for.
     */
    selectedStateEntry = computed(() => {
        const code = this.selectedState();
        if (!code) {
            return null;
        }
        return this.stateRanking().find((entry) => entry.state === code) ?? null;
    });

    /**
     * Venues in the selected state, from stateRankingVenues() - no second
     * call needed. Before any state is clicked, this is every venue
     * nationwide instead of an empty list, so the panel shows real data
     * from page load rather than a "click a state" placeholder.
     */
    selectedStateVenues = computed(() => {
        const code = this.selectedState();
        if (!code) {
            return this.stateRankingVenues();
        }
        return this.stateRankingVenues().filter((venue) => (venue.state ?? 'Unknown') === code);
    });

    /**
     * Ads → Categories → Venues breakdown for the selected state's venues
     * (nationwide, same as selectedStateVenues(), before any state is
     * clicked) - same shape/endpoint the Dashboard's own Ads card uses, just
     * scoped to these venues instead of every venue.
     */
    adSharesInState = signal<DashboardAds | null>(null);
    isLoadingAdShares = signal(false);
    hasAdSharesError = signal(false);

    /**
     * Lookup from venueId to its HostRankingEntry (category, host name, city) -
     * every venue referenced by adSharesInState()'s per-ad venue breakdown is
     * already one of selectedStateVenues(), since that's what scoped the
     * request, so this alone is enough to resolve category/name/city for them.
     */
    private readonly venuesById = computed(
        () => new Map(this.selectedStateVenues().map((venue) => [venue.venueId, venue])),
    );

    /**
     * Ads breakdown rows: every distinct creative received at the selected
     * state's venues, each as a share of what those venues received.
     * @type {Signal<ShareItem[]>}
     */
    adShareItems = computed((): ShareItem[] =>
        (this.adSharesInState()?.ads ?? []).map((ad) => ({
            id: this.adId(ad),
            name: this.shortTitle(ad.title),
            fullName: ad.title,
            caption: `${ad.source} · ${ad.venueCount} ${ad.venueCount === 1 ? 'venue' : 'venues'}`,
            value: ad.received,
            imageUrl: ad.mediaUrl,
            isVideo: ad.creativeType === 'video',
            route: ad.contentId ? `/ad/${ad.contentId}` : null,
        })),
    );

    /** Ad picked in the breakdown to see its categories, or null for the top ad. */
    selectedAdId = signal<string | null>(null);

    /** The picked ad, or the top ad when none is picked (or the picked one isn't in this state). */
    selectedAd = computed((): DashboardAdShare | null => {
        const ads = this.adSharesInState()?.ads ?? [];
        const id = this.selectedAdId();
        return ads.find((ad) => this.adId(ad) === id) ?? ads[0] ?? null;
    });

    /** Row ID of the selected ad, for highlighting it in the list. */
    selectedAdRowId = computed((): string | null => {
        const ad = this.selectedAd();
        return ad ? this.adId(ad) : null;
    });

    /**
     * Categories breakdown for the selected ad: its venues (already scoped
     * to the selected state) rolled up by category, each as a share of the
     * ad's total received here. Venues with no known category count as
     * "Unknown" rather than being dropped.
     * @type {Signal<ShareItem[]>}
     */
    adCategoryItems = computed((): ShareItem[] => {
        const ad = this.selectedAd();
        if (!ad) {
            return [];
        }

        const venuesById = this.venuesById();
        const byCategory = new Map<string, number>();
        for (const slice of ad.venues) {
            const category = venuesById.get(slice.venueId)?.category ?? 'Unknown';
            byCategory.set(category, (byCategory.get(category) ?? 0) + slice.received);
        }

        return [...byCategory.entries()]
            .map(([category, received]) => ({
                id: category,
                name: this.categoryName(category),
                value: received,
            }))
            .sort((left, right) => right.value - left.value);
    });

    /** Category picked in the selected ad's categories to see its venues, or null for the top category. */
    selectedCategoryId = signal<string | null>(null);

    /** The picked category, or the top category when none is picked. */
    selectedCategory = computed((): ShareItem | null => {
        const categories = this.adCategoryItems();
        const id = this.selectedCategoryId();
        return categories.find((category) => category.id === id) ?? categories[0] ?? null;
    });

    /**
     * Venues of the selected ad in the selected category, most received
     * first, each as a share of the category's received.
     * @type {Signal<ShareItem[]>}
     */
    adCategoryVenueItems = computed((): ShareItem[] => {
        const ad = this.selectedAd();
        const category = this.selectedCategory()?.id;
        if (!ad || !category) {
            return [];
        }

        const venuesById = this.venuesById();
        return ad.venues
            .filter((slice) => (venuesById.get(slice.venueId)?.category ?? 'Unknown') === category)
            .sort((left, right) => right.received - left.received)
            .map((slice) => {
                const venue = venuesById.get(slice.venueId);
                return {
                    id: slice.venueId,
                    name: venue?.hostName ?? slice.venueId,
                    caption: [slice.venueId, venue?.city].filter(Boolean).join(' · '),
                    value: slice.received,
                    route: `/venue/${slice.venueId}`,
                };
            });
    });

    // -------------------------------------------------------------------
    // Nationwide States breakdown - shown by itself (no switcher) while no
    // state is selected: States → the picked state's ads → that ad's
    // venues in that state. Entirely self-contained and local - picking a
    // state here does NOT select it on the map (that's a separate,
    // deliberate action); it's just a way to explore nationwide data
    // before committing to one. Computed client-side from stateRanking()
    // and the nationwide adSharesInState() already loaded for the other
    // breakdowns - no extra calls.
    // -------------------------------------------------------------------

    /**
     * Nationwide state ranking as share items, most received first.
     * @type {Signal<ShareItem[]>}
     */
    stateShareItems = computed((): ShareItem[] =>
        [...this.stateRanking()]
            .sort((left, right) => right.totalAds - left.totalAds)
            .map((entry) => ({
                id: entry.state,
                name: entry.state === 'Unknown' ? 'Unknown state' : entry.state,
                caption: `${entry.venueCount} ${entry.venueCount === 1 ? 'venue' : 'venues'}`,
                value: entry.totalAds,
            })),
    );

    /** State picked in the nationwide breakdown, or null for the top state. */
    selectedNationwideStateId = signal<string | null>(null);

    /** The picked state, or the top state when none is picked. */
    selectedNationwideState = computed((): ShareItem | null => {
        const states = this.stateShareItems();
        const id = this.selectedNationwideStateId();
        return states.find((state) => state.id === id) ?? states[0] ?? null;
    });

    /**
     * Ads received in the picked nationwide state, most received first - rolled up from
     * adSharesInState()'s nationwide per-ad venue slices, filtered to venues in that state
     * (via venuesById(), which nationwide covers every venue).
     * @type {Signal<ShareItem[]>}
     */
    nationwideStateAdItems = computed((): ShareItem[] => {
        const state = this.selectedNationwideState()?.id;
        if (!state) {
            return [];
        }

        const venuesById = this.venuesById();
        return (this.adSharesInState()?.ads ?? [])
            .map((ad) => {
                const received = ad.venues
                    .filter(
                        (slice) => (venuesById.get(slice.venueId)?.state ?? 'Unknown') === state,
                    )
                    .reduce((sum, slice) => sum + slice.received, 0);
                return received > 0 ? { ad, received } : null;
            })
            .filter((row): row is { ad: DashboardAdShare; received: number } => row !== null)
            .sort((left, right) => right.received - left.received)
            .map(({ ad, received }) => ({
                id: this.adId(ad),
                name: this.shortTitle(ad.title),
                fullName: ad.title,
                value: received,
                imageUrl: ad.mediaUrl,
                isVideo: ad.creativeType === 'video',
                route: ad.contentId ? `/ad/${ad.contentId}` : null,
            }));
    });

    /** Ad picked in the nationwide breakdown's ad list, or null for the top ad. */
    selectedNationwideAdId = signal<string | null>(null);

    /** The picked ad, or the top ad when none is picked. */
    selectedNationwideAd = computed((): ShareItem | null => {
        const ads = this.nationwideStateAdItems();
        const id = this.selectedNationwideAdId();
        return ads.find((ad) => ad.id === id) ?? ads[0] ?? null;
    });

    /**
     * Venues in the picked nationwide state that played the picked nationwide ad, most
     * received first.
     * @type {Signal<ShareItem[]>}
     */
    nationwideStateAdVenueItems = computed((): ShareItem[] => {
        const state = this.selectedNationwideState()?.id;
        const adId = this.selectedNationwideAd()?.id;
        if (!state || !adId) {
            return [];
        }

        const ad = (this.adSharesInState()?.ads ?? []).find((row) => this.adId(row) === adId);
        if (!ad) {
            return [];
        }

        const venuesById = this.venuesById();
        return ad.venues
            .filter((slice) => (venuesById.get(slice.venueId)?.state ?? 'Unknown') === state)
            .sort((left, right) => right.received - left.received)
            .map((slice) => {
                const venue = venuesById.get(slice.venueId);
                return {
                    id: slice.venueId,
                    name: venue?.hostName ?? slice.venueId,
                    caption: [slice.venueId, venue?.city].filter(Boolean).join(' · '),
                    value: slice.received,
                    route: `/venue/${slice.venueId}`,
                };
            });
    });

    // -------------------------------------------------------------------
    // Venues tab - every venue in the current scope (nationwide, or the
    // selected state's), ranked → the picked venue's own ads. No "which
    // state" step here (that's the map's own job) - this is a flat venue
    // ranking, one level shallower than the Categories tab's own venue
    // level, which groups by category first.
    // -------------------------------------------------------------------

    /**
     * Venues in the current scope, most received first - the Venues tab's top-level
     * list. Reuses selectedStateVenues() (already fetched/scoped for the map and the
     * other tabs), no separate call.
     * @type {Signal<ShareItem[]>}
     */
    venueShareItems = computed((): ShareItem[] =>
        [...this.selectedStateVenues()]
            .sort((left, right) => right.totalAds - left.totalAds)
            .map((venue) => ({
                id: venue.venueId,
                name: venue.hostName ?? venue.venueId,
                caption: [venue.venueId, venue.city].filter(Boolean).join(' · '),
                value: venue.totalAds,
                route: `/venue/${venue.venueId}`,
            })),
    );

    /** Venue picked in the Venues tab, or null for the top venue. */
    selectedVenueId = signal<string | null>(null);

    /** The picked venue, or the top venue when none is picked. */
    selectedVenue = computed((): ShareItem | null => {
        const venues = this.venueShareItems();
        const id = this.selectedVenueId();
        return venues.find((venue) => venue.id === id) ?? venues[0] ?? null;
    });

    /**
     * Ads played at the Venues tab's picked venue, each as a share of the venue's own
     * total - see adsAtVenue()'s own remarks.
     * @type {Signal<ShareItem[]>}
     */
    selectedVenueAdItems = computed((): ShareItem[] => this.adsAtVenue(this.selectedVenue()?.id));

    // -------------------------------------------------------------------
    // Categories tab - category ranking within the current scope (every
    // venue nationwide, or just the selected state's, via
    // selectedStateVenues() - the same signal the Ads tab already scopes
    // on) → its venues in that category → the picked venue's ads.
    // -------------------------------------------------------------------

    /**
     * Category ranking within the current scope (nationwide, or the selected state's
     * venues), rolled up from selectedStateVenues() - each venue already carries its own
     * totalAds and category, so no separate call is needed here either.
     * @type {Signal<ShareItem[]>}
     */
    categoryShareItems = computed((): ShareItem[] => {
        const byCategory = new Map<string, number>();
        for (const venue of this.selectedStateVenues()) {
            const category = venue.category ?? 'Unknown';
            byCategory.set(category, (byCategory.get(category) ?? 0) + venue.totalAds);
        }

        return [...byCategory.entries()]
            .map(([category, value]) => ({
                id: category,
                name: this.categoryName(category),
                value,
            }))
            .sort((left, right) => right.value - left.value);
    });

    /** Category picked in the Categories tab, or null for the top category. */
    selectedMapCategoryId = signal<string | null>(null);

    /** The picked category, or the top category when none is picked. */
    selectedMapCategory = computed((): ShareItem | null => {
        const categories = this.categoryShareItems();
        const id = this.selectedMapCategoryId();
        return categories.find((category) => category.id === id) ?? categories[0] ?? null;
    });

    /**
     * Venues in the selected category, within the current scope, most received first.
     * @type {Signal<ShareItem[]>}
     */
    categoryVenueItems = computed((): ShareItem[] => {
        const category = this.selectedMapCategory()?.id;
        if (!category) {
            return [];
        }

        return this.selectedStateVenues()
            .filter((venue) => (venue.category ?? 'Unknown') === category)
            .sort((left, right) => right.totalAds - left.totalAds)
            .map((venue) => ({
                id: venue.venueId,
                name: venue.hostName ?? venue.venueId,
                caption: [venue.venueId, venue.city].filter(Boolean).join(' · '),
                value: venue.totalAds,
                route: `/venue/${venue.venueId}`,
            }));
    });

    /** Venue picked in the Categories tab's venue list, or null for the top venue. */
    selectedMapVenueId = signal<string | null>(null);

    /** The picked venue, or the top venue when none is picked. */
    selectedMapVenue = computed((): ShareItem | null => {
        const venues = this.categoryVenueItems();
        const id = this.selectedMapVenueId();
        return venues.find((venue) => venue.id === id) ?? venues[0] ?? null;
    });

    /**
     * Ads played at the selected venue (Categories tab) - see adsAtVenue()'s own remarks.
     * @type {Signal<ShareItem[]>}
     */
    venueAdItems = computed((): ShareItem[] => this.adsAtVenue(this.selectedMapVenue()?.id));

    /**
     * Ads played at a given venue, looked up from adSharesInState()'s own per-ad venue
     * slices (already scoped the same way as selectedStateVenues()), each as a share of
     * the venue's own total. Shared by both the Categories tab's venue level
     * (venueAdItems) and the Venues tab (selectedVenueAdItems).
     *
     * @param venueId - Venue to look up, or undefined/null for none picked yet
     * @returns {ShareItem[]} That venue's ads, most received first
     */
    private adsAtVenue(venueId: string | null | undefined): ShareItem[] {
        if (!venueId) {
            return [];
        }

        return (this.adSharesInState()?.ads ?? [])
            .map((ad) => {
                const slice = ad.venues.find((venueSlice) => venueSlice.venueId === venueId);
                return slice ? { ad, received: slice.received } : null;
            })
            .filter((row): row is { ad: DashboardAdShare; received: number } => row !== null)
            .sort((left, right) => right.received - left.received)
            .map(({ ad, received }) => ({
                id: this.adId(ad),
                name: this.shortTitle(ad.title),
                fullName: ad.title,
                value: received,
                imageUrl: ad.mediaUrl,
                isVideo: ad.creativeType === 'video',
                route: ad.contentId ? `/ad/${ad.contentId}` : null,
            }));
    }

    /**
     * Stable ID for an ad share row - creativeId alone isn't unique across sources.
     *
     * @param ad - Ad share row
     * @returns {string} "creativeId:source"
     */
    private adId(ad: DashboardAdShare): string {
        return `${ad.creativeId}:${ad.source}`;
    }

    /**
     * Shortens a long ad title (usually a file name, e.g. a UUID + extension) in the
     * middle, keeping its start and its extension.
     *
     * @param title - The full title
     * @returns {string} e.g. "b3e49f9a-b...885d9.jpg"
     */
    protected shortTitle(title: string): string {
        return truncateMiddle(title, 10, 8);
    }

    /**
     * Display name for a category.
     *
     * @param category - Category name, or "Unknown"
     * @returns {string} e.g. "Restaurant", "Unknown category"
     */
    protected categoryName(category: string): string {
        return category === 'Unknown' ? 'Unknown category' : category;
    }

    /**
     * Reloads the Ads breakdown for the current state/range - the retry
     * button shown on a failed load.
     *
     * @returns {void}
     */
    reloadAdShares(): void {
        const code = this.selectedState();
        if (code) {
            this.onStateClicked(code);
            return;
        }

        const range = this.range();
        this.loadNationwideAdShares(
            range ? this.formatCalendarDate(range.start) : undefined,
            range ? this.formatCalendarDate(range.end) : undefined,
        );
    }

    /** Per-day totals (total ads, unique venues) for the selected state's venues - empty until a state is clicked. */
    dailyAdsSummary = signal<DailyAdsSummaryEntry[]>([]);
    isLoadingDailyAdsSummary = signal(false);

    /** The in-flight state-ranking request - cancelled when a newer range replaces it. */
    private rankingSubscription?: Subscription;

    /** In-flight ads/chart requests - cancelled when a new range or state replaces them. */
    private detailSubscriptions = new Subscription();

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.rankingSubscription?.unsubscribe();
            this.detailSubscriptions.unsubscribe();
        });

        // Loads now (the first value) and again whenever the shared range or the
        // "Eastern Time / UTC" display mode changes - a quick range like "Yesterday" can
        // resolve to the exact same calendar-date label in both zones for most of the day,
        // while still meaning a genuinely different UTC instant window underneath that
        // label (resolve-date-zone.middleware.ts), so the mode has to be its own trigger,
        // not just a side effect of the range changing.
        combineLatest([
            toObservable(this.rangeService.pageRange),
            toObservable(this.timeDisplayService.mode),
        ])
            .pipe(takeUntilDestroyed())
            .subscribe(() => this.load());
    }

    /**
     * Loads state ranking data for the current range. If a state was
     * already selected, it stays selected - its venues/ads/chart are
     * reloaded for the new range once the new state ranking arrives,
     * instead of forcing the user to click the map again.
     *
     * @returns void
     */
    private load(): void {
        const previouslySelectedState = this.selectedState();

        this.isLoading.set(true);
        this.selectedState.set(null);
        this.adSharesInState.set(null);
        this.dailyAdsSummary.set([]);
        // Set synchronously, not just inside loadNationwideAdShares()/
        // onStateClicked() below - those only run once the state-ranking
        // response comes back, so without this the breakdown card's
        // skeleton stayed off (isLoadingAdShares() still false) during that
        // initial wait, rendering an empty state instead.
        this.isLoadingAdShares.set(true);

        const startDate = this.range() ? this.formatCalendarDate(this.range()!.start) : undefined;
        const endDate = this.range() ? this.formatCalendarDate(this.range()!.end) : undefined;

        // A new range supersedes whatever was still in flight for the old one
        this.rankingSubscription?.unsubscribe();
        this.detailSubscriptions.unsubscribe();
        this.detailSubscriptions = new Subscription();

        // With nothing selected (including the very first load) the breakdown card and
        // chart are nationwide - they don't need the state ranking, so they start
        // now, in parallel, instead of waiting for it. A previously-selected state
        // still has to wait: its venue IDs come from the new ranking.
        if (!previouslySelectedState) {
            this.loadNationwideAdShares(startDate, endDate);
            this.loadNationwideDailyChart(startDate, endDate);
        }

        this.rankingSubscription = this.mediaFilesService
            .getStateRanking({ startDate, endDate })
            .subscribe({
                next: ({ states, venues }) => {
                    this.stateRanking.set(states);
                    this.stateRankingVenues.set(venues);
                    this.isLoading.set(false);

                    // Re-select and reload for the new range - selectedStateVenues()
                    // reads off stateRankingVenues() above, so this already sees
                    // the new range's venues, not the stale pre-reload ones.
                    if (previouslySelectedState) {
                        this.onStateClicked(previouslySelectedState);
                    }
                },
                error: (error: unknown) => {
                    console.error('[Map View] Failed to load state ranking:', error);
                    this.isLoading.set(false);
                },
            });
    }

    /**
     * Loads the nationwide Ads → Categories → Venues breakdown - shown
     * whenever no state is selected (including the very first page load),
     * instead of leaving the card empty until a state is clicked. Mirrors
     * onStateClicked()'s own ads call, just without a venue-ID filter.
     *
     * @param startDate - "YYYY-MM-DD", or undefined for all-time
     * @param endDate - "YYYY-MM-DD", or undefined for all-time
     * @returns void
     */
    private loadNationwideAdShares(
        startDate: string | undefined,
        endDate: string | undefined,
    ): void {
        this.isLoadingAdShares.set(true);
        this.hasAdSharesError.set(false);
        this.selectedAdId.set(null);
        this.selectedCategoryId.set(null);
        this.selectedMapCategoryId.set(null);
        this.selectedMapVenueId.set(null);
        this.selectedVenueId.set(null);
        this.selectedNationwideStateId.set(null);
        this.selectedNationwideAdId.set(null);

        this.detailSubscriptions.add(
            this.dashboardSummaryService.getAdsByVenues([], { startDate, endDate }).subscribe({
                next: (data) => {
                    this.adSharesInState.set(data);
                    this.isLoadingAdShares.set(false);
                },
                error: (error: unknown) => {
                    console.error('[Map View] Failed to load nationwide ad shares:', error);
                    this.isLoadingAdShares.set(false);
                    this.hasAdSharesError.set(true);
                },
            }),
        );
    }

    /**
     * Loads the nationwide daily chart - shown whenever no state is
     * selected. Split from loadNationwideAdShares() so a failed/retried
     * ads breakdown doesn't also reload the chart.
     *
     * @param startDate - "YYYY-MM-DD", or undefined for all-time
     * @param endDate - "YYYY-MM-DD", or undefined for all-time
     * @returns void
     */
    private loadNationwideDailyChart(
        startDate: string | undefined,
        endDate: string | undefined,
    ): void {
        this.isLoadingDailyAdsSummary.set(true);
        this.detailSubscriptions.add(
            this.mediaFilesService.getDailyAdsSummary({ startDate, endDate }).subscribe({
                next: (days) => {
                    this.dailyAdsSummary.set(days);
                    this.isLoadingDailyAdsSummary.set(false);
                },
                error: (error: unknown) => {
                    console.error('[Map View] Failed to load nationwide daily ads summary:', error);
                    this.isLoadingDailyAdsSummary.set(false);
                },
            }),
        );
    }

    /**
     * Handles a state being clicked on the map: selects it, then loads the
     * Ads → Categories → Venues breakdown and the per-day bar chart for its
     * venues - both scoped to the current date range.
     *
     * @param code - Two-letter USPS state code
     * @returns void
     */
    onStateClicked(code: string): void {
        this.detailSubscriptions.unsubscribe();
        this.detailSubscriptions = new Subscription();
        this.selectedState.set(code);
        this.adSharesInState.set(null);
        this.dailyAdsSummary.set([]);
        this.isLoadingAdShares.set(true);
        this.hasAdSharesError.set(false);
        this.selectedAdId.set(null);
        this.selectedCategoryId.set(null);
        this.selectedMapCategoryId.set(null);
        this.selectedMapVenueId.set(null);
        this.selectedVenueId.set(null);
        this.selectedNationwideStateId.set(null);
        this.selectedNationwideAdId.set(null);

        const venueIds = this.selectedStateVenues().map((venue) => venue.venueId);
        const range = this.range();
        const startDate = range ? this.formatCalendarDate(range.start) : undefined;
        const endDate = range ? this.formatCalendarDate(range.end) : undefined;

        this.detailSubscriptions.add(
            this.dashboardSummaryService
                .getAdsByVenues(venueIds, { startDate, endDate })
                .subscribe({
                    next: (data) => {
                        this.adSharesInState.set(data);
                        this.isLoadingAdShares.set(false);
                    },
                    error: (error: unknown) => {
                        console.error('[Map View] Failed to load ad shares for state:', error);
                        this.isLoadingAdShares.set(false);
                        this.hasAdSharesError.set(true);
                    },
                }),
        );

        this.loadDailyAdsSummary(venueIds, startDate, endDate);
    }

    /**
     * Loads the per-day bar chart data for a state's venues.
     *
     * @param venueIds - Venue IDs to restrict to
     * @param startDate - "YYYY-MM-DD", or undefined for the server's default (last 2 weeks)
     * @param endDate - "YYYY-MM-DD", or undefined for the server's default (today)
     * @returns void
     */
    private loadDailyAdsSummary(
        venueIds: string[],
        startDate: string | undefined,
        endDate: string | undefined,
    ): void {
        this.isLoadingDailyAdsSummary.set(true);

        this.detailSubscriptions.add(
            this.mediaFilesService
                .getDailyAdsSummaryByVenues(venueIds, { startDate, endDate })
                .subscribe({
                    next: (days) => {
                        this.dailyAdsSummary.set(days);
                        this.isLoadingDailyAdsSummary.set(false);
                    },
                    error: (error: unknown) => {
                        console.error('[Map View] Failed to load daily ads summary:', error);
                        this.isLoadingDailyAdsSummary.set(false);
                    },
                }),
        );
    }

    /**
     * Formats a Date's own local calendar components as "YYYY-MM-DD" -
     * deliberately not toISOString(), which converts to UTC and can shift
     * the date backward or forward a day depending on the browser's offset.
     * Mirrors RankingDataComponent's own formatCalendarDate.
     *
     * @param date - Date to format
     * @returns "YYYY-MM-DD"
     */
    private formatCalendarDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}
