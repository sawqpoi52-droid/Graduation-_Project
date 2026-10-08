import { useState, useEffect } from 'react';

const PasswordStrengthTester = ({ t, lang }) => {
    const [password, setPassword] = useState('');
    const [strength, setStrength] = useState({
        label: 'weak',
        checks: { length: false, mix: false, predictable: true, repetition: true }
    });

    useEffect(() => {
        analyzeStrength(password);
    }, [password]);

    const analyzeStrength = (pwd) => {
        const checks = {
            length: pwd.length >= 8,
            mix: false,
            predictable: true,
            repetition: true
        };

        // 1. Length & Level
        let level = 'weak';
        if (pwd.length >= 12) level = 'strong';
        else if (pwd.length >= 8) level = 'medium';
        else level = 'weak';

        // 2. Mix
        const hasUpper = /[A-Z]/.test(pwd);
        const hasLower = /[a-z]/.test(pwd);
        const hasNumber = /[0-9]/.test(pwd);
        const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(pwd);
        const typesCount = [hasUpper, hasLower, hasNumber, hasSymbol].filter(Boolean).length;
        checks.mix = typesCount >= 3;

        // 3. Predictable (Common patterns + common words)
        const common = ['123456', 'password', 'qwerty', '12345678', 'admin', '12345', '654321', '000000'];
        if (common.some(c => pwd.toLowerCase().includes(c))) {
            checks.predictable = false;
        }

        // 4. Repetition & Sequences (aaaa, 1111, 1234, abcd)
        const hasRepetition = /(.)\1{2,}/.test(pwd); // 3+ repeated chars (aaa, 111)
        const hasSequence = /1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|defg|qwer|asdf|zxcv/.test(pwd.toLowerCase());
        if (hasRepetition || hasSequence) {
            checks.repetition = false;
        }

        // Adjust level based on complexity
        if (level === 'strong' && (!checks.mix || !checks.predictable || !checks.repetition)) {
            level = 'medium';
        }
        if (level === 'medium' && (!checks.mix || !checks.predictable || !checks.repetition) && pwd.length < 10) {
            level = 'weak';
        }
        if (pwd.length === 0) level = 'none';

        setStrength({
            label: level,
            checks
        });
    };

    const getStatusColor = (lvl) => {
        switch (lvl) {
            case 'strong': return 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400';
            case 'medium': return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400';
            case 'weak': return 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400';
            default: return 'text-gray-400 bg-gray-100 dark:bg-gray-800';
        }
    };

    const getCheckIcon = (passed) => (
        passed ? (
            <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
        ) : (
            <svg className="w-5 h-5 text-gray-300 dark:text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
        )
    );

    return (
        <div className="mt-10 p-8 bg-white dark:bg-dark-card rounded-3xl border border-gray-100 dark:border-gray-700 shadow-xl animate-fade-in max-w-2xl mx-auto">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                    </svg>
                </div>
                {t('strengthTesterTitle')}
            </h3>

            <div className="space-y-6">
                <div>
                    <input
                        type="text"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('strengthPlaceholder')}
                        className="w-full px-6 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-white text-lg transition-all focus:border-blue-500 outline-none"
                        dir="ltr"
                    />
                </div>

                {password && (
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-500 dark:text-gray-400 font-medium">{t('strengthStatus')}</span>
                            <span className={`px-4 py-1 rounded-full text-sm font-bold ${getStatusColor(strength.label)}`}>
                                {t(`strength_${strength.label}`)}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700">
                                {getCheckIcon(strength.checks.length)}
                                <span className={strength.checks.length ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400'}>{t('rule_length')}</span>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700">
                                {getCheckIcon(strength.checks.mix)}
                                <span className={strength.checks.mix ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400'}>{t('rule_mix')}</span>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700">
                                {getCheckIcon(strength.checks.predictable)}
                                <span className={strength.checks.predictable ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400'}>{t('rule_predictable')}</span>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700">
                                {getCheckIcon(strength.checks.repetition)}
                                <span className={strength.checks.repetition ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400'}>{t('rule_repetition')}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PasswordStrengthTester;
