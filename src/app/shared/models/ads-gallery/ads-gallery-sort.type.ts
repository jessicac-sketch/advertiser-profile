/**
 * Order of the Ads Gallery.
 *
 * - `plays`: all-time play count (counted in Postgres)
 * - `newest`: when the media file was added (default)
 * - `duration`: the creative's length; files without one go last
 */
export type AdsGallerySort = 'plays' | 'newest' | 'duration';
