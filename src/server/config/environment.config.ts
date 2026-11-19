/** Node Imports */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine which .env file to load based on NODE_ENV
const nodeEnv = process.env['NODE_ENV'] || 'development';
const envFile = nodeEnv === 'development' ? '.env.dev' : '.env.production';
const envPath = path.resolve(__dirname, '../../../', envFile);

// Load environment variables from the appropriate .env file
const result = config({ path: envPath });

if (result.error) {
    console.warn(
        `[Config] Warning: Could not load ${envFile}. Using environment variables from shell.`,
    );
} else {
    console.log(`[Config] Loaded environment from: ${envFile} (NODE_ENV=${nodeEnv})`);
}

/**
 * Environment configuration for BFF layer.
 * Centralizes all environment-dependent settings.
 *
 * @remarks
 * All configuration values are loaded from environment variables.
 * Required variables will throw an error if not set.
 */

/**
 * Validates that a required environment variable is set.
 *
 * @param key - Environment variable name
 * @param value - Environment variable value
 * @throws Error if value is undefined or empty
 * @returns The validated value
 */
function requireEnv(key: string, value: string | undefined): string {
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

/**
 * API configuration for backend communication.
 */
export const API_CONFIG = {
    /** Base URL for backend API */
    BASE_URL: process.env['API_BASE_URL'] || 'https://api.example.com',

    /** Timeout for API calls in milliseconds */
    TIMEOUT: parseInt(process.env['API_TIMEOUT'] || '30000', 10),
} as const;

/**
 * Server configuration
 */
export const SERVER_CONFIG = {
    /** Port the server listens on */
    PORT: parseInt(process.env['PORT'] || '4000', 10),

    /** Node environment */
    NODE_ENV: process.env['NODE_ENV'] || 'development',

    /** Enable request logging */
    ENABLE_LOGGING: process.env['ENABLE_LOGGING'] === 'true',
} as const;

/**
 * Sign-in configuration.
 *
 * @remarks
 * The template ships with a single demo account so it runs with no external services.
 * Replace `authController`/`requireAuth` with your identity provider for a real project
 * (see docs/AUTHENTICATION.md).
 */
export const AUTH_CONFIG = {
    /** Email of the demo account */
    DEMO_EMAIL: process.env['DEMO_EMAIL'] || 'demo@example.com',

    /** Password of the demo account */
    DEMO_PASSWORD: process.env['DEMO_PASSWORD'] || 'demo1234',

    /**
     * Secret used to sign the session cookie. Required in production; development falls
     * back to a fixed value so the template runs without a .env file.
     */
    SESSION_SECRET:
        SERVER_CONFIG.NODE_ENV === 'production'
            ? requireEnv('SESSION_SECRET', process.env['SESSION_SECRET'])
            : process.env['SESSION_SECRET'] || 'dev-only-session-secret-change-me',

    /** How long a session lasts, in hours */
    SESSION_TTL_HOURS: parseInt(process.env['SESSION_TTL_HOURS'] || '12', 10),
} as const;

/**
 * Supabase (Postgres) configuration, used for the advertiser profiles table.
 *
 * @remarks
 * The BFF talks to Supabase's REST API with the secret / service role key, which
 * bypasses row level security - so the key must never reach the browser. Both are
 * optional at startup; endpoints that need the database answer 503 until they are set.
 */
export const SUPABASE_CONFIG = {
    /** Project URL, e.g. https://<project-ref>.supabase.co */
    URL: (process.env['SUPABASE_URL'] || '').replace(/\/+$/, ''),

    /** Secret key (sb_secret_...) or legacy service_role JWT */
    SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'] || '',
} as const;
