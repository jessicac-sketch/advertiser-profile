/**
 * Advertiser profile and import shapes, mirroring the BFF's
 * src/server/types/advertiser-profile.types.ts.
 */

/** One advertiser (a row of the advertiser_profiles table). */
export interface AdvertiserProfile {
    id: string;
    /** Null only for rows imported without a name, to be filled in later */
    business_name: string | null;
    location: string | null;
    phone_number: string | null;
    category: string | null;
    /** One link per account (Facebook, LinkedIn, Instagram, ...) */
    social_media: string[] | null;
    website: string | null;
    /** Link to the advertiser's video, the source of this profile */
    video_url: string | null;
    /** What needs fixing (set by the import); null when nothing does */
    review_notes: string[] | null;
    created_at: string;
    updated_at: string;
}

/** A short form of a profile, for lists of related profiles. */
export type AdvertiserProfileSummary = Pick<
    AdvertiserProfile,
    'id' | 'business_name' | 'location' | 'category' | 'video_url' | 'review_notes' | 'created_at'
>;

/** One advertiser, with the profiles that may be duplicates of it. */
export interface AdvertiserProfileDetail extends AdvertiserProfile {
    /** Other profiles with the same business name and location */
    sameNameAndLocation: AdvertiserProfileSummary[];
}

/** One page of advertisers. */
export interface AdvertiserProfilePage {
    items: AdvertiserProfile[];
    /** Advertisers in total, across all pages */
    total: number;
    /** Page number, from 1 */
    page: number;
    pageSize: number;
}

/** The editable columns of an advertiser. */
export type AdvertiserProfileInput = Pick<
    AdvertiserProfile,
    | 'business_name'
    | 'location'
    | 'phone_number'
    | 'category'
    | 'social_media'
    | 'website'
    | 'video_url'
>;

/** What happens to one spreadsheet row on import. */
export type AdvertiserImportRowStatus = 'new' | 'duplicate' | 'invalid';

/** One spreadsheet row in the import preview. */
export interface AdvertiserImportRow {
    /** Row number in the sheet, as Excel shows it */
    rowNumber: number;
    status: AdvertiserImportRowStatus;
    /** Why the row is a duplicate or a problem */
    reason?: string;
    /** Duplicate of an advertiser already saved; always skipped */
    alreadySaved?: boolean;
    /** What was changed to import the row, e.g. a second website left out */
    notes?: string[];
    data: AdvertiserProfileInput;
}

/** What an import would do, before anything is saved. */
export interface AdvertiserImportPreview {
    sheetName: string;
    /** Every tab that can be imported, in workbook order */
    sheets: { name: string; matchedCount: number }[];
    matchedColumns: Partial<Record<keyof AdvertiserProfileInput, string>>;
    rows: AdvertiserImportRow[];
    counts: Record<AdvertiserImportRowStatus, number>;
}

/** Which rows besides the new ones to import (they are tagged Needs Attention). */
export interface AdvertiserImportOptions {
    /** Also import rows that repeat an earlier row in the same file */
    includeDuplicates: boolean;
    /** Also import rows with problems (no business name) */
    includeInvalid: boolean;
}

/** Result of a saved import. */
export interface AdvertiserImportResult {
    /** Rows added, including those tagged Needs Attention */
    inserted: number;
    /** Of those, rows added with review notes */
    flaggedForReview: number;
    skippedDuplicates: number;
    skippedInvalid: number;
}

/** Filters for the advertiser list; all optional and combined. */
export interface AdvertiserListFilters {
    /** Text any detail contains, ignoring case */
    search?: string;
    /** Category group, e.g. "Home services" */
    group?: string;
    /** Two-letter state code, or "none" for advertisers without a state */
    state?: string;
    /** Only advertisers tagged Needs Attention */
    attention?: boolean;
}

/** Figures for the Dashboard page (from GET /api/advertiser-profiles/dashboard). */
export interface AdvertiserDashboard {
    totals: {
        advertisers: number;
        /** With all six details filled in */
        complete: number;
        withVideo: number;
        /** With a US state found in their location */
        withState: number;
        noLocation: number;
        /** A location with only a city or area, no state */
        locationWithoutState: number;
        /** States (and DC) with at least one advertiser */
        states: number;
        /** Different category names, ignoring capitals */
        categoryNames: number;
    };
    /** Category groups, largest first, then Other and No category */
    groups: { name: string; count: number }[];
    /** Advertisers per state code, by category group (same order as `groups`) */
    states: Record<string, number[]>;
    /** Most common category names */
    topCategories: { name: string; count: number }[];
    attention: {
        /** Profiles tagged Needs Attention */
        profiles: number;
        duplicates: number;
        missingName: number;
        secondWebsite: number;
        /** Latest profiles that need attention */
        toReview: {
            id: string;
            business_name: string | null;
            category: string | null;
            reason: string;
        }[];
    };
}
