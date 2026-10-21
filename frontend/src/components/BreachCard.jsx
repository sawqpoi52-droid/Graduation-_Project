export default function BreachCard({ breach }) {
    return (
        <div className="bg-white dark:bg-dark-card rounded-xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{breach.Title}</h3>
            <span className="text-sm text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{breach.BreachDate}</span>
            <p className="text-gray-600 dark:text-gray-300 text-sm mt-2" dangerouslySetInnerHTML={{ __html: breach.Description }}></p>
        </div>
    );
}
