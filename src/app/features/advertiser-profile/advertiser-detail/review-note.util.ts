/**
 * A "Needs Attention" note explained for the profile page.
 */
export interface ReviewIssue {
    /** Kind of issue; duplicates also list the matching profiles */
    kind: 'duplicate' | 'missing-name' | 'link-left-out' | 'other';
    /** Short heading, e.g. "Possible duplicate" */
    title: string;
    /** What happened, in plain words */
    explanation: string;
    /** What to do about it */
    action: string;
    /** Font Awesome icon classes */
    icon: string;
    /** The note as saved by the import */
    note: string;
}

/**
 * Explains a review note saved by the import (see reviewNotes() and validateRow() in
 * src/server/services/advertiser-profiles.service.ts, which write these texts).
 *
 * @param note - One entry of review_notes
 * @returns The issue, with a heading, explanation and suggested action
 */
export function explainReviewNote(note: string): ReviewIssue {
    // "Possible duplicate: same business name and location as row 8 of sheet "X", also imported"
    let match = note.match(
        /^Possible duplicate: same business name and location as row (\d+) of sheet "(.+)"/,
    );
    if (match) {
        return {
            kind: 'duplicate',
            title: 'Possible duplicate',
            explanation: `Row ${match[1]} of sheet "${match[2]}" has the same business name and location, and both rows were imported. Often they are the same business with different videos.`,
            action: 'Compare it with the profiles below: keep one and remove the other, or confirm they are different businesses.',
            icon: 'fa-sharp fa-regular fa-clone',
            note,
        };
    }

    // "Possible duplicate: rows 14, 20 of sheet "X" have the same business name and location, also imported"
    match = note.match(
        /^Possible duplicate: rows? ([\d, ]+) of sheet "(.+)" (?:has|have) the same/,
    );
    if (match) {
        const rows = match[1].trim();
        const plural = rows.includes(',');
        return {
            kind: 'duplicate',
            title: 'Possible duplicate',
            explanation: `${plural ? 'Rows' : 'Row'} ${rows} of sheet "${match[2]}" ${plural ? 'repeat' : 'repeats'} this business (same name and location) and ${plural ? 'were' : 'was'} imported too. Often they are the same business with different videos.`,
            action: 'Compare it with the profiles below: keep one and remove the others, or confirm they are different businesses.',
            icon: 'fa-sharp fa-regular fa-clone',
            note,
        };
    }

    if (/^Business Name is empty/.test(note)) {
        return {
            kind: 'missing-name',
            title: 'Missing business name',
            explanation:
                'The spreadsheet row had no business name, so this profile was saved as "Unnamed business".',
            action: 'Add the business name. The video, website, phone number and category on this page can help identify it.',
            icon: 'fa-sharp fa-regular fa-signature',
            note,
        };
    }

    // "Other website not imported: b.com, c.com"
    match = note.match(/^Other website not imported: (.+)$/);
    if (match) {
        return {
            kind: 'link-left-out',
            title: 'Second website left out',
            explanation: `The Website cell listed more than one address. Only the first was kept; this was not imported: ${match[1]}.`,
            action: 'Check which website belongs to this business.',
            icon: 'fa-sharp fa-regular fa-globe',
            note,
        };
    }

    // "Website left empty: "x" is not a web address" / "Video URL left empty: ..."
    match = note.match(/^(.+?) left empty: "(.+)" is not a web address$/);
    if (match) {
        return {
            kind: 'link-left-out',
            title: `${match[1]} missing`,
            explanation: `The spreadsheet had "${match[2]}" as the ${match[1].toLowerCase()}, which is not a web address, so it was left empty.`,
            action: `Add the correct ${match[1].toLowerCase()}.`,
            icon: 'fa-sharp fa-regular fa-link-slash',
            note,
        };
    }

    // "Social Media: left out "Instagram" (not a web address)"
    match = note.match(/^Social Media: left out "(.+)" \(not a web address\)$/);
    if (match) {
        return {
            kind: 'link-left-out',
            title: 'Social media entry left out',
            explanation: `The Social Media cell included "${match[1]}", which is not a link, so it was left out.`,
            action: 'Find the account and add its link.',
            icon: 'fa-sharp fa-regular fa-link-slash',
            note,
        };
    }

    return {
        kind: 'other',
        title: 'Check this profile',
        explanation: note,
        action: 'Review the details on this page.',
        icon: 'fa-sharp fa-regular fa-circle-exclamation',
        note,
    };
}
