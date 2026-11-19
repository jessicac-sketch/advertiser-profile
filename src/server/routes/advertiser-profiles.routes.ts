/** Third Party Imports */
import express, { type Router } from 'express';

/** Local Imports */
import { advertiserProfilesController } from '../controllers/advertiser-profiles.controller.js';

/**
 * Router for advertiser profile endpoints.
 */
const router: Router = express.Router();

/** The uploaded workbook arrives as the raw request body. */
const xlsxBody = express.raw({ type: 'application/octet-stream', limit: '10mb' });

/**
 * GET /api/advertiser-profiles
 * Lists one page of advertisers, by business name, with the total count.
 *
 * @query page - Page number, from 1 (default 1)
 * @query pageSize - Advertisers per page (default 20, max 100)
 * @query search - Text any detail contains (optional)
 * @query group - Category group, e.g. "Home services" (optional)
 * @query state - Two-letter state code, or "none" (optional)
 * @query attention - "true" for Needs Attention profiles only (optional)
 */
router.get('/', (req, res) => advertiserProfilesController.list(req, res));

/**
 * POST /api/advertiser-profiles/import/preview
 * Reads an .xlsx and reports which rows are new, duplicates or invalid. Saves nothing.
 *
 * @query sheet - Tab to read (optional; the best-matching tab otherwise)
 * @body The .xlsx file (Content-Type: application/octet-stream)
 */
router.post('/import/preview', xlsxBody, (req, res) =>
    advertiserProfilesController.previewImport(req, res),
);

/**
 * POST /api/advertiser-profiles/import
 * Imports an .xlsx: inserts the new rows; duplicates within the file and rows with problems
 * only when asked (they are saved with review notes). Rows already saved are never re-added.
 *
 * @query sheet - Tab to read (the one shown in the preview)
 * @query includeDuplicates - "true" to also import duplicates within the file
 * @query includeInvalid - "true" to also import rows with problems
 * @body The .xlsx file (Content-Type: application/octet-stream)
 */
router.post('/import', xlsxBody, (req, res) => advertiserProfilesController.import(req, res));

/**
 * GET /api/advertiser-profiles/dashboard
 * Figures for the Dashboard page. Registered before /:id, which would otherwise match it.
 */
router.get('/dashboard', (req, res) => advertiserProfilesController.dashboard(req, res));

/**
 * GET /api/advertiser-profiles/:id
 * Reads one advertiser. Registered after the /import and /dashboard routes.
 */
router.get('/:id', (req, res) => advertiserProfilesController.get(req, res));

export default router;
