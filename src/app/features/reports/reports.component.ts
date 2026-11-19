/** Angular Imports */
import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Local Imports */
import { PageHeaderComponent } from '@shared/components/page-header';

/**
 * Reports page. Intentionally empty for now.
 */
@Component({
    selector: 'app-reports',
    imports: [PageHeaderComponent],
    templateUrl: './reports.component.html',
    styleUrl: './reports.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
})
export class ReportsComponent {}
