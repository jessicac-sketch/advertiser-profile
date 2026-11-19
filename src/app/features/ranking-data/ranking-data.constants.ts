import type {
    CategoryRankingEntry,
    DashboardTopAd,
    HostRankingEntry,
    PlayRecordContent,
    StateRankingEntry,
} from '@core';
import { formatExportDateTime, formatExportYesNo, formatPopDuration } from '@shared';

/** CSV column definition: a spreadsheet header paired with the record property it reads. */
export interface DashboardExportColumn<T> {
    /** Spreadsheet header label. */
    header: string;

    /** Property read from a record. */
    key: keyof T;

    /**
     * Formats the cell value instead of using the raw property - for columns
     * the Ranking Data table itself displays as something other than the raw
     * value, so the export reads identically to what's on screen.
     */
    format?: (row: T) => string;
}

/**
 * Builds the Programmatic Ads fields included in its CSV export, in order -
 * matching exactly what Ranking Data's Programmatic Ads table itself shows,
 * including its timestamps in the same zone the table was viewed in.
 *
 * @param timeZone - IANA timezone identifier (or "UTC") - TimeDisplayService.zoneId()
 */
export function buildDashboardExportColumns(
    timeZone: string,
): readonly DashboardExportColumn<PlayRecordContent>[] {
    return [
        { header: 'Creative', key: 'mediaUrl' },
        { header: 'Screenshot', key: 'popScreenshot' },
        { header: 'Creative ID', key: 'creativeId' },
        { header: 'Creative Source', key: 'creativeSource' },
        { header: 'Venue ID', key: 'venueId' },
        { header: 'Device ID', key: 'deviceId' },
        {
            header: 'Fetched At',
            key: 'fetchedAt',
            format: (row) => formatExportDateTime(row.fetchedAt, timeZone),
        },
        {
            header: 'Proof of Play Sent',
            key: 'proofOfPlaySent',
            format: (row) => formatExportDateTime(row.proofOfPlaySent, timeZone),
        },
        {
            header: 'POP Duration',
            key: 'popDurationMinutes',
            format: (row) => formatPopDuration(row.popDurationMinutes),
        },
        { header: 'Served', key: 'served', format: (row) => formatExportYesNo(row.served) },
        {
            header: 'Date Served',
            key: 'dateServed',
            format: (row) => formatExportDateTime(row.dateServed, timeZone),
        },
    ];
}

/**
 * Builds the Ad Ranking fields included in its CSV export, matching the
 * table exactly, including its timestamp in the same zone the table was
 * viewed in.
 *
 * @param timeZone - IANA timezone identifier (or "UTC") - TimeDisplayService.zoneId()
 */
export function buildAdRankingExportColumns(
    timeZone: string,
): readonly DashboardExportColumn<DashboardTopAd>[] {
    return [
        { header: 'Creative', key: 'creativeUrl' },
        { header: 'Content ID', key: 'contentId' },
        { header: 'Filename', key: 'title' },
        { header: 'Location', key: 'location' },
        { header: 'Play Count', key: 'plays' },
        { header: 'Source', key: 'source' },
        {
            header: 'Date Created',
            key: 'fetchedDate',
            format: (row) => formatExportDateTime(row.fetchedDate, timeZone),
        },
    ];
}

/** Venue Ranking fields included in its CSV export, matching the table exactly. */
export const VENUE_RANKING_EXPORT_COLUMNS: readonly DashboardExportColumn<HostRankingEntry>[] = [
    { header: 'Latest Play Screenshot', key: 'screenshotUrl' },
    { header: 'Venue ID', key: 'venueId' },
    { header: 'Host Business Name', key: 'hostName' },
    { header: 'City', key: 'city' },
    { header: 'State', key: 'state' },
    { header: 'Category', key: 'category' },
    { header: 'Business Hours', key: 'businessHoursSchedule' },
    { header: 'Total Ads', key: 'totalAds' },
    { header: 'Slot Count', key: 'slotCount' },
    { header: 'Expected Reqs', key: 'expectedRequests' },
];

/**
 * State Ranking fields included in its CSV export, in order - matching what the State
 * Ranking table shows (and its XLSX export).
 */
export const STATE_RANKING_EXPORT_COLUMNS: readonly DashboardExportColumn<StateRankingEntry>[] = [
    { header: 'State', key: 'state' },
    { header: 'Venue Count', key: 'venueCount' },
    { header: 'Total Ads', key: 'totalAds' },
    { header: 'Unique Ads Played', key: 'uniqueAdsPlayed' },
];

/**
 * Category Ranking fields included in its CSV export, in order - matching what the
 * Category Ranking table shows (and its XLSX export).
 */
export const CATEGORY_RANKING_EXPORT_COLUMNS: readonly DashboardExportColumn<CategoryRankingEntry>[] =
    [
        { header: 'Category', key: 'category' },
        { header: 'Venue Count', key: 'venueCount' },
        { header: 'Total Ads', key: 'totalAds' },
        { header: 'Unique Ads Played', key: 'uniqueAdsPlayed' },
    ];
