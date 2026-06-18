import { Icon } from './Icon';
import { t } from '../../data';
import type { Lang } from '../../data/types';

export interface StarsProps {
  value: number;
  sold?: number;
  lang: Lang;
}

export function Stars({ value, sold, lang }: StarsProps) {
  return (
    <div className="v-stars">
      <Icon name="star" size={14} style={{ color: 'var(--gold)' }} />
      <b>{value.toFixed(1)}</b>
      {sold != null && <span className="v-muted">· {sold.toLocaleString('vi-VN')} {t('sold', lang)}</span>}
    </div>
  );
}
