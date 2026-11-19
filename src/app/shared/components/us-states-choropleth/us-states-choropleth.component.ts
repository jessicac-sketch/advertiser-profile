/** Angular Imports */
import {
    afterNextRender,
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';

/** Third Party Imports */
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

/** Local Imports */
import { STATE_CODE_TO_NAME, STATE_NAME_TO_CODE } from '@shared/utils/us-states.util';

/** One state's outline, ready to draw. */
interface StateShape {
    /** Two-letter code, e.g. "MN" */
    code: string;
    /** SVG path */
    d: string;
    /** Label position (center of its largest piece) */
    x: number;
    y: number;
}

/** A state as drawn: outline, shade and label. */
interface DrawnState extends StateShape {
    value: number;
    /** 0 = no advertisers, 1–5 = light to dark */
    step: number;
    tooltip: string;
    showLabel: boolean;
}

/** Shades: a state's value as a share of the largest value, above which it moves up a shade. */
const CUTS = [0.04, 0.12, 0.3, 0.6];

/** Too small to label on the map (named in the tooltip instead). */
const NO_LABEL = new Set(['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD', 'DC', 'HI']);

/** Points closer than this (in map units) are dropped, keeping outlines light. */
const MIN_POINT_DISTANCE = 0.6;

/** The outlines, loaded once and shared by every map on the page. */
let shapesPromise: Promise<StateShape[]> | null = null;

/**
 * US map with each state shaded by a value (e.g. number of advertisers).
 *
 * @remarks
 * Draws the states as SVG from the bundled `us-atlas` shapes (/assets/us-states-albers-10m.json,
 * already projected, with Alaska and Hawaii inset). Shades come from the `--app-map-*`
 * theme tokens, so the map follows light and dark mode. Clicking a state emits its code;
 * states can't take keyboard focus, so pair the map with another way to pick a state.
 *
 * @example
 * <app-us-states-choropleth [values]="{ MN: 222, TX: 93 }" [selected]="'MN'"
 *     [tooltip]="tooltipFn" (stateSelect)="pick($event)" />
 */
@Component({
    selector: 'app-us-states-choropleth',
    templateUrl: './us-states-choropleth.component.html',
    styleUrl: './us-states-choropleth.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
})
export class UsStatesChoroplethComponent {
    /**
     * Value per state, by two-letter code; states left out count as 0
     * @type {InputSignal<Record<string, number>>}
     */
    public readonly values = input.required<Record<string, number>>();

    /**
     * Code of the selected state, outlined; null for none
     * @type {InputSignal<string | null>}
     */
    public readonly selected = input<string | null>(null);

    /**
     * Tooltip text for a state; defaults to "<State>: <value>"
     * @type {InputSignal<(code: string, value: number) => string>}
     */
    public readonly tooltip = input<(code: string, value: number) => string>(
        (code, value) => `${STATE_CODE_TO_NAME[code] ?? code}: ${value}`,
    );

    /**
     * Accessible description of the whole map
     * @type {InputSignal<string>}
     */
    public readonly label = input('Map of the United States');

    /**
     * Emits the code of the state that was clicked
     * @type {OutputEmitterRef<string>}
     */
    public readonly stateSelect = output<string>();

    /**
     * The outlines, once loaded
     * @type {WritableSignal<StateShape[]>}
     */
    protected readonly shapes = signal<StateShape[]>([]);

    /**
     * Whether the outlines failed to load
     * @type {WritableSignal<boolean>}
     */
    protected readonly failed = signal(false);

    /**
     * Largest value on the map
     * @type {Signal<number>}
     */
    protected readonly max = computed(() => Math.max(0, ...Object.values(this.values())));

    /**
     * Every state with its shade, tooltip and label
     * @type {Signal<DrawnState[]>}
     */
    protected readonly states = computed<DrawnState[]>(() => {
        const values = this.values();
        const max = this.max();
        const tooltip = this.tooltip();
        return this.shapes().map((shape) => {
            const value = values[shape.code] ?? 0;
            return {
                ...shape,
                value,
                step: stepFor(value, max),
                tooltip: tooltip(shape.code, value),
                showLabel: !NO_LABEL.has(shape.code),
            };
        });
    });

    /**
     * Outline of the selected state, drawn on top
     * @type {Signal<string | null>}
     */
    protected readonly selectedPath = computed(
        () => this.shapes().find((s) => s.code === this.selected())?.d ?? null,
    );

    /**
     * Legend: the value range behind each shade
     * @type {Signal<{ step: number; label: string }[]>}
     */
    protected readonly legend = computed(() => {
        const max = this.max();
        const items = [{ step: 0, label: 'None' }];
        if (max === 0) {
            return items;
        }
        // Lowest value in each shade: 1, then just above each cut
        const lows = [1, ...CUTS.map((cut) => Math.floor(cut * max) + 1)];
        lows.forEach((low, i) => {
            const high = i < CUTS.length ? lows[i + 1] - 1 : max;
            if (low <= high) {
                items.push({
                    step: i + 1,
                    label:
                        low === high
                            ? low.toLocaleString()
                            : `${low.toLocaleString()}–${high.toLocaleString()}`,
                });
            }
        });
        return items;
    });

    constructor() {
        // Browser only: the shapes are fetched from the app's own assets
        afterNextRender(() => {
            shapesPromise ??= loadShapes();
            shapesPromise
                .then((shapes) => this.shapes.set(shapes))
                .catch(() => {
                    shapesPromise = null; // try again next time
                    this.failed.set(true);
                });
        });
    }

    /**
     * Emits a click on a state.
     *
     * @param code - Two-letter state code
     * @returns {void}
     */
    protected onSelect(code: string): void {
        this.stateSelect.emit(code);
    }
}

/**
 * The shade for a value: 0 for none, else 1–5 by its share of the largest value.
 *
 * @param value - The state's value
 * @param max - Largest value on the map
 * @returns The shade step
 */
function stepFor(value: number, max: number): number {
    if (!value || !max) {
        return 0;
    }
    const share = value / max;
    return 1 + CUTS.filter((cut) => share > cut).length;
}

/**
 * Loads the state outlines and turns them into SVG paths.
 *
 * @returns The outlines of the 50 states and DC
 */
async function loadShapes(): Promise<StateShape[]> {
    const response = await fetch('/assets/us-states-albers-10m.json');
    if (!response.ok) {
        throw new Error(`Map shapes: HTTP ${response.status}`);
    }
    const topology = (await response.json()) as Topology;
    const collection = feature(
        topology,
        topology.objects['states'] as GeometryCollection,
    ) as unknown as {
        features: {
            properties: { name: string };
            geometry: {
                type: 'Polygon' | 'MultiPolygon';
                coordinates: number[][][] | number[][][][];
            };
        }[];
    };

    return collection.features
        .map((f) => {
            const code = STATE_NAME_TO_CODE[f.properties.name];
            if (!code) {
                return null;
            }
            const polygons = (
                f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
            ) as number[][][][];

            let d = '';
            let largest = { area: -1, x: 0, y: 0 };
            for (const polygon of polygons) {
                for (const ring of polygon) {
                    d += ringPath(ring);
                }
                const xs = polygon[0].map((p) => p[0]);
                const ys = polygon[0].map((p) => p[1]);
                const [minX, maxX, minY, maxY] = [
                    Math.min(...xs),
                    Math.max(...xs),
                    Math.min(...ys),
                    Math.max(...ys),
                ];
                const area = (maxX - minX) * (maxY - minY);
                if (area > largest.area) {
                    largest = { area, x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
                }
            }
            return { code, d, x: Math.round(largest.x), y: Math.round(largest.y) };
        })
        .filter((shape): shape is StateShape => shape !== null);
}

/**
 * One closed ring as SVG path commands, skipping points too close to the previous one.
 *
 * @param ring - Points [x, y]
 * @returns Path commands ("M…L…Z"), or "" for a ring too small to draw
 */
function ringPath(ring: number[][]): string {
    const kept: number[][] = [];
    for (const point of ring) {
        const last = kept[kept.length - 1];
        if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= MIN_POINT_DISTANCE) {
            kept.push(point);
        }
    }
    if (kept.length < 3) {
        return '';
    }
    return `M${kept.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`;
}
