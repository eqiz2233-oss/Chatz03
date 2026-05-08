import type { SlipResult } from '../../types';
import { I } from '../Icons';
import { useAppPreferences } from '../../context/AppPreferencesContext';

export function SlipCard({ slip }: { slip: SlipResult }) {
  const { t } = useAppPreferences();
  const label = t(`slipCard.label.${slip.status}`);

  const style = {
    verified: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800', text: 'text-emerald-700 dark:text-emerald-300', icon: <I.Check className="h-4 w-4" /> },
    pending: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-700 dark:text-amber-200', icon: <I.Sparkle className="h-4 w-4" /> },
    failed: { bg: 'bg-rose-50 dark:bg-rose-950/30', border: 'border-rose-200 dark:border-rose-800', text: 'text-rose-700 dark:text-rose-300', icon: <I.X className="h-4 w-4" /> },
    duplicate: { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-200', icon: <I.Shield className="h-4 w-4" /> },
  }[slip.status];

  return (
    <div className={'mt-1 w-[280px] overflow-hidden rounded-xl border ' + style.border + ' ' + style.bg}>
      <div className="relative h-32 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
        <div className="absolute inset-3 rounded-md bg-white p-2 shadow-sm dark:bg-slate-900">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-emerald-500" />
            <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">{slip.bank || 'BANK'}</div>
          </div>
          <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{t('slipCard.transferOk')}</div>
          <div className="mt-1 text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">฿ {slip.amount?.toLocaleString()}.00</div>
          <div className="mt-0.5 text-[9px] text-slate-400">Ref: {slip.ref}</div>
          <div className="text-[9px] text-slate-400">{slip.date}</div>
        </div>
      </div>
      <div className="border-t border-white/60 p-2.5 dark:border-slate-700/80">
        <div className={'flex items-center justify-between text-xs font-semibold ' + style.text}>
          <span className="flex items-center gap-1.5">
            {style.icon}
            {t('slipCard.aiCheck')}: {label}
          </span>
          {slip.status === 'verified' && <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">99.7%</span>}
        </div>
        {slip.status === 'verified' && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
            <li className="flex items-center gap-1.5">
              <I.Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> {t('slipCard.verifiedLine1', { amount: slip.amount?.toLocaleString() ?? '' })}
            </li>
            <li className="flex items-center gap-1.5">
              <I.Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> {t('slipCard.verifiedLine2')}
            </li>
            <li className="flex items-center gap-1.5">
              <I.Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> {t('slipCard.verifiedLine3')}
            </li>
            <li className="flex items-center gap-1.5">
              <I.Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> {t('slipCard.verifiedLine4')}
            </li>
          </ul>
        )}
        {slip.reason && <div className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-300">{slip.reason}</div>}
      </div>
    </div>
  );
}
