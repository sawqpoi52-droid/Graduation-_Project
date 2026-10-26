const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyOccurrence } = require('../../services/classifier');

test('Classifier Matrix - File content with write access maps to Lane A1', () => {
    const res = classifyOccurrence({
        type: 'FILE_CONTENT',
        repoFullName: 'my-org/my-project',
        repoPermissions: { push: true, pull: true },
        viewerRelation: 'writer'
    });
    assert.equal(res.lane, 'A');
    assert.equal(res.sublane, 'A1');
    assert.equal(res.actionType, 'PATCH_FILE');
    assert.ok(res.canAutomate);
});

test('Classifier Matrix - File content with NO write access maps to Lane B', () => {
    const res = classifyOccurrence({
        type: 'FILE_CONTENT',
        repoFullName: 'other-org/public-project',
        repoPermissions: { push: false, admin: false, pull: true },
        viewerRelation: 'none'
    });
    assert.equal(res.lane, 'B');
    assert.equal(res.sublane, 'B');
    assert.equal(res.actionType, 'FORK_AND_PR');
    assert.ok(res.canAutomate);
});

test('Classifier Matrix - Commit metadata with admin/owner maps to Lane A2', () => {
    const res = classifyOccurrence({
        type: 'COMMIT_METADATA',
        repoFullName: 'my-org/my-project',
        repoPermissions: { admin: true },
        viewerRelation: 'owner'
    });
    assert.equal(res.lane, 'A');
    assert.equal(res.sublane, 'A2');
    assert.equal(res.actionType, 'REWRITE_HISTORY');
    assert.ok(res.canAutomate);
});

test('Classifier Matrix - Commit metadata on non-owned repo maps to Lane C (Cannot rewrite)', () => {
    const res = classifyOccurrence({
        type: 'COMMIT_METADATA',
        repoFullName: 'torvalds/linux',
        repoPermissions: { push: false, admin: false },
        viewerRelation: 'none'
    });
    assert.equal(res.lane, 'C');
    assert.equal(res.sublane, 'C');
    assert.equal(res.actionType, 'EVIDENCE_PACKAGE');
    assert.equal(res.canAutomate, false);
});

test('Classifier Matrix - Comment authored by user maps to Lane A3', () => {
    const res = classifyOccurrence({
        type: 'ISSUE_COMMENT',
        repoFullName: 'any-org/any-repo',
        currentUserLogin: 'ali-dev',
        itemAuthorLogin: 'ali-dev',
        viewerRelation: 'comment_author'
    });
    assert.equal(res.lane, 'A');
    assert.equal(res.sublane, 'A3');
    assert.equal(res.actionType, 'DELETE_COMMENT');
    assert.ok(res.canAutomate);
});

test('Classifier Matrix - Comment authored by third-party without repo write maps to Lane C', () => {
    const res = classifyOccurrence({
        type: 'ISSUE_COMMENT',
        repoFullName: 'other-org/other-repo',
        currentUserLogin: 'ali-dev',
        itemAuthorLogin: 'stranger',
        repoPermissions: { push: false, admin: false },
        viewerRelation: 'none'
    });
    assert.equal(res.lane, 'C');
    assert.equal(res.sublane, 'C');
    assert.equal(res.actionType, 'EVIDENCE_PACKAGE');
    assert.equal(res.canAutomate, false);
});

test('Classifier Matrix - Hacker News items are always Lane C', () => {
    const res = classifyOccurrence({
        type: 'HN_ITEM'
    });
    assert.equal(res.lane, 'C');
    assert.equal(res.sublane, 'C');
    assert.equal(res.actionType, 'EVIDENCE_PACKAGE');
    assert.equal(res.canAutomate, false);
});
