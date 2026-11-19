/** Two-letter codes of the 50 states and DC. */
const STATE_CODES = new Set(
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(
        ' ',
    ),
);

/** Full state names (lower case) to their codes. */
const STATE_NAMES: Readonly<Record<string, string>> = {
    alabama: 'AL',
    alaska: 'AK',
    arizona: 'AZ',
    arkansas: 'AR',
    california: 'CA',
    colorado: 'CO',
    connecticut: 'CT',
    delaware: 'DE',
    florida: 'FL',
    georgia: 'GA',
    hawaii: 'HI',
    idaho: 'ID',
    illinois: 'IL',
    indiana: 'IN',
    iowa: 'IA',
    kansas: 'KS',
    kentucky: 'KY',
    louisiana: 'LA',
    maine: 'ME',
    maryland: 'MD',
    massachusetts: 'MA',
    michigan: 'MI',
    minnesota: 'MN',
    mississippi: 'MS',
    missouri: 'MO',
    montana: 'MT',
    nebraska: 'NE',
    nevada: 'NV',
    'new hampshire': 'NH',
    'new jersey': 'NJ',
    'new mexico': 'NM',
    'new york': 'NY',
    'north carolina': 'NC',
    'north dakota': 'ND',
    ohio: 'OH',
    oklahoma: 'OK',
    oregon: 'OR',
    pennsylvania: 'PA',
    'rhode island': 'RI',
    'south carolina': 'SC',
    'south dakota': 'SD',
    tennessee: 'TN',
    texas: 'TX',
    utah: 'UT',
    vermont: 'VT',
    virginia: 'VA',
    washington: 'WA',
    'west virginia': 'WV',
    wisconsin: 'WI',
    wyoming: 'WY',
};

/** Full names, longest first, so "west virginia" wins over "virginia". */
const NAMES_LONGEST_FIRST = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);

/**
 * The US state of a free-text location.
 *
 * @remarks
 * Recognises a two-letter code after a comma or before a ZIP code ("San Pedro, CA 90731,
 * United States", "Grand Junction, CO") and full state names ("Michigan", "Delta County,
 * Colorado"). Locations with only a city or area ("Lehigh Valley") have no state.
 *
 * @param location - Location as written
 * @returns The two-letter code, or null when no state is found
 */
export function stateFromLocation(location: string | null): string | null {
    if (!location) {
        return null;
    }
    const code =
        location.match(/,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,|$)/)?.[1] ??
        location.match(/\b([A-Z]{2})\s+\d{5}\b/)?.[1];
    if (code && STATE_CODES.has(code)) {
        return code;
    }
    const lower = location.toLowerCase();
    const name = NAMES_LONGEST_FIRST.find((n) => new RegExp(`\\b${n}\\b`).test(lower));
    return name ? STATE_NAMES[name] : null;
}
