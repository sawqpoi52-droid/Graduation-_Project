const RISK_MAP = {
    safe: { key: 'riskMeterSafe', gradient: 'risk-gradient-safe' },
    yellow: { key: 'riskMeterWarning', gradient: 'risk-gradient-warning' },
    red: { key: 'riskMeterDanger', gradient: 'risk-gradient-danger' }
};

export default function RiskMeter({ riskLevel, t }) {
    const cfg = RISK_MAP[riskLevel] || {};
    const details = { text: t(cfg.key), gradient: cfg.gradient };
    return (
        <div className={`rounded-2xl p-8 text-center text-white ${details.gradient} shadow-2xl`}>
            <h2 className="text-4xl font-bold mb-2">{details.text}</h2>
        </div>
    );
}

