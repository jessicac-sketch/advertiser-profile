/** Local Imports */
import type { SelectOption } from '@shared/interfaces/ui/select-option.interface';

import type { AdsGallerySort } from './ads-gallery-sort.type';

/**
 * Sort choices for the Ads Gallery, in display order.
 */
export const ADS_GALLERY_SORT_OPTIONS: readonly SelectOption<AdsGallerySort>[] = [
    { value: 'plays', label: 'Plays' },
    { value: 'newest', label: 'Newest' },
    { value: 'duration', label: 'Duration' },
];
