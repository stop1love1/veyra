import { Icon } from './Icon';

export interface CoinProps {
  value: number;
  size?: 'sm' | 'md';
}

export function Coin({ value, size = 'md' }: CoinProps) {
  return (
    <div className={'v-coin v-coin-' + size}>
      <span className="v-coin-dot"><Icon name="coin" size={size === 'sm' ? 14 : 16} /></span>
      <b>{value.toLocaleString('vi-VN')}</b>
    </div>
  );
}
