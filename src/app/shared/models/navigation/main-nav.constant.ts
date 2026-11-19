/** Local Imports */
import { NavItem } from '@shared/interfaces/navigation';

/**
 * Primary sidebar navigation, in display order.
 */
export const MAIN_NAV_ITEMS: readonly NavItem[] = [
    { label: 'Dashboard', icon: 'grid-2', route: '/dashboard' },
    { label: 'Advertiser Profile', icon: 'store', route: '/advertiser-profile' },
    { label: 'Reports', icon: 'file-chart-column', route: '/reports' },
];
