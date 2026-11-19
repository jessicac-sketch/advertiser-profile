/** Angular Imports */
import { NgTemplateOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

/** Third Party Imports */
import { Button } from '@ntv360/component-pantry';

/** Local Imports */
import {
    type AdvertiserImportPreview,
    type AdvertiserImportResult,
    type AdvertiserImportRow,
    type AdvertiserImportRowStatus,
    type AdvertiserListFilters,
    type AdvertiserProfile,
    type AdvertiserProfileInput,
    AdvertiserProfilesService,
} from '@core';
import { PageHeaderComponent } from '@shared/components/page-header';
import { ShowMoreComponent } from '@shared/components/show-more';
import { SocialBadgeComponent } from '@shared/components/social-badge';
import { fileNameOf } from '@shared/utils/file-name.util';
import { describeSocialLink, type SocialLink } from '@shared/utils/social-link.util';
import { STATE_CODE_TO_NAME } from '@shared/utils/us-states.util';

/** Advertisers loaded at first, and added by each "Show More". */
const PAGE_SIZE = 20;

/** localStorage key for the list / grid choice. */
const VIEW_STORAGE_KEY = 'ntv360-advertisers-view';

/** How the advertisers are shown. */
type AdvertiserView = 'list' | 'grid';

/** Spreadsheet columns, in table order, with the headings the import looks for. */
const IMPORT_COLUMNS: readonly { key: keyof AdvertiserProfileInput; label: string }[] = [
    { key: 'business_name', label: 'Business Name' },
    { key: 'location', label: 'Location' },
    { key: 'phone_number', label: 'Phone Number' },
    { key: 'category', label: 'Category' },
    { key: 'social_media', label: 'Social Media' },
    { key: 'website', label: 'Website' },
];

/** Import preview columns: the list's columns plus the video. */
const PREVIEW_COLUMNS: readonly { key: keyof AdvertiserProfileInput; label: string }[] = [
    ...IMPORT_COLUMNS,
    { key: 'video_url', label: 'Video URL' },
];

/**
 * Advertiser Profile page: the list of advertisers, and importing them from Excel.
 *
 * @remarks
 * Import is two steps. Choosing a file uploads it for a preview (nothing is saved) that
 * marks each row new, duplicate or invalid; confirming uploads the same file again and
 * the BFF inserts only the new rows.
 */
@Component({
    selector: 'app-advertiser-profile',
    imports: [
        PageHeaderComponent,
        ShowMoreComponent,
        SocialBadgeComponent,
        NgTemplateOutlet,
        Button,
        RouterLink,
    ],
    templateUrl: './advertiser-profile.component.html',
    styleUrl: './advertiser-profile.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
})
export class AdvertiserProfileComponent {
    /**
     * Advertiser profiles API
     * @type {AdvertiserProfilesService}
     */
    private readonly advertiserProfilesService = inject(AdvertiserProfilesService);

    /**
     * Column headings, in display order
     * @type {typeof IMPORT_COLUMNS}
     */
    protected readonly columns = IMPORT_COLUMNS;

    /**
     * Import preview column headings (with Video URL)
     * @type {typeof PREVIEW_COLUMNS}
     */
    protected readonly previewColumns = PREVIEW_COLUMNS;

    /**
     * Advertisers shown so far (20 at first, 20 more per "Show More"), or null until loaded
     * @type {WritableSignal<AdvertiserProfile[] | null>}
     */
    protected readonly advertisers = signal<AdvertiserProfile[] | null>(null);

    /**
     * Advertisers in total
     * @type {WritableSignal<number>}
     */
    protected readonly total = signal(0);

    /**
     * True while the next 20 are loading
     * @type {WritableSignal<boolean>}
     */
    protected readonly isLoadingMore = signal(false);

    /**
     * List (table) or grid (cards), remembered in this browser
     * @type {WritableSignal<AdvertiserView>}
     */
    protected readonly view = signal<AdvertiserView>(readStoredView());

    /**
     * Which preview rows to show: one status, or null for all
     * @type {WritableSignal<AdvertiserImportRowStatus | null>}
     */
    protected readonly rowFilter = signal<AdvertiserImportRowStatus | null>(null);

    /**
     * Preview rows matching the filter
     * @type {Signal<AdvertiserImportRow[]>}
     */
    protected readonly visibleRows = computed(() => {
        const rows = this.preview()?.rows ?? [];
        const filter = this.rowFilter();
        return filter ? rows.filter((row) => row.status === filter) : rows;
    });

    /**
     * Why the list failed to load, or null
     * @type {WritableSignal<string | null>}
     */
    protected readonly listError = signal<string | null>(null);

    /**
     * The workbook being imported
     * @type {WritableSignal<File | null>}
     */
    protected readonly importFile = signal<File | null>(null);

    /**
     * What the import would do, once the file has been read
     * @type {WritableSignal<AdvertiserImportPreview | null>}
     */
    protected readonly preview = signal<AdvertiserImportPreview | null>(null);

    /**
     * True while the file is being read for the preview
     * @type {WritableSignal<boolean>}
     */
    protected readonly isPreviewing = signal(false);

    /**
     * True while the import is being saved
     * @type {WritableSignal<boolean>}
     */
    protected readonly isImporting = signal(false);

    /**
     * Why the preview or import failed, or null
     * @type {WritableSignal<string | null>}
     */
    protected readonly importError = signal<string | null>(null);

    /**
     * Outcome of the last saved import, or null
     * @type {WritableSignal<AdvertiserImportResult | null>}
     */
    protected readonly result = signal<AdvertiserImportResult | null>(null);

    /**
     * Rows that will be imported with a change (e.g. a second website left out)
     * @type {Signal<number>}
     */
    /**
     * Also import duplicates within the file (tagged Needs Attention)
     * @type {WritableSignal<boolean>}
     */
    protected readonly includeDuplicates = signal(false);

    /**
     * Also import rows with problems (tagged Needs Attention)
     * @type {WritableSignal<boolean>}
     */
    protected readonly includeInvalid = signal(false);

    /**
     * Duplicates of an earlier row in the same file (can be included)
     * @type {Signal<number>}
     */
    protected readonly fileDuplicateCount = computed(
        () =>
            this.preview()?.rows.filter((r) => r.status === 'duplicate' && !r.alreadySaved)
                .length ?? 0,
    );

    /**
     * Duplicates of advertisers already saved (always skipped)
     * @type {Signal<number>}
     */
    protected readonly savedDuplicateCount = computed(
        () => (this.preview()?.counts.duplicate ?? 0) - this.fileDuplicateCount(),
    );

    /**
     * How many rows the Import button will add
     * @type {Signal<number>}
     */
    protected readonly importCount = computed(() => {
        const p = this.preview();
        if (!p) {
            return 0;
        }
        return (
            p.counts.new +
            (this.includeDuplicates() ? this.fileDuplicateCount() : 0) +
            (this.includeInvalid() ? p.counts.invalid : 0)
        );
    });

    protected readonly notedCount = computed(
        () => this.preview()?.rows.filter((r) => r.status === 'new' && r.notes?.length).length ?? 0,
    );

    /**
     * Header line under the title
     * @type {Signal<string>}
     */
    protected readonly subtitle = computed(() => {
        if (!this.advertisers()) {
            return 'Business details for each advertiser.';
        }
        const total = this.total();
        const count = total === 1 ? '1 advertiser' : `${total.toLocaleString()} advertisers`;
        return this.hasFilters() ? `${count} match the filters` : count;
    });

    /**
     * Current list filters (from the address)
     * @type {WritableSignal<AdvertiserListFilters>}
     */
    protected readonly filters = signal<AdvertiserListFilters>({});

    /**
     * Text in the search box (applied once typing pauses)
     * @type {WritableSignal<string>}
     */
    protected readonly searchText = signal('');

    /**
     * Whether any filter is set
     * @type {Signal<boolean>}
     */
    protected readonly hasFilters = computed(() => {
        const f = this.filters();
        return Boolean(f.search || f.group || f.state || f.attention);
    });

    /**
     * Category groups and states for the filter menus, or null until loaded
     * @type {WritableSignal<{ groups: { name: string; count: number }[]; states: Record<string, number[]>; noState: number } | null>}
     */
    private readonly filterOptions = signal<{
        groups: { name: string; count: number }[];
        states: Record<string, number[]>;
        noState: number;
    } | null>(null);

    /**
     * Category menu: each group with its number of advertisers
     * @type {Signal<{ name: string; count: number }[]>}
     */
    protected readonly groupOptions = computed(() => this.filterOptions()?.groups ?? []);

    /**
     * State menu: states with advertisers by name, then "No state"
     * @type {Signal<{ code: string; label: string }[]>}
     */
    protected readonly stateOptions = computed(() => {
        const options = this.filterOptions();
        if (!options) {
            return [];
        }
        const states = Object.entries(options.states)
            .map(([code, counts]) => ({
                code,
                name: STATE_CODE_TO_NAME[code] ?? code,
                total: counts.reduce((a, b) => a + b, 0),
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => ({ code: s.code, label: `${s.name} (${s.total})` }));
        return [...states, { code: 'none', label: `No state (${options.noState})` }];
    });

    /**
     * Router, to keep the filters in the address
     * @type {Router}
     */
    private readonly router = inject(Router);

    /**
     * Counts list requests, so a slower, older one can't overwrite a newer result
     * @type {number}
     */
    private listRequest = 0;

    /**
     * Pending search, applied once typing pauses
     * @type {ReturnType<typeof setTimeout> | undefined}
     */
    private searchTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * Expected columns the sheet doesn't have (they are imported empty)
     * @type {Signal<string[]>}
     */
    protected readonly missingColumns = computed(() => {
        const matched = this.preview()?.matchedColumns ?? {};
        return this.previewColumns.filter((c) => !matched[c.key]).map((c) => c.label);
    });

    constructor() {
        // Filters live in the address, so the dashboard can link to a filtered list
        inject(ActivatedRoute)
            .queryParamMap.pipe(takeUntilDestroyed())
            .subscribe((params) => {
                const filters: AdvertiserListFilters = {
                    search: params.get('search') || undefined,
                    group: params.get('group') || undefined,
                    state: params.get('state') || undefined,
                    attention: params.get('attention') === 'true' || undefined,
                };
                this.filters.set(filters);
                this.searchText.set(filters.search ?? '');
                this.loadAdvertisers();
            });
        this.loadFilterOptions();
        inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
    }

    /**
     * Changes one or more filters (an empty value removes it) and reloads the list.
     *
     * @param change - Filters to set
     * @returns {void}
     */
    protected setFilter(change: Partial<AdvertiserListFilters>): void {
        const next = { ...this.filters(), ...change };
        void this.router.navigate([], {
            queryParams: {
                search: next.search || null,
                group: next.group || null,
                state: next.state || null,
                attention: next.attention ? 'true' : null,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }

    /**
     * Search as the user types, once they pause.
     *
     * @param value - Text in the search box
     * @returns {void}
     */
    protected onSearchInput(value: string): void {
        this.searchText.set(value);
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(
            () => this.setFilter({ search: value.trim() || undefined }),
            300,
        );
    }

    /**
     * Removes every filter.
     *
     * @returns {void}
     */
    protected clearFilters(): void {
        clearTimeout(this.searchTimer);
        this.setFilter({
            search: undefined,
            group: undefined,
            state: undefined,
            attention: undefined,
        });
    }

    /**
     * Adds the next 20 advertisers to the list.
     *
     * @returns {void}
     */
    protected showMore(): void {
        const shown = this.advertisers() ?? [];
        if (this.isLoadingMore() || shown.length >= this.total()) {
            return;
        }
        // Pages of 20 in a fixed order (name, then id), so the next page follows on
        const nextPage = Math.floor(shown.length / PAGE_SIZE) + 1;
        this.isLoadingMore.set(true);
        this.advertiserProfilesService.list(nextPage, PAGE_SIZE, this.filters()).subscribe({
            next: (result) => {
                // Skip any already shown (if advertisers were added meanwhile)
                const ids = new Set(shown.map((a) => a.id));
                this.advertisers.set([...shown, ...result.items.filter((a) => !ids.has(a.id))]);
                this.total.set(result.total);
                this.isLoadingMore.set(false);
            },
            error: (error: unknown) => {
                this.isLoadingMore.set(false);
                this.listError.set(
                    AdvertiserProfilesService.errorMessage(
                        error,
                        'More advertisers could not be loaded.',
                    ),
                );
            },
        });
    }

    /**
     * Switches between list and grid, and remembers the choice.
     *
     * @param view - 'list' or 'grid'
     * @returns {void}
     */
    protected setView(view: AdvertiserView): void {
        this.view.set(view);
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, view);
        } catch {
            // Storage unavailable: the choice just isn't remembered
        }
    }

    /**
     * Reads the chosen file and shows the import preview.
     *
     * @param event - Change event of the file input
     * @returns {void}
     */
    protected onFileChosen(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = ''; // so choosing the same file again still fires `change`
        if (!file) {
            return;
        }

        this.result.set(null);
        this.importError.set(null);
        this.preview.set(null);

        if (!/\.xlsx$/i.test(file.name)) {
            this.importError.set(
                `"${file.name}" is not an .xlsx file. Open it in Excel and save it as an Excel Workbook (.xlsx).`,
            );
            return;
        }

        this.importFile.set(file);
        this.includeDuplicates.set(false);
        this.includeInvalid.set(false);
        this.loadPreview(file);
    }

    /**
     * Re-reads the file from another tab of the workbook.
     *
     * @param event - Change event of the tab select
     * @returns {void}
     */
    protected onSheetChange(event: Event): void {
        const file = this.importFile();
        const sheet = (event.target as HTMLSelectElement).value;
        if (file && sheet !== this.preview()?.sheetName) {
            this.loadPreview(file, sheet);
        }
    }

    /**
     * Uploads the file for a preview of one tab (the best-matching tab when none is given).
     *
     * @param file - The .xlsx file
     * @param sheet - Tab to read
     * @returns {void}
     */
    private loadPreview(file: File, sheet?: string): void {
        this.isPreviewing.set(true);
        this.importError.set(null);
        this.advertiserProfilesService.previewImport(file, sheet).subscribe({
            next: (preview) => {
                this.preview.set(preview);
                this.rowFilter.set(null);
                this.isPreviewing.set(false);
            },
            error: (error: unknown) => {
                this.importError.set(
                    AdvertiserProfilesService.errorMessage(error, 'The file could not be read.'),
                );
                // Switching tabs keeps the current preview; a new file that can't be read is dropped
                if (!sheet) {
                    this.importFile.set(null);
                }
                this.isPreviewing.set(false);
            },
        });
    }

    /**
     * Saves the previewed import, then reloads the list.
     *
     * @returns {void}
     */
    protected onConfirmImport(): void {
        const file = this.importFile();
        if (!file || this.isImporting()) {
            return;
        }

        this.isImporting.set(true);
        this.importError.set(null);
        this.advertiserProfilesService
            .import(file, this.preview()?.sheetName, {
                includeDuplicates: this.includeDuplicates(),
                includeInvalid: this.includeInvalid(),
            })
            .subscribe({
                next: (result) => {
                    this.result.set(result);
                    this.cancelImport();
                    this.isImporting.set(false);
                    this.loadAdvertisers();
                    this.loadFilterOptions();
                },
                error: (error: unknown) => {
                    this.importError.set(
                        AdvertiserProfilesService.errorMessage(
                            error,
                            'The import failed. Nothing was saved.',
                        ),
                    );
                    this.isImporting.set(false);
                },
            });
    }

    /**
     * Closes the preview without saving.
     *
     * @returns {void}
     */
    protected cancelImport(): void {
        this.preview.set(null);
        this.importFile.set(null);
    }

    /**
     * Shows only rows with this status, or all rows when it is already selected.
     *
     * @param status - Row status
     * @returns {void}
     */
    protected toggleRowFilter(status: AdvertiserImportRowStatus): void {
        this.rowFilter.update((current) => (current === status ? null : status));
    }

    /**
     * Label for a row's status.
     *
     * @param status - Row status
     * @returns {string}
     */
    protected statusLabel(status: AdvertiserImportRowStatus): string {
        return { new: 'New', duplicate: 'Duplicate', invalid: 'Problem' }[status];
    }

    /**
     * Platform, icon and account name for a social media link.
     *
     * @param url - The link
     * @returns {SocialLink}
     */
    protected socialLink(url: string): SocialLink {
        return describeSocialLink(url);
    }

    /**
     * Tooltip for the Needs Attention tag: one note per line.
     *
     * @param advertiser - The advertiser
     * @returns {string}
     */
    protected reviewTitle(advertiser: AdvertiserProfile): string {
        return (advertiser.review_notes ?? []).join('\n');
    }

    /**
     * The file name at the end of an address, e.g. the video's ".webm" file.
     *
     * @param url - Full address
     * @returns {string}
     */
    protected fileName(url: string): string {
        return fileNameOf(url);
    }

    /**
     * A web address shortened for display: no scheme, "www.", tracking query
     * ("?utm_source=..."), "#..." or trailing slash. The link itself keeps the full address.
     *
     * @param url - Full address
     * @returns {string} e.g. "1treeexpert.com" or "agents.farmers.com/tx/rockwall/randy-rhew"
     */
    protected shortUrl(url: string): string {
        return url
            .replace(/^https?:\/\/(www\.)?/i, '')
            .replace(/[?#].*$/, '')
            .replace(/\/+$/, '');
    }

    /**
     * Category groups and states (with counts) for the filter menus, from the dashboard
     * figures so both pages group advertisers the same way.
     *
     * @returns {void}
     */
    private loadFilterOptions(): void {
        this.advertiserProfilesService.dashboard().subscribe({
            next: (data) =>
                this.filterOptions.set({
                    groups: data.groups.filter((g) => g.count > 0),
                    states: data.states,
                    noState: data.totals.advertisers - data.totals.withState,
                }),
            // The menus just stay empty; the list itself still loads
            error: () => this.filterOptions.set(null),
        });
    }

    /**
     * Loads the first 20 advertisers matching the filters (again, e.g. after an import).
     *
     * @returns {void}
     */
    private loadAdvertisers(): void {
        const request = ++this.listRequest;
        this.listError.set(null);
        this.advertiserProfilesService.list(1, PAGE_SIZE, this.filters()).subscribe({
            next: (result) => {
                // A newer filter change has started another request: ignore this one
                if (request !== this.listRequest) {
                    return;
                }
                this.advertisers.set(result.items);
                this.total.set(result.total);
            },
            error: (error: unknown) => {
                if (request !== this.listRequest) {
                    return;
                }
                this.listError.set(
                    AdvertiserProfilesService.errorMessage(
                        error,
                        'Advertisers could not be loaded.',
                    ),
                );
            },
        });
    }
}

/**
 * Reads the remembered list / grid choice.
 *
 * @returns {AdvertiserView} The stored view, or 'list'
 */
function readStoredView(): AdvertiserView {
    try {
        return localStorage.getItem(VIEW_STORAGE_KEY) === 'grid' ? 'grid' : 'list';
    } catch {
        return 'list';
    }
}
