/** Local Imports */
import type { AdvertiserDashboard, AdvertiserProfile } from '../types/advertiser-profile.types.js';
import {
    CATEGORY_GROUPS,
    categoryGroup,
    NO_CATEGORY_GROUP,
    OTHER_GROUP,
} from '../utils/category-groups.util.js';
import { stateFromLocation } from '../utils/us-state.util.js';
import { supabaseRestService } from './supabase-rest.service.js';

/** Columns the dashboard needs from each profile. */
type DashboardRow = Pick<
    AdvertiserProfile,
    | 'id'
    | 'business_name'
    | 'location'
    | 'phone_number'
    | 'category'
    | 'social_media'
    | 'website'
    | 'video_url'
    | 'review_notes'
    | 'created_at'
>;

/** Category names listed under "Top category names". */
const TOP_CATEGORY_COUNT = 8;

/** Profiles listed under "To review". */
const TO_REVIEW_COUNT = 5;

/**
 * Works out the Dashboard page's figures from every advertiser profile.
 *
 * @remarks
 * Reads all profiles (a few thousand rows, paged by the REST client) and counts in
 * memory, so the grouping rules live in one place (category-groups.util.ts,
 * us-state.util.ts) rather than being repeated in SQL.
 */
export class AdvertiserDashboardService {
    /**
     * Builds the dashboard summary.
     *
     * @returns The figures
     */
    async summary(): Promise<AdvertiserDashboard> {
        const rows = await supabaseRestService.selectAll<DashboardRow>(
            'advertiser_profiles',
            'select=id,business_name,location,phone_number,category,social_media,website,video_url,review_notes,created_at&order=created_at.desc,id.asc',
        );

        // Group order while counting: the named groups, then Other and No category
        const groupNames = [...CATEGORY_GROUPS.map((g) => g.name), OTHER_GROUP, NO_CATEGORY_GROUP];
        const groupIndex = new Map(groupNames.map((name, i) => [name, i]));
        const otherIndex = groupIndex.get(OTHER_GROUP) as number;
        const groupCounts = groupNames.map(() => 0);
        const states: Record<string, number[]> = {};
        const categoryNames = new Map<string, { count: number; spellings: Map<string, number> }>();

        let complete = 0;
        let withVideo = 0;
        let withState = 0;
        let noLocation = 0;
        let duplicates = 0;
        let missingName = 0;
        let secondWebsite = 0;
        const flagged: DashboardRow[] = [];

        for (const row of rows) {
            const group = groupIndex.get(categoryGroup(row.category)) ?? otherIndex;
            groupCounts[group]++;

            const state = stateFromLocation(row.location);
            if (state) {
                withState++;
                (states[state] ??= groupNames.map(() => 0))[group]++;
            } else if (!row.location) {
                noLocation++;
            }

            if (
                row.business_name &&
                row.location &&
                row.phone_number &&
                row.category &&
                row.website &&
                row.social_media?.length
            ) {
                complete++;
            }
            if (row.video_url) {
                withVideo++;
            }

            const category = row.category?.trim();
            if (category) {
                const key = category.toLowerCase();
                const entry = categoryNames.get(key) ?? { count: 0, spellings: new Map() };
                entry.count++;
                entry.spellings.set(category, (entry.spellings.get(category) ?? 0) + 1);
                categoryNames.set(key, entry);
            }

            const notes = row.review_notes ?? [];
            if (notes.length) {
                flagged.push(row);
            }
            if (notes.some((note) => note.startsWith('Possible duplicate'))) {
                duplicates++;
            }
            if (!row.business_name) {
                missingName++;
            }
            if (notes.some((note) => note.startsWith('Other website not imported'))) {
                secondWebsite++;
            }
        }

        // Display order: largest named groups first; Other and No category stay last
        const namedCount = CATEGORY_GROUPS.length;
        const order = groupNames
            .map((_, i) => i)
            .sort((a, b) => {
                const aLast = a >= namedCount;
                const bLast = b >= namedCount;
                if (aLast !== bLast) {
                    return aLast ? 1 : -1;
                }
                return aLast ? a - b : groupCounts[b] - groupCounts[a];
            });

        return {
            totals: {
                advertisers: rows.length,
                complete,
                withVideo,
                withState,
                noLocation,
                locationWithoutState: rows.length - withState - noLocation,
                states: Object.keys(states).length,
                categoryNames: categoryNames.size,
            },
            groups: order.map((i) => ({ name: groupNames[i], count: groupCounts[i] })),
            states: Object.fromEntries(
                Object.entries(states).map(([code, counts]) => [code, order.map((i) => counts[i])]),
            ),
            topCategories: [...categoryNames.values()]
                .sort((a, b) => b.count - a.count)
                .slice(0, TOP_CATEGORY_COUNT)
                .map((entry) => ({ name: mostCommon(entry.spellings), count: entry.count })),
            attention: {
                profiles: flagged.length,
                duplicates,
                missingName,
                secondWebsite,
                // Rows come newest first
                toReview: flagged.slice(0, TO_REVIEW_COUNT).map((row) => ({
                    id: row.id,
                    business_name: row.business_name,
                    category: row.category,
                    reason: row.review_notes?.[0] ?? '',
                })),
            },
        };
    }
}

/**
 * The spelling used most often (e.g. "Insurance agency" over "Insurance Agency").
 *
 * @param spellings - Each spelling and how often it appears
 * @returns The most frequent spelling
 */
function mostCommon(spellings: Map<string, number>): string {
    return [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export const advertiserDashboardService = new AdvertiserDashboardService();
