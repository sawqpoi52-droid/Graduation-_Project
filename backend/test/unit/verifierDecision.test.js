const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES } = require('../../services/stateMachine');

/**
 * Unit simulation of Verifier Decision Table logic to verify that:
 * 1. 401, 403, 429, 5xx NEVER yield "Verified Removed".
 * 2. Unreachable repository NEVER yields "Verified Removed".
 * 3. False-Verified rate is strictly 0.
 */

function evaluateVerifierDecision({
    repoStatus,
    targetStatus,
    targetType,
    bodyContainsTargetEmail = false,
    bodyContainsPatchedMarker = false,
    commitShaStatus = null
}) {
    // 1. Inaccessible repository cannot prove removal
    if (repoStatus !== 200) {
        return {
            decision: STATES.VERIFICATION_INCONCLUSIVE,
            reasonCode: repoStatus === 404 ? 'REPO_NOT_FOUND_OR_PRIVATE' : `REPO_ACCESS_REFUSED_${repoStatus}`
        };
    }

    // 2. Target check errors (401, 403, 429, 5xx) CANNOT be considered removed
    if ([401, 403, 429, 500, 502, 503, 504].includes(targetStatus)) {
        return {
            decision: STATES.VERIFICATION_INCONCLUSIVE,
            reasonCode: `TARGET_HTTP_${targetStatus}`
        };
    }

    // 3. Comments
    if (['ISSUE_COMMENT', 'PR_REVIEW_COMMENT', 'COMMIT_COMMENT'].includes(targetType)) {
        if (targetStatus === 404) {
            return {
                decision: STATES.VERIFIED_REMOVED,
                reasonCode: 'COMMENT_CONFIRMED_DELETED_404'
            };
        }
        if (targetStatus === 200) {
            if (bodyContainsPatchedMarker || !bodyContainsTargetEmail) {
                return {
                    decision: STATES.PARTIALLY_MITIGATED,
                    reasonCode: 'COMMENT_PATCHED_HISTORY_RESIDUAL'
                };
            }
            return {
                decision: STATES.DETECTED,
                reasonCode: 'COMMENT_STILL_EXPOSED'
            };
        }
    }

    // 4. File content
    if (targetType === 'FILE_CONTENT') {
        const fileRemovedFromHead = (targetStatus === 404) || bodyContainsPatchedMarker;
        if (fileRemovedFromHead) {
            if (commitShaStatus === 200) {
                return {
                    decision: STATES.PARTIALLY_MITIGATED,
                    reasonCode: 'HEAD_REMOVED_HISTORY_RESIDUAL'
                };
            }
            if (commitShaStatus === 404 || commitShaStatus === 422) {
                return {
                    decision: STATES.VERIFIED_REMOVED,
                    reasonCode: 'HEAD_AND_HISTORY_CLEAN'
                };
            }
            return {
                decision: STATES.PARTIALLY_MITIGATED,
                reasonCode: 'HEAD_REMOVED_HISTORY_RESIDUAL'
            };
        }
        return {
            decision: STATES.DETECTED,
            reasonCode: 'FILE_STILL_EXPOSED_AT_HEAD'
        };
    }

    // 5. Commit Metadata
    if (targetType === 'COMMIT_METADATA') {
        if (targetStatus === 404 || targetStatus === 422) {
            return {
                decision: STATES.VERIFIED_REMOVED,
                reasonCode: 'COMMIT_SHA_UNREACHABLE_404'
            };
        }
        if (targetStatus === 200) {
            return {
                decision: STATES.PARTIALLY_MITIGATED,
                reasonCode: 'COMMIT_SHA_STILL_CACHED_OR_LIVE'
            };
        }
    }

    return {
        decision: STATES.VERIFICATION_INCONCLUSIVE,
        reasonCode: 'UNKNOWN_STATUS'
    };
}

test('Verifier Decision - 401/403/429/5xx NEVER return Verified Removed', () => {
    const errorCodes = [401, 403, 429, 500, 502, 503];
    for (const code of errorCodes) {
        const res = evaluateVerifierDecision({
            repoStatus: 200,
            targetStatus: code,
            targetType: 'ISSUE_COMMENT'
        });
        assert.notEqual(res.decision, STATES.VERIFIED_REMOVED, `HTTP ${code} must NOT yield Verified Removed`);
        assert.equal(res.decision, STATES.VERIFICATION_INCONCLUSIVE);
    }
});

test('Verifier Decision - Inaccessible or private repository NEVER returns Verified Removed', () => {
    const res403 = evaluateVerifierDecision({
        repoStatus: 403,
        targetStatus: 404,
        targetType: 'FILE_CONTENT'
    });
    assert.equal(res403.decision, STATES.VERIFICATION_INCONCLUSIVE);

    const res404 = evaluateVerifierDecision({
        repoStatus: 404,
        targetStatus: 404,
        targetType: 'ISSUE_COMMENT'
    });
    assert.equal(res404.decision, STATES.VERIFICATION_INCONCLUSIVE);
});

test('Verifier Decision - Comment 404 with accessible repository confirms deletion', () => {
    const res = evaluateVerifierDecision({
        repoStatus: 200,
        targetStatus: 404,
        targetType: 'ISSUE_COMMENT'
    });
    assert.equal(res.decision, STATES.VERIFIED_REMOVED);
    assert.equal(res.reasonCode, 'COMMENT_CONFIRMED_DELETED_404');
});

test('Verifier Decision - Comment PATCHed with 200 yields Partially Mitigated due to edit history', () => {
    const res = evaluateVerifierDecision({
        repoStatus: 200,
        targetStatus: 200,
        targetType: 'ISSUE_COMMENT',
        bodyContainsPatchedMarker: true,
        bodyContainsTargetEmail: false
    });
    assert.equal(res.decision, STATES.PARTIALLY_MITIGATED);
    assert.equal(res.reasonCode, 'COMMENT_PATCHED_HISTORY_RESIDUAL');
});

test('Verifier Decision - File HEAD patched but Commit SHA reachable yields Partially Mitigated (history residual)', () => {
    const res = evaluateVerifierDecision({
        repoStatus: 200,
        targetStatus: 200,
        targetType: 'FILE_CONTENT',
        bodyContainsPatchedMarker: true,
        commitShaStatus: 200
    });
    assert.equal(res.decision, STATES.PARTIALLY_MITIGATED);
    assert.equal(res.reasonCode, 'HEAD_REMOVED_HISTORY_RESIDUAL');
});

test('Verifier Decision - File HEAD patched AND Commit SHA unreachable yields Verified Removed', () => {
    const res = evaluateVerifierDecision({
        repoStatus: 200,
        targetStatus: 200,
        targetType: 'FILE_CONTENT',
        bodyContainsPatchedMarker: true,
        commitShaStatus: 404
    });
    assert.equal(res.decision, STATES.VERIFIED_REMOVED);
    assert.equal(res.reasonCode, 'HEAD_AND_HISTORY_CLEAN');
});
