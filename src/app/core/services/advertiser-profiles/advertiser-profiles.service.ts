/** Angular Imports */
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

/** Third Party Imports */
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Local Imports */
import type {
    AdvertiserDashboard,
    AdvertiserImportOptions,
    AdvertiserImportPreview,
    AdvertiserImportResult,
    AdvertiserListFilters,
    AdvertiserProfile,
    AdvertiserProfileDetail,
    AdvertiserProfilePage,
} from '@core/models';

/** The workbook is sent as the raw request body. */
const FILE_HEADERS = new HttpHeaders({ 'Content-Type': 'application/octet-stream' });

/**
 * Query parameters naming the tab to import, if any.
 *
 * @param sheet - Tab name
 * @returns {HttpParams}
 */
function sheetParams(sheet?: string): HttpParams {
    return sheet ? new HttpParams().set('sheet', sheet) : new HttpParams();
}

/**
 * Advertiser profiles API: list, and import from an Excel workbook.
 */
@Injectable({ providedIn: 'root' })
export class AdvertiserProfilesService {
    /**
     * HTTP client
     * @type {HttpClient}
     */
    private readonly http = inject(HttpClient);

    /**
     * BFF base path
     * @type {string}
     */
    private readonly apiUrl = '/api/advertiser-profiles';

    /**
     * Lists one page of advertisers, by business name, with the total count of matches.
     *
     * @param page - Page number, from 1
     * @param pageSize - Advertisers per page (at most 100)
     * @param filters - Search text, category group, state and Needs Attention (optional)
     * @returns {Observable<AdvertiserProfilePage>}
     */
    list(
        page: number,
        pageSize: number,
        filters: AdvertiserListFilters = {},
    ): Observable<AdvertiserProfilePage> {
        let params = new HttpParams().set('page', page).set('pageSize', pageSize);
        if (filters.search) params = params.set('search', filters.search);
        if (filters.group) params = params.set('group', filters.group);
        if (filters.state) params = params.set('state', filters.state);
        if (filters.attention) params = params.set('attention', 'true');
        return this.http
            .get<{ data: AdvertiserProfilePage }>(this.apiUrl, { params })
            .pipe(map((response) => response.data));
    }

    /**
     * Figures for the Dashboard page: totals, advertisers by state and category group,
     * top category names, and what needs attention.
     *
     * @returns {Observable<AdvertiserDashboard>}
     */
    dashboard(): Observable<AdvertiserDashboard> {
        return this.http
            .get<{ data: AdvertiserDashboard }>(`${this.apiUrl}/dashboard`)
            .pipe(map((response) => response.data));
    }

    /**
     * Reads one advertiser, with the profiles that may be duplicates of it.
     *
     * @param id - Advertiser id
     * @returns {Observable<AdvertiserProfileDetail>}
     */
    get(id: string): Observable<AdvertiserProfileDetail> {
        return this.http
            .get<{ data: AdvertiserProfileDetail }>(`${this.apiUrl}/${encodeURIComponent(id)}`)
            .pipe(map((response) => response.data));
    }

    /**
     * Reads a workbook and reports what each row would do. Saves nothing.
     *
     * @param file - The .xlsx file
     * @param sheet - Tab to read; omitted, the server picks the best-matching tab
     * @returns {Observable<AdvertiserImportPreview>}
     */
    previewImport(file: File, sheet?: string): Observable<AdvertiserImportPreview> {
        return this.http
            .post<{ data: AdvertiserImportPreview }>(`${this.apiUrl}/import/preview`, file, {
                headers: FILE_HEADERS,
                params: sheetParams(sheet),
            })
            .pipe(map((response) => response.data));
    }

    /**
     * Imports a workbook: adds the new rows, plus duplicates and problem rows when asked.
     *
     * @param file - The same .xlsx file that was previewed
     * @param sheet - The tab shown in the preview
     * @param options - Also import duplicates / problem rows (tagged Needs Attention)
     * @returns {Observable<AdvertiserImportResult>}
     */
    import(
        file: File,
        sheet?: string,
        options: AdvertiserImportOptions = { includeDuplicates: false, includeInvalid: false },
    ): Observable<AdvertiserImportResult> {
        return this.http
            .post<{ data: AdvertiserImportResult }>(`${this.apiUrl}/import`, file, {
                headers: FILE_HEADERS,
                params: sheetParams(sheet)
                    .set('includeDuplicates', String(options.includeDuplicates))
                    .set('includeInvalid', String(options.includeInvalid)),
            })
            .pipe(map((response) => response.data));
    }

    /**
     * Turns a failed request into a message for the user.
     *
     * @param error - What the request failed with
     * @param fallback - Message when the server gave none
     * @returns {string}
     */
    static errorMessage(error: unknown, fallback: string): string {
        if (error instanceof HttpErrorResponse) {
            if (error.status === 413) {
                return 'The file is too large. Files up to 10 MB can be imported.';
            }
            const description = (error.error as { errorDescription?: string } | null)
                ?.errorDescription;
            if (description) {
                return description;
            }
        }
        return fallback;
    }
}
