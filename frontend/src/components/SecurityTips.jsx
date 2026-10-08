export default function SecurityTips({ t }) {
    const tips = t('tips');

    return (
        <div className="mt-12 w-full max-w-5xl mx-auto">
            <div className="bg-red-50 dark:bg-red-900/10 border-r-4 border-red-500 p-6 rounded-lg mb-8">
                <h3 className="text-2xl font-bold text-red-700 dark:text-red-400 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.008v.008H12v-.008z" />
                    </svg>
                    {t('urgentAction')}
                </h3>
                <p className="mt-2 text-red-600 dark:text-red-300">{t('urgentDesc')}</p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tips.map((tip, index) => (
                    <div key={index} className="bg-white dark:bg-dark-card p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                        <h4 className="font-bold text-lg mb-3 text-blue-700 dark:text-blue-400 flex items-center gap-2">
                            <span className="bg-blue-100 dark:bg-blue-900 w-6 h-6 rounded-full flex items-center justify-center text-sm">{index + 1}</span>
                            {tip.title}
                        </h4>
                        <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">{tip.desc}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

