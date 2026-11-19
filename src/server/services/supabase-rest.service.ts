/** Local Imports */
import { SUPABASE_CONFIG } from '../config/environment.config.js';

/** Supabase caps a single REST response at 1000 rows by default. */
const PAGE_SIZE = 1000;

/**
 * Thrown when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.
 */
export class DatabaseNotConfiguredError extends Error {
    constructor() {
        super('Database is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
        this.name = 'DatabaseNotConfiguredError';
    }
}

/**
 * Minimal client for Supabase's REST API (PostgREST), using the server's secret key.
 *
 * @remarks
 * Uses fetch rather than @supabase/supabase-js to keep the BFF free of another
 * dependency; it only needs select-all and bulk insert.
 */
export class SupabaseRestService {
    /**
     * Whether the database settings are present.
     *
     * @returns {boolean}
     */
    isConfigured(): boolean {
        return Boolean(SUPABASE_CONFIG.URL && SUPABASE_CONFIG.SERVICE_ROLE_KEY);
    }

    /**
     * Reads every row of a table, following pages past the 1000-row response cap.
     *
     * @param table - Table name in the public schema
     * @param query - PostgREST query string, e.g. "select=*&order=business_name.asc"
     * @returns All matching rows
     */
    async selectAll<T>(table: string, query: string): Promise<T[]> {
        const rows: T[] = [];
        for (let from = 0; ; from += PAGE_SIZE) {
            const page = await this.request<T[]>(`${table}?${query}`, {
                method: 'GET',
                headers: { Range: `${from}-${from + PAGE_SIZE - 1}`, 'Range-Unit': 'items' },
            });
            rows.push(...page);
            if (page.length < PAGE_SIZE) {
                return rows;
            }
        }
    }

    /**
     * Reads one page of a table, with the total number of matching rows.
     *
     * @param table - Table name in the public schema
     * @param query - PostgREST query string, e.g. "select=*&order=business_name.asc"
     * @param offset - Rows to skip
     * @param limit - Rows to return (at most 1000)
     * @returns The page's rows and the total count
     */
    async selectPage<T>(
        table: string,
        query: string,
        offset: number,
        limit: number,
    ): Promise<{ rows: T[]; total: number }> {
        const { body, status, headers } = await this.requestWithHeaders<T[]>(
            `${table}?${query}`,
            {
                method: 'GET',
                headers: {
                    Range: `${offset}-${offset + limit - 1}`,
                    'Range-Unit': 'items',
                    Prefer: 'count=exact',
                },
            },
            [416], // a page past the end: no rows, but the total is still in Content-Range
        );
        // Content-Range: "0-19/2550", or "*/2550" when the page is empty
        const total = Number(headers.get('content-range')?.split('/')[1]);
        return {
            rows: status === 416 ? [] : (body ?? []),
            total: Number.isFinite(total) ? total : 0,
        };
    }

    /**
     * Inserts rows in batches.
     *
     * @param table - Table name in the public schema
     * @param rows - Rows to insert
     * @param batchSize - Rows per request
     * @returns Number of rows inserted
     */
    async insert<T extends object>(table: string, rows: T[], batchSize = 500): Promise<number> {
        let inserted = 0;
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            await this.request<void>(table, {
                method: 'POST',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify(batch),
            });
            inserted += batch.length;
        }
        return inserted;
    }

    /**
     * Sends one request to the REST API.
     *
     * @param path - Path after /rest/v1/, including any query string
     * @param init - fetch options
     * @returns Parsed JSON body (undefined for empty responses)
     * @throws DatabaseNotConfiguredError, or Error with Supabase's message on failure
     */
    private async request<T>(path: string, init: RequestInit): Promise<T> {
        return (await this.requestWithHeaders<T>(path, init)).body;
    }

    /**
     * Sends one request to the REST API and keeps the response headers.
     *
     * @param path - Path after /rest/v1/, including any query string
     * @param init - fetch options
     * @param allowStatus - Error statuses to return instead of throwing (e.g. 416)
     * @returns Parsed JSON body (undefined for empty responses), status and headers
     * @throws DatabaseNotConfiguredError, or Error with Supabase's message on failure
     */
    private async requestWithHeaders<T>(
        path: string,
        init: RequestInit,
        allowStatus: number[] = [],
    ): Promise<{ body: T; status: number; headers: Headers }> {
        if (!this.isConfigured()) {
            throw new DatabaseNotConfiguredError();
        }

        const key = SUPABASE_CONFIG.SERVICE_ROLE_KEY;
        const headers: Record<string, string> = {
            apikey: key,
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string>),
        };
        // Legacy service_role keys are JWTs and go in Authorization too; the newer
        // sb_secret_ keys must only be sent as `apikey`.
        if (key.startsWith('eyJ')) {
            headers['Authorization'] = `Bearer ${key}`;
        }

        const response = await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/${path}`, {
            ...init,
            headers,
            signal: AbortSignal.timeout(30000),
        });

        const text = await response.text();
        if (allowStatus.includes(response.status)) {
            return { body: undefined as T, status: response.status, headers: response.headers };
        }
        if (!response.ok) {
            let message = text;
            try {
                const body = JSON.parse(text) as { message?: string };
                message = body.message || text;
            } catch {
                // Not JSON: keep the raw text
            }
            throw new Error(`Supabase ${response.status}: ${message}`);
        }
        return {
            body: (text ? JSON.parse(text) : undefined) as T,
            status: response.status,
            headers: response.headers,
        };
    }
}

export const supabaseRestService = new SupabaseRestService();
