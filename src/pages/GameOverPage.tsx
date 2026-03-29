import { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Zap, Star, Crown } from 'lucide-react';
import { useGame } from '../context/GameContext';

const AVATAR_COLORS = [
  '#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #51a2ff 0%, #00d3f3 100%)',
  'linear-gradient(135deg, #fb64b6 0%, #ff2056 100%)',
  'linear-gradient(135deg, #ffb900 0%, #ff8904 100%)',
  'linear-gradient(135deg, #00d492 0%, #00bcd4 100%)',
  'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
  'linear-gradient(135deg, #05df72 0%, #00bc7d 100%)',
];

function avatarColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) hash = (hash * 31 + playerId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

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

export default function GameOverPage() {
  const { finalLeaderboard, players, finalWinnerIds, bonusPerWinner, reset } = useGame();

  const winners = finalLeaderboard.filter((e) => finalWinnerIds.includes(e.playerId));
  const isTie = winners.length > 1;

  const confettiParticles = useMemo(() => generateConfetti(), []);

  function handlePlayAgain() {
    reset();
  }

  const podiumEntries = finalLeaderboard.slice(0, 3);
  const restEntries = finalLeaderboard.slice(3);

  const first = podiumEntries[0];
  const second = podiumEntries[1];
  const third = podiumEntries[2];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="relative min-h-screen flex flex-col items-center justify-center px-4 py-12 overflow-hidden bg-gradient-to-b from-indigo-950 via-purple-950 to-indigo-950"
    >
      {/* Background glows */}
      <div
        className="pointer-events-none fixed rounded-full"
        style={{
          width: 600,
          height: 600,
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#f59e0b',
          opacity: 0.15,
          filter: 'blur(120px)',
        }}
      />
      <div
        className="pointer-events-none fixed rounded-full"
        style={{
          width: 500,
          height: 500,
          top: '40%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: '#ec4899',
          opacity: 0.07,
          filter: 'blur(140px)',
        }}
      />

      {/* Confetti */}
      <AnimatePresence>
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
          {confettiParticles.map((p) => (
            <motion.div
              key={p.id}
              animate={{
                y: ['0vh', '120vh'],
                rotate: [p.rotateFrom, p.rotateTo],
              }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                repeat: Infinity,
                ease: 'linear',
              }}
              style={{
                position: 'absolute',
                top: '-2%',
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                background: p.color,
                opacity: 0.7,
              }}
            />
          ))}
        </div>
      </AnimatePresence>

      <div className="relative z-10 w-full max-w-lg flex flex-col gap-8">

        {/* Header */}
        <div className="flex flex-col items-center gap-3">
          {/* Badge */}
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-yellow-400/30 bg-yellow-400/10">
            <Trophy size={14} className="text-yellow-400" />
            <span className="text-xs font-bold tracking-widest uppercase text-yellow-400">Match Complete</span>
          </div>

          {/* Title */}
          <h1
            className="font-extrabold text-4xl tracking-tight text-center bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent"
            style={{ letterSpacing: '-0.7px' }}
          >
            Final Results
          </h1>

          {/* Subtext */}
          <div className="flex items-center gap-1.5 text-white/50 text-sm">
            <Zap size={14} className="text-purple-400" />
            <span>What a game!</span>
          </div>
        </div>

        {/* Podium */}
        {finalLeaderboard.length >= 1 && (
          <div className="flex items-end justify-center gap-3 px-4 pt-4">

            {/* 2nd place */}
            {second && (
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2, type: 'spring', stiffness: 120 }}
                className="flex flex-col items-center flex-1"
              >
                {/* Avatar */}
                <div
                  className="flex items-center justify-center rounded-full font-bold text-sm mb-1"
                  style={{
                    width: 48,
                    height: 48,
                    background: avatarGradient(second.playerId),
                    color: '#fff',
                    boxShadow: '0 0 0 2px rgba(209,213,219,0.4)',
                  }}
                >
                  {(players.find((p) => p.id === second.playerId)?.displayName ?? second.displayName)[0].toUpperCase()}
                </div>
                <span className="text-white/70 text-xs font-semibold truncate max-w-[72px] text-center mb-1">
                  {players.find((p) => p.id === second.playerId)?.displayName ?? second.displayName}
                </span>
                <span className="text-white/50 text-[10px] font-bold mb-1">{second.totalScore} pts</span>
                {/* Pillar */}
                <div
                  className="w-full rounded-t-lg bg-gradient-to-b from-gray-300 to-gray-500 flex items-start justify-center pt-2"
                  style={{ height: 80 }}
                >
                  <span className="text-gray-800 font-black text-lg">2</span>
                </div>
              </motion.div>
            )}

            {/* 1st place */}
            {first && (
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4, type: 'spring', stiffness: 120 }}
                className="flex flex-col items-center flex-1"
              >
                {/* Crown */}
                <Crown size={20} className="text-yellow-400 mb-1" />
                {/* Avatar */}
                <div
                  className="flex items-center justify-center rounded-full font-bold text-base mb-1"
                  style={{
                    width: 56,
                    height: 56,
                    background: avatarGradient(first.playerId),
                    color: '#fff',
                    boxShadow: '0 0 0 3px #f59e0b, 0 0 20px rgba(245,158,11,0.4)',
                  }}
                >
                  {(players.find((p) => p.id === first.playerId)?.displayName ?? first.displayName)[0].toUpperCase()}
                </div>
                <span className="text-white font-bold text-sm truncate max-w-[80px] text-center mb-1">
                  {players.find((p) => p.id === first.playerId)?.displayName ?? first.displayName}
                </span>
                <span className="text-yellow-400 text-xs font-bold mb-1">{first.totalScore} pts</span>
                {/* Pillar */}
                <div
                  className="w-full rounded-t-lg bg-gradient-to-b from-yellow-400 to-yellow-600 flex items-start justify-center pt-2"
                  style={{ height: 112 }}
                >
                  <span className="text-yellow-900 font-black text-xl">1</span>
                </div>
              </motion.div>
            )}

            {/* 3rd place */}
            {third && (
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0, type: 'spring', stiffness: 120 }}
                className="flex flex-col items-center flex-1"
              >
                {/* Avatar */}
                <div
                  className="flex items-center justify-center rounded-full font-bold text-sm mb-1"
                  style={{
                    width: 44,
                    height: 44,
                    background: avatarGradient(third.playerId),
                    color: '#fff',
                    boxShadow: '0 0 0 2px rgba(180,83,9,0.5)',
                  }}
                >
                  {(players.find((p) => p.id === third.playerId)?.displayName ?? third.displayName)[0].toUpperCase()}
                </div>
                <span className="text-white/60 text-xs font-semibold truncate max-w-[68px] text-center mb-1">
                  {players.find((p) => p.id === third.playerId)?.displayName ?? third.displayName}
                </span>
                <span className="text-white/40 text-[10px] font-bold mb-1">{third.totalScore} pts</span>
                {/* Pillar */}
                <div
                  className="w-full rounded-t-lg bg-gradient-to-b from-amber-600 to-amber-800 flex items-start justify-center pt-2"
                  style={{ height: 56 }}
                >
                  <span className="text-amber-100 font-black text-lg">3</span>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* Rest of leaderboard (4th+) */}
        {restEntries.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-bold text-xs tracking-widest uppercase text-white/40">Also Played</span>
            <div className="flex flex-col gap-2">
              {restEntries.map((entry, i) => {
                const rank = i + 4;
                const isWinner = finalWinnerIds.includes(entry.playerId);
                const playerInfo = players.find((p) => p.id === entry.playerId);
                const displayName = playerInfo?.displayName ?? entry.displayName;
                return (
                  <div
                    key={entry.playerId}
                    className="flex items-center gap-4 px-5 py-3 rounded-2xl bg-white/5 border border-white/10"
                  >
                    <span className="font-bold text-sm w-5 text-center shrink-0 text-white/40">{rank}</span>
                    <div
                      className="flex items-center justify-center rounded-full font-bold text-xs shrink-0"
                      style={{
                        width: 36,
                        height: 36,
                        background: avatarGradient(entry.playerId),
                        color: '#fff',
                        boxShadow: isWinner ? '0 0 0 2px #f59e0b' : undefined,
                      }}
                    >
                      {displayName[0].toUpperCase()}
                    </div>
                    <span className="flex-1 font-semibold truncate text-white/80 text-sm">{displayName}</span>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="font-bold text-sm" style={{ color: isWinner ? '#f59e0b' : 'rgba(255,255,255,0.7)' }}>
                        {entry.totalScore} pts
                      </span>
                      {entry.bestAnswerVotes > 0 && (
                        <span className="text-[10px] text-white/30">
                          ⭐ {entry.bestAnswerVotes} vote{entry.bestAnswerVotes !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Best answer bonus */}
        {bonusPerWinner > 0 && winners.length > 0 && (
          <div className="rounded-2xl px-5 py-4 flex items-center gap-3 bg-yellow-400/10 border border-yellow-400/25">
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

        {/* Actions */}
        <div className="flex flex-col gap-3 pt-2">
          {/* Back to Lobby */}
          <button
            onClick={handlePlayAgain}
            className="w-full h-12 rounded-2xl font-semibold text-sm border border-white/15 text-white/60 bg-transparent transition-all hover:bg-white/5 hover:text-white/80"
          >
            Back to Lobby
          </button>

          {/* Play Again */}
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
            <button
              onClick={handlePlayAgain}
              className="w-full h-14 rounded-2xl font-bold text-lg text-white bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 flex items-center justify-center gap-2 shadow-lg transition-all"
              style={{ boxShadow: '0 0 24px rgba(245,158,11,0.35)' }}
            >
              <Zap size={20} />
              Play Again
            </button>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
