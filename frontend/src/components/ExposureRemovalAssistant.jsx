import { useState, useEffect } from 'react';
import axios from 'axios';

export default function ExposureRemovalAssistant({ email, t, lang }) {
    const [exposures, setExposures] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Active tab per card: 'owner' (صاحب المستودع) or 'third_party' (شخص آخر)
    const [activeTab, setActiveTab] = useState({});
    const [instructionsData, setInstructionsData] = useState({});
    const [loadingInstructions, setLoadingInstructions] = useState({});
    const [copiedKey, setCopiedKey] = useState(null);

    const isAr = lang === 'ar';

    useEffect(() => {
        if (!email) return;

        let isMounted = true;
        const fetchExposures = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await axios.get(`/api/exposures?email=${encodeURIComponent(email)}`);
                if (!isMounted) return;

                const rawList = Array.isArray(res.data)
                    ? res.data
                    : (res.data?.exposures || res.data?.data || []);

                const list = rawList.map((item, idx) => {
                    const normId = item.exposure_id || item.id || (idx + 1);
                    return {
                        ...item,
                        id: normId,
                        exposure_id: normId
                    };
                });

                setExposures(list);

                // Default all cards to 'owner' instructions tab
                const initialTabs = {};
                list.forEach(item => {
                    initialTabs[item.id] = 'owner';
                });
                setActiveTab(initialTabs);

                // Pre-fetch instructions for all unique source types
                const sourceTypes = [...new Set(list.map(i => i.source_type || 'github_commit'))];
                sourceTypes.forEach(st => {
                    fetchInstructions(st);
                });
            } catch (err) {
                console.error('Failed to load exposures:', err);
                if (isMounted) {
                    setError(isAr ? 'فشل تحميل مواضع الظهور والتسريب.' : 'Failed to load exposure details.');
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        fetchExposures();

        return () => {
            isMounted = false;
        };
    }, [email, lang]);

    const fetchInstructions = async (sourceType) => {
        const cacheKey = `${sourceType}_${lang}`;
        if (instructionsData[cacheKey] || loadingInstructions[sourceType]) return;

        setLoadingInstructions(prev => ({ ...prev, [sourceType]: true }));
        try {
            const res = await axios.get(`/api/exposure-instructions?source_type=${encodeURIComponent(sourceType)}&lang=${lang}`);
            setInstructionsData(prev => ({
                ...prev,
                [cacheKey]: res.data
            }));
        } catch (err) {
            console.error('Failed to fetch instructions:', err);
        } finally {
            setLoadingInstructions(prev => ({ ...prev, [sourceType]: false }));
        }
    };

    const handleCopy = (text, key) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => {
            setCopiedKey(null);
        }, 2200);
    };

    // Platform and source styling
    const getSourceTypeDetails = (sourceType = '') => {
        const typeLower = sourceType.toLowerCase();
        if (typeLower.includes('commit')) {
            return {
                label: t('exposureGithubCommit'),
                platform: 'github',
                color: 'bg-slate-900 text-white dark:bg-slate-800'
            };
        }
        if (typeLower.includes('file')) {
            return {
                label: t('exposureGithubFile'),
                platform: 'github',
                color: 'bg-slate-900 text-white dark:bg-slate-800'
            };
        }
        if (typeLower.includes('issue')) {
            return {
                label: t('exposureGithubIssue'),
                platform: 'github',
                color: 'bg-slate-900 text-white dark:bg-slate-800'
            };
        }
        if (typeLower.includes('hackernews') && typeLower.includes('comment')) {
            return {
                label: t('exposureHackernewsComment'),
                platform: 'hackernews',
                color: 'bg-orange-600 text-white'
            };
        }
        if (typeLower.includes('hackernews') || typeLower.includes('hn')) {
            return {
                label: t('exposureHackernewsPost'),
                platform: 'hackernews',
                color: 'bg-orange-600 text-white'
            };
        }
        return {
            label: sourceType || t('exposureSource'),
            platform: 'generic',
            color: 'bg-blue-600 text-white'
        };
    };

    if (loading) {
        return (
            <div className="mt-8 w-full max-w-4xl mx-auto bg-white dark:bg-dark-card rounded-2xl p-8 border border-gray-200 dark:border-gray-800 shadow-md text-center">
                <div className="flex flex-col items-center justify-center gap-3 py-6">
                    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-gray-600 dark:text-gray-300 font-bold text-sm">
                        {isAr ? 'جاري تحميل تفاصيل المصدر وخطوات الإزالة...' : 'Loading leak source details and removal steps...'}
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
        <section aria-label="Exposure Removal Guide" className="mt-10 w-full max-w-4xl mx-auto space-y-6">
            {/* Clean Section Header (غير مبهرج وبدون متابعة أو تعقيد) */}
            <div className="bg-white dark:bg-dark-card rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm" dir={isAr ? 'rtl' : 'ltr'}>
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
            </div>

            {/* List of Exposure Remediation Cards */}
            <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
                {exposures.map((item, index) => {
                    const id = item.id || item.exposure_id || (index + 1);
                    const sourceDetails = getSourceTypeDetails(item.source_type);
                    const cacheKey = `${item.source_type || 'github_commit'}_${lang}`;
                    const instructions = instructionsData[cacheKey];
                    const isTabOwner = (activeTab[id] || 'owner') === 'owner';
                    const repoContext = item.repo_name || item.repository || item.source_context;
                    const owner = item.content_owner || item.owner;

                    const currentInstructions = isTabOwner
                        ? instructions?.owner_instructions
                        : instructions?.third_party_instructions;

                    return (
                        <div
                            key={id}
                            className="bg-white dark:bg-dark-card rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden"
                        >
                            {/* Card Top: Source Details & Real Verified URL */}
                            <div className="p-5 md:p-6 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/50 dark:bg-gray-900/30">
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                    <div className="flex items-center gap-2.5">
                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${sourceDetails.color} shadow-sm`}>
                                            {sourceDetails.platform === 'github' ? (
                                                <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24">
                                                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                                                </svg>
                                            ) : sourceDetails.platform === 'hackernews' ? (
                                                <span className="w-3.5 h-3.5 rounded bg-white text-orange-600 font-black text-[9px] flex items-center justify-center shrink-0">
                                                    Y
                                                </span>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 shrink-0">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-3.536l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                                                </svg>
                                            )}
                                            {sourceDetails.label}
                                        </span>
                                    </div>

                                    {/* Link to actual leak location */}
                                    <div className="flex items-center gap-2">
                                        {item.source_url && (
                                            <a
                                                href={item.source_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors border border-blue-200 dark:border-blue-800"
                                            >
                                                <span>{t('exposureOpenSourceUrl')}</span>
                                            </a>
                                        )}
                                        {item.source_url && (item.source_type?.includes('commit') || item.source_url.includes('/commit/')) && (
                                            <a
                                                href={item.source_url.endsWith('.patch') ? item.source_url : `${item.source_url}.patch`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors border border-amber-200 dark:border-amber-800"
                                            >
                                                <span>{t('exposureViewProof')}</span>
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {/* Direct Source URL info */}
                                {item.source_url && (
                                    <div className="mt-2.5 flex flex-col gap-1">
                                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                                            {t('exposureSourceUrl')}:
                                        </span>
                                        <div className="flex items-center gap-2 bg-white dark:bg-gray-800/80 p-2 rounded-xl border border-gray-200 dark:border-gray-700">
                                            <a
                                                href={item.source_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-1 text-xs font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline break-all"
                                                dir="ltr"
                                            >
                                                {item.source_url}
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(item.source_url, `url_${id}`)}
                                                className="px-2.5 py-1 text-xs font-bold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 rounded-lg transition-colors shrink-0"
                                                title={isAr ? 'نسخ الرابط' : 'Copy URL'}
                                            >
                                                {copiedKey === `url_${id}` ? (
                                                    <span className="text-emerald-600 dark:text-emerald-400">✓ {t('exposureCopied')}</span>
                                                ) : (
                                                    <span>{isAr ? 'نسخ الرابط' : 'Copy'}</span>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Context / Repo */}
                                {repoContext && (
                                    <div className="mt-2.5 text-xs text-gray-600 dark:text-gray-300">
                                        <span className="font-bold">{t('exposureRepo')}: </span>
                                        <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200" dir="ltr">
                                            {repoContext}
                                        </span>
                                        {owner && (
                                            <span className="mr-3 ml-3 font-medium">
                                                <span className="font-bold">{t('exposureOwner')}: </span>
                                                <span dir="ltr">{owner}</span>
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Card Body: Dual Instructions (صاحب المستودع أو شخص ثاني) */}
                            <div className="p-5 md:p-6 space-y-4">
                                <h4 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.27 3.27a.75.75 0 01-1.06 0l-1.06-1.06a.75.75 0 010-1.06l3.27-3.27a4.5 4.5 0 00-6.334 4.486c.048.58.024 1.193-.14 1.743" />
                                    </svg>
                                    <span>{t('exposureInstructionsTitle')}</span>
                                </h4>

                                {/* Two-Option Switcher Tabs: Owner vs Third Party */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-gray-100 dark:bg-gray-800/80 p-1.5 rounded-xl border border-gray-200 dark:border-gray-700">
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab(prev => ({ ...prev, [id]: 'owner' }))}
                                        className={`py-2.5 px-3 rounded-lg text-xs md:text-sm font-bold transition-all text-center flex items-center justify-center gap-2 cursor-pointer ${
                                            isTabOwner
                                                ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm border border-gray-200/80 dark:border-gray-700'
                                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                        }`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 shrink-0">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.0 0 3.75 3.75 0 017.0 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                                        </svg>
                                        <span>{t('exposureTabOwner')}</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setActiveTab(prev => ({ ...prev, [id]: 'third_party' }))}
                                        className={`py-2.5 px-3 rounded-lg text-xs md:text-sm font-bold transition-all text-center flex items-center justify-center gap-2 cursor-pointer ${
                                            !isTabOwner
                                                ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm border border-gray-200/80 dark:border-gray-700'
                                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                        }`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 shrink-0">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                                        </svg>
                                        <span>{t('exposureTabThirdParty')}</span>
                                    </button>
                                </div>

                                {/* Step-by-Step Instructions Display */}
                                {currentInstructions ? (
                                    <div className="space-y-4 pt-1">
                                        <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800">
                                            <div className="font-bold text-xs md:text-sm text-gray-800 dark:text-gray-200 mb-3">
                                                {currentInstructions.title}
                                            </div>

                                            {/* Numbered Steps */}
                                            {Array.isArray(currentInstructions.steps) && (
                                                <ol className="space-y-3">
                                                    {currentInstructions.steps.map((step, sIdx) => (
                                                        <li
                                                            key={sIdx}
                                                            className="flex items-start gap-2.5 text-xs md:text-sm text-gray-700 dark:text-gray-300 font-medium leading-relaxed"
                                                        >
                                                            <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-extrabold text-xs flex items-center justify-center shrink-0 mt-0.5">
                                                                {sIdx + 1}
                                                            </span>
                                                            <span className="flex-1">
                                                                {step}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ol>
                                            )}

                                            {/* Terminal Commands with Clean One-Click Copy */}
                                            {isTabOwner && Array.isArray(currentInstructions.commands) && currentInstructions.commands.length > 0 && (
                                                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 space-y-2">
                                                    <span className="text-xs font-bold text-gray-600 dark:text-gray-400 block">
                                                        {isAr ? 'الأوامر البرمجية للتنفيذ في الطرفية (Terminal):' : 'Terminal Commands:'}
                                                    </span>
                                                    {currentInstructions.commands.map((cmd, cIdx) => (
                                                        <div
                                                            key={cIdx}
                                                            dir="ltr"
                                                            className="bg-slate-900 text-slate-100 p-3 rounded-xl font-mono text-xs flex items-center justify-between gap-3 shadow-inner"
                                                        >
                                                            <span className="overflow-x-auto whitespace-pre-wrap select-all font-semibold text-emerald-400">
                                                                {cmd}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopy(cmd, `cmd_${id}_${cIdx}`)}
                                                                className="shrink-0 px-2.5 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer"
                                                            >
                                                                {copiedKey === `cmd_${id}_${cIdx}` ? t('exposureCopied') : t('exposureCopyCommand')}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Pre-written Message Template (إذا كان المستودع لشخص آخر) */}
                                            {!isTabOwner && currentInstructions.template_message && (
                                                <div className="mt-4 p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-right">
                                                    <div className="flex items-center justify-between gap-2 mb-2">
                                                        <span className="text-xs font-bold text-blue-900 dark:text-blue-200">
                                                            {t('exposureTemplateMessage')}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleCopy(currentInstructions.template_message, `tpl_${id}`)}
                                                            className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shrink-0 cursor-pointer"
                                                        >
                                                            {copiedKey === `tpl_${id}` ? t('exposureCopied') : t('exposureCopyTemplate')}
                                                        </button>
                                                    </div>
                                                    <p className="text-xs md:text-sm text-gray-800 dark:text-gray-200 leading-relaxed bg-white dark:bg-gray-900 p-3 rounded-lg border border-blue-100 dark:border-blue-900/50 font-medium select-all">
                                                        "{currentInstructions.template_message}"
                                                    </p>
                                                </div>
                                            )}

                                            {/* Official Takedown / Contact Form Link */}
                                            {!isTabOwner && currentInstructions.official_form_url && (
                                                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
                                                    <a
                                                        href={currentInstructions.official_form_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-bold bg-gray-900 hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 text-white transition-colors shadow-sm"
                                                    >
                                                        <span>{t('exposureOfficialForm')}</span>
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-900/40 text-center text-xs text-gray-500 font-medium">
                                        {isAr ? 'جاري تحميل التعليمات التفصيلية...' : 'Loading detailed instructions...'}
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
