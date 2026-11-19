/** Angular Imports */
import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, type OnInit, signal, untracked } from '@angular/core';

/** Third Party Imports */
import { Card } from '@ntv360/component-pantry';
import type { ApexOptions } from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';

/** Local Imports */
import {
    type DashboardAnalytics,
    type DashboardCountPoint,
    type DashboardTopAd,
    MediaFilesService,
} from '@core';
import { PageHeaderComponent } from '@shared/components/page-header';
import { CHART_COLORS, CHART_FONT, type ChartPalette } from '@shared/models/chart';
import { CARD_CONFIG } from '@shared/models/ui';
import { ThemeService } from '@shared/services/theme';

/**
 * Analytics page component.
 *
 * @remarks
 * Displays advanced analytics and insights for ad performance.
 */
@Component({
    selector: 'app-analytics',
    imports: [PageHeaderComponent, Card, DecimalPipe, NgApexchartsModule],
    templateUrl: './analytics.component.html',
    styleUrl: './analytics.component.scss',
    standalone: true,
})
export class AnalyticsComponent implements OnInit {
    /**
     * Media files service for analytics API calls.
     * @type {MediaFilesService}
     */
    private readonly mediaFilesService = inject(MediaFilesService);

    /**
     * Current light / dark theme; the charts are re-themed when it changes.
     * @type {ThemeService}
     */
    private readonly themeService = inject(ThemeService);

    /**
     * Chart colors for the current theme.
     * @type {Signal<ChartPalette>}
     */
    protected readonly chartColors = computed<ChartPalette>(
        () => CHART_COLORS[this.themeService.theme()],
    );

    constructor() {
        effect(() => {
            const colors = this.chartColors();
            untracked(() => this.applyChartTheme(colors));
        });
    }

    /**
     * Configuration for cards.
     * @type {object}
     */
    cardConfig = CARD_CONFIG;

    /**
     * Top 5 ads data loaded from the analytics endpoint.
     * @type {DashboardTopAd[]}
     */
    topAds: DashboardTopAd[] = [];

    /**
     * Live dashboard analytics data.
     */
    dashboardAnalytics = signal<DashboardAnalytics | null>(null);

    /**
     * Loading state for live analytics.
     */
    isLoadingAnalytics = signal(true);

    /**
     * Angular lifecycle hook that loads live analytics data.
     *
     * @returns {void}
     */
    ngOnInit(): void {
        this.mediaFilesService.getDashboardAnalytics().subscribe({
            next: (analytics: DashboardAnalytics) => this.applyAnalytics(analytics),
            error: (error: unknown) => {
                console.error('[Analytics] Failed to load analytics:', error);
                this.isLoadingAnalytics.set(false);
            },
        });
    }

    /**
     * Growth chart - Shows growth of media files over time.
     * @type {ApexOptions}
     */
    growthChartOptions: ApexOptions = {
        series: [
            {
                name: 'Media Files',
                data: [],
            },
        ],
        theme: { mode: this.themeService.theme() },
        chart: {
            type: 'line',
            height: 350,
            fontFamily: CHART_FONT,
            foreColor: this.chartColors().secondary,
            background: 'transparent',
            toolbar: {
                show: true,
            },
            zoom: {
                enabled: true,
            },
        },
        title: {
            text: 'Media Inventory Growth',
            align: 'left',
            style: {
                fontSize: '18px',
                fontWeight: 'bold',
            },
        },
        dataLabels: {
            enabled: true,
        },
        stroke: {
            curve: 'smooth',
            width: 3,
        },
        markers: {
            shape: 'square',
            size: 6,
            hover: {
                size: 8,
            },
        },
        xaxis: {
            categories: [],
            title: {
                text: 'Year',
            },
        },
        yaxis: {
            title: {
                text: 'Number of Ads',
            },
        },
        grid: {
            borderColor: this.chartColors().border,
            row: {
                colors: [this.chartColors().hover, 'transparent'],
                opacity: 0.5,
            },
        },
        tooltip: {
            enabled: true,
            y: {
                formatter: (val: number) => `${val} ads`,
            },
        },
        legend: {
            markers: { shape: 'square' },
            show: true,
            position: 'top',
        },
    };

    /**
     * Content Weekly Chart - Weekly growth of ads number.
     * @type {ApexOptions}
     */
    weeklyContentChartOptions: ApexOptions = {
        series: [
            {
                name: 'New Media Files',
                data: [],
            },
        ],
        theme: { mode: this.themeService.theme() },
        chart: {
            type: 'bar',
            height: 350,
            fontFamily: CHART_FONT,
            foreColor: this.chartColors().secondary,
            background: 'transparent',
            toolbar: {
                show: true,
            },
        },
        title: {
            text: 'New Media Files by Day',
            align: 'left',
            style: {
                fontSize: '18px',
                fontWeight: 'bold',
            },
        },
        plotOptions: {
            bar: {
                borderRadius: 0,
                dataLabels: {
                    position: 'top',
                },
            },
        },
        dataLabels: {
            enabled: true,
            offsetY: -20,
            style: {
                fontSize: '12px',
                colors: [this.chartColors().secondary],
            },
        },
        xaxis: {
            categories: [],
            title: {
                text: 'Day',
            },
            labels: {
                rotate: -45,
                rotateAlways: false,
            },
        },
        yaxis: {
            title: {
                text: 'Number of New Media Files',
            },
        },
        grid: {
            borderColor: this.chartColors().border,
        },
        tooltip: {
            enabled: true,
            y: {
                formatter: (val: number) => `${val} new ads`,
            },
        },
        legend: {
            markers: { shape: 'square' },
            show: true,
            position: 'top',
        },
        colors: [this.chartColors().brand],
    };

    /**
     * Total Plays - Aggregation and trend of total plays.
     * @type {ApexOptions}
     */
    totalPlaysChartOptions: ApexOptions = {
        series: [
            {
                name: 'Served',
                type: 'column',
                data: [],
            },
            {
                name: 'Played',
                type: 'line',
                data: [],
            },
        ],
        theme: { mode: this.themeService.theme() },
        chart: {
            type: 'line',
            height: 350,
            fontFamily: CHART_FONT,
            foreColor: this.chartColors().secondary,
            background: 'transparent',
            toolbar: {
                show: true,
            },
        },
        title: {
            text: 'Served vs Played Records',
            align: 'left',
            style: {
                fontSize: '18px',
                fontWeight: 'bold',
            },
        },
        stroke: {
            width: [0, 4],
            curve: 'smooth',
        },
        plotOptions: {
            bar: {
                borderRadius: 0,
                columnWidth: '50%',
            },
        },
        dataLabels: {
            enabled: true,
            enabledOnSeries: [1],
        },
        labels: [],
        xaxis: {
            title: {
                text: 'Year',
            },
        },
        yaxis: [
            {
                title: {
                    text: 'Total Plays',
                },
            },
        ],
        grid: {
            borderColor: this.chartColors().border,
        },
        tooltip: {
            shared: true,
            intersect: false,
            y: {
                formatter: (val: number) => `${val.toLocaleString()} plays`,
            },
        },
        legend: {
            markers: { shape: 'square' },
            show: true,
            position: 'top',
        },
        colors: [this.chartColors().brand, this.chartColors().series[0]],
    };

    /**
     * Weekly Total Plays trend.
     * @type {ApexOptions}
     */
    weeklyPlaysChartOptions: ApexOptions = {
        series: [
            {
                name: 'Proof Sent',
                data: [],
            },
        ],
        theme: { mode: this.themeService.theme() },
        chart: {
            type: 'area',
            height: 350,
            fontFamily: CHART_FONT,
            foreColor: this.chartColors().secondary,
            background: 'transparent',
            toolbar: {
                show: true,
            },
            zoom: {
                enabled: true,
            },
        },
        title: {
            text: 'Proof of Play Sent by Day',
            align: 'left',
            style: {
                fontSize: '18px',
                fontWeight: 'bold',
            },
        },
        dataLabels: {
            enabled: false,
        },
        stroke: {
            curve: 'smooth',
            width: 2,
        },
        markers: {
            shape: 'square',
            size: 5,
            hover: {
                size: 7,
            },
        },
        xaxis: {
            categories: [],
            title: {
                text: 'Day',
            },
            labels: {
                rotate: -45,
                rotateAlways: false,
            },
        },
        yaxis: {
            title: {
                text: 'Proof Sent',
            },
            labels: {
                formatter: (val: number) => val.toLocaleString(),
            },
        },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.7,
                opacityTo: 0.2,
                stops: [0, 90, 100],
            },
        },
        grid: {
            borderColor: this.chartColors().border,
        },
        tooltip: {
            enabled: true,
            y: {
                formatter: (val: number) => `${val.toLocaleString()} plays`,
            },
        },
        legend: {
            markers: { shape: 'square' },
            show: true,
            position: 'top',
        },
        colors: [this.chartColors().brand],
    };

    /**
     * Re-applies the theme-dependent colors to every chart's options. ApexCharts needs
     * literal colors, so a theme switch replaces the options to re-render the charts.
     *
     * @param colors - Palette for the current theme
     * @returns {void}
     */
    private applyChartTheme(colors: ChartPalette): void {
        this.growthChartOptions = this.withChartTheme(this.growthChartOptions, colors);
        this.weeklyContentChartOptions = this.withChartTheme(
            this.weeklyContentChartOptions,
            colors,
            [colors.brand],
        );
        this.totalPlaysChartOptions = this.withChartTheme(this.totalPlaysChartOptions, colors, [
            colors.brand,
            colors.series[0],
        ]);
        this.weeklyPlaysChartOptions = this.withChartTheme(this.weeklyPlaysChartOptions, colors, [
            colors.brand,
        ]);
    }

    /**
     * Returns a copy of chart options with the theme-dependent colors replaced.
     *
     * @param options - Current chart options
     * @param colors - Palette for the current theme
     * @param seriesColors - Series colors, for charts that set their own
     * @returns {ApexOptions} The re-themed options
     */
    private withChartTheme(
        options: ApexOptions,
        colors: ChartPalette,
        seriesColors?: string[],
    ): ApexOptions {
        const { grid, dataLabels } = options;
        return {
            ...options,
            theme: { ...options.theme, mode: this.themeService.theme() },
            // Every chart here sets `chart.type`; the fallback only satisfies the type
            chart: { type: 'line', ...options.chart, foreColor: colors.secondary },
            grid: {
                ...grid,
                borderColor: colors.border,
                ...(grid?.row
                    ? { row: { ...grid.row, colors: [colors.hover, 'transparent'] } }
                    : {}),
            },
            ...(dataLabels?.style?.colors
                ? {
                      dataLabels: {
                          ...dataLabels,
                          style: { ...dataLabels.style, colors: [colors.secondary] },
                      },
                  }
                : {}),
            ...(seriesColors ? { colors: seriesColors } : {}),
        };
    }

    /**
     * Applies live analytics data to all chart and card inputs.
     *
     * @param analytics - Aggregate dashboard data
     * @returns {void}
     */
    private applyAnalytics(analytics: DashboardAnalytics): void {
        this.dashboardAnalytics.set(analytics);
        this.topAds = analytics.topAds;

        const mediaLabels = this.getChartLabels(analytics.mediaCreatedByDay);
        const mediaValues = this.getChartValues(analytics.mediaCreatedByDay, mediaLabels);
        let runningTotal = 0;
        const cumulativeMedia = mediaValues.map((value) => {
            runningTotal += value;
            return runningTotal;
        });

        this.growthChartOptions = {
            ...this.growthChartOptions,
            series: [{ name: 'Media Files', data: cumulativeMedia }],
            xaxis: { ...this.growthChartOptions.xaxis, categories: mediaLabels },
        };
        this.weeklyContentChartOptions = {
            ...this.weeklyContentChartOptions,
            series: [{ name: 'New Media Files', data: mediaValues }],
            xaxis: { ...this.weeklyContentChartOptions.xaxis, categories: mediaLabels },
        };

        const playLabels = this.getChartLabels(analytics.servedByDay, analytics.playedByDay);
        this.totalPlaysChartOptions = {
            ...this.totalPlaysChartOptions,
            series: [
                {
                    name: 'Served',
                    type: 'column',
                    data: this.getChartValues(analytics.servedByDay, playLabels),
                },
                {
                    name: 'Played',
                    type: 'line',
                    data: this.getChartValues(analytics.playedByDay, playLabels),
                },
            ],
            labels: playLabels,
            xaxis: { ...this.totalPlaysChartOptions.xaxis, categories: playLabels },
        };

        const proofLabels = this.getChartLabels(analytics.proofSentByDay);
        this.weeklyPlaysChartOptions = {
            ...this.weeklyPlaysChartOptions,
            series: [
                {
                    name: 'Proof Sent',
                    data: this.getChartValues(analytics.proofSentByDay, proofLabels),
                },
            ],
            xaxis: { ...this.weeklyPlaysChartOptions.xaxis, categories: proofLabels },
        };
        this.isLoadingAnalytics.set(false);
    }

    /**
     * Gets sorted labels shared by one or more chart series.
     *
     * @param series - Count-point series
     * @returns Sorted chart labels
     */
    private getChartLabels(...series: DashboardCountPoint[][]): string[] {
        return [...new Set(series.flatMap((points) => points.map((point) => point.label)))].sort();
    }

    /**
     * Aligns count points to chart labels.
     *
     * @param points - Count points
     * @param labels - Shared chart labels
     * @returns Values aligned to the labels
     */
    private getChartValues(points: DashboardCountPoint[], labels: string[]): number[] {
        const values = new Map(points.map((point) => [point.label, point.value]));
        return labels.map((label) => values.get(label) || 0);
    }

    /**
     * Calculates the age of content from fetched date.
     *
     * @param {string} fetchedDate - The fetched date string
     * @returns {string} Age in months and days format
     */
    calculateAge(fetchedDate: string): string {
        const now = new Date();
        const fetched = new Date(fetchedDate);
        const diffMs = now.getTime() - fetched.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        const months = Math.floor(diffDays / 30);
        const days = diffDays % 30;

        if (months === 0) {
            return `${days} day${days !== 1 ? 's' : ''}`;
        } else if (days === 0) {
            return `${months} month${months !== 1 ? 's' : ''}`;
        } else {
            return `${months} month${months !== 1 ? 's' : ''} ${days} day${days !== 1 ? 's' : ''}`;
        }
    }

    /**
     * Formats duration in seconds to human-readable format.
     *
     * @param {number} seconds - Total duration in seconds
     * @returns {string} Formatted duration string
     */
    formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const parts: string[] = [];

        if (hours > 0) {
            parts.push(`${hours}h`);
        }
        if (minutes > 0) {
            parts.push(`${minutes}m`);
        }
        if (secs > 0 || parts.length === 0) {
            parts.push(`${secs}s`);
        }

        return parts.join(' ');
    }

    /**
     * Gets the number of unique locations for an ad.
     *
     * @param content - Top ad aggregate
     * @returns {number} Number of locations
     */
    public getLocationCount(content: DashboardTopAd): number {
        return content.venueCount;
    }

    /**
     * Gets the live four-week trend for an ad.
     *
     * @param content - Top ad aggregate
     * @returns {number[]} Array of weekly play counts
     */
    public generateTrendData(content: DashboardTopAd): number[] {
        return content.weeklyPlays;
    }

    /**
     * Gets chart options for a small trend chart.
     *
     * @param {number[]} data - Trend data points
     * @returns {ApexOptions} Chart configuration
     */
    getTrendChartOptions(data: number[]): ApexOptions {
        return {
            series: [
                {
                    name: 'Plays',
                    data: data,
                },
            ],
            theme: { mode: this.themeService.theme() },
            colors: [this.chartColors().brand],
            chart: {
                type: 'area',
                height: 60,
                fontFamily: CHART_FONT,
                foreColor: this.chartColors().secondary,
                background: 'transparent',
                zoom: {
                    enabled: false,
                },
                toolbar: {
                    show: false,
                },
                sparkline: {
                    enabled: true,
                },
            },
            dataLabels: {
                enabled: false,
            },
            stroke: {
                curve: 'smooth',
                width: 2,
            },
            markers: {
                shape: 'square',
                size: 3,
                hover: {
                    size: 5,
                },
            },
            xaxis: {
                categories: ['3 Weeks Ago', '2 Weeks Ago', 'Last Week', 'This Week'],
            },
            tooltip: {
                enabled: true,
                x: {
                    show: true,
                },
                y: {
                    formatter: (val: number) => `${val} plays`,
                },
            },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.7,
                    opacityTo: 0.2,
                    stops: [0, 90, 100],
                },
            },
        };
    }
}
