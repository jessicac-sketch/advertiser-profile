/** Angular Imports */
import {
    Component,
    DestroyRef,
    ElementRef,
    afterNextRender,
    effect,
    inject,
    input,
    viewChild,
} from '@angular/core';

/** Third Party Imports */
import * as echarts from 'echarts';

/** Local Imports */
import { CHART_COLORS, CHART_FONT, type ChartPalette } from '@shared/models/chart';
import { ThemeService } from '@shared/services/theme';

/**
 * One line (with a soft area under it) of a count per hour ("HH:00") or per day
 * ("YYYY-MM-DD", labelled "Oct 11") - e.g. the unique ads received.
 *
 * @remarks
 * Wraps the plain `echarts` package the same way DailyAdsBarChartComponent does (init
 * once the container has a size, so it never starts against a 0x0 box).
 *
 * @example
 * <app-daily-line-chart [data]="days" seriesLabel="Unique ads" />
 */
@Component({
    selector: 'app-daily-line-chart',
    standalone: true,
    template: `<div
        #chartEl
        class="daily-line-chart"
        [class.daily-line-chart--loading]="loading()"></div>`,
    styles: [
        `
            :host {
                display: block;
                width: 100%;
                height: 100%;
            }

            .daily-line-chart {
                width: 100%;
                height: 100%;
                min-height: 320px;
                transition: opacity 0.15s ease;

                &--loading {
                    opacity: 0.5;
                }
            }
        `,
    ],
})
export class DailyLineChartComponent {
    private readonly destroyRef = inject(DestroyRef);

    private readonly chartEl = viewChild.required<ElementRef<HTMLDivElement>>('chartEl');

    /** One entry per hour or day, ascending ("HH:00" or "YYYY-MM-DD"). */
    data = input.required<{ date: string; value: number }[]>();

    /** Name of the line (legend-less, shown in the tooltip and as the axis title). */
    seriesLabel = input('Count');

    /** Dims the chart while a new range is loading, without unmounting it. */
    loading = input(false);

    /** Current light / dark theme; charts re-render when it changes. */
    private readonly themeService = inject(ThemeService);

    private chart: echarts.ECharts | null = null;
    private resizeObserver: ResizeObserver | null = null;

    /**
     * Chart colors for the current theme
     * @returns {ChartPalette} The light or dark palette
     */
    private get colors(): ChartPalette {
        return CHART_COLORS[this.themeService.theme()];
    }

    constructor() {
        afterNextRender(() => {
            this.observeContainerSize();

            this.destroyRef.onDestroy(() => {
                this.resizeObserver?.disconnect();
                this.chart?.dispose();
            });
        });

        effect(() => {
            this.themeService.theme(); // re-render when the user switches themes
            const rows = this.data();
            const isLoading = this.loading();
            const label = this.seriesLabel();

            if (this.chart) {
                this.renderOption(rows, isLoading, label);
            }
        });
    }

    /**
     * Initializes ECharts once the container has a real size, then keeps it resized.
     *
     * @returns void
     */
    private observeContainerSize(): void {
        const el = this.chartEl().nativeElement;

        this.resizeObserver = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            if (width === 0 || height === 0) {
                return;
            }

            if (!this.chart) {
                this.chart = echarts.init(el);
                this.renderOption(this.data(), this.loading(), this.seriesLabel());
            } else {
                this.chart.resize();
            }
        });
        this.resizeObserver.observe(el);
    }

    /**
     * Builds and applies the ECharts option.
     *
     * @param rows - Per-day counts to plot
     * @param isLoading - Whether to show the loading overlay
     * @param label - Name of the line
     * @returns void
     */
    private renderOption(
        rows: { date: string; value: number }[],
        isLoading: boolean,
        label: string,
    ): void {
        if (!this.chart) {
            return;
        }

        // Hours arrive as "HH:00" and are shown as they are; days as "YYYY-MM-DD" -> "Oct 11"
        const isHourly = /^\d{2}:00$/.test(rows[0]?.date ?? '');
        const dayLabel = (date: string): string =>
            isHourly
                ? date
                : new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                  });
        // Every label up to a week, then about eight evenly spaced ones
        const labelStep = rows.length <= 8 ? 1 : Math.max(1, Math.round(rows.length / 8));

        this.chart.setOption({
            textStyle: { fontFamily: CHART_FONT, color: this.colors.secondary },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: this.colors.border } },
                backgroundColor: this.colors.surfaceRaised,
                borderColor: this.colors.border,
                textStyle: { color: this.colors.primary, fontFamily: CHART_FONT },
            },
            grid: { left: 56, right: 24, top: 32, bottom: 32 },
            xAxis: {
                type: 'category',
                data: rows.map((row) => dayLabel(row.date)),
                axisLine: { lineStyle: { color: this.colors.border } },
                axisTick: { lineStyle: { color: this.colors.border } },
                axisLabel: {
                    color: this.colors.secondary,
                    interval: (index: number) =>
                        index % labelStep === 0 || index === rows.length - 1,
                },
            },
            yAxis: {
                type: 'value',
                name: label,
                minInterval: 1,
                nameTextStyle: { color: this.colors.muted },
                axisLabel: { color: this.colors.secondary },
                splitLine: { lineStyle: { color: this.colors.border } },
            },
            series: [
                {
                    name: label,
                    type: 'line',
                    smooth: true,
                    data: rows.map((row) => row.value),
                    itemStyle: { color: this.colors.series[0] },
                    lineStyle: { width: 3, color: this.colors.series[0] },
                    areaStyle: { color: this.colors.series[0], opacity: 0.12 },
                    symbol: 'circle',
                    symbolSize: 8,
                },
            ],
        });

        if (isLoading) {
            this.chart.showLoading({
                text: '',
                color: this.colors.brand,
                maskColor: this.colors.mask,
            });
        } else {
            this.chart.hideLoading();
        }
    }
}
