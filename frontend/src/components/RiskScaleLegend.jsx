export default function RiskScaleLegend({ t }) {
    const levels = [
        {
            key: 'safe',
            title: t('riskLevelSafe'),
            description: t('riskDescSafe'),
            gradient: 'risk-gradient-safe',
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-white">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            )
        },
        {
            key: 'red',
            title: t('riskLevelDanger'),
            description: t('riskDescDanger'),
            gradient: 'risk-gradient-danger',
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-white">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
            )
        }
    ];

    return (
        <div className="bg-white dark:bg-dark-card rounded-2xl shadow-xl p-6 border border-gray-100 dark:border-gray-700 w-full lg:w-80 h-fit sticky top-8">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6 border-b border-gray-100 dark:border-gray-700 pb-4">
                {t('riskLegendTitle')}
            </h3>
            <div className="space-y-4">
                {levels.map((level) => (
                    <div key={level.key} className="flex items-start gap-3 group">
                        <div className={`p-2 rounded-lg ${level.gradient} shadow-md group-hover:scale-105 transition-transform shrink-0`}>
                            {level.icon}
                        </div>
                        <div>
                            <h4 className="font-bold text-gray-800 dark:text-gray-200 text-sm mb-1">{level.title}</h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{level.description}</p>
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">
                <p>{t('riskLegendDescription')}</p>
            </div>
        </div>
    );
}

