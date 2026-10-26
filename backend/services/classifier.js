/**
 * Classification Service
 * Determines the remediation Lane and Sub-lane based on:
 * - Occurrence Type (File, Commit, Comment, HN)
 * - Repository Permissions (admin, push/write, pull/read)
 * - Authorship / Viewer Relation
 */

function classifyOccurrence({
    type,
    repoFullName,
    viewerRelation = 'none',
    repoPermissions = {},
    currentUserLogin = null,
    itemAuthorLogin = null
}) {
    // 1. Hacker News items are always Lane C (no automated write API)
    if (type === 'HN_ITEM') {
        return {
            lane: 'C',
            sublane: 'C',
            actionType: 'EVIDENCE_PACKAGE',
            allowedActions: ['EVIDENCE_PACKAGE'],
            canAutomate: false,
            reason: 'Hacker News content cannot be automatically edited via GitHub APIs. Escalation via evidence package.'
        };
    }

    const hasWrite = Boolean(repoPermissions.push || repoPermissions.admin || viewerRelation === 'owner' || viewerRelation === 'writer');
    const isOwnerOrAdmin = Boolean(repoPermissions.admin || viewerRelation === 'owner');
    const isAuthor = Boolean(
        viewerRelation === 'comment_author' ||
        (currentUserLogin && itemAuthorLogin && currentUserLogin.toLowerCase() === itemAuthorLogin.toLowerCase())
    );

    // 2. Comments (Issue comments, PR review comments, commit comments)
    if (type === 'ISSUE_COMMENT' || type === 'PR_REVIEW_COMMENT' || type === 'COMMIT_COMMENT') {
        if (isAuthor || hasWrite) {
            return {
                lane: 'A',
                sublane: 'A3',
                actionType: 'DELETE_COMMENT',
                allowedActions: ['DELETE_COMMENT'],
                canAutomate: true,
                reason: 'User is the comment author or has write/admin permissions on the repository. Lane A3 (Delete Comment).'
            };
        } else {
            return {
                lane: 'C',
                sublane: 'C',
                actionType: 'EVIDENCE_PACKAGE',
                allowedActions: ['EVIDENCE_PACKAGE'],
                canAutomate: false,
                reason: 'Comment in third-party repository not authored by current user. Lane C (Manual Escalation).'
            };
        }
    }

    // 3. Commit Metadata / Commit Message
    if (type === 'COMMIT_METADATA' || type === 'COMMIT_MESSAGE') {
        if (isOwnerOrAdmin) {
            return {
                lane: 'A',
                sublane: 'A2',
                actionType: 'REWRITE_HISTORY',
                allowedActions: ['REWRITE_HISTORY'],
                canAutomate: true,
                reason: 'Email exposed in Git commit metadata and user owns/administers repository. Lane A2 (Git Filter Repo).'
            };
        } else {
            return {
                lane: 'C',
                sublane: 'C',
                actionType: 'EVIDENCE_PACKAGE',
                allowedActions: ['EVIDENCE_PACKAGE'],
                canAutomate: false,
                reason: 'Email in commit metadata of a third-party repository cannot be rewritten by non-owners. Lane C only.'
            };
        }
    }

    // 4. File Content
    if (type === 'FILE_CONTENT') {
        if (hasWrite) {
            return {
                lane: 'A',
                sublane: 'A1',
                actionType: 'PATCH_FILE',
                allowedActions: ['PATCH_FILE', 'REWRITE_HISTORY'],
                canAutomate: true,
                reason: 'Email in file content of owned/writable repository. Lane A1 (Direct Patch via Contents API).'
            };
        } else {
            // Third-party repository -> Try Lane B (Fork + PR), fallback to Lane C
            return {
                lane: 'B',
                sublane: 'B',
                actionType: 'FORK_AND_PR',
                allowedActions: ['FORK_AND_PR', 'EVIDENCE_PACKAGE'],
                canAutomate: true,
                reason: 'Email in file content of third-party repository. Lane B (Fork & Pull Request) with fallback to Lane C.'
            };
        }
    }

    // Default fallback
    return {
        lane: 'C',
        sublane: 'C',
        actionType: 'EVIDENCE_PACKAGE',
        allowedActions: ['EVIDENCE_PACKAGE'],
        canAutomate: false,
        reason: 'Unclassified occurrence type defaults safely to Lane C.'
    };
}

module.exports = {
    classifyOccurrence
};
