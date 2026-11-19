/** Angular Imports */
import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';

/** Local Imports */
import type { AppTheme } from '@shared/models/theme';

/**
 * localStorage key for the chosen theme. The inline script in src/index.html reads the
 * same key so a saved dark theme applies before the app boots (no light flash).
 */
export const THEME_STORAGE_KEY = 'ntv360-theme';

/**
 * Global light / dark theme preference.
 *
 * @remarks
 * Light is the default. The theme is applied as the `dark` class on <html>: the app's
 * tokens (src/styles/_theme.scss) and component-pantry both key off it. Charts can't
 * read CSS variables, so they read `theme()` and re-render when it changes.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
    /**
     * Root document, injected so the service also runs during server-side rendering
     * @type {Document}
     */
    private readonly document = inject(DOCUMENT);

    /**
     * Current theme - defaults to 'light', restored from localStorage
     * @type {WritableSignal<AppTheme>}
     */
    readonly theme = signal<AppTheme>(this.readStoredTheme());

    constructor() {
        effect(() => {
            const theme = this.theme();
            const root = this.document.documentElement;
            root.classList.toggle('dark', theme === 'dark');
            root.style.colorScheme = theme;
        });
    }

    /**
     * Sets the theme and remembers it for future visits.
     *
     * @param theme - 'light' or 'dark'
     * @returns {void}
     */
    setTheme(theme: AppTheme): void {
        this.theme.set(theme);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {
            // Storage unavailable (private mode, SSR): the choice just isn't remembered
        }
    }

    /**
     * Switches between light and dark.
     *
     * @returns {void}
     */
    toggle(): void {
        this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
    }

    /**
     * Reads the remembered theme.
     *
     * @returns {AppTheme} The stored theme, or 'light' if unset, invalid or unavailable
     */
    private readStoredTheme(): AppTheme {
        try {
            return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
        } catch {
            return 'light';
        }
    }
}
