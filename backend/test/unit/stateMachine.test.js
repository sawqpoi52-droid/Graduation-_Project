const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES, transitionState, ArchitecturalInvariantViolationError } = require('../../services/stateMachine');

test('State Machine - All 9 expected state constants exist', () => {
    const expected = [
        'Detected',
        'Processing',
        'Removal Requested',
        'Awaiting Owner',
        'Under Review',
        'Verified Removed',
        'Partially Mitigated',
        'Failed',
        'Verification Inconclusive'
    ];
    for (const st of expected) {
        assert.ok(Object.values(STATES).includes(st), `Expected state "${st}" not found in STATES`);
    }
});

test('State Machine - Architectural Invariant: Only Verifier can transition to Verified Removed', () => {
    // Attempt by normal execution (isVerifier !== true) must throw ArchitecturalInvariantViolationError
    assert.throws(() => {
        transitionState(STATES.PROCESSING, STATES.VERIFIED_REMOVED, { isVerifier: false });
    }, ArchitecturalInvariantViolationError);

    assert.throws(() => {
        transitionState(STATES.DETECTED, STATES.VERIFIED_REMOVED, {});
    }, ArchitecturalInvariantViolationError);

    // Permitted only when isVerifier: true
    const allowed = transitionState(STATES.PROCESSING, STATES.VERIFIED_REMOVED, { isVerifier: true });
    assert.equal(allowed, STATES.VERIFIED_REMOVED);
});

test('State Machine - Architectural Invariant: Only Verifier can transition to Partially Mitigated', () => {
    // Attempt by normal execution (isVerifier !== true) must throw ArchitecturalInvariantViolationError
    assert.throws(() => {
        transitionState(STATES.PROCESSING, STATES.PARTIALLY_MITIGATED, { isVerifier: false });
    }, ArchitecturalInvariantViolationError);

    // Permitted only when isVerifier: true
    const allowed = transitionState(STATES.PROCESSING, STATES.PARTIALLY_MITIGATED, { isVerifier: true });
    assert.equal(allowed, STATES.PARTIALLY_MITIGATED);
});

test('State Machine - Valid non-restricted transitions', () => {
    assert.equal(transitionState(STATES.DETECTED, STATES.PROCESSING), STATES.PROCESSING);
    assert.equal(transitionState(STATES.DETECTED, STATES.AWAITING_OWNER), STATES.AWAITING_OWNER);
    assert.equal(transitionState(STATES.AWAITING_OWNER, STATES.UNDER_REVIEW), STATES.UNDER_REVIEW);
    assert.equal(transitionState(STATES.UNDER_REVIEW, STATES.FAILED), STATES.FAILED);
    assert.equal(transitionState(STATES.FAILED, STATES.DETECTED), STATES.DETECTED);
});

test('State Machine - Illegal transitions throw standard error', () => {
    assert.throws(() => {
        transitionState(STATES.FAILED, STATES.AWAITING_OWNER);
    }, /Illegal state transition/);
});
