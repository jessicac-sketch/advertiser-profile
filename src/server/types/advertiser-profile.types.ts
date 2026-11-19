/**
 * Row of the advertiser_profiles table (supabase/migrations/*_create_advertiser_profiles.sql).
 */
export interface AdvertiserProfile {
    /** UUID primary key */
    id: string;
    /** Null only for rows imported without a name, to be filled in later */
    business_name: string | null;
    location: string | null;
    phone_number: string | null;
    category: string | null;
    /** One link per account (Facebook, LinkedIn, Instagram, ...), in the order given */
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

/** Columns read from a spreadsheet row. */
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

/**
 * What happens to one spreadsheet row on import.
 *
 * - `new`: will be added
 * - `duplicate`: same business name and location as an existing advertiser, or as an
 *   earlier row in the same file - skipped unless duplicates are included
 * - `invalid`: missing a business name - skipped unless problem rows are included
 */
export type AdvertiserImportRowStatus = 'new' | 'duplicate' | 'invalid';

/** One parsed spreadsheet row, as shown in the import preview. */
export interface AdvertiserImportRow {
    /** Row number in the sheet (1-based, as Excel shows it) */
    rowNumber: number;
    status: AdvertiserImportRowStatus;
    /** Why the row is a duplicate or a problem */
    reason?: string;
    /**
     * Duplicate of an advertiser already saved (not just of an earlier row in the file).
     * These are always skipped, so importing the same file twice adds nothing.
     */
    alreadySaved?: boolean;
    /** What was changed to import the row, e.g. a second website left out */
    notes?: string[];
    data: AdvertiserProfileInput;
}

/** Result of reading a spreadsheet, before anything is saved. */
export interface AdvertiserImportPreview {
    /** Name of the worksheet that was read */
    sheetName: string;
    /** Every tab that can be imported (has a "Business Name" heading), in workbook order */
    sheets: { name: string; matchedCount: number }[];
    /** Spreadsheet columns that were recognised, by table column */
    matchedColumns: Partial<Record<keyof AdvertiserProfileInput, string>>;
    rows: AdvertiserImportRow[];
    counts: Record<AdvertiserImportRowStatus, number>;
}

/** Which rows besides the new ones to import. */
export interface AdvertiserImportOptions {
    /** Also import rows that repeat an earlier row in the same file */
    includeDuplicates: boolean;
    /** Also import rows with problems (no business name) */
    includeInvalid: boolean;
}

/** Result of saving an import. */
export interface AdvertiserImportResult {
    /** Rows added, including those tagged Needs Attention */
    inserted: number;
    /** Of those, rows added with review notes (included duplicates and problems) */
    flaggedForReview: number;
    skippedDuplicates: number;
    skippedInvalid: number;
}

/** Filters for the advertiser list; all optional and combined with AND. */
export interface AdvertiserListFilters {
    /** Text any detail contains (name, category, location, phone, website, social), ignoring case */
    search?: string;
    /** Category group, e.g. "Home services" (see category-groups.util.ts) */
    group?: string;
    /** Two-letter state code, or "none" for profiles without a state */
    state?: string;
    /** Only profiles tagged Needs Attention */
    attention?: boolean;
}

/**
 * Figures for the Dashboard page, worked out from every advertiser profile.
 */
export interface AdvertiserDashboard {
    totals: {
        /** Advertiser profiles */
        advertisers: number;
        /** With all six details: name, location, phone, category, website, social media */
        complete: number;
        /** With a video link */
        withVideo: number;
        /** With a US state found in their location */
        withState: number;
        /** With no location at all */
        noLocation: number;
        /** With a location but no state in it (a city or area only) */
        locationWithoutState: number;
        /** States (and DC) with at least one advertiser */
        states: number;
        /** Different category names, ignoring capitals */
        categoryNames: number;
    };
    /** Category groups, in display order (largest first, then Other and No category) */
    groups: { name: string; count: number }[];
    /** Advertisers per state, by category group (same order as `groups`) */
    states: Record<string, number[]>;
    /** Most common category names, ignoring capitals */
    topCategories: { name: string; count: number }[];
    attention: {
        /** Profiles tagged Needs Attention */
        profiles: number;
        /** Profiles tagged as a possible duplicate */
        duplicates: number;
        /** Profiles without a business name */
        missingName: number;
        /** Profiles where a second website was left out */
        secondWebsite: number;
        /** Most recently imported profiles that need attention */
        toReview: {
            id: string;
            business_name: string | null;
            category: string | null;
            reason: string;
        }[];
    };
}
