/** Angular Imports */
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

/** Third Party Imports */
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

/** Local Imports */
import { type AdvertiserProfileDetail, AdvertiserProfilesService } from '@core';
import { PageHeaderComponent } from '@shared/components/page-header';
import { SocialBadgeComponent } from '@shared/components/social-badge';
import { fileNameOf } from '@shared/utils/file-name.util';
import { describeSocialLink } from '@shared/utils/social-link.util';
import { explainReviewNote } from './review-note.util';

/**
 * One advertiser's profile: everything saved about the business, its video, and -
 * when the import tagged it - why it needs attention and what to do.
 *
 * @remarks
 * Route: /advertiser-profile/:id. For possible duplicates, the other profiles with the
 * same business name and location are listed (from the API) so they can be compared.
 */
@Component({
    selector: 'app-advertiser-detail',
    imports: [PageHeaderComponent, SocialBadgeComponent, RouterLink, DatePipe],
    templateUrl: './advertiser-detail.component.html',
    styleUrl: './advertiser-detail.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
})
export class AdvertiserDetailComponent {
    /**
     * Advertiser profiles API
     * @type {AdvertiserProfilesService}
     */
    private readonly advertiserProfilesService = inject(AdvertiserProfilesService);

    /**
     * The advertiser, or null until loaded
     * @type {WritableSignal<AdvertiserProfileDetail | null>}
     */
    protected readonly advertiser = signal<AdvertiserProfileDetail | null>(null);

    /**
     * Why the advertiser failed to load, or null
     * @type {WritableSignal<string | null>}
     */
    protected readonly error = signal<string | null>(null);

    /**
     * Whether the video failed to play (e.g. the file is gone or the browser can't play .webm)
     * @type {WritableSignal<boolean>}
     */
    protected readonly videoFailed = signal(false);

    /**
     * Each social media account with its platform and account name
     * @type {Signal<SocialLink[]>}
     */
    protected readonly socialLinks = computed(() =>
        (this.advertiser()?.social_media ?? []).map(describeSocialLink),
    );

    /**
     * Why the profile needs attention, explained
     * @type {Signal<ReviewIssue[]>}
     */
    protected readonly issues = computed(() =>
        (this.advertiser()?.review_notes ?? []).map(explainReviewNote),
    );

    /**
     * Whether any issue is a possible duplicate (the matching profiles are shown with it)
     * @type {Signal<boolean>}
     */
    protected readonly hasDuplicateIssue = computed(() =>
        this.issues().some((issue) => issue.kind === 'duplicate'),
    );

    constructor() {
        // Load the advertiser, and again whenever the id in the address changes
        inject(ActivatedRoute)
            .paramMap.pipe(
                map((params) => params.get('id') ?? ''),
                switchMap((id) => {
                    this.advertiser.set(null);
                    this.error.set(null);
                    this.videoFailed.set(false);
                    return this.advertiserProfilesService.get(id).pipe(
                        catchError((error: unknown) => {
                            this.error.set(
                                AdvertiserProfilesService.errorMessage(
                                    error,
                                    'This advertiser could not be loaded.',
                                ),
                            );
                            return of(null);
                        }),
                    );
                }),
                takeUntilDestroyed(),
            )
            .subscribe((advertiser) => this.advertiser.set(advertiser));
    }

    /**
     * A web address without its scheme and trailing slash, for display.
     *
     * @param url - Full address
     * @returns {string}
     */
    protected shortUrl(url: string): string {
        return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
    }

    /**
     * The file name at the end of an address (the video's .webm file).
     *
     * @param url - Full address
     * @returns {string}
     */
    protected fileName(url: string): string {
        return fileNameOf(url);
    }

    /**
     * Phone number as a tel: address (digits and a leading +).
     *
     * @param phone - Phone number as written
     * @returns {string}
     */
    protected telHref(phone: string): string {
        return `tel:${phone.replace(/[^\d+]/g, '')}`;
    }
}
