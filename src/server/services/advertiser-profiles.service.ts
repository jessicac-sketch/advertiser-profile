/** Third Party Imports */
import ExcelJS from 'exceljs';

/** Local Imports */
import type {
    AdvertiserImportOptions,
    AdvertiserImportPreview,
    AdvertiserImportResult,
    AdvertiserImportRow,
    AdvertiserListFilters,
    AdvertiserProfile,
    AdvertiserProfileDetail,
    AdvertiserProfileInput,
    AdvertiserProfilePage,
    AdvertiserProfileSummary,
} from '../types/advertiser-profile.types.js';
import { categoryGroup } from '../utils/category-groups.util.js';
import { stateFromLocation } from '../utils/us-state.util.js';
import { supabaseRestService } from './supabase-rest.service.js';

const TABLE = 'advertiser_profiles';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Largest sheet accepted in one import. */
export const MAX_IMPORT_ROWS = 5000;

type ProfileColumn = keyof AdvertiserProfileInput;

/**
 * Spreadsheet headings recognised for each column, compared after lower-casing and
 * removing everything but letters and digits ("Phone Number" -> "phonenumber").
 */
const HEADER_ALIASES: Record<ProfileColumn, string[]> = {
    business_name: ['businessname', 'business', 'name', 'companyname', 'company'],
    location: ['location', 'address', 'fulladdress', 'streetaddress'],
    phone_number: ['phonenumber', 'phone', 'telephone', 'tel', 'phoneno'],
    category: ['category', 'businesscategory', 'type', 'businesstype'],
    social_media: ['socialmedia', 'social', 'socials', 'sociallink', 'instagram', 'facebook'],
    website: ['website', 'websiteurl', 'url', 'site', 'web'],
    video_url: ['videourl', 'video', 'videolink', 'videofile', 'creativeurl'],
};

const URL_COLUMNS: ReadonlySet<ProfileColumn> = new Set(['social_media', 'website', 'video_url']);

/** Raw cell text per column, before validation. */
type RawRow = Record<ProfileColumn, string | null>;

const COLUMN_LABELS: Record<ProfileColumn, string> = {
    business_name: 'Business Name',
    location: 'Location',
    phone_number: 'Phone Number',
    category: 'Category',
    social_media: 'Social Media',
    website: 'Website',
    video_url: 'Video URL',
};

/**
 * Thrown when the uploaded file can't be imported (not a workbook, no recognised
 * columns, too many rows). The message is shown to the user as is.
 */
export class ImportFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ImportFileError';
    }
}

/**
 * Advertiser profiles: listing and spreadsheet import.
 */
export class AdvertiserProfilesService {
    /**
     * Lists one page of advertisers, by business name, optionally filtered.
     *
     * @remarks
     * Without filters the database pages the list. Category groups and states are worked
     * out from free text (category-groups.util.ts, us-state.util.ts, the same rules as the
     * dashboard), so with filters every profile is read and filtered here, then paged.
     * That is a few thousand rows; move the grouping into the database if it grows a lot.
     *
     * @param page - Page number, from 1
     * @param pageSize - Advertisers per page
     * @param filters - Search text, category group, state and Needs Attention
     * @returns The page and the total number of matching advertisers
     */
    async list(
        page: number,
        pageSize: number,
        filters: AdvertiserListFilters = {},
    ): Promise<AdvertiserProfilePage> {
        // Unnamed rows (imported to fix later) sort last; id keeps equal names in a stable order
        const query = 'select=*&order=business_name.asc.nullslast,id.asc';
        const offset = (page - 1) * pageSize;

        if (!hasFilters(filters)) {
            const { rows, total } = await supabaseRestService.selectPage<AdvertiserProfile>(
                TABLE,
                query,
                offset,
                pageSize,
            );
            return { items: rows, total, page, pageSize };
        }

        const all = await supabaseRestService.selectAll<AdvertiserProfile>(
            TABLE,
            filters.attention ? `${query}&review_notes=not.is.null` : query,
        );
        const matching = all.filter((row) => matchesFilters(row, filters));
        return {
            items: matching.slice(offset, offset + pageSize),
            total: matching.length,
            page,
            pageSize,
        };
    }

    /**
     * Reads one advertiser, with the other profiles that share its business name and
     * location (possible duplicates, for the "Needs Attention" explanation).
     *
     * @param id - Advertiser id (UUID)
     * @returns The advertiser, or null when there is none with that id
     */
    async get(id: string): Promise<AdvertiserProfileDetail | null> {
        if (!UUID_PATTERN.test(id)) {
            return null;
        }
        const rows = await supabaseRestService.selectAll<AdvertiserProfile>(
            TABLE,
            `select=*&id=eq.${id}`,
        );
        const advertiser = rows[0];
        if (!advertiser) {
            return null;
        }
        return { ...advertiser, sameNameAndLocation: await this.sameNameAndLocation(advertiser) };
    }

    /**
     * Other profiles with the same business name and location, ignoring case and spacing
     * (the same rule the import uses to spot duplicates).
     *
     * @param advertiser - The advertiser to compare with
     * @returns The matching profiles, by business name; none for unnamed advertisers
     */
    private async sameNameAndLocation(
        advertiser: AdvertiserProfile,
    ): Promise<AdvertiserProfileSummary[]> {
        if (!advertiser.business_name) {
            return [];
        }
        // Narrow down in the database (case-insensitive name), then compare exactly here
        const candidates = await supabaseRestService.selectAll<AdvertiserProfileSummary>(
            TABLE,
            `select=id,business_name,location,category,video_url,review_notes,created_at` +
                `&business_name=ilike.${encodeURIComponent(likeLiteral(advertiser.business_name))}` +
                `&id=neq.${advertiser.id}&order=created_at.asc`,
        );
        const key = duplicateKey(advertiser);
        return candidates.filter((c) => duplicateKey(c) === key);
    }

    /**
     * Reads an .xlsx file and decides what would happen to each row, without saving.
     *
     * @param file - The uploaded workbook
     * @param sheetName - Tab to read; omitted, the tab whose headings best match is used
     * @returns The preview
     * @throws ImportFileError when the file can't be read
     */
    async preview(file: Buffer, sheetName?: string): Promise<AdvertiserImportPreview> {
        const { sheet, sheets, matchedColumns, rows } = await this.readWorkbook(file, sheetName);
        const existingKeys = await this.existingKeys();
        const seenInFile = new Map<string, number>();

        const classified = rows.map((row): AdvertiserImportRow => {
            if (row.status === 'invalid') {
                return row;
            }
            const key = duplicateKey(row.data);
            if (existingKeys.has(key)) {
                return {
                    ...row,
                    status: 'duplicate',
                    reason: 'Already in Advertiser Profile',
                    alreadySaved: true,
                };
            }
            const firstRow = seenInFile.get(key);
            if (firstRow !== undefined) {
                return { ...row, status: 'duplicate', reason: `Same as row ${firstRow}` };
            }
            seenInFile.set(key, row.rowNumber);
            return row;
        });

        return {
            sheetName: sheet,
            sheets,
            matchedColumns,
            rows: classified,
            counts: {
                new: classified.filter((r) => r.status === 'new').length,
                duplicate: classified.filter((r) => r.status === 'duplicate').length,
                invalid: classified.filter((r) => r.status === 'invalid').length,
            },
        };
    }

    /**
     * Imports an .xlsx file: re-reads it and inserts only the rows the preview marks new.
     *
     * @param file - The uploaded workbook
     * @param sheetName - Tab to read (the one shown in the preview)
     * @returns How many rows were inserted and skipped
     * @throws ImportFileError when the file can't be read
     */
    async import(
        file: Buffer,
        sheetName?: string,
        options: AdvertiserImportOptions = { includeDuplicates: false, includeInvalid: false },
    ): Promise<AdvertiserImportResult> {
        const preview = await this.preview(file, sheetName);

        // New rows always; duplicates within the file and problem rows only when asked.
        // Duplicates of advertisers already saved are never added again.
        const included = preview.rows.filter(
            (r) =>
                r.status === 'new' ||
                (r.status === 'duplicate' && options.includeDuplicates && !r.alreadySaved) ||
                (r.status === 'invalid' && options.includeInvalid),
        );
        // Included duplicates, by the row they repeat, so that first row is tagged too
        const copiesOf = new Map<number, number[]>();
        for (const r of included) {
            const firstRow = r.status === 'duplicate' ? sameAsRow(r) : null;
            if (firstRow !== null) {
                copiesOf.set(firstRow, [...(copiesOf.get(firstRow) ?? []), r.rowNumber]);
            }
        }

        const toInsert = included.map((r) => ({
            ...r.data,
            review_notes: reviewNotes(r, preview.sheetName, copiesOf.get(r.rowNumber) ?? []),
        }));
        const inserted = toInsert.length ? await supabaseRestService.insert(TABLE, toInsert) : 0;

        return {
            inserted,
            flaggedForReview: toInsert.filter((r) => r.review_notes).length,
            skippedDuplicates: preview.rows.filter(
                (r) => r.status === 'duplicate' && !included.includes(r),
            ).length,
            skippedInvalid: preview.rows.filter(
                (r) => r.status === 'invalid' && !included.includes(r),
            ).length,
        };
    }

    /**
     * Duplicate keys (business name + location) of every advertiser already saved.
     *
     * @returns The set of keys
     */
    private async existingKeys(): Promise<Set<string>> {
        const rows = await supabaseRestService.selectAll<
            Pick<AdvertiserProfile, 'business_name' | 'location'>
        >(TABLE, 'select=business_name,location');
        return new Set(rows.map(duplicateKey));
    }

    /**
     * Parses one worksheet: finds the heading row, maps headings to columns and
     * validates each data row.
     *
     * @param file - The uploaded workbook
     * @param sheetName - Tab to read; omitted, the tab whose headings best match is used
     * @returns Tab read, importable tabs, recognised columns and parsed rows (`new` or `invalid`)
     * @throws ImportFileError when the file can't be read
     */
    private async readWorkbook(
        file: Buffer,
        sheetName?: string,
    ): Promise<{
        sheet: string;
        sheets: AdvertiserImportPreview['sheets'];
        matchedColumns: AdvertiserImportPreview['matchedColumns'];
        rows: AdvertiserImportRow[];
    }> {
        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.load(file as unknown as ArrayBuffer);
        } catch {
            throw new ImportFileError(
                'This file could not be read. Upload an Excel workbook (.xlsx); for .xls or .csv, open it in Excel and save as .xlsx.',
            );
        }

        // Every tab with a "Business Name" heading can be imported
        const candidates = workbook.worksheets
            .map((ws) => ({ ws, header: findHeaderRow(ws) }))
            .filter((c): c is { ws: ExcelJS.Worksheet; header: HeaderRow } => c.header !== null);
        const sheets = candidates.map((c) => ({
            name: c.ws.name,
            matchedCount: Object.keys(c.header.indexes).length,
        }));

        if (!candidates.length) {
            throw new ImportFileError(
                `No tab in this workbook has a "Business Name" heading. Expected headings: ${Object.values(COLUMN_LABELS).join(', ')}.`,
            );
        }

        let chosen: (typeof candidates)[number] | undefined;
        if (sheetName) {
            chosen = candidates.find((c) => c.ws.name === sheetName);
            if (!chosen) {
                throw new ImportFileError(
                    workbook.getWorksheet(sheetName)
                        ? `Tab "${sheetName}" has no "Business Name" heading.`
                        : `This workbook has no tab named "${sheetName}".`,
                );
            }
        } else {
            // Best match: most recognised columns, then fewest other columns
            chosen = [...candidates].sort(
                (a, b) =>
                    Object.keys(b.header.indexes).length - Object.keys(a.header.indexes).length ||
                    a.header.headingCount - b.header.headingCount,
            )[0];
        }

        const sheet = chosen.ws;
        const headerRowNumber = chosen.header.rowNumber;
        const columnIndexes = chosen.header.indexes;
        const matchedColumns = chosen.header.labels;

        const rows: AdvertiserImportRow[] = [];
        for (let r = headerRowNumber + 1; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const raw = {} as RawRow;
            for (const column of Object.keys(HEADER_ALIASES) as ProfileColumn[]) {
                const index = columnIndexes[column];
                const value =
                    index === undefined
                        ? null
                        : cellText(row.getCell(index), URL_COLUMNS.has(column));
                raw[column] = value;
            }

            if (Object.values(raw).every((v) => v === null)) {
                continue; // blank row
            }
            if (rows.length >= MAX_IMPORT_ROWS) {
                throw new ImportFileError(
                    `The sheet has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files.`,
                );
            }
            rows.push(validateRow(r, raw));
        }

        if (!rows.length) {
            throw new ImportFileError(`Sheet "${sheet.name}" has headings but no rows.`);
        }
        return { sheet: sheet.name, sheets, matchedColumns, rows };
    }
}

/** A tab's heading row and the columns recognised in it. */
interface HeaderRow {
    rowNumber: number;
    indexes: Partial<Record<ProfileColumn, number>>;
    labels: Partial<Record<ProfileColumn, string>>;
    /** Headings in the row, recognised or not */
    headingCount: number;
}

/**
 * Finds a tab's heading row: the first of its top 10 rows with a "Business Name" heading.
 *
 * @param ws - Worksheet
 * @returns The heading row, or null when the tab has none
 */
function findHeaderRow(ws: ExcelJS.Worksheet): HeaderRow | null {
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const row = ws.getRow(r);
        const found = matchHeaders(row);
        if (found.indexes.business_name !== undefined) {
            return { rowNumber: r, ...found, headingCount: row.actualCellCount };
        }
    }
    return null;
}

/**
 * Matches a row's headings to table columns.
 *
 * @param row - Candidate heading row
 * @returns Column index and original heading for each recognised column
 */
function matchHeaders(row: ExcelJS.Row): {
    indexes: Partial<Record<ProfileColumn, number>>;
    labels: Partial<Record<ProfileColumn, string>>;
} {
    const indexes: Partial<Record<ProfileColumn, number>> = {};
    const labels: Partial<Record<ProfileColumn, string>> = {};

    row.eachCell((cell, colNumber) => {
        const heading = cellText(cell, false);
        if (!heading) {
            return;
        }
        const normalized = heading.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const column of Object.keys(HEADER_ALIASES) as ProfileColumn[]) {
            if (indexes[column] === undefined && HEADER_ALIASES[column].includes(normalized)) {
                indexes[column] = colNumber;
                labels[column] = heading;
                return;
            }
        }
    });
    return { indexes, labels };
}

/**
 * A cell's value as trimmed text, or null when empty.
 *
 * @param cell - Worksheet cell
 * @param preferLink - For link columns: use the hyperlink target over the shown text
 * @returns The text
 */
function cellText(cell: ExcelJS.Cell, preferLink: boolean): string | null {
    const value = cell.value;
    let text: string;

    if (value === null || value === undefined) {
        return null;
    } else if (typeof value === 'object' && 'hyperlink' in value && value.hyperlink) {
        const shown = typeof value.text === 'string' ? value.text : '';
        const shownHasLinks = /https?:\/\/|www\./i.test(shown);
        text =
            preferLink && !shownHasLinks
                ? String(value.hyperlink)
                : shown || String(value.hyperlink);
    } else if (typeof value === 'object' && 'richText' in value) {
        text = value.richText.map((part) => part.text).join('');
    } else if (typeof value === 'object' && 'result' in value) {
        text = value.result === undefined || value.result === null ? '' : String(value.result);
    } else if (value instanceof Date) {
        text = value.toISOString().slice(0, 10);
    } else {
        text = String(cell.text ?? value);
    }

    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed || null;
}

/**
 * Checks a row and tidies its web addresses.
 *
 * Only a missing Business Name keeps a row out. Problems in the other columns are
 * fixed or left out, and each change is noted so it shows in the preview:
 * - Social Media may list several links (";", ",", "|" or line breaks); each becomes its
 *   own entry, repeats are dropped, and anything that isn't a web address is left out.
 * - Website keeps the first address when a cell lists several ("a.com; b.com",
 *   "a.com & b.com"). Only ";", "|" and a spaced " & " / " and " separate addresses, so
 *   "&" inside a query string stays. Stray spaces inside an address are removed; a
 *   website that still isn't a web address is left empty.
 *
 * @param rowNumber - Row number in the sheet
 * @param raw - Cell text per column
 * @returns The row, marked `new` or `invalid`
 */
function validateRow(rowNumber: number, raw: RawRow): AdvertiserImportRow {
    const notes: string[] = [];

    // Social media: one entry per link
    const socialLinks: string[] = [];
    for (const part of raw.social_media?.split(/[;,\s|]+/).filter(Boolean) ?? []) {
        const url = normalizeUrl(part);
        if (!url) {
            notes.push(`${COLUMN_LABELS.social_media}: left out "${part}" (not a web address)`);
        } else if (!socialLinks.includes(url)) {
            socialLinks.push(url);
        }
    }

    // Website: the first address
    let website: string | null = null;
    if (raw.website) {
        const [first, ...others] = raw.website.split(/\s*[;|]\s*|\s+(?:&|and)\s+/i).filter(Boolean);
        website = normalizeUrl(first) ?? normalizeUrl(first.replace(/\s+/g, ''));
        if (!website) {
            notes.push(
                `${COLUMN_LABELS.website} left empty: "${raw.website}" is not a web address`,
            );
        } else if (others.length) {
            notes.push(
                `Other ${COLUMN_LABELS.website.toLowerCase()} not imported: ${others.join(', ')}`,
            );
        }
    }

    // Video: one address. File names can contain spaces ("..._FS_1 (1).webm"), so the
    // address is encoded rather than having its spaces removed.
    let videoUrl: string | null = null;
    if (raw.video_url) {
        const candidate = /^https?:\/\//i.test(raw.video_url)
            ? raw.video_url
            : `https://${raw.video_url}`;
        if (URL.canParse(candidate) && new URL(candidate).hostname.includes('.')) {
            videoUrl = new URL(candidate).href;
        } else {
            notes.push(
                `${COLUMN_LABELS.video_url} left empty: "${raw.video_url}" is not a web address`,
            );
        }
    }

    const data: AdvertiserProfileInput = {
        business_name: raw.business_name,
        location: raw.location,
        phone_number: raw.phone_number,
        category: raw.category,
        social_media: socialLinks.length ? socialLinks : null,
        website,
        video_url: videoUrl,
    };

    if (!raw.business_name) {
        return { rowNumber, status: 'invalid', reason: 'Business Name is empty', data };
    }
    return notes.length
        ? { rowNumber, status: 'new', data, notes }
        : { rowNumber, status: 'new', data };
}

/**
 * Turns "www.example.com" into "https://www.example.com" and checks it is a web address.
 *
 * @param value - One address, without spaces
 * @returns The full address, or null when it isn't one
 */
function normalizeUrl(value: string): string | null {
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    if (/\s/.test(url) || !URL.canParse(url) || !new URL(url).hostname.includes('.')) {
        return null;
    }
    return url;
}

/**
 * What needs attention in an imported row, saved as its review_notes (shown as the
 * "Needs Attention" tag). Both copies of a duplicate are tagged: the later row, and the
 * first row it repeats.
 *
 * @param row - The imported row
 * @param sheetName - Tab it came from
 * @param copies - Rows also imported that repeat this one
 * @returns The notes, or null when the row needs no attention
 */
function reviewNotes(
    row: AdvertiserImportRow,
    sheetName: string,
    copies: number[],
): string[] | null {
    const notes: string[] = [];
    if (row.status === 'invalid' && row.reason) {
        notes.push(row.reason);
    }
    const firstRow = row.status === 'duplicate' ? sameAsRow(row) : null;
    if (firstRow !== null) {
        notes.push(
            `Possible duplicate: same business name and location as row ${firstRow} of sheet "${sheetName}", also imported`,
        );
    }
    if (copies.length) {
        const rows = copies.length === 1 ? `row ${copies[0]}` : `rows ${copies.join(', ')}`;
        notes.push(
            `Possible duplicate: ${rows} of sheet "${sheetName}" ${copies.length === 1 ? 'has' : 'have'} the same business name and location, also imported`,
        );
    }
    notes.push(...(row.notes ?? []));
    return notes.length ? notes : null;
}

/**
 * The earlier sheet row a duplicate repeats (from its reason, "Same as row 8").
 *
 * @param row - A duplicate row
 * @returns The row number, or null for duplicates of advertisers already saved
 */
function sameAsRow(row: AdvertiserImportRow): number | null {
    const match = row.reason?.match(/^Same as row (\d+)$/);
    return match ? Number(match[1]) : null;
}

/**
 * Escapes a value for a PostgREST ilike filter, so it matches literally: LIKE wildcards
 * (% _ *) and backslashes are escaped, and the value is quoted for reserved characters
 * such as commas and parentheses.
 *
 * @param value - Text to match
 * @returns The filter value, ready for encodeURIComponent
 */
function likeLiteral(value: string): string {
    const escaped = value.replace(/[\\%_*]/g, (c) => `\\${c}`);
    return `"${escaped.replace(/"/g, '\\"')}"`;
}

/**
 * Key used to spot the same business twice: name and location, ignoring case and spacing.
 *
 * @param row - Business name and location
 * @returns The key
 */
function duplicateKey(row: Pick<AdvertiserProfileInput, 'business_name' | 'location'>): string {
    const norm = (v: string | null): string => (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    return `${norm(row.business_name)}|${norm(row.location)}`;
}

export const advertiserProfilesService = new AdvertiserProfilesService();

/**
 * Whether any list filter is set.
 *
 * @param filters - List filters
 * @returns {boolean}
 */
function hasFilters(filters: AdvertiserListFilters): boolean {
    return Boolean(filters.search || filters.group || filters.state || filters.attention);
}

/**
 * Whether a profile matches the list filters.
 *
 * @param row - The profile
 * @param filters - Search text (any detail contains it, ignoring case), category group,
 *   state code ("none" for profiles without one) and Needs Attention
 * @returns {boolean}
 */
function matchesFilters(row: AdvertiserProfile, filters: AdvertiserListFilters): boolean {
    if (filters.attention && !row.review_notes?.length) {
        return false;
    }
    if (filters.group && categoryGroup(row.category) !== filters.group) {
        return false;
    }
    if (filters.state) {
        const state = stateFromLocation(row.location);
        if (filters.state === 'none' ? state !== null : state !== filters.state) {
            return false;
        }
    }
    if (filters.search) {
        const needle = filters.search.toLowerCase();
        const haystack = [
            row.business_name,
            row.category,
            row.location,
            row.phone_number,
            row.website,
            ...(row.social_media ?? []),
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        if (!haystack.includes(needle)) {
            return false;
        }
    }
    return true;
}
