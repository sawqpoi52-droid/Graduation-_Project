import { useState, useEffect } from 'react';
import axios from 'axios';
import ThemeToggle from './components/ThemeToggle';
import EmailForm from './components/EmailForm';
import SecurityTips from './components/SecurityTips';
import PasswordAdvice from './components/PasswordAdvice';

import { checkPassword } from './utils/passwordCheck';
import { UI_TRANSLATIONS } from './utils/translations';
import NotificationModal from './components/NotificationModal';
import NotificationButton from './components/NotificationButton';
import PasswordStrengthTester from './components/PasswordStrengthTester';

function App() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [queryType, setQueryType] = useState('email');
    const [lang, setLang] = useState('ar');
    const [isNotificationOpen, setIsNotificationOpen] = useState(false);
    const [leaksCount, setLeaksCount] = useState(0);

    useEffect(() => {
        const fetchCount = async () => {
            try {
                const res = await axios.get('/api/leaks-count');
                if (res.data && res.data.count) {
                    setLeaksCount(res.data.count);
                }
            } catch (e) {
                console.error('Failed to fetch leaks count');
            }
        };
        fetchCount();
        const interval = setInterval(fetchCount, 60000);
        return () => clearInterval(interval);
    }, []);

    const t = (key) => {
        return UI_TRANSLATIONS[lang][key] || key;
    };

    const toggleLanguage = () => {
        setLang(lang === 'ar' ? 'en' : 'ar');
    };

    const checkIdentifier = async (inputValue, type) => {
        setLoading(true);
        setError(null);
        setResult(null);
        setQueryType(type);

        try {
            if (type === 'email') {
                const response = await axios.get(`/api/check?email=${inputValue}`);
                setResult(response.data);
            } else {
                const count = await checkPassword(inputValue);
                setResult({
                    type: 'password',
                    count: count,
                    safe: count === 0,
                    analysis: {
                        level: count === 0 ? 'safe' : 'red',
                        color: count === 0 ? 'green' : 'red'
                    }
                });
            }
        } catch (err) {
            console.error(err);
            setError(lang === 'ar' ? 'حدث خطأ أثناء الاتصال بالخادم.' : 'Server connection error.');
        } finally {
            setLoading(false);
        }
    };

    const renderEmailResult = () => {
        const isSafe = result.safe;

        return (
            <>
                {/* Result Banner */}
                <div className={`rounded-2xl p-8 text-center text-white shadow-2xl ${isSafe ? 'risk-gradient-safe' : 'risk-gradient-danger'}`}>
                    <div className="flex items-center justify-center gap-3 mb-2">
                        {isSafe ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-10 h-10">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-10 h-10 animate-pulse">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                        )}
                    </div>
                    <h2 className="text-4xl font-bold">{isSafe ? t('resultSafe') : t('resultDanger')}</h2>
                    <p className="mt-3 text-lg opacity-90">{isSafe ? t('resultSafeDesc') : t('resultDangerDesc')}</p>
                </div>

                {/* Security Tips (only when breached) */}
                {!isSafe && <SecurityTips t={t} />}
            </>
        );
    };

    const renderHome = () => (
        <div className="max-w-6xl mx-auto px-4 py-8 relative z-10 w-full animate-fade-in">
            <header className="flex justify-between items-center mb-12">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-500/30">
                        S
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">{t('title')}</h1>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={toggleLanguage}
                        className="px-4 py-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-all font-bold text-sm shadow-sm"
                    >
                        {t('switchLang')}
                    </button>
                    <ThemeToggle />
                </div>
            </header>

            <div className={`flex flex-col gap-12 items-center ${lang === 'en' ? 'text-left' : 'text-right'}`}>
                <main className="flex-1 flex flex-col items-center gap-12 text-center w-full">
                    {!result && (
                        <div className="space-y-6 max-w-2xl mx-auto">
                            <h2 className="text-5xl font-bold text-gray-900 dark:text-white leading-tight">
                                {lang === 'ar' ? (
                                    <>هل بياناتك <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600">آمنة؟</span></>
                                ) : (
                                    <>Is your data <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600">secure?</span></>
                                )}
                            </h2>
                            <p className="text-xl text-gray-500 dark:text-gray-400 leading-relaxed">
                                {t('heroSubtitle')}
                            </p>
                            {/* Leaks Counter */}
                            <div className="mt-4 inline-flex items-center gap-3 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-6 py-3 rounded-full font-bold text-lg shadow-sm border border-blue-100 dark:border-blue-800">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                                </svg>
                                <span>{t('leaksCounterText').replace('{count}', leaksCount.toLocaleString())}</span>
                            </div>
                        </div>
                    )}

                    {!result ? (
                        <div className="w-full max-w-md mx-auto space-y-4">
                            <EmailForm onCheck={checkIdentifier} loading={loading} t={t} />
                            {error && (
                                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm font-bold text-center">
                                    {error}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="w-full space-y-12 max-w-3xl mx-auto">
                            <div className="flex justify-center">
                                <button
                                    onClick={() => setResult(null)}
                                    className="mb-8 px-6 py-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-blue-100 hover:text-blue-600 transition-all flex items-center gap-2 font-medium"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-4 h-4 ${lang === 'en' ? '' : 'rotate-180'}`}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                                    </svg>
                                    {t('checkAnother')}
                                </button>
                            </div>

                            {queryType === 'email' ? (
                                renderEmailResult()
                            ) : (
                                <div className="bg-white dark:bg-dark-card rounded-3xl p-10 shadow-xl border border-gray-100 dark:border-gray-700 animate-fade-in">
                                    {result.safe ? (
                                        <div className="flex flex-col items-center gap-6">
                                            <div className="w-24 h-24 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center text-green-600 dark:text-green-400">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-12 h-12">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            </div>
                                            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{t('passwordSafeTitle')}</h3>
                                            <p className="text-gray-500 dark:text-gray-400 text-lg max-w-lg">
                                                {t('passwordSafeDesc')}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-6">
                                            <div className="w-24 h-24 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center text-red-600 dark:text-red-400 animate-pulse">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-12 h-12">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                                </svg>
                                            </div>
                                            <h3 className="text-3xl font-bold text-red-600 dark:text-red-500">{t('passwordBreachedTitle')}</h3>
                                            <p className="text-gray-600 dark:text-gray-300 text-lg max-w-lg font-medium">
                                                {t('passwordBreachedDesc').replace('{count}', result.count.toLocaleString())}
                                            </p>
                                            <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-xl text-red-700 dark:text-red-300 text-sm mt-4">
                                                {t('passwordChangeUrgent')}
                                            </div>
                                            <PasswordAdvice t={t} lang={lang} />
                                            <PasswordStrengthTester t={t} lang={lang} />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>

            <footer className="mt-20 pt-8 border-t border-gray-200 dark:border-gray-800 text-center text-gray-500 dark:text-gray-400 text-sm">
                <p className="mb-4">{t('footer')}</p>
            </footer>
        </div>
    );

    return (
        <div className="min-h-screen relative overflow-x-hidden bg-gray-50 dark:bg-dark-bg transition-colors duration-300 font-body" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-blue-50/50 to-transparent dark:from-blue-900/10 pointer-events-none" />
            {renderHome()}
            <NotificationButton onClick={() => setIsNotificationOpen(true)} t={t} lang={lang} />
            <NotificationModal
                isOpen={isNotificationOpen}
                onClose={() => setIsNotificationOpen(false)}
                t={t}
                lang={lang}
                onUpdate={() => { }}
            />
        </div>
    );
}


export default App;
