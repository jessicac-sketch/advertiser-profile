/** Angular Imports */
import { CommonModule, DecimalPipe, IMAGE_CONFIG, NgOptimizedImage } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

/** Third Party Imports */
import { Card, Input, Skeleton } from '@ntv360/component-pantry';
import {
    catchError,
    debounceTime,
    distinctUntilChanged,
    map,
    of,
    type Subscription,
    switchMap,
} from 'rxjs';

/** Local Imports */
import { type MediaFileContent, MediaFilesService } from '@core';
import { FilterListComponent } from '@shared/components/filter-list';
import { PageHeaderComponent } from '@shared/components/page-header';
import { SortControlComponent } from '@shared/components/sort-control';
import type { FilterOption } from '@shared/interfaces/ui';
import {
    ADS_GALLERY_SORT_OPTIONS,
    type AdsGallerySort,
    type AdsGalleryTypeFilter,
} from '@shared/models/ads-gallery';
import { CARD_CONFIG } from '@shared/models/ui';
import type { SortDirection } from '@shared/models/ui/sort-direction.type';

/**
 * What one gallery load asks the BFF for: everything that, when it changes, restarts the
 * list from the first page.
 */
interface GalleryQuery {
    /** Search text (creative name or ID), trimmed */
    search: string;

    /** Order */
    sort: AdsGallerySort;

    /** Order direction */
    direction: SortDirection;

    /** Creative type, or all */
    type: AdsGalleryTypeFilter;

    /** Bumped by refreshAds() to reload the same query */
    reloads: number;
}

/**
 * Ads Gallery page component.
 *
 * @remarks
 * Displays list of media files from the programmatic_media_files table.
 */
@Component({
    selector: 'app-ads-gallery',
    imports: [
        PageHeaderComponent,
        CommonModule,
        Card,
        DecimalPipe,
        FilterListComponent,
        Input,
        NgOptimizedImage,
        ReactiveFormsModule,
        Skeleton,
        SortControlComponent,
    ],
    templateUrl: './ads-gallery.component.html',
    styleUrl: './ads-gallery.component.scss',
    standalone: true,
    providers: [
        {
            provide: IMAGE_CONFIG,
            useValue: {
                disableImageSizeWarning: true,
                disableImageLazyLoadWarning: true,
            },
        },
    ],
})
export class AdsGalleryComponent {
    /**
     * Injection for Media File Service
     */
    private readonly mediaFilesService = inject(MediaFilesService);

    /**
     * Injection for Router Module
     */
    private readonly router = inject(Router);

    /**
     * Media file content data as a signal.
     */
    contents = signal<MediaFileContent[]>([]);

    /**
     * Loading state as a signal.
     */
    isLoading = signal(true);

    /**
     * Loading more state as a signal.
     */
    isLoadingMore = signal(false);

    /**
     * Error message as a signal.
     */
    errorMessage = signal<string | null>(null);

    /**
     * Pagination offset.
     * @type {number}
     */
    private offset = 0;

    /**
     * Items per page.
     * @type {number}
     */
    private readonly limit = 20;

    /**
     * Placeholder array for rendering skeleton cards while the gallery loads - one per
     * card in the first page, so the page height doesn't change once the ads arrive.
     * @type {number[]}
     */
    readonly skeletonPlaceholders = Array.from({ length: this.limit }, (_value, index) => index);

    /**
     * Has more data to load as a signal.
     */
    hasMore = signal(true);

    /**
     * Configuration for content cards.
     * @type {object}
     */
    cardConfig = CARD_CONFIG;

    /**
     * Search box (creative name or ID), sent to the BFF after a short pause in typing
     * @type {FormControl<string>}
     */
    protected readonly searchControl = new FormControl('', { nonNullable: true });

    /**
     * Search text, debounced and trimmed
     * @type {Signal<string>}
     */
    private readonly search = toSignal(
        this.searchControl.valueChanges.pipe(
            debounceTime(300),
            map((value) => value.trim()),
            distinctUntilChanged(),
        ),
        { initialValue: '' },
    );

    /**
     * Sort choices
     * @type {readonly SelectOption<AdsGallerySort>[]}
     */
    protected readonly sortOptions = ADS_GALLERY_SORT_OPTIONS;

    /**
     * Order of the gallery
     * @type {WritableSignal<AdsGallerySort>}
     */
    protected readonly sort = signal<AdsGallerySort>('newest');

    /**
     * Direction of the order (clicking the active sort again reverses it)
     * @type {WritableSignal<SortDirection>}
     */
    protected readonly sortDirection = signal<SortDirection>('desc');

    /**
     * Creative-type filter
     * @type {WritableSignal<AdsGalleryTypeFilter>}
     */
    protected readonly typeFilter = signal<AdsGalleryTypeFilter>('all');

    /**
     * How many ads match the search, all and per type (null until loaded)
     * @type {Signal<{ all: number; video: number; image: number } | null>}
     */
    private readonly typeCounts = toSignal(
        toObservable(this.search).pipe(
            switchMap((search) =>
                this.mediaFilesService.getTypeCounts(search || undefined).pipe(
                    catchError((error: unknown) => {
                        console.error('Failed to count media files:', error);
                        return of(null);
                    }),
                ),
            ),
        ),
        { initialValue: null },
    );

    /**
     * Type filter entries with their counts
     * @type {Signal<FilterOption<AdsGalleryTypeFilter>[]>}
     */
    protected readonly typeOptions = computed((): FilterOption<AdsGalleryTypeFilter>[] => {
        const counts = this.typeCounts();
        return [
            { value: 'all', label: 'All ads', icon: 'grid-2', count: counts?.all ?? 0 },
            { value: 'video', label: 'Videos', icon: 'video', count: counts?.video ?? 0 },
            { value: 'image', label: 'Images', icon: 'image', count: counts?.image ?? 0 },
        ];
    });

    /**
     * Bumped to reload the current query
     * @type {WritableSignal<number>}
     */
    private readonly reloads = signal(0);

    /**
     * The current query - any change restarts the list from the first page
     * @type {Signal<GalleryQuery>}
     */
    private readonly query = computed((): GalleryQuery => ({
        search: this.search(),
        sort: this.sort(),
        direction: this.sortDirection(),
        type: this.typeFilter(),
        reloads: this.reloads(),
    }));

    /**
     * The in-flight "Load More" request, cancelled when the query changes
     * @type {Subscription | undefined}
     */
    private loadMoreSubscription?: Subscription;

    constructor() {
        // A new query replaces the list; switchMap drops a slower response for an older one
        toObservable(this.query)
            .pipe(
                switchMap((query) => {
                    this.loadMoreSubscription?.unsubscribe();
                    this.isLoadingMore.set(false);
                    this.offset = 0;
                    this.isLoading.set(true);
                    this.errorMessage.set(null);

                    return this.fetchPage(query, 0).pipe(
                        catchError((error: unknown) => {
                            console.error('Failed to load media files:', error);
                            return of(null);
                        }),
                    );
                }),
                takeUntilDestroyed(inject(DestroyRef)),
            )
            .subscribe((files) => {
                if (files === null) {
                    this.contents.set([]);
                    this.errorMessage.set('Failed to load ads. Please try again.');
                } else {
                    this.contents.set(files);
                    this.hasMore.set(files.length >= this.limit);
                }
                this.isLoading.set(false);
            });
    }

    /**
     * Fetches one page of the gallery for a query.
     *
     * @param query - Search, sort, direction and type
     * @param offset - Rows to skip
     * @returns Observable of the page
     */
    private fetchPage(query: GalleryQuery, offset: number) {
        return this.mediaFilesService.getAll({
            limit: this.limit,
            offset,
            search: query.search || undefined,
            sort: query.sort,
            direction: query.direction,
            type: query.type === 'all' ? undefined : query.type,
        });
    }

    /**
     * Loads the next page of the current query (pagination).
     *
     * @returns {void}
     */
    loadMore(): void {
        if (this.isLoadingMore() || !this.hasMore()) {
            return;
        }

        this.isLoadingMore.set(true);
        const offset = this.offset + this.limit;

        this.loadMoreSubscription = this.fetchPage(this.query(), offset).subscribe({
            next: (files) => {
                this.offset = offset;
                this.contents.set([...this.contents(), ...files]);
                this.hasMore.set(files.length >= this.limit);
                this.isLoadingMore.set(false);
            },
            error: (error) => {
                console.error('Failed to load more media files:', error);
                this.isLoadingMore.set(false);
            },
        });
    }

    /**
     * Navigates to ad analytics page.
     *
     * @param {string} contentId - Content ID to view
     * @returns {void}
     */
    viewAd(contentId: string): void {
        this.router.navigate(['/ad', contentId]);
    }

    /**
     * Refreshes the gallery by reloading from the API.
     *
     * @returns {void}
     */
    refreshAds(): void {
        this.reloads.update((count) => count + 1);
    }

    /**
     * Handles image/video load errors with placeholder.
     *
     * @param {Event} event - Error event
     * @returns {void}
     */
    onImageError(event: Event): void {
        const target = event.target as HTMLImageElement | HTMLVideoElement;
        if (target.tagName === 'IMG') {
            (target as HTMLImageElement).src =
                'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="113" viewBox="0 0 200 113"%3E%3Crect fill="%23ddd" width="200" height="113"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="%23999"%3ENo Thumbnail%3C/text%3E%3C/svg%3E';
        } else if (target.tagName === 'VIDEO') {
            // Hide video element and show placeholder
            target.style.display = 'none';
            const placeholder = document.createElement('div');
            placeholder.className = 'ad-card__thumbnail-placeholder';
            placeholder.textContent = 'Video Unavailable';
            target.parentElement?.appendChild(placeholder);
        }
    }

    /**
     * Formats duration from seconds to human-readable string.
     *
     * @param {number | undefined} seconds - Duration in seconds
     * @returns {string} Formatted duration
     */
    formatDuration(seconds: number | undefined): string {
        if (!seconds) return 'N/A';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }

    /**
     * Formats date to relative time.
     *
     * @param {string} dateString - ISO date string
     * @returns {string} Relative time string
     */
    formatDate(dateString: string): string {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        return `${Math.floor(diffDays / 365)} years ago`;
    }

    /**
     * Gets the vendor icon path based on source.
     *
     * @param {string} source - Content source
     * @returns {string} Path to vendor icon
     */
    getVendorIcon(source: string): string {
        const iconMap: Record<string, string> = {
            Vistar: 'assets/vendor-icons/vistar.jpeg',
            'Place Exchange': 'assets/vendor-icons/pxchange.png',
            'Video Elephant': 'assets/vendor-icons/velephant.png',
            Internal: '',
        };

        return iconMap[source] || '';
    }
}
