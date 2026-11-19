/** Angular Imports */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Local Imports */
import { type AdvertiserDashboard, AdvertiserProfilesService } from '@core';
import { explainReviewNote } from '@features/advertiser-profile/advertiser-detail/review-note.util';
import { PageHeaderComponent } from '@shared/components/page-header';
import { UsStatesChoroplethComponent } from '@shared/components/us-states-choropleth';
import { STATE_CODE_TO_NAME } from '@shared/utils/us-states.util';

/** Categories listed for the selected state before "See more". */
const STATE_CATEGORY_LIMIT = 8;

/** Groups left out of the map's category chips (too vague to map). */
const NOT_A_CHIP = new Set(['Other', 'No category']);

/**
 * Dashboard: how many advertisers there are, where they are by US state, their category
 * mix, and which profiles need attention.
 *
 * @remarks
 * One request (GET /api/advertiser-profiles/dashboard) returns every figure. Picking a
 * category (chip or bar) shades the map by that category; clicking a state shows its
 * category mix. Lazy-loaded, so the map code stays out of the main bundle.
 */
@Component({
    selector: 'app-dashboard',
    imports: [PageHeaderComponent, UsStatesChoroplethComponent, RouterLink],
    templateUrl: './dashboard.component.html',
    styleUrl: './dashboard.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
})
export class DashboardComponent {
    /**
     * Advertiser profiles API
     * @type {AdvertiserProfilesService}
     */
    private readonly advertiserProfilesService = inject(AdvertiserProfilesService);

    /**
     * The figures, or null until loaded
     * @type {WritableSignal<AdvertiserDashboard | null>}
     */
    protected readonly data = signal<AdvertiserDashboard | null>(null);

    /**
     * Why the figures failed to load, or null
     * @type {WritableSignal<string | null>}
     */
    protected readonly error = signal<string | null>(null);

    /**
     * Selected state's code (the map outline and the category mix panel)
     * @type {WritableSignal<string | null>}
     */
    protected readonly selectedState = signal<string | null>(null);

    /**
     * Category group shown on the map, by index into `groups`; -1 for all
     * @type {WritableSignal<number>}
     */
    protected readonly selectedGroup = signal(-1);

    /**
     * Whether the selected state's full category list is shown
     * @type {WritableSignal<boolean>}
     */
    protected readonly showAllCategories = signal(false);

    /**
     * Advertisers per state for the map: all, or the selected category group
     * @type {Signal<Record<string, number>>}
     */
    protected readonly mapValues = computed(() => {
        const data = this.data();
        const group = this.selectedGroup();
        if (!data) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(data.states).map(([code, counts]) => [
                code,
                group < 0 ? sum(counts) : counts[group],
            ]),
        );
    });

    /**
     * Map tooltip: the state, and how many advertisers (of the chosen category)
     * @type {Signal<(code: string, value: number) => string>}
     */
    protected readonly mapTooltip = computed(() => {
        const data = this.data();
        const group = this.selectedGroup();
        return (code: string, value: number): string => {
            const name = STATE_CODE_TO_NAME[code] ?? code;
            if (group < 0 || !data) {
                return `${name}: ${plural(value, 'advertiser')}`;
            }
            const all = sum(data.states[code] ?? []);
            const share = all ? ` (${Math.round((value / all) * 100)}% of ${all})` : '';
            return `${name}: ${value} ${data.groups[group].name}${share}`;
        };
    });

    /**
     * What the map is shaded by, for its caption and accessible label
     * @type {Signal<string>}
     */
    protected readonly mapSubject = computed(() => {
        const group = this.selectedGroup();
        const data = this.data();
        return group < 0 || !data ? 'advertisers' : `${data.groups[group].name} advertisers`;
    });

    /**
     * Category chips above the map (named groups only)
     * @type {Signal<{ index: number; name: string }[]>}
     */
    protected readonly chips = computed(() =>
        (this.data()?.groups ?? [])
            .map((g, index) => ({ index, name: g.name }))
            .filter((g) => !NOT_A_CHIP.has(g.name)),
    );

    /**
     * States with advertisers, for the state picker, by name
     * @type {Signal<{ code: string; label: string }[]>}
     */
    protected readonly stateOptions = computed(() => {
        const data = this.data();
        if (!data) {
            return [];
        }
        return Object.keys(data.states)
            .map((code) => ({
                code,
                name: STATE_CODE_TO_NAME[code] ?? code,
                total: sum(data.states[code]),
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => ({ code: s.code, label: `${s.name} (${s.total})` }));
    });

    /**
     * The selected state's category mix, largest first
     * @type {Signal<{ name: string; count: number; pct: number; width: number; highlighted: boolean }[]>}
     */
    private readonly stateMix = computed(() => {
        const data = this.data();
        const code = this.selectedState();
        const counts = data && code ? data.states[code] : undefined;
        if (!data || !counts) {
            return [];
        }
        const total = sum(counts);
        const rows = counts
            .map((count, index) => ({ index, name: data.groups[index].name, count }))
            .filter((r) => r.count > 0)
            .sort((a, b) => b.count - a.count);
        const largest = rows[0]?.count ?? 1;
        return rows.map((r) => ({
            name: r.name,
            count: r.count,
            pct: Math.round((r.count / total) * 100),
            width: Math.round((r.count / largest) * 100),
            highlighted: r.index === this.selectedGroup(),
        }));
    });

    /**
     * The selected state's panel: name, total and category rows (8 unless expanded)
     * @type {Signal<object | null>}
     */
    protected readonly statePanel = computed(() => {
        const data = this.data();
        const code = this.selectedState();
        if (!data || !code) {
            return null;
        }
        const mix = this.stateMix();
        const total = sum(data.states[code] ?? []);
        const hidden = Math.max(0, mix.length - STATE_CATEGORY_LIMIT);
        return {
            name: STATE_CODE_TO_NAME[code] ?? code,
            total,
            share: data.totals.withState ? Math.round((total / data.totals.withState) * 100) : 0,
            topGroup: mix[0]?.name ?? null,
            rows: this.showAllCategories() ? mix : mix.slice(0, STATE_CATEGORY_LIMIT),
            hidden,
        };
    });

    /**
     * Category group bars: count, share of all advertisers and bar width
     * @type {Signal<{ index: number; name: string; count: number; pct: string; width: number; muted: boolean }[]>}
     */
    protected readonly groupBars = computed(() => {
        const data = this.data();
        if (!data) {
            return [];
        }
        const largest = Math.max(1, ...data.groups.map((g) => g.count));
        return data.groups.map((g, index) => ({
            index,
            name: g.name,
            count: g.count,
            pct: data.totals.advertisers
                ? ((g.count / data.totals.advertisers) * 100).toFixed(1)
                : '0',
            width: Math.round((g.count / largest) * 100),
            muted: NOT_A_CHIP.has(g.name),
        }));
    });

    /**
     * Side list: the most common category names, or the top states for the chosen group
     * @type {Signal<{ title: string; caption: string; rows: { label: string; count: number; note: string }[] }>}
     */
    protected readonly sideList = computed(() => {
        const data = this.data();
        const group = this.selectedGroup();
        if (!data) {
            return { title: '', caption: '', rows: [] };
        }
        if (group < 0) {
            return {
                title: 'Top category names',
                caption: 'The most common categories, ignoring capitals',
                rows: data.topCategories.map((c) => ({ label: c.name, count: c.count, note: '' })),
            };
        }
        const rows = Object.entries(data.states)
            .map(([code, counts]) => ({ code, count: counts[group], all: sum(counts) }))
            .filter((r) => r.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)
            .map((r) => ({
                label: STATE_CODE_TO_NAME[r.code] ?? r.code,
                count: r.count,
                note: `${Math.round((r.count / r.all) * 100)}%`,
            }));
        return {
            title: `Top states for ${data.groups[group].name}`,
            caption: 'Advertisers, and their share of the state',
            rows,
        };
    });

    /**
     * Needs Attention breakdown, with bar widths relative to the largest
     * @type {Signal<{ title: string; count: number; hint: string; width: number }[]>}
     */
    protected readonly issues = computed(() => {
        const attention = this.data()?.attention;
        if (!attention) {
            return [];
        }
        const items = [
            {
                title: 'Possible duplicates',
                count: attention.duplicates,
                hint: 'Same name and location as another profile (both are tagged)',
            },
            {
                title: 'Missing business name',
                count: attention.missingName,
                hint: 'Saved as "Unnamed business"',
            },
            {
                title: 'Second website left out',
                count: attention.secondWebsite,
                hint: 'The Website cell listed two sites',
            },
        ];
        const largest = Math.max(1, ...items.map((i) => i.count));
        return items.map((i) => ({ ...i, width: Math.round((i.count / largest) * 100) }));
    });

    /**
     * Latest profiles to review, with a short reason
     * @type {Signal<{ id: string; name: string | null; category: string | null; why: string }[]>}
     */
    protected readonly toReview = computed(() =>
        (this.data()?.attention.toReview ?? []).map((r) => ({
            id: r.id,
            name: r.business_name,
            category: r.category,
            why: explainReviewNote(r.reason).title,
        })),
    );

    /**
     * Query parameters that open the advertiser list filtered to the selected state,
     * and to the category shown on the map, if one is
     * @type {Signal<Record<string, string>>}
     */
    protected readonly stateListParams = computed(() => {
        const params: Record<string, string> = {};
        const state = this.selectedState();
        const group = this.selectedGroup();
        const data = this.data();
        if (state) {
            params['state'] = state;
        }
        if (data && group >= 0) {
            params['group'] = data.groups[group].name;
        }
        return params;
    });

    constructor() {
        this.advertiserProfilesService.dashboard().subscribe({
            next: (data) => {
                this.data.set(data);
                // Start on the state with the most advertisers
                const busiest = Object.entries(data.states).sort(
                    (a, b) => sum(b[1]) - sum(a[1]),
                )[0];
                this.selectedState.set(busiest?.[0] ?? null);
            },
            error: (error: unknown) =>
                this.error.set(
                    AdvertiserProfilesService.errorMessage(
                        error,
                        'The dashboard could not be loaded.',
                    ),
                ),
        });
    }

    /**
     * Selects a state (map click or picker) and collapses its category list.
     *
     * @param code - Two-letter state code
     * @returns {void}
     */
    protected selectState(code: string): void {
        this.selectedState.set(code);
        this.showAllCategories.set(false);
    }

    /**
     * Shows a category group on the map, or all advertisers when it is already shown.
     *
     * @param index - Index into `groups`; -1 for all
     * @returns {void}
     */
    protected toggleGroup(index: number): void {
        this.selectedGroup.update((current) => (current === index ? -1 : index));
    }

    /**
     * Formats a count with its noun, e.g. "1 advertiser" / "93 advertisers".
     *
     * @param count - The count
     * @param noun - Singular noun
     * @returns {string}
     */
    protected plural(count: number, noun: string): string {
        return plural(count, noun);
    }
}

/**
 * Sum of a list of numbers.
 *
 * @param values - The numbers
 * @returns The total
 */
function sum(values: number[]): number {
    return values.reduce((a, b) => a + b, 0);
}

/**
 * A count with its noun, e.g. "1 advertiser" / "93 advertisers".
 *
 * @param count - The count
 * @param noun - Singular noun
 * @returns {string}
 */
function plural(count: number, noun: string): string {
    return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}
