/** Angular Imports */
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Local Imports */
import { ThemeService } from '@shared/services/theme';

/**
 * Root application component.
 *
 * @remarks
 * Authentication state is resolved per-route by `authGuard`/`guestGuard`,
 * not here.
 */
@Component({
    selector: 'app-root',
    imports: [RouterOutlet],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss',
})
export class AppComponent {
    /**
     * Theme service, injected at startup so the saved light / dark theme is applied
     * @type {ThemeService}
     */
    private readonly themeService = inject(ThemeService);

    /**
     * Application title
     * @type {string}
     */
    title = 'Welcome to internal-tool-boilerplate!';
}
