import { useEconomy } from '../contexts/EconomyContext';

export default function CoinBalance({ amount, size = 'md', className = '' }) {
  const economy = useEconomy();
  const value = typeof amount === 'number' ? amount : economy.coins;
  const cls = `sk-coin-balance sk-coin-balance--${size} ${className}`.trim();
  return (
    <span className={cls}>
      <img src="/images/brain_coins.png" alt="" className="sk-coin-icon" />
      <span className="sk-coin-count">{value.toLocaleString()}</span>
    </span>
  );
}
