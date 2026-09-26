'use client'

import { Skull } from 'lucide-react'
import type { VisualEffectType } from '@/app/lib/config/boss-easter-eggs'

interface BossEasterEggVisualEffectsPartOneProps {
  activeVisualEffect: VisualEffectType
}

export function BossEasterEggVisualEffectsPartOne({
  activeVisualEffect
}: BossEasterEggVisualEffectsPartOneProps) {
  return (
    <>
      {/* Targeting Reticle - T'au */}
      {activeVisualEffect === 'targeting_reticle' && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="targeting-reticle">
              <div className="reticle-ring" />
              <div className="reticle-crosshair-h" />
              <div className="reticle-crosshair-v" />
              <div className="reticle-dot" />
            </div>
          </div>
          <div className="absolute top-4 right-4 font-mono text-xs text-orange-400 animate-pulse">
            TARGET ACQUIRED
          </div>
        </div>
      )}

      {/* Servo Skull - Mechanicus */}
      {activeVisualEffect === 'servo_skull' && (
        <div className="fixed z-40 pointer-events-none servo-skull-container">
          <div className="servo-skull">
            <Skull className="h-10 w-10 text-slate-200" />
            <div className="servo-skull-glow" />
          </div>
          <div className="servo-skull-trail" />
        </div>
      )}

      {/* Binary Rain - Mechanicus */}
      {activeVisualEffect === 'binary_rain' && (
        <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="binary-column"
              style={{
                left: `${5 + i * 5}%`,
                animationDelay: `${i * 0.15}s`
              }}
            >
              {Array.from({ length: 15 }).map((_, j) => (
                <span key={j} className="text-green-500/60 text-xs font-mono">
                  {Math.random() > 0.5 ? '1' : '0'}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Poison Cloud - Nurgle */}
      {activeVisualEffect === 'poison_cloud' && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="poison-cloud-overlay" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="poison-bubble"
              style={{
                left: `${10 + Math.random() * 80}%`,
                bottom: `${Math.random() * 30}%`,
                animationDelay: `${i * 0.3}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Psychic Eye - Tzeentch/Tyranid */}
      {activeVisualEffect === 'psychic_eye' && (
        <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center">
          <div className="psychic-eye">
            <div className="psychic-eye-outer" />
            <div className="psychic-eye-iris" />
            <div className="psychic-eye-pupil" />
          </div>
        </div>
      )}

      {/* Warp Flames - Tzeentch */}
      {activeVisualEffect === 'warp_flames' && (
        <div className="fixed inset-x-0 bottom-0 h-32 z-40 pointer-events-none">
          <div className="warp-flames" />
        </div>
      )}

      {/* Visual effect styles */}
      <style jsx>{`
        /* Targeting Reticle - T'au */
        .targeting-reticle {
          position: relative;
          width: 200px;
          height: 200px;
          animation: reticle-pulse 1s ease-in-out infinite;
        }
        .reticle-ring {
          position: absolute;
          inset: 0;
          border: 2px solid #f97316;
          border-radius: 50%;
          animation: reticle-rotate 3s linear infinite;
        }
        .reticle-ring::before {
          content: '';
          position: absolute;
          inset: 10px;
          border: 1px dashed #f9731680;
          border-radius: 50%;
        }
        .reticle-crosshair-h,
        .reticle-crosshair-v {
          position: absolute;
          background: #f97316;
        }
        .reticle-crosshair-h {
          top: 50%;
          left: 20px;
          right: 20px;
          height: 1px;
          transform: translateY(-50%);
        }
        .reticle-crosshair-v {
          left: 50%;
          top: 20px;
          bottom: 20px;
          width: 1px;
          transform: translateX(-50%);
        }
        .reticle-dot {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 8px;
          height: 8px;
          background: #f97316;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          animation: reticle-blink 0.5s ease-in-out infinite;
        }
        @keyframes reticle-pulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.8;
          }
          50% {
            transform: scale(1.05);
            opacity: 1;
          }
        }
        @keyframes reticle-rotate {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes reticle-blink {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.3;
          }
        }

        /* Servo Skull - Mechanicus */
        .servo-skull-container {
          animation: servo-float 5s ease-in-out forwards;
        }
        .servo-skull {
          position: relative;
          filter: drop-shadow(0 0 10px #22c55e);
        }
        .servo-skull-glow {
          position: absolute;
          inset: -10px;
          background: radial-gradient(circle, #22c55e40 0%, transparent 70%);
          animation: servo-glow 1s ease-in-out infinite;
        }
        @keyframes servo-float {
          0% {
            top: 20%;
            left: -10%;
          }
          25% {
            top: 30%;
            left: 30%;
          }
          50% {
            top: 20%;
            left: 60%;
          }
          75% {
            top: 40%;
            left: 80%;
          }
          100% {
            top: 30%;
            left: 110%;
          }
        }
        @keyframes servo-glow {
          0%,
          100% {
            opacity: 0.5;
          }
          50% {
            opacity: 1;
          }
        }

        /* Binary Rain - Mechanicus */
        .binary-column {
          position: absolute;
          top: -20px;
          display: flex;
          flex-direction: column;
          animation: binary-fall 2s linear infinite;
        }
        @keyframes binary-fall {
          0% {
            transform: translateY(-100%);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateY(100vh);
            opacity: 0;
          }
        }

        /* Poison Cloud - Nurgle */
        .poison-cloud-overlay {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            ellipse at center,
            #22c55e20 0%,
            transparent 70%
          );
          animation: poison-pulse 2s ease-in-out infinite;
        }
        .poison-bubble {
          position: absolute;
          width: 20px;
          height: 20px;
          background: radial-gradient(circle, #22c55e60 0%, #84cc1640 100%);
          border-radius: 50%;
          animation: poison-rise 3s ease-out infinite;
        }
        @keyframes poison-pulse {
          0%,
          100% {
            opacity: 0.3;
          }
          50% {
            opacity: 0.6;
          }
        }
        @keyframes poison-rise {
          0% {
            transform: translateY(0) scale(1);
            opacity: 0.8;
          }
          100% {
            transform: translateY(-200px) scale(1.5);
            opacity: 0;
          }
        }

        /* Psychic Eye - Tzeentch/Tyranid */
        .psychic-eye {
          position: relative;
          width: 120px;
          height: 120px;
          animation: eye-appear 0.5s ease-out;
        }
        .psychic-eye-outer {
          position: absolute;
          inset: 0;
          border: 3px solid #a855f7;
          border-radius: 50% 0 50% 0;
          transform: rotate(45deg);
          animation: eye-pulse 1.5s ease-in-out infinite;
        }
        .psychic-eye-iris {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 50px;
          height: 50px;
          background: radial-gradient(circle, #7c3aed 0%, #4c1d95 100%);
          border-radius: 50%;
          transform: translate(-50%, -50%);
        }
        .psychic-eye-pupil {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 20px;
          height: 20px;
          background: #000;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          animation: eye-look 2s ease-in-out infinite;
        }
        @keyframes eye-appear {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes eye-pulse {
          0%,
          100% {
            box-shadow: 0 0 20px #a855f7;
          }
          50% {
            box-shadow:
              0 0 40px #a855f7,
              0 0 60px #7c3aed;
          }
        }
        @keyframes eye-look {
          0%,
          100% {
            transform: translate(-50%, -50%);
          }
          25% {
            transform: translate(-40%, -45%);
          }
          75% {
            transform: translate(-60%, -55%);
          }
        }

        /* Warp Flames - Tzeentch */
        .warp-flames {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            0deg,
            #7c3aed 0%,
            #a855f780 30%,
            #3b82f640 60%,
            transparent 100%
          );
          animation: warp-flicker 0.15s ease-in-out infinite;
        }
        @keyframes warp-flicker {
          0%,
          100% {
            opacity: 0.8;
            transform: scaleY(1);
          }
          50% {
            opacity: 0.6;
            transform: scaleY(1.1);
          }
        }
      `}</style>
    </>
  )
}
