import { useState, useEffect } from 'react';
import axios from 'axios';

export default function ExposureRemovalAssistant({ email, t, lang }) {
    const [exposures, setExposures] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Auth state
    const [authState, setAuthState] = useState({ authenticated: false, user: null, verifiedEmails: [] });

    // Per-card interactive states
    const [activePlan, setActivePlan] = useState({});
    const [planLoading, setPlanLoading] = useState({});
    const [executing, setExecuting] = useState({});
    const [verificationResult, setVerificationResult] = useState({});
    const [verifying, setVerifying] = useState({});
    const [evidencePackage, setEvidencePackage] = useState({});
    const [confirmRepoInput, setConfirmRepoInput] = useState({});
    const [copiedKey, setCopiedKey] = useState(null);

    const isAr = lang === 'ar';

    // 1. Fetch Auth Status
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const res = await axios.get('/api/auth/me');
                if (res.data && res.data.authenticated) {
                    setAuthState(res.data);
                } else {
                    // Auto initialize dev login session for interactive testing
                    await handleDevLogin();
                }
            } catch (_) {
                await handleDevLogin();
            }
        };
        checkAuth();
    }, [email]);

    // 2. Fetch Exposures for this email
    useEffect(() => {
        if (!email) return;

        let isMounted = true;
        const fetchExposures = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await axios.get(`/api/exposures?email=${encodeURIComponent(email)}`);
                if (!isMounted) return;

                const list = res.data?.exposures || [];
                setExposures(list);
            } catch (err) {
                console.error('Failed to load exposures:', err);
                if (isMounted) {
                    setError(isAr ? 'فشل تحميل مواضع الانكشاف.' : 'Failed to load exposure details.');
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        fetchExposures();
        return () => { isMounted = false; };
    }, [email, lang]);

    // Handle Copy to clipboard
    const handleCopy = (text, key) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2200);
    };

    // OAuth Connect handler
    const handleConnectOAuth = async () => {
        try {
            const res = await axios.get('/api/auth/github/login');
            if (res.data?.authUrl) {
                window.location.href = res.data.authUrl;
            } else if (res.data?.devModeAvailable) {
                // Quick developer login fallback
                handleDevLogin();
            }
        } catch (e) {
            handleDevLogin();
        }
    };

    // Quick Dev Login
    const handleDevLogin = async () => {
        try {
            const res = await axios.post('/api/auth/dev-login', {
                login: 'developer',
                email: email || 'dev@example.com'
            });
            if (res.data?.success) {
                setAuthState({
                    authenticated: true,
                    user: { login: res.data.login || 'developer', id: res.data.userId },
                    verifiedEmails: [{ email: email || 'dev@example.com', verified: true }]
                });
            }
        } catch (e) {
            console.error('Dev login error:', e);
        }
    };

    // Logout
    const handleLogout = async () => {
        try {
            await axios.post('/api/auth/logout');
            setAuthState({ authenticated: false, user: null, verifiedEmails: [] });
        } catch (e) {
            console.error('Logout error:', e);
        }
    };

    // Plan Generation (Dry-Run)
    const handleGeneratePlan = async (occurrence) => {
        const occId = occurrence.occurrence_id;
        setPlanLoading(prev => ({ ...prev, [occId]: true }));
        try {
            if (!authState.authenticated) {
                await handleDevLogin();
            }

            const defaultAction = occurrence.lane === 'A'
                ? (occurrence.occurrence_type === 'COMMIT_METADATA' ? 'REWRITE_HISTORY' : (occurrence.occurrence_type?.includes('COMMENT') ? 'DELETE_COMMENT' : 'PATCH_FILE'))
                : (occurrence.lane === 'B' ? 'FORK_AND_PR' : 'EVIDENCE_PACKAGE');

            const res = await axios.post(`/api/exposures/${occId}/plan`, {
                actionType: defaultAction,
                targetEmail: email
            });

            if (res.data?.plan) {
                setActivePlan(prev => ({ ...prev, [occId]: res.data.plan }));
            }
        } catch (err) {
            console.error('Plan error:', err);
            alert(err.response?.data?.error || err.message);
        } finally {
            setPlanLoading(prev => ({ ...prev, [occId]: false }));
        }
    };

    // Plan Execution (Requires Consent)
    const handleExecutePlan = async (occurrence) => {
        const occId = occurrence.occurrence_id;
        const plan = activePlan[occId];
        if (!plan) return;

        setExecuting(prev => ({ ...prev, [occId]: true }));
        try {
            const res = await axios.post(`/api/exposures/${occId}/execute`, {
                planId: plan.planId,
                actionType: plan.actionType,
                confirmationText: confirmRepoInput[occId] || null
            });

            if (res.data?.success) {
                alert(isAr ? 'تم تنفيذ الإجراء بنجاح وتحديث الحالة!' : 'Action executed successfully and status updated!');
                const updatedStatus = res.data.result?.status || 'Action Done';
                setExposures(prev => prev.map(exp => {
                    if (exp.occurrence_id === occId) {
                        return { ...exp, status: updatedStatus };
                    }
                    return exp;
                }));
                // Auto trigger verification
                handleVerify(occId);
            }
        } catch (err) {
            alert(err.response?.data?.error || err.message);
        } finally {
            setExecuting(prev => ({ ...prev, [occId]: false }));
        }
    };

    // Verification Trigger
    const handleVerify = async (occurrenceId) => {
        setVerifying(prev => ({ ...prev, [occurrenceId]: true }));
        try {
            const res = await axios.post(`/api/exposures/${occurrenceId}/verify`);
            if (res.data?.verification) {
                setVerificationResult(prev => ({ ...prev, [occurrenceId]: res.data.verification.decision }));
                // Update local exposure status in list
                setExposures(prev => prev.map(exp => {
                    if (exp.occurrence_id === occurrenceId) {
                        return {
                            ...exp,
                            status: res.data.verification.newStatus,
                            status_reason: res.data.verification.decision.reasonCode
                        };
                    }
                    return exp;
                }));
            }
        } catch (err) {
            alert(err.response?.data?.error || err.message);
        } finally {
            setVerifying(prev => ({ ...prev, [occurrenceId]: false }));
        }
    };

    // Generate Lane C Evidence Package
    const handleGenerateEvidence = async (occurrenceId) => {
        try {
            const res = await axios.post(`/api/exposures/${occurrenceId}/evidence`, {
                userExplanation: ''
            });
            if (res.data?.evidencePackage) {
                setEvidencePackage(prev => ({ ...prev, [occurrenceId]: res.data.evidencePackage }));
            }
        } catch (err) {
            alert(err.response?.data?.error || err.message);
        }
    };

    // Confirm Lane C Manual Submission
    const handleConfirmLaneCSubmission = async (occurrenceId) => {
        const ticketRef = prompt(isAr ? 'أدخل رقم التذكرة أو المرجع (اختياري):' : 'Enter ticket or submission reference (optional):');
        try {
            const res = await axios.post(`/api/exposures/${occurrenceId}/confirm-submission`, {
                ticketRef
            });
            if (res.data?.success) {
                alert(isAr ? 'تم تسجيل تأكيد تقديم الطلب بنجاح!' : 'Submission confirmation recorded!');
                setExposures(prev => prev.map(exp => {
                    if (exp.occurrence_id === occurrenceId) {
                        return { ...exp, status: 'Removal Requested' };
                    }
                    return exp;
                }));
            }
        } catch (err) {
            alert(err.response?.data?.error || err.message);
        }
    };

    // Status Badge Helpers
    const getStatusBadge = (status = 'Detected') => {
        const map = {
            'Detected': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300',
            'Processing': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300 animate-pulse',
            'Removal Requested': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 border-indigo-300',
            'Awaiting Owner': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-300',
            'Under Review': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300 border-cyan-300',
            'Verified Removed': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-400 font-extrabold',
            'Partially Mitigated': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-400 font-bold',
            'Failed': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-300',
            'Verification Inconclusive': 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300'
        };
        const color = map[status] || map['Detected'];
        const labelKey = 'status_' + status.replace(/\s+/g, '_');
        return (
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border ${color}`}>
                {t(labelKey) || status}
            </span>
        );
    };

    // Lane Badge Helpers
    const getLaneBadge = (lane, occurrenceType) => {
        let sub = lane;
        if (lane === 'A') {
            if (occurrenceType === 'COMMIT_METADATA') sub = 'A2';
            else if (occurrenceType?.includes('COMMENT')) sub = 'A3';
            else sub = 'A1';
        }
        return (
            <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-900 text-white dark:bg-slate-700">
                {t(`lane_${sub}`) || `Lane ${sub}`}
            </span>
        );
    };

    if (loading) {
        return (
            <div className="mt-8 w-full max-w-4xl mx-auto bg-white dark:bg-dark-card rounded-2xl p-8 border border-gray-200 dark:border-gray-800 shadow-md text-center">
                <div className="flex flex-col items-center justify-center gap-3 py-6">
                    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-gray-600 dark:text-gray-300 font-bold text-sm">
                        {isAr ? 'جاري فحص وتدقيق مواضع الانكشاف وسجل المعالجة...' : 'Loading exposure records and remediation state machine...'}
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="mt-8 w-full max-w-4xl mx-auto bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-2xl p-5 text-center text-red-600 dark:text-red-400">
                <p className="font-bold text-sm">{error}</p>
            </div>
        );
    }

    if (exposures.length === 0) {
        return null;
    }

    return (
        <section aria-label="Automated Exposure Remediation Engine" className="mt-10 w-full max-w-4xl mx-auto space-y-6">
            {/* Header with Title & GitHub Authentication Banner */}
            <div className="bg-white dark:bg-dark-card rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm" dir={isAr ? 'rtl' : 'ltr'}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-800">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
                                {t('exposureAssistantTitle')}
                            </h3>
                            <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1 font-medium">
                                {t('exposureAssistantDesc')}
                            </p>
                        </div>
                    </div>

                    {/* OAuth Connection Status */}
                    <div className="shrink-0 flex items-center gap-2">
                        {authState.authenticated ? (
                            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                                    {t('oauth_connected_as')} <b>@{authState.user?.login}</b>
                                </span>
                                <button
                                    onClick={handleLogout}
                                    className="ml-2 text-red-600 dark:text-red-400 hover:underline font-bold text-[11px]"
                                >
                                    (خروج)
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col sm:flex-row items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleConnectOAuth}
                                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-2 transition-colors shadow-sm"
                                >
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                                        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                                    </svg>
                                    <span>{t('oauth_connect')}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDevLogin}
                                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                                    title="Developer Quick Login"
                                >
                                    {t('dev_login_hint')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* List of Occurrence Cards */}
            <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
                {exposures.map((occ, idx) => {
                    const occId = occ.occurrence_id || idx + 1;
                    const plan = activePlan[occId];
                    const vRes = verificationResult[occId];
                    const evPkg = evidencePackage[occId];
                    const isSeedTest = occ.data_origin === 'seeded_test';

                    return (
                        <div
                            key={occId}
                            className="bg-white dark:bg-dark-card rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden"
                        >
                            {/* Card Top: Badges, Permalinks, Repo info */}
                            <div className="p-5 md:p-6 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/50 dark:bg-gray-900/30">
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {getLaneBadge(occ.lane, occ.occurrence_type)}
                                        {getStatusBadge(occ.status)}
                                        {isSeedTest && (
                                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100 border border-amber-300">
                                                🏷️ {t('test_data_badge')}
                                            </span>
                                        )}
                                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                            [{occ.occurrence_type}]
                                        </span>
                                    </div>

                                    {/* Action Links */}
                                    <div className="flex items-center gap-2">
                                        {occ.permalink && (
                                            <a
                                                href={occ.permalink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors border border-blue-200 dark:border-blue-800"
                                            >
                                                <span>{t('exposureOpenSourceUrl')}</span>
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {/* Location Details */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300 mt-2">
                                    {occ.repo_full_name && (
                                        <div>
                                            <span className="font-bold">{t('exposureRepo')}: </span>
                                            <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded" dir="ltr">
                                                {occ.repo_full_name}
                                            </span>
                                        </div>
                                    )}
                                    {occ.file_path && (
                                        <div>
                                            <span className="font-bold">المسار: </span>
                                            <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded" dir="ltr">
                                                {occ.file_path} {occ.line_number ? `(#L${occ.line_number})` : ''}
                                            </span>
                                        </div>
                                    )}
                                    {occ.commit_sha && (
                                        <div>
                                            <span className="font-bold">Commit SHA: </span>
                                            <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded" dir="ltr">
                                                {occ.commit_sha.substring(0, 10)}
                                            </span>
                                        </div>
                                    )}
                                    <div>
                                        <span className="font-bold">الصلاحية / العلاقة: </span>
                                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                                            {occ.viewer_relation === 'owner' ? 'مالك المستودع' : (occ.viewer_relation === 'writer' ? 'صلاحية تعديل (Writer)' : (occ.viewer_relation === 'comment_author' ? 'كاتب التعليق' : 'طرف ثالث (بلا صلاحية)'))}
                                        </span>
                                    </div>
                                </div>

                                {/* Masked Snippet */}
                                {occ.evidence_masked && (
                                    <div className="mt-3 p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto select-all">
                                        {occ.evidence_masked}
                                    </div>
                                )}
                            </div>

                            {/* Card Body: Interactive Action Plans & Verifier */}
                            <div className="p-5 md:p-6 space-y-4">
                                <div className="flex flex-wrap items-center gap-3">
                                    {/* Plan / Dry-run Button */}
                                    <button
                                        type="button"
                                        disabled={planLoading[occId]}
                                        onClick={() => handleGeneratePlan(occ)}
                                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
                                    >
                                        {planLoading[occId] ? (
                                            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
                                            </svg>
                                        )}
                                        <span>{t('btn_plan')}</span>
                                    </button>

                                    {/* Direct Verifier Button */}
                                    <button
                                        type="button"
                                        disabled={verifying[occId]}
                                        onClick={() => handleVerify(occId)}
                                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
                                    >
                                        {verifying[occId] ? (
                                            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-400">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        )}
                                        <span>{t('btn_verify')}</span>
                                    </button>

                                    {/* Lane C Evidence Package Button */}
                                    <button
                                        type="button"
                                        onClick={() => handleGenerateEvidence(occId)}
                                        className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <span>📋 {t('btn_evidence')}</span>
                                    </button>
                                </div>

                                {/* Dry-Run Plan Display Box */}
                                {plan && (
                                    <div className="mt-4 p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 space-y-3 animate-fade-in">
                                        <div className="font-bold text-xs text-blue-900 dark:text-blue-300">
                                            {t('plan_ready')}
                                        </div>

                                        {/* Diff Display if available */}
                                        {plan.diff && (
                                            <div className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono space-y-1">
                                                <div className="text-red-400">
                                                    - {plan.diff.removed}
                                                </div>
                                                <div className="text-emerald-400">
                                                    + {plan.diff.added}
                                                </div>
                                            </div>
                                        )}

                                        {/* Destructive History Rewrite Consent Guard */}
                                        {plan.actionType === 'REWRITE_HISTORY' && (
                                            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 text-amber-900 dark:text-amber-200 text-xs space-y-2">
                                                <p className="font-bold">{t('warning_a2_force')}</p>
                                                <label className="block text-[11px] font-semibold">
                                                    {t('type_repo_confirm')} <span className="font-mono font-bold text-red-600">{occ.repo_full_name}</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    value={confirmRepoInput[occId] || ''}
                                                    onChange={e => setConfirmRepoInput({ ...confirmRepoInput, [occId]: e.target.value })}
                                                    placeholder={occ.repo_full_name}
                                                    className="w-full p-2 text-xs font-mono rounded bg-white dark:bg-gray-900 border border-amber-400"
                                                    dir="ltr"
                                                />
                                            </div>
                                        )}

                                        {/* Execute Button */}
                                        <button
                                            type="button"
                                            disabled={
                                                executing[occId] ||
                                                (plan.actionType === 'REWRITE_HISTORY' && confirmRepoInput[occId] !== occ.repo_full_name)
                                            }
                                            onClick={() => handleExecutePlan(occ)}
                                            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                                        >
                                            {executing[occId] ? (
                                                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                            ) : null}
                                            <span>{t('btn_execute')}</span>
                                        </button>
                                    </div>
                                )}

                                {/* Verification Result Box */}
                                {vRes && (
                                    <div className="mt-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 text-xs space-y-2 animate-fade-in">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-gray-800 dark:text-gray-200">
                                                نتيجة التحقق المستقل:
                                            </span>
                                            {getStatusBadge(vRes.resultStatus)}
                                        </div>
                                        <div className="text-gray-600 dark:text-gray-300">
                                            <b>السبب:</b> {vRes.reasonCode} ({vRes.details?.message || 'تم الفحص المباشر'})
                                        </div>
                                        {Array.isArray(vRes.unverifiedScope) && vRes.unverifiedScope.length > 0 && (
                                            <div className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-[11px]">
                                                <b>{t('scope_unverified')}:</b> {vRes.unverifiedScope.join(', ')}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Lane C Evidence Package Box */}
                                {evPkg && (
                                    <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                                                حزمة الأدلة الرسمية لـ GitHub (جاهزة للإرسال اليدوي):
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(evPkg.contentMarkdown, `ev_${occId}`)}
                                                className="px-2.5 py-1 text-xs font-bold rounded bg-blue-600 hover:bg-blue-700 text-white"
                                            >
                                                {copiedKey === `ev_${occId}` ? 'تم النسخ!' : 'نسخ حزمة Markdown'}
                                            </button>
                                        </div>
                                        <textarea
                                            readOnly
                                            value={evPkg.contentMarkdown}
                                            rows={8}
                                            className="w-full p-2.5 rounded-lg bg-white dark:bg-black font-mono text-[11px] border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200"
                                            dir="ltr"
                                        />
                                        <div className="flex flex-wrap items-center gap-3">
                                            <a
                                                href={evPkg.submissionUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5"
                                            >
                                                <span>فتح نموذج الخصوصية الرسمي لـ GitHub ↗</span>
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => handleConfirmLaneCSubmission(occId)}
                                                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                                            >
                                                <span>{t('btn_confirm_submit')}</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
