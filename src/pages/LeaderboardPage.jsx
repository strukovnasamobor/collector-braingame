import { useEffect, useMemo, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonSpinner,
  IonSegment,
  IonSegmentButton,
  IonLabel
} from '@ionic/react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import AppHeader from '../components/AppHeader';
import { useI18n } from '../contexts/I18nContext';
import { db } from '../../firebase';

const MEDALS = ['🥇', '🥈', '🥉'];

// Tiebreaker chain for ranked: rating desc → wins desc → draws desc →
// losses asc → coins desc → most-recent-activity desc. Coins act as the
// final substantive tiebreaker before falling back to recency, so two
// players with identical W/D/L records are separated by their economy
// progress.
function rankCompare(a, b) {
  const aR = Number(a.rating || 0);
  const bR = Number(b.rating || 0);
  if (aR !== bR) return bR - aR;

  const aW = Number(a.wins || 0);
  const bW = Number(b.wins || 0);
  if (aW !== bW) return bW - aW;

  const aD = Number(a.draws || 0);
  const bD = Number(b.draws || 0);
  if (aD !== bD) return bD - aD;

  const aL = Number(a.losses || 0);
  const bL = Number(b.losses || 0);
  if (aL !== bL) return aL - bL;

  const aC = Number(a.coins || 0);
  const bC = Number(b.coins || 0);
  if (aC !== bC) return bC - aC;

  const aT = Date.parse(a.updatedAt || '') || 0;
  const bT = Date.parse(b.updatedAt || '') || 0;
  return bT - aT;
}

// Tiebreaker chain for standard: coins desc → most-recent-activity desc.
// Wins/draws/losses aren't tracked per-mode and don't apply to the standard
// leaderboard.
function coinCompare(a, b) {
  const aC = Number(a.coins || 0);
  const bC = Number(b.coins || 0);
  if (aC !== bC) return bC - aC;

  const aT = Date.parse(a.updatedAt || '') || 0;
  const bT = Date.parse(b.updatedAt || '') || 0;
  return bT - aT;
}

function Table({ rows, t, empty, keyFn, renderName, valueColumnLabel, renderValue, showStats }) {
  if (!rows || rows.length === 0) {
    return <p style={{ textAlign: 'center', marginTop: 24 }}>{empty}</p>;
  }
  return (
    <table className="sk-leaderboard-table">
      <thead>
        <tr>
          <th>{t('leaderboard.rank')}</th>
          <th>{t('leaderboard.player')}</th>
          <th>{valueColumnLabel}</th>
          {showStats && (
            <>
              <th className="sk-stat-cell">{t('leaderboard.wins_short')}</th>
              <th className="sk-stat-cell">{t('leaderboard.draws_short')}</th>
              <th className="sk-stat-cell">{t('leaderboard.losses_short')}</th>
            </>
          )}
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
            <td className="sk-rating-cell">{renderValue(p)}</td>
            {showStats && (
              <>
                <td className="sk-stat-cell">{p.wins ?? 0}</td>
                <td className="sk-stat-cell">{p.draws ?? 0}</td>
                <td className="sk-stat-cell">{p.losses ?? 0}</td>
              </>
            )}
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
  const [mode, setMode] = useState('ranked');

  // Live subscription to the players collection. Whenever any tracked field
  // changes (rating, coins, wins, ...) the table updates in place.
  useEffect(() => {
    setLoading(true);
    setError('');
    const q = query(collection(db, 'players'), orderBy('rating', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
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

  // Re-sort client-side per mode. Firestore's orderBy stays on `rating` so
  // the snapshot always returns the same set of docs; the standard view
  // simply re-sorts that set by coins. Bots are excluded from the standard
  // leaderboard because they carry fixed coin values that would dominate
  // the ranking — the standard ladder is "coins earned through gameplay",
  // which bots no longer participate in. Ranked still shows bots since
  // their Elo ratings are meaningful.
  //
  // Ranked is gated on the 8×8 unlock: ranked play only happens on 8×8, so
  // players who haven't unlocked that grid have no rating worth ranking.
  // Bots have all grids unlocked at seed time so they pass this filter.
  const sortedRows = useMemo(() => {
    if (!onlinePlayers) return null;
    const compare = mode === 'standard' ? coinCompare : rankCompare;
    let filtered;
    if (mode === 'standard') {
      filtered = onlinePlayers.filter((p) => !(p.id || '').startsWith('bot:'));
    } else {
      filtered = onlinePlayers.filter((p) => {
        const grids = Array.isArray(p.unlocks?.onlineGrids)
          ? p.unlocks.onlineGrids.map(Number)
          : [6];
        return grids.includes(8);
      });
    }
    return [...filtered].sort(compare);
  }, [onlinePlayers, mode]);

  const valueColumnLabel =
    mode === 'standard' ? t('leaderboard.coins') : t('leaderboard.rating');
  const renderValue =
    mode === 'standard'
      ? (p) => Number(p.coins || 0).toLocaleString()
      : (p) => p.rating;

  return (
    <IonPage>
      <AppHeader title={t('leaderboard.title')} />
      <IonContent fullscreen>
        <div className="sk-tab-section ion-padding">
          <IonSegment
            value={mode}
            onIonChange={(e) => setMode(e.detail.value)}
            className="sk-leaderboard-segment"
          >
            <IonSegmentButton value="standard">
              <IonLabel>{t('leaderboard.tab_standard')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="ranked">
              <IonLabel>{t('leaderboard.tab_ranked')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          <div className="sk-leaderboard-container">
            {loading && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <IonSpinner /> <div>{t('leaderboard.loading')}</div>
              </div>
            )}
            {error && (
              <p style={{ color: '#dc3545', textAlign: 'center' }}>{error}</p>
            )}
            {sortedRows && !loading && (
              <Table
                rows={sortedRows}
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
                valueColumnLabel={valueColumnLabel}
                renderValue={renderValue}
                showStats={mode === 'ranked'}
              />
            )}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
