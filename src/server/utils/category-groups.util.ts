/**
 * Category groups for the dashboard.
 *
 * @remarks
 * The advertiser sheet has over a thousand free-text categories ("Insurance agency",
 * "State Farm Agent", "Roofing contractor"...), too many to chart. Each category is put
 * in one group by keyword, checked in this order (first match wins). Anything that
 * matches none is "Other"; advertisers without a category are "No category".
 */
export const CATEGORY_GROUPS: readonly { name: string; pattern: RegExp }[] = [
    {
        name: 'Real estate',
        pattern:
            /real ?estate|realtor|realty|mortgage|propert|title (co|agency)|apartment|home ?builder|housing|loan officer|lender/i,
    },
    { name: 'Insurance', pattern: /insurance|state farm|allstate|farmers agent|agent - farmers/i },
    {
        name: 'Finance',
        pattern: /bank|credit union|financ|account|tax|cpa|invest|wealth|bookkeep|payroll/i,
    },
    {
        name: 'Home services',
        pattern:
            /roof|hvac|heating|cooling|air condition|plumb|electric|contractor|construct|remodel|landscap|lawn|pest|clean|septic|floor|window|door|paint|garage|pool|tree|handyman|fenc|insulat|restor|moving|storage|concrete|gutter|siding|cabinet|kitchen|bath|carpet|water|well|excavat|paving|asphalt|junk|dumpster|appliance|locksmith|solar|home (service|improvement|inspect)|builder/i,
    },
    {
        name: 'Automotive',
        pattern:
            /auto|car |cars|car$|tire|dealer|vehicle|collision|motor|truck|rv |rv$|towing|mechanic|oil change|body shop|transmission|powersport|boat|marine/i,
    },
    {
        name: 'Food & drink',
        pattern:
            /restaurant|pizza|cafe|café|coffee|bar$|bar |pub|grill|brew|bakery|food|cater|winery|wine|distill|deli|diner|bbq|barbecue|taco|burger|ice cream|donut|tavern|steak|sushi|mexican|chinese|italian|bistro|eatery|kitchen$|smoothie|juice|liquor/i,
    },
    {
        name: 'Health & wellness',
        pattern:
            /dental|dentist|orthodon|chiropract|clinic|medical|health|therap|physic|doctor|hospital|wellness|fitness|gym|spa|salon|beauty|massage|optom|eye|vision|pharm|veterin|animal|pet|nurs|care|hospice|counsel|mental|surgeon|derma|med spa|yoga|pilates|barber|nail|hair|lash|tattoo|iv /i,
    },
    { name: 'Legal', pattern: /law|attorney|lawyer|legal|injury/i },
    {
        name: 'Retail',
        pattern:
            /store|shop|boutique|jewel|retail|furniture|gift|florist|flower|market|outlet|supply|hardware|pawn|thrift|mattress|clothing|apparel|sporting|gun|book/i,
    },
    {
        name: 'Business services',
        pattern:
            /consult|marketing|advertis|staffing|employment|recruit|software|technology|it serv|computer|janitorial|printing|print shop|sign|magazine|manufactur|rental|networking|business|hr |payroll|security|courier|logistic|shipping|trucking|freight|photograph|design|web|telecom|internet|wireless/i,
    },
    {
        name: 'Travel & recreation',
        pattern:
            /golf|campground|camp|hotel|motel|travel|resort|recreation|bowling|lodge|inn$|inn |cabin|rv park|marina|ski|amusement|entertainment|casino|poker|arcade|escape room|fishing|hunting|outfitter|tour/i,
    },
    {
        name: 'Community & education',
        pattern:
            /school|church|college|university|academy|museum|library|nonprofit|non-profit|community|association|chamber|government|county|city of|club|foundation|ministr|center$|park|event|venue|theat|radio|news|tv|media|tourism|visitor|athletic/i,
    },
];

/** Group for categories that match none of the patterns. */
export const OTHER_GROUP = 'Other';

/** Group for advertisers without a category. */
export const NO_CATEGORY_GROUP = 'No category';

/**
 * The group a category belongs to.
 *
 * @param category - Free-text category, e.g. "Roofing contractor"
 * @returns The group name, e.g. "Home services"
 */
export function categoryGroup(category: string | null): string {
    if (!category?.trim()) {
        return NO_CATEGORY_GROUP;
    }
    return CATEGORY_GROUPS.find((group) => group.pattern.test(category))?.name ?? OTHER_GROUP;
}
