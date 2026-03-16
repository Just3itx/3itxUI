"use client";

import { useState, useEffect } from "react";

interface LoadingScreenProps {
  onComplete?: () => void;
  duration?: number; // total ms for loading to reach 100
}

// Diagonal "LOADING" banner strips across the screen
const BANNERS = [
  { top: "-8%",  left: "-10%", angle: -25, size: 72, opacity: 0.07, speed: 30 },
  { top: "5%",   left: "20%",  angle: -20, size: 90, opacity: 0.06, speed: 25 },
  { top: "15%",  left: "-5%",  angle: -30, size: 56, opacity: 0.08, speed: 35 },
  { top: "30%",  left: "40%",  angle: -22, size: 110, opacity: 0.05, speed: 20 },
  { top: "45%",  left: "-15%", angle: -28, size: 64, opacity: 0.09, speed: 28 },
  { top: "55%",  left: "10%",  angle: -18, size: 80, opacity: 0.06, speed: 32 },
  { top: "65%",  left: "50%",  angle: -25, size: 96, opacity: 0.05, speed: 22 },
  { top: "75%",  left: "-20%", angle: -32, size: 52, opacity: 0.1, speed: 38 },
  { top: "85%",  left: "30%",  angle: -20, size: 74, opacity: 0.07, speed: 26 },
  { top: "95%",  left: "60%",  angle: -28, size: 60, opacity: 0.08, speed: 30 },
];

export default function LoadingScreen({ onComplete, duration = 3000 }: LoadingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(Math.floor((elapsed / duration) * 100), 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(interval);
        // Start fade out
        setTimeout(() => setFadeOut(true), 200);
        // Notify parent after fade
        setTimeout(() => onComplete?.(), 700);
      }
    }, 30);
    return () => clearInterval(interval);
  }, [duration, onComplete]);

  const progressStr = String(progress).padStart(3, "0");
  // Pixel progress bar: 10 blocks
  const filledBlocks = Math.floor(progress / 10);

  return (
    <div
      className={`loading-screen ${fadeOut ? "loading-screen--out" : ""}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "#0a0a0a",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "opacity 0.5s ease-out",
        opacity: fadeOut ? 0 : 1,
      }}
    >
      {/* Grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "120px 120px",
          pointerEvents: "none",
        }}
      />

      {/* Diagonal hatching overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 2px,
            rgba(255,255,255,0.015) 2px,
            rgba(255,255,255,0.015) 4px
          )`,
          pointerEvents: "none",
        }}
      />

      {/* Animated LOADING banners */}
      {BANNERS.map((b, i) => (
        <div
          key={i}
          className="loading-banner"
          style={{
            position: "absolute",
            top: b.top,
            left: b.left,
            transform: `rotate(${b.angle}deg)`,
            whiteSpace: "nowrap",
            fontSize: `${b.size}px`,
            fontWeight: 900,
            fontFamily: "'JetBrains Mono', 'Impact', sans-serif",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "transparent",
            WebkitTextStroke: "1px rgba(255,255,255,0.08)",
            backgroundImage: `repeating-linear-gradient(
              45deg,
              rgba(255,255,255,${b.opacity}) 0px,
              rgba(255,255,255,${b.opacity}) 2px,
              transparent 2px,
              transparent 5px
            )`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            animation: `loadingSlide${i % 2 === 0 ? "Left" : "Right"} ${b.speed}s linear infinite`,
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          LOADING&nbsp;&nbsp;&nbsp;LOADING&nbsp;&nbsp;&nbsp;LOADING&nbsp;&nbsp;&nbsp;LOADING&nbsp;&nbsp;&nbsp;LOADING&nbsp;&nbsp;&nbsp;LOADING&nbsp;&nbsp;&nbsp;LOADING&nbsp;&nbsp;&nbsp;LOADING
        </div>
      ))}

      {/* Center progress indicator */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: "rgba(0,0,0,0.85)",
          border: "1px solid rgba(255,255,255,0.1)",
          padding: "8px 16px",
        }}
      >
        {/* Number */}
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "14px",
            fontWeight: 700,
            color: "#fff",
            letterSpacing: "0.05em",
            minWidth: "36px",
          }}
        >
          {progressStr}
        </span>

        {/* Pixel progress bar */}
        <div style={{ display: "flex", gap: "2px" }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: "10px",
                height: "14px",
                background: i < filledBlocks ? "#fff" : "rgba(255,255,255,0.1)",
                transition: "background 0.15s ease",
              }}
            />
          ))}
        </div>
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes loadingSlideLeft {
          0% { transform: translateX(0%) rotate(-25deg); }
          100% { transform: translateX(-50%) rotate(-25deg); }
        }
        @keyframes loadingSlideRight {
          0% { transform: translateX(-50%) rotate(-25deg); }
          100% { transform: translateX(0%) rotate(-25deg); }
        }
      `}</style>
    </div>
  );
}
