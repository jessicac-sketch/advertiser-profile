/** Angular Imports */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Local Imports */
import type { SocialLink } from '@shared/utils/social-link.util';

/**
 * Small square badge for a social media platform: a short label ("f", "IG", "in") on the
 * platform's brand color, or a globe for other sites. Drawn with text rather than brand
 * icons, which the app's Font Awesome kit doesn't include.
 *
 * @example
 * <app-social-badge [link]="link" />
 * <app-social-badge [link]="link" size="lg" />
 */
@Component({
    selector: 'app-social-badge',
    template: `
        <span
            class="social-badge"
            [class.social-badge--lg]="size() === 'lg'"
            [style.background-color]="link().color"
            aria-hidden="true">
            @if (link().abbr) {
                {{ link().abbr }}
            } @else {
                <i class="fa-sharp fa-regular fa-globe"></i>
            }
        </span>
    `,
    styleUrl: './social-badge.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
})
export class SocialBadgeComponent {
    /**
     * The link to draw a badge for
     * @type {InputSignal<SocialLink>}
     */
    public readonly link = input.required<SocialLink>();

    /**
     * Badge size: `md` (24px, lists) or `lg` (40px, the profile page)
     * @type {InputSignal<'md' | 'lg'>}
     */
    public readonly size = input<'md' | 'lg'>('md');
}
