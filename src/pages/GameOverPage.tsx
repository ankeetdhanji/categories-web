import { useGame } from '../context/GameContext';

const AVATAR_COLORS = [
  '#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

function avatarColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) hash = (hash * 31 + playerId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function GameOverPage() {
  const { finalLeaderboard, players, finalWinnerIds, bonusPerWinner, reset } = useGame();

  const winners = finalLeaderboard.filter((e) => finalWinnerIds.includes(e.playerId));
  const isTie = winners.length > 1;

  function handlePlayAgain() {
    reset();
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: '#0b0f14' }}>
      {/* Background glows */}
      <div className="pointer-events-none fixed rounded-full" style={{ width: 700, height: 700, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#f59e0b', opacity: 0.04, filter: 'blur(130px)' }} />
      <div className="pointer-events-none fixed rounded-full" style={{ width: 400, height: 400, top: 0, right: 0, background: '#ec4899', opacity: 0.04, filter: 'blur(100px)' }} />

      <div className="relative z-10 w-full max-w-lg flex flex-col gap-8">

        {/* Winner banner */}
        <div className="flex flex-col items-center gap-4">
          <div className="text-6xl">🏆</div>
          <div className="flex flex-col items-center gap-1">
            <span className="font-bold text-xs tracking-widest uppercase" style={{ color: '#9ca3af' }}>
              {isTie ? "It's a tie!" : 'Winner'}
            </span>
            <h1 className="font-bold text-4xl tracking-tight text-center" style={{ color: '#e5e7eb', letterSpacing: '-0.7px' }}>
              {winners.length === 0
                ? 'Game Over'
                : winners.map((w) => w.displayName).join(' & ')}
            </h1>
          </div>

          {/* Winner avatars */}
          {winners.length > 0 && (
            <div className="flex gap-3">
              {winners.map((w) => (
                <div
                  key={w.playerId}
                  className="flex items-center justify-center rounded-full font-bold text-base"
                  style={{ width: 56, height: 56, background: avatarColor(w.playerId), color: '#0b0f14', border: '3px solid #f59e0b' }}
                >
                  {w.displayName[0].toUpperCase()}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Best-answer bonus attribution */}
        {bonusPerWinner > 0 && winners.length > 0 && (
          <div
            className="rounded-[14px] px-5 py-4 flex items-center gap-3"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <span className="text-2xl">⭐</span>
            <div>
              <p className="font-bold text-sm" style={{ color: '#f59e0b' }}>Best Answer Bonus</p>
              <p className="text-xs" style={{ color: '#9ca3af' }}>
                +{bonusPerWinner} pts to {winners.map((w) => w.displayName).join(' & ')}
                {isTie && ` (split ${bonusPerWinner} pts each)`}
              </p>
            </div>
          </div>
        )}

        {/* Final leaderboard */}
        <div className="flex flex-col gap-3">
          <span className="font-bold text-xs tracking-widest uppercase" style={{ color: '#9ca3af' }}>Final Standings</span>
          <div className="rounded-2xl overflow-hidden" style={{ background: '#111827', border: '1px solid #263244' }}>
            {finalLeaderboard.map((entry, i) => {
              const isWinner = finalWinnerIds.includes(entry.playerId);
              const playerInfo = players.find((p) => p.id === entry.playerId);
              const displayName = playerInfo?.displayName ?? entry.displayName;
              return (
                <div
                  key={entry.playerId}
                  className="flex items-center gap-4 px-6"
                  style={{
                    height: 68,
                    borderBottom: i < finalLeaderboard.length - 1 ? '1px solid #263244' : 'none',
                    background: isWinner ? 'rgba(245,158,11,0.05)' : 'transparent',
                  }}
                >
                  <span className="font-bold text-lg w-6 text-center shrink-0" style={{ color: i === 0 ? '#f59e0b' : '#6b7280' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <div
                    className="flex items-center justify-center rounded-full font-bold text-xs shrink-0"
                    style={{ width: 36, height: 36, background: avatarColor(entry.playerId), color: '#0b0f14', border: isWinner ? '2px solid #f59e0b' : 'none' }}
                  >
                    {displayName[0].toUpperCase()}
                  </div>
                  <span className="flex-1 font-semibold truncate" style={{ color: '#e5e7eb' }}>{displayName}</span>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="font-bold text-base" style={{ color: isWinner ? '#f59e0b' : '#e5e7eb' }}>
                      {entry.totalScore} pts
                    </span>
                    {entry.bestAnswerVotes > 0 && (
                      <span className="text-[10px]" style={{ color: '#9ca3af' }}>
                        ⭐ {entry.bestAnswerVotes} vote{entry.bestAnswerVotes !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <button
          onClick={handlePlayAgain}
          className="w-full h-14 rounded-[14px] font-bold text-lg flex items-center justify-center gap-2 transition-all hover:brightness-110"
          style={{ background: '#3b82f6', color: '#0b0f14', boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}
        >
          Play Again
        </button>
      </div>
    </div>
  );
}
