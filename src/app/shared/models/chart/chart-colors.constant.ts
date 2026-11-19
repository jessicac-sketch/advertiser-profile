/** Local Imports */
import type { AppTheme } from '@shared/models/theme';

/**
 * Chart colors for one theme. They match the theme tokens in src/styles/_theme.scss:
 * ECharts and ApexCharts need literal values, not CSS variables, so keep the two in step.
 *
 * The first four keys are shared with gbp-management-tool-ui; the rest cover this app's
 * maps and multi-series charts.
 */
export interface ChartPalette {
    /** Marigold: the highlighted series / selection (kept true marigold in both themes) */
    readonly brand: string;
    /** Secondary text (--app-content-secondary): axis labels, legends */
    readonly secondary: string;
    /** Muted text (--app-content-muted): minor labels, inactive items */
    readonly muted: string;
    /** Borders and grid lines (--app-surface-border) */
    readonly border: string;

    /** Primary text (--app-content-primary): titles, values, tooltips */
    readonly primary: string;
    /** Page background (--app-surface-base): chart canvas, map "ocean" */
    readonly surfaceBase: string;
    /** Cards and panels (--app-surface-raised): tooltips, empty map regions */
    readonly surfaceRaised: string;
    /** Hover tint (--app-surface-hover): axis pointer shadows */
    readonly hover: string;
    /** Loading overlay: the page background at 60% */
    readonly mask: string;

    /** Sequential low → high scale for choropleths (teal shades; marigold stays for selection) */
    readonly scale: readonly string[];

    /** Categorical palette for multi-series charts (e.g. one line per device) */
    readonly series: readonly string[];
}

/** Light theme (the default): off-white page, white cards, deep teal text */
const LIGHT_CHART_COLORS: ChartPalette = {
    brand: '#f2a541',
    secondary: '#3d5d65',
    muted: '#557379',
    border: '#d5e1e3',

    primary: '#0a2e37',
    surfaceBase: '#f3f7f6',
    surfaceRaised: '#ffffff',
    hover: 'rgba(15, 76, 92, 0.05)',
    mask: 'rgba(243, 247, 246, 0.6)',

    scale: ['#d3e7eb', '#5e9eac', '#0f4c5c'],

    series: [
        '#2563eb',
        '#15803d',
        '#db2777',
        '#a16207',
        '#7c3aed',
        '#0f766e',
        '#ea580c',
        '#475569',
    ],
};

/** Dark theme: deep teal page and cards, off-white text */
const DARK_CHART_COLORS: ChartPalette = {
    brand: '#f2a541',
    secondary: '#c2d4d6',
    muted: '#85a2a8',
    border: '#215663',

    primary: '#f3f7f6',
    surfaceBase: '#0a2e37',
    surfaceRaised: '#0e3a46',
    hover: 'rgba(255, 255, 255, 0.04)',
    mask: 'rgba(10, 46, 55, 0.6)',

    scale: ['#14596b', '#3f8a9c', '#9fd0db'],

    series: [
        '#60a5fa',
        '#4ade80',
        '#f472b6',
        '#facc15',
        '#a78bfa',
        '#2dd4bf',
        '#fb923c',
        '#c2d4d6',
    ],
};

/**
 * Chart colors per theme. Read the current theme from ThemeService inside a reactive
 * context (computed / effect) so charts re-render when the user switches themes.
 */
export const CHART_COLORS: Readonly<Record<AppTheme, ChartPalette>> = {
    light: LIGHT_CHART_COLORS,
    dark: DARK_CHART_COLORS,
};
