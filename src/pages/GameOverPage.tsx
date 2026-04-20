import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Zap, Star, Crown, Home, Play, Sparkles } from 'lucide-react';
import { useGame } from '../context/GameContext';
import { api } from '../services/api';

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #51a2ff 0%, #00d3f3 100%)',
  'linear-gradient(135deg, #fb64b6 0%, #ff2056 100%)',
  'linear-gradient(135deg, #ffb900 0%, #ff8904 100%)',
  'linear-gradient(135deg, #00d492 0%, #00bcd4 100%)',
  'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
  'linear-gradient(135deg, #05df72 0%, #00bc7d 100%)',
];

function avatarGradient(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) hash = (hash * 31 + playerId.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

const CONFETTI_COLORS = ['#f59e0b', '#ec4899', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316'];

interface ConfettiParticle {
  id: number;
  color: string;
  size: number;
  left: number;
  duration: number;
  delay: number;
  rotateFrom: number;
  rotateTo: number;
}

function generateConfetti(): ConfettiParticle[] {
  return Array.from({ length: 60 }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 6 + Math.random() * 8,
    left: Math.random() * 100,
    duration: 3 + Math.random() * 3,
    delay: Math.random() * 3,
    rotateFrom: Math.random() * 360,
    rotateTo: Math.random() * 360 + 360,
  }));
}

// --- Podium column ---

function PodiumCol({
  playerId,
  displayName,
  score,
  rank,
  heightClass,
  delay,
}: {
  playerId: string;
  displayName: string;
  score: number;
  rank: number;
  heightClass: string;
  delay: number;
}) {
  const isFirst = rank === 1;
  const isSecond = rank === 2;

  const pillarClass = isFirst
    ? 'bg-gradient-to-t from-yellow-600/40 via-yellow-500/20 to-yellow-400/10 border-yellow-500/50'
    : isSecond
      ? 'bg-gradient-to-t from-slate-400/40 via-slate-300/20 to-slate-200/10 border-slate-400/50'
      : 'bg-gradient-to-t from-orange-700/40 via-orange-600/20 to-orange-500/10 border-orange-600/50';

  const ringColor = isFirst
    ? '#f59e0b'
    : isSecond
      ? 'rgba(209,213,219,0.4)'
      : 'rgba(180,83,9,0.5)';

  const rankBg = isFirst ? '#ca8a04' : isSecond ? '#9ca3af' : '#b45309';
  const scoreColor = isFirst ? 'text-yellow-400' : isSecond ? 'text-slate-300' : 'text-orange-400';
  const avatarSize = isFirst ? 64 : 52;
  const avatarFontSize = isFirst ? 22 : 18;

  return (
    <div className={`flex flex-col items-center justify-end w-24 md:w-36 relative ${heightClass}`}>
      {/* Avatar & info */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: delay + 0.2, type: 'spring', bounce: 0.5 }}
        className="flex flex-col items-center mb-3 z-20"
      >
        {isFirst && (
          <motion.div
            initial={{ scale: 0, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ delay: delay + 0.6, type: 'spring', bounce: 0.7 }}
            className="text-yellow-400 mb-2 relative z-30"
          >
            <Crown
              size={40}
              className="fill-yellow-400/60 drop-shadow-[0_0_20px_rgba(250,204,21,1)]"
            />
            <div className="absolute inset-0 bg-yellow-400/30 blur-xl rounded-full" />
          </motion.div>
        )}

        <div className="relative">
          <div
            className="rounded-full flex items-center justify-center font-black text-white shadow-xl"
            style={{
              width: avatarSize,
              height: avatarSize,
              fontSize: avatarFontSize,
              background: avatarGradient(playerId),
              boxShadow: `0 0 0 ${isFirst ? 3 : 2}px ${ringColor}${isFirst ? ', 0 0 20px rgba(245,158,11,0.4)' : ''}`,
            }}
          >
            {displayName[0].toUpperCase()}
          </div>
          {/* Rank badge */}
          <div
            className="absolute -bottom-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-white border-2 border-indigo-950 shadow-lg"
            style={{ background: rankBg }}
          >
            {rank}
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-md rounded-xl px-3 py-1.5 mt-3 border border-white/10 flex flex-col items-center shadow-lg"
          style={{ width: '110%', maxWidth: 120 }}>
          <span className="text-white font-bold text-sm truncate w-full text-center">{displayName}</span>
          <span className={`font-black text-lg leading-tight ${scoreColor}`}>{score}</span>
        </div>
      </motion.div>

      {/* Pillar */}
      <motion.div
        initial={{ y: 200, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay, duration: 0.6, type: 'spring', bounce: 0.2 }}
        className={`w-full flex-1 rounded-t-2xl border-t-[3px] border-l border-r backdrop-blur-md relative overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] ${pillarClass}`}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-1/3 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
      </motion.div>
    </div>
  );
}

// --- Main component ---

export default function GameOverPage() {
  const { finalLeaderboard, players, finalWinnerIds, bonusPerWinner, reset, gameId, playerId } = useGame();
  const [isReopening, setIsReopening] = useState(false);

  const winners = finalLeaderboard.filter((e) => finalWinnerIds.includes(e.playerId));
  const isTie = winners.length > 1;
  const confettiParticles = useMemo(() => generateConfetti(), []);

  async function handleReturnToLobby() {
    if (!gameId || !playerId || isReopening) return;
    setIsReopening(true);
    try {
      await api.reopenLobby(gameId, playerId);
      // Phase transition driven by LobbyReopened SignalR event (App.tsx)
    } catch (err) {
      console.error('[GameOverPage] reopenLobby failed', err);
      setIsReopening(false);
    }
  }

  function handlePlayAgain() {
    reset();
  }

  function getDisplayName(pid: string, fallback: string) {
    return players.find((p) => p.id === pid)?.displayName ?? fallback;
  }

  const first = finalLeaderboard[0];
  const second = finalLeaderboard[1];
  const third = finalLeaderboard[2];
  const restEntries = finalLeaderboard.slice(3);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="relative min-h-screen flex flex-col pb-40 overflow-hidden bg-gradient-to-br from-indigo-950 via-purple-950 to-indigo-950"
    >
      {/* Ambient Celebration Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-0 left-0 w-full h-[40vh] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-yellow-500/20 via-transparent to-transparent opacity-80" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[50rem] h-[50rem] bg-pink-600/10 rounded-full blur-[150px]" />

        <motion.div
          className="absolute top-[15%] left-[20%] text-yellow-300 opacity-60"
          animate={{ scale: [1, 1.3, 1], rotate: [0, 45, 0] }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          <Sparkles size={32} />
        </motion.div>
        <motion.div
          className="absolute top-[25%] right-[25%] text-cyan-300 opacity-50"
          animate={{ scale: [1, 1.2, 1], rotate: [0, -30, 0] }}
          transition={{ duration: 4, repeat: Infinity, delay: 1 }}
        >
          <Sparkles size={24} />
        </motion.div>
        <motion.div
          className="absolute top-[40%] left-[10%] text-pink-300 opacity-40"
          animate={{ scale: [1, 1.4, 1] }}
          transition={{ duration: 5, repeat: Infinity, delay: 0.5 }}
        >
          <Star size={20} className="fill-pink-300" />
        </motion.div>
      </div>

      {/* Confetti */}
      <AnimatePresence>
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-[1]">
          {confettiParticles.map((p) => (
            <motion.div
              key={p.id}
              animate={{ y: ['0vh', '120vh'], rotate: [p.rotateFrom, p.rotateTo] }}
              transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'linear' }}
              style={{
                position: 'absolute',
                top: '-2%',
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                borderRadius: '50%',
                background: p.color,
                opacity: 0.7,
              }}
            />
          ))}
        </div>
      </AnimatePresence>

      <div className="relative z-10 w-full max-w-xl mx-auto flex flex-col flex-1 mt-10 px-4 md:px-8">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, type: 'spring' }}
          className="flex flex-col items-center mb-6 text-center"
        >
          <div className="bg-yellow-500/20 backdrop-blur-xl rounded-full px-5 py-2 flex items-center gap-2 border border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.2)] mb-4">
            <Trophy size={16} className="text-yellow-400 fill-yellow-400/20" />
            <span className="text-yellow-400 text-xs font-black uppercase tracking-widest">Match Complete</span>
          </div>
          <h1 className="text-transparent bg-clip-text bg-gradient-to-b from-white to-white/70 font-black text-5xl md:text-6xl tracking-tight leading-tight mb-2 drop-shadow-lg">
            Final Results
          </h1>
          <p className="text-white/60 text-base font-bold flex items-center gap-2">
            <Zap size={16} className="text-cyan-400" /> What a game!
          </p>
        </motion.div>

        {/* Podium */}
        {finalLeaderboard.length >= 1 && (
          <div className="flex items-end justify-center gap-3 md:gap-6 h-72 md:h-80 mt-4 mb-8 w-full relative">
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-yellow-500/10 blur-[60px] pointer-events-none" />

            {second ? (
              <PodiumCol
                playerId={second.playerId}
                displayName={getDisplayName(second.playerId, second.displayName)}
                score={second.totalScore}
                rank={2}
                heightClass="h-[75%]"
                delay={0.4}
              />
            ) : (
              <div className="w-24 md:w-36 h-[75%]" />
            )}

            {first && (
              <PodiumCol
                playerId={first.playerId}
                displayName={getDisplayName(first.playerId, first.displayName)}
                score={first.totalScore}
                rank={1}
                heightClass="h-full"
                delay={0.8}
              />
            )}

            {third ? (
              <PodiumCol
                playerId={third.playerId}
                displayName={getDisplayName(third.playerId, third.displayName)}
                score={third.totalScore}
                rank={3}
                heightClass="h-[60%]"
                delay={0.2}
              />
            ) : (
              <div className="w-24 md:w-36 h-[60%]" />
            )}
          </div>
        )}

        {/* Rest of leaderboard (4th+) */}
        {restEntries.length > 0 && (
          <div className="flex flex-col gap-3 w-full max-w-xl mx-auto z-10">
            {restEntries.map((entry, idx) => {
              const rank = idx + 4;
              const isWinner = finalWinnerIds.includes(entry.playerId);
              const displayName = getDisplayName(entry.playerId, entry.displayName);
              return (
                <motion.div
                  key={entry.playerId}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.4 + idx * 0.1, type: 'spring', bounce: 0.4 }}
                  className="w-full bg-black/40 backdrop-blur-xl border border-white/10 rounded-[1.25rem] p-3 flex items-center shadow-[0_8px_30px_rgba(0,0,0,0.3)]"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <span className="text-white/40 font-black text-lg w-6 text-center">#{rank}</span>
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black text-white shadow-md ring-2 ring-white/10"
                      style={{ background: avatarGradient(entry.playerId) }}
                    >
                      {displayName[0].toUpperCase()}
                    </div>
                    <div className="flex flex-col flex-1">
                      <span className="text-white font-bold text-lg">{displayName}</span>
                      {entry.bestAnswerVotes > 0 && (
                        <span className="text-purple-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                          <Star size={10} className="fill-purple-400" /> Best Answer
                        </span>
                      )}
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-1.5 min-w-[4.5rem] text-right">
                      <span className={`font-black text-xl ${isWinner ? 'text-yellow-400' : 'text-white'}`}>
                        {entry.totalScore}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Best answer bonus */}
        {bonusPerWinner > 0 && winners.length > 0 && (
          <div className="mt-4 rounded-2xl px-5 py-4 flex items-center gap-3 bg-yellow-400/10 border border-yellow-400/25">
            <Star size={22} className="text-yellow-400 shrink-0" />
            <div>
              <p className="font-bold text-sm text-yellow-400">Best Answer Bonus</p>
              <p className="text-xs text-white/50">
                +{bonusPerWinner} pts to {winners.map((w) => w.displayName).join(' & ')}
                {isTie && ` (split ${bonusPerWinner} pts each)`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Fixed Bottom Bar */}
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 2, type: 'spring', bounce: 0 }}
        className="fixed bottom-0 left-0 w-full z-50 pointer-events-none flex justify-center"
      >
        <div className="absolute bottom-full left-0 w-full h-32 bg-gradient-to-t from-indigo-950 via-indigo-950/90 to-transparent pointer-events-none" />
        <div
          className="w-full bg-indigo-950/90 backdrop-blur-2xl border-t border-white/10 px-4 pt-4 pointer-events-auto shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-xl mx-auto flex flex-col sm:flex-row gap-3 pb-4">
            <button
              onClick={handleReturnToLobby}
              disabled={isReopening}
              className="flex-1 bg-white/5 text-white/90 py-4 rounded-2xl font-black text-lg border border-white/10 hover:bg-white/10 hover:text-white transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isReopening
                ? <span className="inline-block w-4 h-4 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
                : <Home size={20} className="text-white/60" />
              }
              Back to Lobby
            </button>
            <motion.button
              onClick={handlePlayAgain}
              disabled={isReopening}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex-[1.5] bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 text-white py-4 rounded-2xl font-black text-xl shadow-[0_8px_30px_rgba(249,115,22,0.4)] border-b-4 border-orange-700 hover:shadow-[0_8px_40px_rgba(249,115,22,0.6)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={24} className="fill-white" /> Play Again
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
