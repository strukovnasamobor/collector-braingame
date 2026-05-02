import { useEffect, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonSpinner
} from '@ionic/react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import AppHeader from '../components/AppHeader';
import { useI18n } from '../contexts/I18nContext';
import { db } from '../../firebase';

const MEDALS = ['🥇', '🥈', '🥉'];

// Tiebreaker chain: rating desc → win-ratio desc → wins desc →
// losses asc → most-recent-activity desc.
function rankCompare(a, b) {
  const aR = Number(a.rating || 0);
  const bR = Number(b.rating || 0);
  if (aR !== bR) return bR - aR;

  const aGames = Number(a.games || 0);
  const bGames = Number(b.games || 0);
  const aRatio = aGames > 0 ? Number(a.wins || 0) / aGames : 0;
  const bRatio = bGames > 0 ? Number(b.wins || 0) / bGames : 0;
  if (aRatio !== bRatio) return bRatio - aRatio;

  const aW = Number(a.wins || 0);
  const bW = Number(b.wins || 0);
  if (aW !== bW) return bW - aW;

  const aL = Number(a.losses || 0);
  const bL = Number(b.losses || 0);
  if (aL !== bL) return aL - bL;

  const aT = Date.parse(a.updatedAt || '') || 0;
  const bT = Date.parse(b.updatedAt || '') || 0;
  return bT - aT;
}

function Table({ rows, t, empty, keyFn, renderName, renderRating }) {
  if (!rows || rows.length === 0) {
    return <p style={{ textAlign: 'center', marginTop: 24 }}>{empty}</p>;
  }
  return (
    <table className="sk-leaderboard-table">
      <thead>
        <tr>
          <th>{t('leaderboard.rank')}</th>
          <th>{t('leaderboard.player')}</th>
          <th>{t('leaderboard.rating')}</th>
          <th>{t('leaderboard.wdl')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => (
          <tr key={keyFn(p)} className={i < 3 ? `sk-top-${i + 1}` : ''}>
            <td className="sk-rank-cell">
              {i < MEDALS.length ? (
                <span className="sk-rank-medal" aria-label={`Rank ${i + 1}`}>
                  {MEDALS[i]}
                </span>
              ) : (
                i + 1
              )}
            </td>
            <td className="sk-name-cell">{renderName(p)}</td>
            <td className="sk-rating-cell">{renderRating(p)}</td>
            <td className="sk-wdl-cell">
              {(p.wins ?? 0)} / {(p.draws ?? 0)} / {(p.losses ?? 0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LeaderboardPage() {
  const { t } = useI18n();
  const [onlinePlayers, setOnlinePlayers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Live subscription to the players collection. Whenever any rating field
  // changes (e.g. after a ranked match finalizes or a bot's rating drifts),
  // the table updates in place without requiring a page reload.
  useEffect(() => {
    setLoading(true);
    setError('');
    const q = query(collection(db, 'players'), orderBy('rating', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        // Firestore can only orderBy a single field cheaply. Apply the full
        // tiebreaker chain client-side so equal-rating rows resolve by
        // win-ratio, then total wins, then fewest losses, then recency.
        arr.sort(rankCompare);
        setOnlinePlayers(arr);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  return (
    <IonPage>
      <AppHeader title={t('leaderboard.title')} />
      <IonContent fullscreen>
        <div className="sk-tab-section ion-padding">
          <div className="sk-leaderboard-container">
            {loading && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <IonSpinner /> <div>{t('leaderboard.loading')}</div>
              </div>
            )}
            {error && (
              <p style={{ color: '#dc3545', textAlign: 'center' }}>{error}</p>
            )}
            {onlinePlayers && !loading && (
              <Table
                rows={onlinePlayers}
                t={t}
                empty={t('leaderboard.empty_online')}
                keyFn={(p) => p.id || p.displayName}
                renderName={(p) => {
                  const name = p.displayName || 'Player';
                  // Bot accounts (uid prefix `bot:`) are AI opponents. The
                  // server already includes the 🤖 in displayName, but we
                  // belt-and-suspenders append it for any bot whose name
                  // somehow lost the marker.
                  const isBot = typeof p.id === 'string' && p.id.startsWith('bot:');
                  return isBot && !name.includes('🤖') ? `${name} 🤖` : name;
                }}
                renderRating={(p) => p.rating}
              />
            )}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
