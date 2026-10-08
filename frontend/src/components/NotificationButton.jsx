const NotificationButton = ({ onClick, t, lang }) => {
    return (
        <button
            onClick={onClick}
            className={`fixed bottom-8 ${lang === 'ar' ? 'left-8' : 'right-8'} z-50 flex items-center gap-3 pl-4 pr-6 py-3.5 rounded-2xl bg-slate-900 dark:bg-blue-600 text-white font-bold shadow-2xl shadow-blue-500/40 transition-all hover:scale-105 active:scale-95 group border border-white/10`}
        >
            <div className="relative w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center group-hover:bg-white/20 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
            </div>

            <div className={`flex flex-col items-start ${lang === 'ar' ? 'text-right' : 'text-left'} leading-tight`}>
                <span className="text-[10px] uppercase tracking-wider opacity-60 font-bold">{t('notificationBtn')}</span>
            </div>
        </button>
    );
};

export default NotificationButton;
