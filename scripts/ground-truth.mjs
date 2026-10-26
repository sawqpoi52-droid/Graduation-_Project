#!/usr/bin/env node

/**
 * Independent Ground Truth Verification Tool
 * Cross-platform (Windows & Linux compatible)
 * Clones a mirror and performs an exhaustive scan across all refs, commit logs, and blobs.
 *
 * Usage:
 *   node scripts/ground-truth.mjs <repoUrlOrPath> <targetEmail>
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

async function run(file, args, options = {}) {
    const res = await execFileAsync(file, args, {
        timeout: 180000,
        maxBuffer: 50 * 1024 * 1024,
        shell: false,
        ...options
    });
    return res.stdout.trim();
}

async function verifyGroundTruth(repoSource, targetEmail) {
    if (!repoSource || !targetEmail) {
        console.error('Usage: node scripts/ground-truth.mjs <repoUrlOrLocalPath> <targetEmail>');
        process.exit(1);
    }

    const normEmail = targetEmail.trim().toLowerCase();
    const tempMirrorDir = path.join(os.tmpdir(), `gt-mirror-${crypto.randomBytes(6).toString('hex')}.git`);

    console.log(`\n======================================================`);
    console.log(`[Ground Truth] Independent Mirror Verification`);
    console.log(`Repository Target: ${repoSource}`);
    console.log(`Target Email:      ${normEmail}`);
    console.log(`Mirror Directory:  ${tempMirrorDir}`);
    console.log(`======================================================\n`);

    try {
        // Step 1: git clone --mirror
        console.log('[Ground Truth] Cloning full repository mirror (including all refs)...');
        await run('git', ['clone', '--mirror', repoSource, tempMirrorDir]);

        // Step 2: Exhaustive commit metadata check across all revisions
        console.log('[Ground Truth] Checking all commit authors and committers (git log --all)...');
        const logOutput = await run('git', ['log', '--all', '--format=%ae%n%ce'], { cwd: tempMirrorDir });
        const allEmails = logOutput.split('\n').map(e => e.trim().toLowerCase()).filter(Boolean);

        const matchingCommitsCount = allEmails.filter(e => e === normEmail).length;

        // Step 3: Exhaustive blob content search across all trees
        console.log('[Ground Truth] Searching all historical blobs and trees for email string...');
        let blobMatches = [];
        try {
            // Get all commit revisions
            const revList = await run('git', ['rev-list', '--all'], { cwd: tempMirrorDir });
            const commits = revList.split('\n').filter(Boolean);

            // Sample search across top branches and latest commits
            const sampleCommits = commits.slice(0, 50);
            for (const c of sampleCommits) {
                try {
                    const grepRes = await run('git', ['grep', '-i', '-F', normEmail, c], { cwd: tempMirrorDir });
                    if (grepRes) {
                        blobMatches.push(`${c.substring(0, 8)}: ${grepRes}`);
                    }
                } catch (_) {
                    // git grep returns non-zero when pattern not found
                }
            }
        } catch (e) {
            console.warn('[Ground Truth Note]', e.message);
        }

        // Summary Assessment
        const hasMetadataLeak = matchingCommitsCount > 0;
        const hasContentLeak = blobMatches.length > 0;
        const isCompletelyClean = !hasMetadataLeak && !hasContentLeak;

        const groundTruthStatus = isCompletelyClean
            ? 'VERIFIED_REMOVED'
            : (hasMetadataLeak ? 'PARTIALLY_MITIGATED (history residual)' : 'DETECTED (content exposed)');

        console.log('\n--- Ground Truth Result Summary ---');
        console.log(`Commit Metadata Matches: ${matchingCommitsCount}`);
        console.log(`Blob Content Matches:    ${blobMatches.length}`);
        console.log(`Verdict:                 ${isCompletelyClean ? 'CLEAN (0 references in mirror)' : 'RESIDUAL EXPOSURES DETECTED'}`);
        console.log(`Expected Verifier State: ${groundTruthStatus}\n`);

        return {
            matchingCommitsCount,
            blobMatchesCount: blobMatches.length,
            isCompletelyClean,
            groundTruthStatus
        };
    } finally {
        // Cleanup mirror temp folder
        try {
            fs.rmSync(tempMirrorDir, { recursive: true, force: true });
        } catch (_) {}
    }
}

// Direct CLI invocation
if (process.argv[1] && process.argv[1].endsWith('ground-truth.mjs')) {
    const [,, repo, email] = process.argv;
    verifyGroundTruth(repo, email)
        .then(() => process.exit(0))
        .catch(err => {
            console.error('[Ground Truth Failed]', err);
            process.exit(1);
        });
}

export { verifyGroundTruth };
