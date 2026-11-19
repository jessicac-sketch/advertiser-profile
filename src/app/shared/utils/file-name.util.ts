/**
 * The file name at the end of a web address, decoded for display.
 *
 * @param url - Full address, e.g. "https://bucket.s3.amazonaws.com/abc_FS_1%20(1).webm"
 * @returns The file name ("abc_FS_1 (1).webm"), or the address when it has none
 */
export function fileNameOf(url: string): string {
    try {
        const last = new URL(url).pathname.split('/').filter(Boolean).pop();
        return last ? decodeURIComponent(last) : url;
    } catch {
        return url;
    }
}
