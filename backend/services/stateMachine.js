/**
 * SecureCheck State Machine for Automated Exposure Remediation
 * Enforces strict transitions and architectural invariants.
 */

const STATES = Object.freeze({
    DETECTED: 'Detected',
    PROCESSING: 'Processing',
    REMOVAL_REQUESTED: 'Removal Requested',
    AWAITING_OWNER: 'Awaiting Owner',
    UNDER_REVIEW: 'Under Review',
    VERIFIED_REMOVED: 'Verified Removed',
    PARTIALLY_MITIGATED: 'Partially Mitigated',
    FAILED: 'Failed',
    VERIFICATION_INCONCLUSIVE: 'Verification Inconclusive'
});

const ALL_STATES = Object.values(STATES);

// Restricted states that can ONLY be set by the independent Verifier service
const VERIFIER_RESTRICTED_STATES = new Set([
    STATES.VERIFIED_REMOVED,
    STATES.PARTIALLY_MITIGATED
]);

// Allowed state transitions
const ALLOWED_TRANSITIONS = {
    [STATES.DETECTED]: [
        STATES.PROCESSING,
        STATES.REMOVAL_REQUESTED,
        STATES.AWAITING_OWNER,
        STATES.FAILED,
        STATES.VERIFICATION_INCONCLUSIVE,
        STATES.VERIFIED_REMOVED,     // verifier-only
        STATES.PARTIALLY_MITIGATED   // verifier-only
    ],
    [STATES.PROCESSING]: [
        STATES.AWAITING_OWNER,
        STATES.UNDER_REVIEW,
        STATES.FAILED,
        STATES.VERIFICATION_INCONCLUSIVE,
        STATES.VERIFIED_REMOVED,     // verifier-only
        STATES.PARTIALLY_MITIGATED   // verifier-only
    ],
    [STATES.REMOVAL_REQUESTED]: [
        STATES.PROCESSING,
        STATES.AWAITING_OWNER,
        STATES.UNDER_REVIEW,
        STATES.FAILED,
        STATES.VERIFICATION_INCONCLUSIVE,
        STATES.VERIFIED_REMOVED,     // verifier-only
        STATES.PARTIALLY_MITIGATED   // verifier-only
    ],
    [STATES.AWAITING_OWNER]: [
        STATES.UNDER_REVIEW,
        STATES.PROCESSING,
        STATES.FAILED,
        STATES.REMOVAL_REQUESTED,
        STATES.VERIFICATION_INCONCLUSIVE,
        STATES.VERIFIED_REMOVED,     // verifier-only
        STATES.PARTIALLY_MITIGATED   // verifier-only
    ],
    [STATES.UNDER_REVIEW]: [
        STATES.AWAITING_OWNER,
        STATES.PROCESSING,
        STATES.FAILED,
        STATES.VERIFICATION_INCONCLUSIVE,
        STATES.VERIFIED_REMOVED,     // verifier-only
        STATES.PARTIALLY_MITIGATED   // verifier-only
    ],
    [STATES.VERIFICATION_INCONCLUSIVE]: [
        STATES.PROCESSING,
        STATES.AWAITING_OWNER,
        STATES.UNDER_REVIEW,
        STATES.FAILED,
        STATES.REMOVAL_REQUESTED,
        STATES.VERIFIED_REMOVED,     // verifier-only
        STATES.PARTIALLY_MITIGATED   // verifier-only
    ],
    [STATES.FAILED]: [
        STATES.PROCESSING,
        STATES.REMOVAL_REQUESTED,
        STATES.DETECTED
    ],
    [STATES.PARTIALLY_MITIGATED]: [
        STATES.PROCESSING,
        STATES.VERIFICATION_INCONCLUSIVE,
        STATES.VERIFIED_REMOVED      // verifier-only
    ],
    [STATES.VERIFIED_REMOVED]: [
        STATES.PROCESSING, // re-verification or audit check
        STATES.VERIFICATION_INCONCLUSIVE,
        STATES.DETECTED
    ]
};

class ArchitecturalInvariantViolationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ArchitecturalInvariantViolationError';
    }
}

/**
 * Validates and transitions an exposure state.
 * @param {string} currentState Current state string
 * @param {string} targetState Desired target state string
 * @param {object} options { isVerifier: boolean, reason: string }
 * @returns {string} The new state
 */
function transitionState(currentState, targetState, options = {}) {
    if (!ALL_STATES.includes(currentState)) {
        throw new Error(`Invalid current state: "${currentState}". Allowed: ${ALL_STATES.join(', ')}`);
    }

    if (!ALL_STATES.includes(targetState)) {
        throw new Error(`Invalid target state: "${targetState}". Allowed: ${ALL_STATES.join(', ')}`);
    }

    // ARCHITECTURAL INVARIANT:
    // Only the verifier service (options.isVerifier === true) can transition to Verified Removed or Partially Mitigated.
    // Execution modules and user endpoints are strictly prohibited.
    if (VERIFIER_RESTRICTED_STATES.has(targetState) && options.isVerifier !== true) {
        throw new ArchitecturalInvariantViolationError(
            `Architectural Invariant Violation: State "${targetState}" can ONLY be asserted by the independent Verifier service.`
        );
    }

    // Check transition graph
    const allowedTargets = ALLOWED_TRANSITIONS[currentState] || [];
    if (!allowedTargets.includes(targetState) && currentState !== targetState) {
        throw new Error(`Illegal state transition from "${currentState}" to "${targetState}".`);
    }

    return targetState;
}

module.exports = {
    STATES,
    ALL_STATES,
    VERIFIER_RESTRICTED_STATES,
    ALLOWED_TRANSITIONS,
    ArchitecturalInvariantViolationError,
    transitionState
};
