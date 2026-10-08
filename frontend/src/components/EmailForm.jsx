import { useState } from 'react';

export default function EmailForm({ onCheck, loading, t }) {
    const [inputValue, setInputValue] = useState('');
    const [queryType, setQueryType] = useState('email'); // 'email' or 'password'
    const [error, setError] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!inputValue) {
            setError(queryType === 'email' ? t('errorEmptyEmail') : t('errorEmptyPassword'));
            return;
        }

        if (queryType === 'email') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(inputValue)) {
                setError(t('errorInvalidEmail'));
                return;
            }
        }

        setError('');
        onCheck(inputValue, queryType);
    };

    return (
        <div className="w-full max-w-md mx-auto">
            <div className="flex justify-center mb-6 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit mx-auto">
                <button
                    type="button"
                    onClick={() => { setQueryType('email'); setInputValue(''); setError(''); }}
                    className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${queryType === 'email'
                        ? 'bg-white dark:bg-dark-card text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                        }`}
                >
                    {t('email')}
                </button>
                <button
                    type="button"
                    onClick={() => { setQueryType('password'); setInputValue(''); setError(''); }}
                    className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${queryType === 'password'
                        ? 'bg-white dark:bg-dark-card text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                        }`}
                >
                    {t('password')}
                </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <input
                    type={queryType === 'email' ? 'email' : 'password'}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={queryType === 'email' ? t('placeholderEmail') : t('placeholderPassword')}
                    className="w-full px-6 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-card text-gray-900 dark:text-white text-lg text-left"
                    dir="ltr"
                    disabled={loading}
                />
                {error && <p className="text-red-500 text-sm text-center font-bold">{error}</p>}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-4 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                    {loading ? t('checking') : t('checkNow')}
                </button>
            </form>
        </div>
    );
}

