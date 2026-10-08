import { useState } from 'react';
import axios from 'axios';

const NotificationModal = ({ isOpen, onClose, t, lang, onUpdate }) => {
    const [email, setEmail] = useState('');
    const [frequency, setFrequency] = useState('weekly');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [details, setDetails] = useState(null);
    const [isError, setIsError] = useState(false);

    if (!isOpen) return null;

    const handleSubscribe = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);
        setDetails(null);
        try {
            const response = await axios.post('/api/subscribe', { email, frequency, lang });
            setMessage(response.data.message || t('subSuccess'));
            setDetails(response.data.details || null);
            setIsError(false);
            if (onUpdate) onUpdate();
        } catch (err) {
            const backendError = err.response?.data?.error;
            const backendDetails = err.response?.data?.details;
            setMessage(backendError || t('errorSub'));
            setDetails(backendDetails || null);
            setIsError(true);
        } finally {
            setLoading(false);
        }
    };

    const handleUnsubscribe = async () => {
        if (!email) {
            setMessage(t('errorEmptyEmail'));
            setIsError(true);
            return;
        }
        setLoading(true);
        setMessage(null);
        try {
            const response = await axios.post('/api/unsubscribe', { email, lang });
            setMessage(response.data.message || t('unsubSuccess'));
            setIsError(false);
            if (onUpdate) onUpdate();
        } catch (err) {
            const backendError = err.response?.data?.error;
            setMessage(backendError || t('errorUnsub'));
            setIsError(true);
        } finally {
            setLoading(false);
        }
    };

    const handleSendReport = async () => {
        if (!email) {
            setMessage(t('errorEmptyEmail'));
            setDetails(null);
            setIsError(true);
            return;
        }
        setLoading(true);
        setMessage(null);
        setDetails(null);
        try {
            const response = await axios.post('/api/send-report-now', { email, lang });
            setMessage(response.data.message || t('reportSent'));
            setDetails(response.data.details || null);
            setIsError(false);
        } catch (err) {
            const backendError = err.response?.data?.error;
            const backendDetails = err.response?.data?.details;
            setMessage(backendError || t('errorSub'));
            setDetails(backendDetails || null);
            setIsError(true);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
            <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative border border-gray-100 dark:border-gray-800">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="p-8">
                    <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center text-blue-600 dark:text-blue-400 mb-6">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                        </svg>
                    </div>

                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('notificationTitle')}</h3>
                    <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
                        {t('notificationDesc')}
                    </p>

                    <form onSubmit={handleSubscribe} className="space-y-6">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('email')}</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={t('emailPlaceholder')}
                                required
                                className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('freqLabel')}</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[['daily', 'freqDaily'], ['weekly', 'freqWeekly'], ['monthly', 'freqMonthly']].map(([freq, key]) => (
                                    <button
                                        key={freq}
                                        type="button"
                                        onClick={() => setFrequency(freq)}
                                        className={`px-2 py-2 rounded-lg border text-xs font-medium transition-all ${frequency === freq
                                            ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/30'
                                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-400'
                                            }`}
                                    >
                                        {t(key)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {message && (
                            <div className={`p-4 rounded-xl text-sm font-medium ${isError ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-green-50 text-green-600 dark:bg-green-900/20'}`}>
                                <div className="font-bold">{message}</div>
                                {details && (
                                    <div className="mt-1 text-xs opacity-80 whitespace-pre-wrap">{details}</div>
                                )}
                            </div>
                        )}

                        <div className="flex flex-col gap-3 pt-2">
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50"
                            >
                                {loading ? t('checking') : t('subscribe')}
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={handleSendReport}
                                    disabled={loading}
                                    className="py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all border border-transparent hover:border-blue-200 dark:hover:border-blue-800"
                                >
                                    {t('getReportNow')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleUnsubscribe}
                                    disabled={loading}
                                    className="py-2 text-xs font-semibold rounded-lg text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                >
                                    {t('unsubscribe')}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default NotificationModal;
