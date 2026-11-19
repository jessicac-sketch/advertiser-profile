/** Angular Imports */
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * "Showing 20 out of 2,550 advertisers" bar with a Show More button, for lists that load
 * a batch at a time (the same pattern as ntv-table's footer).
 *
 * @example
 * <app-show-more [shown]="items().length" [total]="total()" itemLabel="advertisers"
 *     [loading]="isLoadingMore()" (showMore)="loadMore()" />
 */
@Component({
    selector: 'app-show-more',
    templateUrl: './show-more.component.html',
    styleUrl: './show-more.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
})
export class ShowMoreComponent {
    /**
     * Items shown so far
     * @type {InputSignal<number>}
     */
    public readonly shown = input.required<number>();

    /**
     * Items in total
     * @type {InputSignal<number>}
     */
    public readonly total = input.required<number>();

    /**
     * What the items are called, e.g. "advertisers"
     * @type {InputSignal<string>}
     */
    public readonly itemLabel = input('items');

    /**
     * True while the next batch loads
     * @type {InputSignal<boolean>}
     */
    public readonly loading = input(false);

    /**
     * Emits when Show More is pressed
     * @type {OutputEmitterRef<void>}
     */
    public readonly showMore = output<void>();

    /**
     * Whether there are more items to load
     * @type {Signal<boolean>}
     */
    protected readonly hasMore = computed(() => this.shown() < this.total());
}
