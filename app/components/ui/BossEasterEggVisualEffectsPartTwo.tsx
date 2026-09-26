'use client'

import { Bug, Shield } from 'lucide-react'
import type { VisualEffectType } from '@/app/lib/config/boss-easter-eggs'

interface BossEasterEggVisualEffectsPartTwoProps {
  activeVisualEffect: VisualEffectType
}

export function BossEasterEggVisualEffectsPartTwo({
  activeVisualEffect
}: BossEasterEggVisualEffectsPartTwoProps) {
  return (
    <>
      {/* WAAAGH Energy - Orks */}
      {activeVisualEffect === 'waaagh_energy' && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="waaagh-flash" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-6xl font-black text-green-500 waaagh-text animate-pulse">
              WAAAGH!
            </span>
          </div>
        </div>
      )}

      {/* Dakka Holes - Orks */}
      {activeVisualEffect === 'dakka_holes' && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="dakka-hole"
              style={{
                top: `${10 + Math.random() * 80}%`,
                left: `${10 + Math.random() * 80}%`,
                animationDelay: `${i * 0.1}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Gauss Flayer - Necrons */}
      {activeVisualEffect === 'gauss_flayer' && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="gauss-beam" />
          <div className="gauss-beam gauss-beam-2" />
        </div>
      )}

      {/* Scarab Swarm - Necrons */}
      {activeVisualEffect === 'scarab_swarm' && (
        <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden">
          {Array.from({ length: 15 }).map((_, i) => (
            <div
              key={i}
              className="scarab"
              style={{
                top: `${Math.random() * 100}%`,
                left: `${-10 + Math.random() * 20}%`,
                animationDelay: `${i * 0.2}s`,
                animationDuration: `${2 + Math.random() * 2}s`
              }}
            >
              <Bug className="h-5 w-5 text-emerald-300" />
            </div>
          ))}
        </div>
      )}

      {/* Blood Drip - Khaine */}
      {activeVisualEffect === 'blood_drip' && (
        <div className="fixed inset-x-0 top-0 z-40 pointer-events-none">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="blood-drip"
              style={{
                left: `${5 + i * 10}%`,
                animationDelay: `${i * 0.2}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Flame Border - Khaine */}
      {activeVisualEffect === 'flame_border' && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="flame-border" />
        </div>
      )}

      {/* Bio Tendrils - Tyranids */}
      {activeVisualEffect === 'bio_tendrils' && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          {['left', 'right', 'bottom'].map((side) => (
            <div key={side} className={`bio-tendril bio-tendril-${side}`} />
          ))}
        </div>
      )}

      {/* Acid Splatter - Tyranids */}
      {activeVisualEffect === 'acid_splatter' && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="acid-splat"
              style={{
                top: `${20 + Math.random() * 60}%`,
                left: `${10 + Math.random() * 80}%`,
                animationDelay: `${i * 0.15}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Fortification - Imperial Fists */}
      {activeVisualEffect === 'fortification' && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="fortification-shield" />
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 font-mono text-xs text-yellow-400 animate-pulse">
            <Shield className="h-4 w-4" />
            <span>AEGIS PROTOCOL ACTIVE</span>
            <Shield className="h-4 w-4" />
          </div>
        </div>
      )}

      {/* Visual effect styles */}
      <style jsx>{`
        /* WAAAGH Energy - Orks */
        .waaagh-flash {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            circle at center,
            #22c55e40 0%,
            transparent 70%
          );
          animation: waaagh-pulse 0.3s ease-out infinite;
        }
        .waaagh-text {
          text-shadow:
            0 0 20px #22c55e,
            0 0 40px #22c55e,
            0 0 60px #16a34a;
          animation: waaagh-shake 0.1s ease-in-out infinite;
        }
        @keyframes waaagh-pulse {
          0% {
            transform: scale(1);
            opacity: 0.5;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.8;
          }
          100% {
            transform: scale(1);
            opacity: 0.5;
          }
        }
        @keyframes waaagh-shake {
          0%,
          100% {
            transform: translate(0, 0) rotate(0deg);
          }
          25% {
            transform: translate(-5px, 5px) rotate(-2deg);
          }
          50% {
            transform: translate(5px, -5px) rotate(2deg);
          }
          75% {
            transform: translate(-3px, -3px) rotate(-1deg);
          }
        }

        /* Dakka Holes - Orks */
        .dakka-hole {
          position: absolute;
          width: 15px;
          height: 15px;
          background: radial-gradient(
            circle,
            #000 40%,
            #44403c 60%,
            transparent 70%
          );
          border-radius: 50%;
          animation: dakka-appear 0.1s ease-out forwards;
          box-shadow:
            inset 0 0 5px #000,
            0 0 3px #78716c;
        }
        @keyframes dakka-appear {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          50% {
            transform: scale(1.5);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        /* Gauss Flayer - Necrons */
        .gauss-beam {
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(
            90deg,
            transparent,
            #22c55e,
            #4ade80,
            #22c55e,
            transparent
          );
          animation: gauss-sweep 1s ease-in-out;
          box-shadow:
            0 0 10px #22c55e,
            0 0 20px #22c55e;
        }
        .gauss-beam-2 {
          top: 60%;
          animation-delay: 0.3s;
        }
        @keyframes gauss-sweep {
          0% {
            transform: translateY(-50vh) rotate(-5deg);
            opacity: 0;
          }
          20% {
            opacity: 1;
          }
          80% {
            opacity: 1;
          }
          100% {
            transform: translateY(50vh) rotate(5deg);
            opacity: 0;
          }
        }

        /* Scarab Swarm - Necrons */
        .scarab {
          position: absolute;
          font-size: 1rem;
          animation: scarab-crawl linear forwards;
          filter: hue-rotate(60deg) brightness(1.2);
        }
        @keyframes scarab-crawl {
          0% {
            transform: translateX(0) rotate(0deg);
          }
          25% {
            transform: translateX(30vw) rotate(10deg) translateY(-20px);
          }
          50% {
            transform: translateX(60vw) rotate(-5deg) translateY(10px);
          }
          75% {
            transform: translateX(90vw) rotate(15deg) translateY(-10px);
          }
          100% {
            transform: translateX(120vw) rotate(0deg);
          }
        }

        /* Blood Drip - Khaine */
        .blood-drip {
          position: absolute;
          top: 0;
          width: 8px;
          height: 0;
          background: linear-gradient(180deg, #dc2626 0%, #7f1d1d 100%);
          border-radius: 0 0 50% 50%;
          animation: blood-drip 2s ease-in forwards;
        }
        @keyframes blood-drip {
          0% {
            height: 0;
          }
          100% {
            height: 150px;
          }
        }

        /* Flame Border - Khaine */
        .flame-border {
          position: absolute;
          inset: 0;
          border: 4px solid transparent;
          border-image: linear-gradient(45deg, #dc2626, #f97316, #dc2626) 1;
          animation: flame-border-pulse 0.5s ease-in-out infinite;
          box-shadow: inset 0 0 30px #dc262640;
        }
        @keyframes flame-border-pulse {
          0%,
          100% {
            opacity: 0.8;
          }
          50% {
            opacity: 1;
          }
        }

        /* Bio Tendrils - Tyranids */
        .bio-tendril {
          position: absolute;
          background: linear-gradient(90deg, #a855f780, #7c3aed40);
          animation: tendril-reach 2s ease-out forwards;
        }
        .bio-tendril-left {
          left: 0;
          top: 30%;
          width: 0;
          height: 80px;
          border-radius: 0 40px 40px 0;
        }
        .bio-tendril-right {
          right: 0;
          top: 50%;
          width: 0;
          height: 60px;
          border-radius: 40px 0 0 40px;
        }
        .bio-tendril-bottom {
          bottom: 0;
          left: 40%;
          width: 100px;
          height: 0;
          border-radius: 40px 40px 0 0;
        }
        @keyframes tendril-reach {
          0% {
            width: 0;
            height: 0;
          }
          100% {
            width: 120px;
            height: 80px;
          }
        }
        .bio-tendril-bottom {
          animation: tendril-reach-up 2s ease-out forwards;
        }
        @keyframes tendril-reach-up {
          0% {
            height: 0;
          }
          100% {
            height: 100px;
          }
        }

        /* Acid Splatter - Tyranids */
        .acid-splat {
          position: absolute;
          width: 30px;
          height: 30px;
          background: radial-gradient(
            ellipse,
            #22c55e80 0%,
            #84cc1660 50%,
            transparent 70%
          );
          border-radius: 50% 40% 60% 30%;
          animation:
            acid-appear 0.3s ease-out forwards,
            acid-dissolve 3s ease-in 0.3s forwards;
        }
        @keyframes acid-appear {
          0% {
            transform: scale(0);
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes acid-dissolve {
          0% {
            opacity: 0.8;
          }
          100% {
            opacity: 0;
            transform: scale(1.5);
          }
        }

        /* Fortification - Imperial Fists */
        .fortification-shield {
          position: absolute;
          inset: 20px;
          border: 3px solid #eab308;
          border-radius: 10px;
          animation: shield-pulse 1s ease-in-out infinite;
          background: linear-gradient(
            135deg,
            #eab30810 0%,
            transparent 50%,
            #eab30810 100%
          );
        }
        .fortification-shield::before {
          content: '';
          position: absolute;
          inset: 10px;
          border: 1px dashed #eab30860;
          border-radius: 8px;
        }
        @keyframes shield-pulse {
          0%,
          100% {
            box-shadow:
              0 0 10px #eab30860,
              inset 0 0 20px #eab30820;
          }
          50% {
            box-shadow:
              0 0 20px #eab308,
              inset 0 0 40px #eab30840;
          }
        }
      `}</style>
    </>
  )
}
