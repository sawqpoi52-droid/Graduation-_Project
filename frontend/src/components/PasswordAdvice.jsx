
const PasswordAdvice = ({ t, lang }) => {
    const adviceItems = t('passwordAdviceItems');
    const isRtl = lang === 'ar';

    return (
        <div className={`bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-2xl p-6 mt-8 animate-fade-in ${isRtl ? 'text-right' : 'text-left'}`}>
            <h4 className={`text-xl font-bold text-yellow-800 dark:text-yellow-500 mb-4 flex items-center gap-2 ${isRtl ? 'justify-end' : 'justify-start'}`}>
                {!isRtl && (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                )}
                <span>{t('passwordAdviceTitle')}</span>
                {isRtl && (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                )}
            </h4>

            <ul className="space-y-3 text-gray-700 dark:text-gray-300">
                {adviceItems.map((item, index) => (
                    <li key={index} className={`flex items-start gap-3 ${isRtl ? 'justify-end text-right' : 'justify-start text-left'}`}>
                        {!isRtl && <span className="mt-1.5 w-1.5 h-1.5 bg-yellow-500 rounded-full flex-shrink-0"></span>}
                        <span>{item}</span>
                        {isRtl && <span className="mt-1.5 w-1.5 h-1.5 bg-yellow-500 rounded-full flex-shrink-0"></span>}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default PasswordAdvice;

