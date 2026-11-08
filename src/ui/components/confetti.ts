import { prefersReducedMotion } from '../dom.ts';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
  life: number;
  shape: 'rect' | 'circle';
}

const COLORS = ['#f5c542', '#ffdf7e', '#ffffff', '#4d7cff', '#8a5cff', '#2fd17a'];

/** A tiny canvas confetti cannon. One shared canvas, animated only while particles exist. */
export class Confetti {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private particles: Particle[] = [];
  private frame = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Fires `count` particles from a point given as fractions of the viewport. */
  burst(count = 120, originX = 0.5, originY = 0.35): void {
    if (!this.ctx || prefersReducedMotion()) return;
    const x = window.innerWidth * originX;
    const y = window.innerHeight * originY;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 9;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6,
        size: 5 + Math.random() * 7,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? '#f5c542',
        life: 1,
        shape: Math.random() < 0.7 ? 'rect' : 'circle',
      });
    }
    if (!this.frame) this.frame = requestAnimationFrame(() => this.tick());
  }

  /** Big celebration: several bursts across the screen. */
  celebrate(): void {
    [0.2, 0.5, 0.8].forEach((x, i) => setTimeout(() => this.burst(110, x, 0.3), i * 250));
    setTimeout(() => this.burst(160, 0.5, 0.2), 900);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (const p of this.particles) {
      p.vy += 0.25;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.life -= 0.006;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    this.particles = this.particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);
    this.frame = this.particles.length > 0 ? requestAnimationFrame(() => this.tick()) : 0;
    if (!this.frame) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}
