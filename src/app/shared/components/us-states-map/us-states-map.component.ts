/** Angular Imports */
import {
    Component,
    DestroyRef,
    ElementRef,
    afterNextRender,
    effect,
    inject,
    input,
    output,
    viewChild,
} from '@angular/core';

/** Third Party Imports */
import * as echarts from 'echarts';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

/** Local Imports */
import { CHART_COLORS, CHART_FONT, type ChartPalette } from '@shared/models/chart';
import { ThemeService } from '@shared/services/theme';
// Direct subpath, not the '@shared' barrel - avoids pulling every other
// shared component (sidebar, modals, etc.) into this component's own chunk
// just to reach two lookup constants.
import { STATE_CODE_TO_NAME, STATE_NAME_TO_CODE } from '@shared/utils/us-states.util';

const MAP_NAME = 'US-states';

/** Minimal shapes covering the pieces of GeoJSON this component walks to flip coordinates - not a full GeoJSON typing. */
type NestedPositions = number[] | NestedPositions[];
type GeoJsonGeometry =
    | { type: 'GeometryCollection'; geometries: GeoJsonGeometry[] }
    | { type: string; coordinates: NestedPositions };
type GeoJsonFeature = { geometry: GeoJsonGeometry };

/**
 * Choropleth map of US states, colored by a numeric value per state.
 *
 * @remarks
 * Wraps the plain `echarts` package directly (not `ngx-echarts`) - this app
 * runs zoneless (`provideZonelessChangeDetection()`), and `ngx-echarts`'s
 * zoneless compatibility isn't established, so the chart is driven
 * imperatively off signals instead.
 *
 * Initializes in `afterNextRender`, once the chart container is in the DOM.
 */
@Component({
    selector: 'app-us-states-map',
    standalone: true,
    template: `<div
        #chartEl
        class="us-states-map"
        [class.us-states-map--loading]="loading()"></div>`,
    styles: [
        `
            :host {
                display: block;
                width: 100%;
                height: 100%;
            }

            .us-states-map {
                width: 100%;
                height: 500px;
                transition: opacity 0.15s ease;

                &--loading {
                    opacity: 0.5;
                }
            }
        `,
    ],
})
export class UsStatesMapComponent {
    private readonly destroyRef = inject(DestroyRef);

    private readonly chartEl = viewChild.required<ElementRef<HTMLDivElement>>('chartEl');

    /** Per-state values to color the map by, keyed by two-letter USPS code. */
    data = input.required<{ code: string; value: number; venueCount: number }[]>();

    /** Dims the map while a new range is loading, without unmounting the chart. */
    loading = input(false);

    /** Two-letter code of the currently-selected state, colored orange regardless of its data value, or null for none. */
    selectedCode = input<string | null>(null);

    /** Emits the two-letter USPS code of the state the user clicked. */
    stateClicked = output<string>();

    /** Current light / dark theme; charts re-render when it changes. */
    private readonly themeService = inject(ThemeService);

    private chart: echarts.ECharts | null = null;
    private mapReady = false;
    private resizeObserver: ResizeObserver | null = null;

    /** Resolves once the GeoJSON is fetched/converted/registered - awaited before init. */
    private mapRegistered: Promise<void> | null = null;

    /**
     * Chart colors for the current theme
     * @returns {ChartPalette} The light or dark palette
     */
    private get colors(): ChartPalette {
        return CHART_COLORS[this.themeService.theme()];
    }

    constructor() {
        afterNextRender(() => {
            this.mapRegistered = this.loadAndRegisterMap();
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
            const selectedCode = this.selectedCode();

            if (this.chart && this.mapReady) {
                this.renderOption(rows, isLoading, selectedCode);
            }
        });
    }

    /**
     * Fetches the US states GeoJSON (converted once from the bundled
     * `us-atlas` TopoJSON asset) and registers it with ECharts. Independent
     * of the container's size, so it can run in parallel with
     * observeContainerSize() waiting for a layout to init against.
     *
     * @returns Promise<void>
     */
    private async loadAndRegisterMap(): Promise<void> {
        const topology = await fetch('/assets/us-states-albers-10m.json').then(
            (response) => response.json() as Promise<Topology>,
        );

        const statesGeoJson = feature(topology, topology.objects['states'] as GeometryCollection);

        // us-states-albers-10m.json holds already-projected planar
        // coordinates (SVG/screen space, y increasing downward) rather than
        // raw lon/lat - but ECharts' map series assumes lon/lat and applies
        // its own north-up (y increasing upward) transform, which flips
        // this data a second time and renders the whole map upside down.
        // Mirroring y here cancels out that extra flip.
        this.flipVertically(statesGeoJson as never as { features: GeoJsonFeature[] });

        echarts.registerMap(MAP_NAME, statesGeoJson as never);
    }

    /**
     * Negates the y coordinate of every position in a GeoJSON
     * FeatureCollection's geometries - see the comment at its call site for
     * why this is needed.
     *
     * @remarks
     * Builds new coordinate arrays rather than mutating in place -
     * `topojson-client` reuses the same decoded coordinate array by
     * reference across features/rings that share a boundary arc, so an
     * in-place negation double-flips (and effectively un-flips) whichever
     * copy of that shared arc gets visited second, corrupting the ring's
     * point order and rendering a spurious line across the affected state(s).
     *
     * @param geojson - FeatureCollection to mirror
     * @returns void
     */
    private flipVertically(geojson: { features: GeoJsonFeature[] }): void {
        for (const f of geojson.features) {
            f.geometry = this.flipGeometryVertically(f.geometry);
        }
    }

    private flipGeometryVertically(geometry: GeoJsonGeometry): GeoJsonGeometry {
        if ('geometries' in geometry) {
            return {
                ...geometry,
                geometries: geometry.geometries.map((g) => this.flipGeometryVertically(g)),
            };
        }
        return { ...geometry, coordinates: this.flipPositionsVertically(geometry.coordinates) };
    }

    private flipPositionsVertically(coords: NestedPositions): NestedPositions {
        if (typeof coords[0] === 'number') {
            const [x, y] = coords as number[];
            return [x, -y];
        }
        return (coords as NestedPositions[]).map((c) => this.flipPositionsVertically(c));
    }

    /**
     * Watches the chart container's size and initializes ECharts only once
     * it actually has non-zero dimensions.
     *
     * @remarks
     * `afterNextRender` guarantees the DOM has updated, but not that layout/
     * paint has completed - this component's container can still measure
     * 0x0 at that point. Initializing ECharts against a 0x0 element fails
     * silently (blank map) or throws.
     * `ResizeObserver` fires immediately on `observe()` with the element's
     * current size, then again on every subsequent layout change - so this
     * also replaces the old window-resize-only listener with one that
     * reacts to any layout change (e.g. the right panel appearing/collapsing).
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
                this.initChart(el);
            } else {
                this.chart.resize();
            }
        });
        this.resizeObserver.observe(el);
    }

    /**
     * Creates the ECharts instance once the container has a real size and
     * the GeoJSON has been registered.
     *
     * @param el - Chart container, already confirmed to have non-zero size
     * @returns Promise<void>
     */
    private async initChart(el: HTMLDivElement): Promise<void> {
        await this.mapRegistered;

        this.chart = echarts.init(el);
        this.chart.on('click', (params) => {
            const code = STATE_NAME_TO_CODE[params.name as string];
            if (code) {
                this.stateClicked.emit(code);
            }
        });

        this.mapReady = true;
        this.renderOption(this.data(), this.loading(), this.selectedCode());
    }

    /**
     * Builds and applies the ECharts option for the current data/loading state.
     *
     * @param rows - Per-state values to plot
     * @param isLoading - Whether to show the loading overlay
     * @returns void
     */
    private renderOption(
        rows: { code: string; value: number; venueCount: number }[],
        isLoading: boolean,
        selectedCode: string | null,
    ): void {
        if (!this.chart) {
            return;
        }

        // venueCount/code ride along on each data point as custom fields -
        // ECharts preserves unknown properties on series data and hands
        // them back in tooltip/label formatters via params.data.
        const seriesData: {
            name: string;
            code: string;
            value: number;
            venueCount: number;
            itemStyle?: { areaColor: string; borderColor: string; borderWidth: number };
        }[] = rows
            .map(({ code, value, venueCount }) => ({
                name: STATE_CODE_TO_NAME[code],
                code,
                value,
                venueCount,
            }))
            .filter((row) => !!row.name);

        if (selectedCode) {
            const selectedItemStyle = {
                areaColor: this.colors.brand,
                borderColor: this.colors.primary,
                borderWidth: 1.5,
            };
            const existing = seriesData.find((row) => row.code === selectedCode);
            if (existing) {
                existing.itemStyle = selectedItemStyle;
            } else if (STATE_CODE_TO_NAME[selectedCode]) {
                // Selected state has no play data (not in `rows` at all) -
                // still needs a data entry to be colorable/highlightable.
                seriesData.push({
                    name: STATE_CODE_TO_NAME[selectedCode],
                    code: selectedCode,
                    value: 0,
                    venueCount: 0,
                    itemStyle: selectedItemStyle,
                });
            }
        }

        const maxValue = Math.max(1, ...seriesData.map((row) => row.value));

        this.chart.setOption({
            // The chart's own canvas background (the "ocean"/negative space
            // around the landmass) - distinct from the surrounding
            // .map-view__map-card's CSS background, which sits behind the
            // canvas but doesn't paint through it.
            backgroundColor: this.colors.surfaceBase,
            textStyle: { fontFamily: CHART_FONT },
            tooltip: {
                trigger: 'item',
                backgroundColor: this.colors.surfaceRaised,
                borderColor: this.colors.border,
                textStyle: { color: this.colors.primary, fontFamily: CHART_FONT },
                formatter: (params: {
                    name: string;
                    value?: number;
                    data?: { venueCount?: number };
                }) =>
                    // Map regions with no matching data entry get value:NaN
                    // from ECharts (not undefined/null), so `?? 0` alone
                    // doesn't catch it.
                    `<strong>${params.name}</strong><br/>` +
                    `Venues: ${params.data?.venueCount ?? 0}<br/>` +
                    `Ads Played: ${Number.isFinite(params.value) ? params.value : 0}`,
            },
            visualMap: {
                left: 'left',
                bottom: '5%',
                min: 0,
                max: maxValue,
                // Navy-to-teal scale for states with plays - states with no
                // data at all fall through to the series' own default
                // itemStyle (raised navy fill / border) below, not this
                // scale, since visualMap only colors matched data points.
                // Orange stays reserved for the selected state.
                inRange: { color: [...this.colors.scale] },
                text: ['High', 'Low'],
                textStyle: { color: this.colors.secondary },
                calculable: true,
            },
            series: [
                {
                    type: 'map',
                    map: MAP_NAME,
                    roam: true,
                    // ECharts' default aspectScale (0.75) assumes the data
                    // is raw lon/lat and compensates for longitude lines
                    // converging toward the poles. This topology is already
                    // projected to planar pixel coordinates (see the y-flip
                    // comment in loadAndRegisterMap), where x/y are equally
                    // scaled units - the default scaling stretched it
                    // horizontally on top of that.
                    aspectScale: 1,
                    // Fills the container instead of leaving a fixed default
                    // margin on every side - the map's own aspect ratio
                    // still constrains how much of that box it actually
                    // fills without distorting.
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    // Base look for states with no play data (not present in
                    // `data` below, so visualMap never touches them) - the
                    // raised navy surface with the theme border.
                    itemStyle: {
                        areaColor: this.colors.surfaceRaised,
                        borderColor: this.colors.border,
                        borderWidth: 0.75,
                    },
                    label: {
                        show: true,
                        fontSize: 10,
                        lineHeight: 12,
                        color: this.colors.primary,
                        fontWeight: 'bold',
                        // Two lines: USPS code in a pill (its own rich style,
                        // for visual pop against the fill color - orange to
                        // match the selected state's own highlight color
                        // when it's the one selected), then "venues / ad
                        // plays" as plain text below it - the full state
                        // name ("California") overlapped badly at this
                        // scale, and both counts are the whole point of the
                        // visualization, so they're worth surfacing
                        // directly instead of hover-only.
                        formatter: (params: {
                            name: string;
                            data?: { value?: number; venueCount?: number };
                        }) => {
                            const code = STATE_NAME_TO_CODE[params.name] ?? params.name;
                            const richKey = code === selectedCode ? 'codeSelected' : 'code';
                            return (
                                `{${richKey}|${code}}\n` +
                                `${params.data?.venueCount ?? 0} / ${params.data?.value ?? 0}`
                            );
                        },
                        rich: {
                            code: {
                                color: this.colors.primary,
                                fontWeight: 'bold',
                                fontSize: 10,
                                backgroundColor: this.colors.surfaceBase,
                                borderRadius: 0,
                                padding: [2, 6],
                                lineHeight: 14,
                            },
                            codeSelected: {
                                color: this.colors.surfaceBase,
                                fontWeight: 'bold',
                                fontSize: 10,
                                backgroundColor: this.colors.brand,
                                borderRadius: 0,
                                padding: [2, 6],
                                lineHeight: 14,
                            },
                        },
                    },
                    emphasis: {
                        label: { show: true, color: this.colors.primary, fontWeight: 'bold' },
                        // Hover: a neutral tint, so it's never mistaken for the
                        // (orange) selected state
                        itemStyle: { areaColor: this.colors.muted },
                    },
                    // Small/tightly-packed states (Northeast especially)
                    // don't have room for the two-line label - instead of
                    // letting it overflow/overlap illegibly, hide whichever
                    // labels collide and keep just the fill color. ECharts
                    // recomputes this on every zoom (roam:true), so zooming
                    // into a cramped area naturally reveals labels again
                    // once there's room.
                    labelLayout: { hideOverlap: true },
                    data: seriesData,
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
