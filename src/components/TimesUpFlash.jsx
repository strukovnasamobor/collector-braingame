import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../contexts/I18nContext';

const FLASH_DURATION_MS = 1500;
const PLAYER_COLOR = { 1: '#dc3545', 2: '#007bff' };

// Detects the moment the turn timer drops to 0 and shows a brief, centered
// "TIME'S UP!" message colored by whoever just timed out. Auto-dismissed.
export default function TimesUpFlash({ seconds, currentPlayer, active }) {
  const { t } = useI18n();
  const [info, setInfo] = useState(null);
  const prevSecondsRef = useRef(seconds);

  useEffect(() => {
    if (seconds === 0 && prevSecondsRef.current > 0 && active) {
      setInfo({ id: Date.now(), player: currentPlayer });
    }
    prevSecondsRef.current = seconds;
  }, [seconds, active, currentPlayer]);

  useEffect(() => {
    if (!info) return undefined;
    const timer = setTimeout(() => setInfo(null), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [info]);

  if (!info) return null;
  const color = PLAYER_COLOR[info.player] || PLAYER_COLOR[1];
  return (
    <div className="sk-times-up-overlay" aria-live="assertive" role="status">
      <div className="sk-times-up-text" style={{ color }}>
        {t('notifications.times_up')}
      </div>
    </div>
  );
}
