/**
 * A social media link with the platform and account worked out from its address.
 */
export interface SocialLink {
    /** Full address */
    url: string;
    /** Platform name, e.g. "Facebook"; "Website" when the host isn't a known platform */
    platform: string;
    /**
     * Short label drawn in the badge, e.g. "f", "IG", "in"; empty for unknown hosts,
     * which show a globe icon instead. (The Font Awesome kit has no brand icons.)
     */
    abbr: string;
    /** Badge background: the platform's brand color (white text stays readable on it) */
    color: string;
    /** Account shown to the user, e.g. "knobleengineering1", or the host for unknown links */
    handle: string;
}

/** Known platforms by host (without "www." / "m."). */
const PLATFORMS: readonly {
    hosts: string[];
    platform: string;
    abbr: string;
    color: string;
}[] = [
    {
        hosts: ['facebook.com', 'fb.com', 'fb.me'],
        platform: 'Facebook',
        abbr: 'f',
        color: '#1877f2',
    },
    { hosts: ['instagram.com', 'instagr.am'], platform: 'Instagram', abbr: 'IG', color: '#c13584' },
    { hosts: ['linkedin.com', 'lnkd.in'], platform: 'LinkedIn', abbr: 'in', color: '#0a66c2' },
    { hosts: ['x.com', 'twitter.com'], platform: 'X', abbr: 'X', color: '#000000' },
    { hosts: ['tiktok.com'], platform: 'TikTok', abbr: 'TT', color: '#000000' },
    { hosts: ['youtube.com', 'youtu.be'], platform: 'YouTube', abbr: 'YT', color: '#cc0000' },
    { hosts: ['pinterest.com', 'pin.it'], platform: 'Pinterest', abbr: 'P', color: '#bd081c' },
    { hosts: ['yelp.com'], platform: 'Yelp', abbr: 'Y', color: '#c41200' },
    { hosts: ['threads.net', 'threads.com'], platform: 'Threads', abbr: '@', color: '#000000' },
];

/** Badge color for links to other sites (deep teal, the brand identity color). */
const OTHER_COLOR = '#0f4c5c';

/** First path segments that are not the account name ("linkedin.com/company/<name>"). */
const PATH_PREFIXES = new Set([
    'company',
    'in',
    'school',
    'showcase',
    'pages',
    'pg',
    'people',
    'c',
    'user',
    'channel',
    'biz',
]);

/**
 * Works out a social media link's platform and account name.
 *
 * @param url - Full address, e.g. "https://www.linkedin.com/company/knoble-engineering"
 * @returns The link with platform, badge and handle (e.g. LinkedIn, "in", "knoble-engineering")
 */
export function describeSocialLink(url: string): SocialLink {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { url, platform: 'Link', abbr: '', color: OTHER_COLOR, handle: url };
    }

    const host = parsed.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
    const known = PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    if (!known) {
        return { url, platform: 'Website', abbr: '', color: OTHER_COLOR, handle: host };
    }

    const segments = parsed.pathname.split('/').filter(Boolean).map(safeDecode);
    // Posts and reels ("instagram.com/p/<id>") don't name the account
    const isPost = ['p', 'reel', 'reels', 'posts', 'watch', 'status', 'video', 'videos'].includes(
        segments[0]?.toLowerCase() ?? '',
    );
    let handle = isPost ? 'Post' : (segments[0] ?? host);
    if (!isPost && PATH_PREFIXES.has(handle.toLowerCase()) && segments[1]) {
        handle = segments[1];
    }
    if (known.platform === 'Facebook' && handle === 'profile.php') {
        handle = 'Profile';
    }

    return { url, platform: known.platform, abbr: known.abbr, color: known.color, handle };
}

/**
 * Decodes a path segment, keeping it as is when it isn't valid percent-encoding.
 *
 * @param segment - Path segment
 * @returns The decoded segment
 */
function safeDecode(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}
