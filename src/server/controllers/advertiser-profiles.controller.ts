/** Third Party Imports */
import type { Request, Response } from 'express';

/** Local Imports */
import { advertiserDashboardService } from '../services/advertiser-dashboard.service.js';
import {
    advertiserProfilesService,
    ImportFileError,
} from '../services/advertiser-profiles.service.js';
import { DatabaseNotConfiguredError } from '../services/supabase-rest.service.js';

/**
 * Controller for advertiser profile endpoints.
 */
export class AdvertiserProfilesController {
    /**
     * Handles GET /api/advertiser-profiles
     * Lists one page of advertisers.
     *
     * @param req - Express request; query `page` (from 1, default 1), `pageSize` (default 20, max 100)
     *   and optional filters `search`, `group`, `state` (code or "none") and `attention=true`
     * @param res - Express response
     * @returns Promise<void>
     */
    async list(req: Request, res: Response): Promise<void> {
        const page = Math.max(1, Math.floor(Number(req.query['page'])) || 1);
        const pageSize = Math.min(
            100,
            Math.max(1, Math.floor(Number(req.query['pageSize'])) || 20),
        );
        const text = (key: string): string | undefined => {
            const value = req.query[key];
            return typeof value === 'string' && value.trim()
                ? value.trim().slice(0, 200)
                : undefined;
        };
        const state = text('state')?.toUpperCase();
        const filters = {
            search: text('search'),
            group: text('group'),
            state:
                state === 'NONE' ? 'none' : state && /^[A-Z]{2}$/.test(state) ? state : undefined,
            attention: req.query['attention'] === 'true',
        };
        try {
            res.json({ data: await advertiserProfilesService.list(page, pageSize, filters) });
        } catch (error) {
            this.sendError(res, error, 'Unable to load advertisers.');
        }
    }

    /**
     * Handles GET /api/advertiser-profiles/dashboard
     * Figures for the Dashboard page: totals, advertisers by state and category group,
     * top category names, and what needs attention.
     *
     * @param _req - Express request
     * @param res - Express response
     * @returns Promise<void>
     */
    async dashboard(_req: Request, res: Response): Promise<void> {
        try {
            res.json({ data: await advertiserDashboardService.summary() });
        } catch (error) {
            this.sendError(res, error, 'Unable to load the dashboard.');
        }
    }

    /**
     * Handles GET /api/advertiser-profiles/:id
     * Reads one advertiser.
     *
     * @param req - Express request with the advertiser id
     * @param res - Express response
     * @returns Promise<void>
     */
    async get(req: Request, res: Response): Promise<void> {
        try {
            const advertiser = await advertiserProfilesService.get(String(req.params['id']));
            if (!advertiser) {
                res.status(404).json({
                    error: 'not_found',
                    errorDescription: 'This advertiser does not exist or was removed.',
                });
                return;
            }
            res.json({ data: advertiser });
        } catch (error) {
            this.sendError(res, error, 'Unable to load the advertiser.');
        }
    }

    /**
     * Handles POST /api/advertiser-profiles/import/preview
     * Reads an uploaded .xlsx (raw request body) and reports what each row would do.
     *
     * @param req - Express request with the workbook as an application/octet-stream body
     * @param res - Express response
     * @returns Promise<void>
     */
    async previewImport(req: Request, res: Response): Promise<void> {
        const file = this.readFile(req, res);
        if (!file) {
            return;
        }
        try {
            res.json({ data: await advertiserProfilesService.preview(file, this.sheetParam(req)) });
        } catch (error) {
            this.sendError(res, error, 'Unable to read the file.');
        }
    }

    /**
     * Handles POST /api/advertiser-profiles/import
     * Imports an uploaded .xlsx: adds the new rows, and duplicates / problem rows when the
     * includeDuplicates / includeInvalid query parameters are "true" (tagged Needs Attention).
     *
     * @param req - Express request with the workbook as an application/octet-stream body
     * @param res - Express response
     * @returns Promise<void>
     */
    async import(req: Request, res: Response): Promise<void> {
        const file = this.readFile(req, res);
        if (!file) {
            return;
        }
        try {
            res.json({
                data: await advertiserProfilesService.import(file, this.sheetParam(req), {
                    includeDuplicates: req.query['includeDuplicates'] === 'true',
                    includeInvalid: req.query['includeInvalid'] === 'true',
                }),
            });
        } catch (error) {
            this.sendError(res, error, 'Unable to import the file.');
        }
    }

    /**
     * The tab to import, from the `sheet` query parameter.
     *
     * @param req - Express request
     * @returns The tab name, or undefined to pick the best match
     */
    private sheetParam(req: Request): string | undefined {
        const sheet = req.query['sheet'];
        return typeof sheet === 'string' && sheet.trim() ? sheet : undefined;
    }

    /**
     * Returns the uploaded file, or answers 400 when there is none.
     *
     * @param req - Express request
     * @param res - Express response
     * @returns The file bytes, or null
     */
    private readFile(req: Request, res: Response): Buffer | null {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            res.status(400).json({
                error: 'invalid_request',
                errorDescription: 'Upload an .xlsx file as the request body.',
            });
            return null;
        }
        return req.body;
    }

    /**
     * Sends an error response: file problems as 400, missing database settings as 503.
     *
     * @param res - Express response
     * @param error - What went wrong
     * @param fallback - Message for unexpected errors
     * @returns void
     */
    private sendError(res: Response, error: unknown, fallback: string): void {
        if (error instanceof ImportFileError) {
            res.status(400).json({ error: 'invalid_file', errorDescription: error.message });
            return;
        }
        if (error instanceof DatabaseNotConfiguredError) {
            res.status(503).json({
                error: 'database_not_configured',
                errorDescription: error.message,
            });
            return;
        }
        console.error('[AdvertiserProfiles]', error);
        res.status(500).json({ error: 'internal_error', errorDescription: fallback });
    }
}

export const advertiserProfilesController = new AdvertiserProfilesController();
