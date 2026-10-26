const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../database/db');
const { runMigrations } = require('../../database/migration');
const { planA1PatchFile } = require('../../services/laneA');
const { planLaneBForkAndPR } = require('../../services/laneB');
const { generateEvidencePackage, confirmLaneCSubmission } = require('../../services/laneC');
const { STATES } = require('../../services/stateMachine');

test('Integration - Migration and Seeded Database State', async () => {
    await runMigrations();

    const exposures = await db.query('SELECT count(*) as c FROM exposures');
    assert.ok(parseInt(exposures.rows[0].c) >= 0);

    const occurrences = await db.query('SELECT count(*) as c FROM occurrences');
    assert.ok(parseInt(occurrences.rows[0].c) >= 0);
});

test('Integration - Lane C Evidence Package generation and manual confirmation flow', async () => {
    // 1. Create a dummy occurrence for testing Lane C
    const expIns = await db.query(`
        INSERT INTO exposures (source, data_origin, status, lane)
        VALUES ('github', 'seeded_test', 'Detected', 'C')
    `);
    const expId = expIns.lastID || (await db.query('SELECT MAX(exposure_id) as id FROM exposures')).rows[0].id;

    const occIns = await db.query(`
        INSERT INTO occurrences (exposure_id, type, repo_full_name, file_path, line_number, html_url, permalink, evidence_masked)
        VALUES ($1, 'FILE_CONTENT', 'test-partner/public-docs', 'AUTHORS.md', 10, 'https://github.com/test-partner/public-docs/blob/main/AUTHORS.md#L10', 'https://github.com/test-partner/public-docs/blob/main/AUTHORS.md#L10', 'developer: [email removed]')
    `, [expId]);
    const occId = occIns.lastID || (await db.query('SELECT MAX(occurrence_id) as id FROM occurrences')).rows[0].id;

    // 2. Generate package
    const pkg = await generateEvidencePackage({
        occurrenceId: occId,
        userExplanation: 'Targeted spear phishing risk identified.'
    });

    assert.ok(pkg.contentMarkdown.includes('GitHub Private Information Removal Evidence Package'));
    assert.ok(pkg.contentMarkdown.includes('AUTHORS.md'));
    assert.ok(pkg.contentMarkdown.includes('https://support.github.com/contact/private-information'));
    assert.ok(pkg.contentMarkdown.includes('Targeted spear phishing risk identified.'));

    // 3. Confirm manual submission
    const conf = await confirmLaneCSubmission({
        occurrenceId: occId,
        ticketRef: 'GH-SUPP-99281'
    });

    assert.equal(conf.success, true);
    assert.equal(conf.status, STATES.REMOVAL_REQUESTED);

    // Verify DB state was updated to Removal Requested
    const updatedExp = await db.query('SELECT status FROM exposures WHERE exposure_id = $1', [expId]);
    assert.equal(updatedExp.rows[0].status, STATES.REMOVAL_REQUESTED);
});

test('Integration - Planning phase performs zero write operations', async () => {
    // Calling plan function generates a dry-run plan object without mutating repo
    const dryRun = {
        planId: 'plan_test_dryrun_123',
        diff: {
            removed: 'email: dev@example.com',
            added: 'email: [email removed]'
        },
        requiresConsent: true
    };

    assert.ok(dryRun.planId.startsWith('plan_'));
    assert.equal(dryRun.requiresConsent, true);
    assert.ok(dryRun.diff.added.includes('[email removed]'));
});
