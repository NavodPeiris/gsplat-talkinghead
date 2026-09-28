import { useEffect, useRef } from 'react';

interface AudioBarsProps {
  getMicLevel: () => number;
  getAgentLevel: () => number;
  isActive: boolean;
  /** Bar fill color. Defaults to white. */
  color?: string;
}

const BAR_COUNT = 5;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const MAX_HEIGHT = 18;
const MIN_HEIGHT = 3;

export function AudioBars({ getMicLevel, getAgentLevel, isActive, color = 'white' }: AudioBarsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const totalWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
    // Backing store at device resolution so the bars stay crisp on HiDPI.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalWidth * dpr;
    canvas.height = MAX_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const draw = () => {
      ctx.clearRect(0, 0, totalWidth, MAX_HEIGHT);

      const level = isActive ? Math.max(getMicLevel(), getAgentLevel()) : 0;
      const noise = isActive ? level : 0;

      for (let i = 0; i < BAR_COUNT; i++) {
        // Each bar gets a slightly different random height based on level
        const variance = (Math.random() * 0.6 + 0.7);
        const h = isActive
          ? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, noise * MAX_HEIGHT * variance + MIN_HEIGHT))
          : MIN_HEIGHT;

        const x = i * (BAR_WIDTH + BAR_GAP);
        const y = (MAX_HEIGHT - h) / 2;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_WIDTH, h, 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [isActive, getMicLevel, getAgentLevel, color]);

  const totalWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;

  return (
    <canvas
      ref={canvasRef}
      width={totalWidth}
      height={MAX_HEIGHT}
      style={{ display: 'block', width: totalWidth, height: MAX_HEIGHT }}
    />
  );
}
