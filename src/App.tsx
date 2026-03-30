import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Rocket, 
  Shield, 
  Zap, 
  Trophy, 
  Play, 
  Settings, 
  Skull, 
  ChevronRight, 
  RotateCcw,
  Home,
  Star
} from 'lucide-react';

// --- Types & Constants ---

type GameState = 'MENU' | 'STORY' | 'PLAYING' | 'BOSS_INTRO' | 'STAGE_CLEAR' | 'GAME_OVER' | 'VICTORY';

interface Entity {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  health: number;
  maxHealth: number;
  speed: number;
}

interface Player extends Entity {
  score: number;
  fireRate: number;
  lastFired: number;
  powerLevel: number;
  shieldTimer: number;
  multiShot: number;
}

type PowerUpType = 'HEAL' | 'FIRE_RATE' | 'MULTI_SHOT' | 'SHIELD';

interface PowerUp {
  x: number;
  y: number;
  width: number;
  height: number;
  type: PowerUpType;
  color: string;
  speed: number;
}

interface Enemy extends Entity {
  type: 'BASIC' | 'FAST' | 'TANK' | 'BOSS';
  shape: 'TRIANGLE' | 'SQUARE' | 'CIRCLE' | 'DIAMOND';
  points: number;
  shootTimer: number;
  shootInterval: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  damage: number;
  fromPlayer: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const MAX_STAGES = 9;

// --- Helper Functions ---

const saveProgress = (stage: number) => {
  const current = localStorage.getItem('galactic_vanguard_stage');
  if (!current || parseInt(current) < stage) {
    localStorage.setItem('galactic_vanguard_stage', stage.toString());
  }
};

const getProgress = () => {
  const saved = localStorage.getItem('galactic_vanguard_stage');
  return saved ? parseInt(saved) : 1;
};

// --- Main Component ---

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('MENU');
  const [currentStage, setCurrentStage] = useState(1);
  const [unlockedStage, setUnlockedStage] = useState(getProgress());
  const [score, setScore] = useState(0);
  const [money, setMoney] = useState(0);
  const [encouragement, setEncouragement] = useState('');
  const [highScore, setHighScore] = useState(parseInt(localStorage.getItem('galactic_vanguard_highscore') || '0'));

  // Game Refs
  const playerRef = useRef<Player>({
    x: CANVAS_WIDTH / 2 - 30,
    y: CANVAS_HEIGHT - 80,
    width: 60,
    height: 60,
    color: '#3b82f6',
    health: 100,
    maxHealth: 100,
    speed: 5,
    score: 0,
    fireRate: 250,
    lastFired: 0,
    powerLevel: 1,
    shieldTimer: 0,
    multiShot: 1
  });

  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const powerUpsRef = useRef<PowerUp[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const requestRef = useRef<number>(0);
  const stageProgressRef = useRef(0); // 0 to 100
  const bossSpawnedRef = useRef(false);
  const isAutoLootingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicOscRef = useRef<OscillatorNode | null>(null);

  // --- Audio Logic ---

  const initAudio = () => {
    if (audioCtxRef.current) return;
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  };

  const startMusic = () => {
    if (!audioCtxRef.current) initAudio();
    const ctx = audioCtxRef.current!;
    if (ctx.state === 'suspended') ctx.resume();

    if (musicOscRef.current) return;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.05;
    masterGain.connect(ctx.destination);

    const playNote = (freq: number, time: number, duration: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, time);
      g.gain.setValueAtTime(0.1, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(time);
      osc.stop(time + duration);
    };

    const sequence = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
    let step = 0;
    
    const loop = () => {
      if (gameState !== 'PLAYING' && gameState !== 'BOSS_INTRO') return;
      const now = ctx.currentTime;
      playNote(sequence[step % sequence.length], now, 0.5);
      step++;
      setTimeout(loop, 250);
    };
    
    loop();
  };

  // --- Game Loop Logic ---

  const initStage = (stage: number) => {
    playerRef.current.health = 100;
    playerRef.current.x = CANVAS_WIDTH / 2 - 30;
    playerRef.current.y = CANVAS_HEIGHT - 80;
    playerRef.current.shieldTimer = 0;
    playerRef.current.multiShot = 1;
    playerRef.current.fireRate = 250;
    enemiesRef.current = [];
    bulletsRef.current = [];
    particlesRef.current = [];
    powerUpsRef.current = [];
    stageProgressRef.current = 0;
    bossSpawnedRef.current = false;
    isAutoLootingRef.current = false;
    setScore(0);
    setMoney(0);
    if (gameState === 'MENU') startMusic();
  };

  const spawnEnemy = (stage: number) => {
    if (bossSpawnedRef.current) return;

    // Reduced difficulty scaling for early stages
    const difficulty = 1 + (stage - 1) * 0.3;
    const rand = Math.random();
    let type: Enemy['type'] = 'BASIC';
    let health = 20 * difficulty;
    
    // Slower base speed for early stages
    let baseSpeed = 1 + (stage * 0.2);
    let speed = baseSpeed + Math.random() * 1;
    
    const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];
    let color = colors[Math.floor(Math.random() * colors.length)];
    let points = 100;
    
    const shapes: Enemy['shape'][] = ['TRIANGLE', 'SQUARE', 'CIRCLE', 'DIAMOND'];
    let shape = shapes[Math.floor(Math.random() * shapes.length)];

    if (rand > 0.8) {
      type = 'FAST';
      health = 10 * difficulty;
      speed = (baseSpeed * 2) + Math.random() * 2;
      points = 150;
    } else if (rand > 0.95) {
      type = 'TANK';
      health = 60 * difficulty;
      speed = (baseSpeed * 0.5) + Math.random() * 0.5;
      points = 300;
    }

    enemiesRef.current.push({
      x: Math.random() * (CANVAS_WIDTH - 40),
      y: -50,
      width: 40,
      height: 40,
      color,
      health,
      maxHealth: health,
      speed,
      type,
      shape,
      points,
      shootTimer: 0,
      shootInterval: 3000 / difficulty // Slower shooting in early stages
    });
  };

  const spawnBoss = (stage: number) => {
    setGameState('BOSS_INTRO');
    const difficulty = 1 + (stage - 1) * 1.5;
    const health = 500 * difficulty;
    enemiesRef.current.push({
      x: CANVAS_WIDTH / 2 - 60,
      y: -150,
      width: 120,
      height: 80,
      color: '#dc2626',
      health,
      maxHealth: health,
      speed: 1,
      type: 'BOSS',
      points: 5000 * stage,
      shootTimer: 0,
      shootInterval: 1000 / difficulty
    });
    bossSpawnedRef.current = true;
  };

  const spawnPowerUp = (x: number, y: number) => {
    const types: PowerUpType[] = ['HEAL', 'FIRE_RATE', 'MULTI_SHOT', 'SHIELD'];
    const type = types[Math.floor(Math.random() * types.length)];
    const colors = {
      HEAL: '#10b981',
      FIRE_RATE: '#f59e0b',
      MULTI_SHOT: '#3b82f6',
      SHIELD: '#8b5cf6'
    };

    powerUpsRef.current.push({
      x,
      y,
      width: 30,
      height: 30,
      type,
      color: colors[type],
      speed: 2
    });
  };

  const createExplosion = (x: number, y: number, color: string, count = 10) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 1,
        maxLife: 0.5 + Math.random() * 0.5,
        color,
        size: 2 + Math.random() * 4
      });
    }
  };

  const update = (time: number) => {
    if (gameState !== 'PLAYING') return;

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    // Player Movement
    const p = playerRef.current;
    if (p.shieldTimer > 0) p.shieldTimer -= 16;
    
    if (keysRef.current['ArrowLeft'] || keysRef.current['a']) p.x -= p.speed;
    if (keysRef.current['ArrowRight'] || keysRef.current['d']) p.x += p.speed;
    if (keysRef.current['ArrowUp'] || keysRef.current['w']) p.y -= p.speed;
    if (keysRef.current['ArrowDown'] || keysRef.current['s']) p.y += p.speed;

    // Bounds
    p.x = Math.max(0, Math.min(CANVAS_WIDTH - p.width, p.x));
    p.y = Math.max(0, Math.min(CANVAS_HEIGHT - p.height, p.y));

    // Shooting
    if (keysRef.current[' '] || keysRef.current['Enter']) {
      if (time - p.lastFired > p.fireRate) {
        const bulletSpeed = -10;
        const damage = 10;
        
        if (p.multiShot === 1) {
          bulletsRef.current.push({
            x: p.x + p.width / 2,
            y: p.y,
            vx: 0,
            vy: bulletSpeed,
            radius: 4,
            color: '#60a5fa',
            damage,
            fromPlayer: true
          });
        } else if (p.multiShot === 2) {
          bulletsRef.current.push({ x: p.x + p.width / 4, y: p.y, vx: 0, vy: bulletSpeed, radius: 4, color: '#60a5fa', damage, fromPlayer: true });
          bulletsRef.current.push({ x: p.x + (p.width * 3) / 4, y: p.y, vx: 0, vy: bulletSpeed, radius: 4, color: '#60a5fa', damage, fromPlayer: true });
        } else {
          bulletsRef.current.push({ x: p.x + p.width / 2, y: p.y, vx: 0, vy: bulletSpeed, radius: 4, color: '#60a5fa', damage, fromPlayer: true });
          bulletsRef.current.push({ x: p.x, y: p.y + 10, vx: -2, vy: bulletSpeed, radius: 4, color: '#60a5fa', damage, fromPlayer: true });
          bulletsRef.current.push({ x: p.x + p.width, y: p.y + 10, vx: 2, vy: bulletSpeed, radius: 4, color: '#60a5fa', damage, fromPlayer: true });
        }
        p.lastFired = time;
      }
    }

    // Progress & Spawning
    if (!bossSpawnedRef.current) {
      stageProgressRef.current += 0.05;
      if (Math.random() < 0.02) spawnEnemy(currentStage);
      if (stageProgressRef.current >= 100) spawnBoss(currentStage);
    }

    // Update Bullets
    bulletsRef.current = bulletsRef.current.filter(b => {
      b.x += b.vx;
      b.y += b.vy;
      return b.y > -20 && b.y < CANVAS_HEIGHT + 20 && b.x > -20 && b.x < CANVAS_WIDTH + 20;
    });

    // Update Enemies
    enemiesRef.current = enemiesRef.current.filter(e => {
      if (e.type === 'BOSS') {
        if (e.y < 50) e.y += e.speed;
        e.x += Math.sin(time / 500) * 2;
      } else {
        e.y += e.speed;
      }

      // Enemy Shooting
      e.shootTimer += 16; // Approx ms per frame
      if (e.shootTimer > e.shootInterval) {
        bulletsRef.current.push({
          x: e.x + e.width / 2,
          y: e.y + e.height,
          vx: e.type === 'BOSS' ? (Math.random() - 0.5) * 5 : 0,
          vy: 5,
          radius: 4,
          color: '#f87171',
          damage: 10,
          fromPlayer: false
        });
        e.shootTimer = 0;
      }

      // Collision with Player
      if (
        p.x < e.x + e.width &&
        p.x + p.width > e.x &&
        p.y < e.y + e.height &&
        p.y + p.height > e.y
      ) {
        p.health -= 0.5;
        if (e.type !== 'BOSS') {
          e.health = 0;
          createExplosion(e.x + e.width / 2, e.y + e.height / 2, e.color);
        }
      }

      return e.y < CANVAS_HEIGHT && e.health > 0;
    });

    // Bullet Collisions
    bulletsRef.current.forEach((b, bi) => {
      if (b.fromPlayer) {
        enemiesRef.current.forEach((e) => {
          if (
            b.x > e.x && b.x < e.x + e.width &&
            b.y > e.y && b.y < e.y + e.height
          ) {
            e.health -= b.damage;
            bulletsRef.current.splice(bi, 1);
            if (e.health <= 0) {
              setScore(s => s + e.points);
              setMoney(m => m + Math.floor(e.points / 10));
              createExplosion(e.x + e.width / 2, e.y + e.height / 2, e.color, e.type === 'BOSS' ? 50 : 15);
              
              // Drop Power-up
              if (e.type === 'TANK' || e.type === 'BOSS' || Math.random() < 0.1) {
                spawnPowerUp(e.x + e.width / 2, e.y + e.height / 2);
              }

              if (e.type === 'BOSS') {
                isAutoLootingRef.current = true;
                const encouragements = [
                  "Incredible flying, pilot!",
                  "The Sector is safe... for now.",
                  "Your waifu would be proud!",
                  "Total domination!",
                  "They never stood a chance.",
                  "One step closer to the Big Boss."
                ];
                setEncouragement(encouragements[Math.floor(Math.random() * encouragements.length)]);
                
                setTimeout(() => {
                  if (currentStage === MAX_STAGES) setGameState('VICTORY');
                  else setGameState('STAGE_CLEAR');
                }, 4000); // Extended delay to savor the win
              }
            }
          }
        });
      } else {
        if (
          b.x > p.x && b.x < p.x + p.width &&
          b.y > p.y && b.y < p.y + p.height
        ) {
          if (p.shieldTimer <= 0) {
            p.health -= b.damage;
            createExplosion(b.x, b.y, '#3b82f6', 5);
          }
          bulletsRef.current.splice(bi, 1);
        }
      }
    });

    // Update Power-ups
    powerUpsRef.current = powerUpsRef.current.filter(pu => {
      if (isAutoLootingRef.current) {
        // Magnet effect towards player
        const dx = p.x + p.width / 2 - pu.x;
        const dy = p.y + p.height / 2 - pu.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        pu.x += (dx / dist) * 15;
        pu.y += (dy / dist) * 15;
      } else {
        pu.y += pu.speed;
      }
      
      // Collision with Player
      if (
        p.x < pu.x + pu.width &&
        p.x + p.width > pu.x &&
        p.y < pu.y + pu.height &&
        p.y + p.height > pu.y
      ) {
        // Apply Power-up
        switch (pu.type) {
          case 'HEAL':
            p.health = Math.min(p.maxHealth, p.health + 25);
            break;
          case 'FIRE_RATE':
            p.fireRate = Math.max(100, p.fireRate - 30);
            break;
          case 'MULTI_SHOT':
            p.multiShot = Math.min(3, p.multiShot + 1);
            break;
          case 'SHIELD':
            p.shieldTimer = 5000;
            break;
        }
        createExplosion(pu.x + pu.width / 2, pu.y + pu.height / 2, pu.color, 20);
        return false;
      }
      
      return pu.y < CANVAS_HEIGHT;
    });

    // Particles
    particlesRef.current.forEach(part => {
      part.x += part.vx;
      part.y += part.vy;
      part.life -= 0.02;
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);

    // Death
    if (p.health <= 0) {
      setGameState('GAME_OVER');
      if (score > highScore) {
        setHighScore(score);
        localStorage.setItem('galactic_vanguard_highscore', score.toString());
      }
    }

    // Draw
    draw(ctx);
    requestRef.current = requestAnimationFrame(update);
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Background Stars
    ctx.fillStyle = 'white';
    for (let i = 0; i < 50; i++) {
      const x = (Math.random() * CANVAS_WIDTH + Date.now() / 50) % CANVAS_WIDTH;
      const y = (Math.random() * CANVAS_HEIGHT + Date.now() / 20) % CANVAS_HEIGHT;
      ctx.fillRect(x, y, 1, 1);
    }

    // Player
    const p = playerRef.current;
    if (p.shieldTimer > 0) {
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x + p.width / 2, p.y + p.height / 2, p.width * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(p.x + p.width / 2, p.y);
    ctx.lineTo(p.x, p.y + p.height);
    ctx.lineTo(p.x + p.width, p.y + p.height);
    ctx.closePath();
    ctx.fill();
    // Engine glow
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(p.x + p.width / 4, p.y + p.height, p.width / 2, 5 + Math.random() * 5);

    // Enemies
    enemiesRef.current.forEach(e => {
      ctx.fillStyle = e.color;
      if (e.type === 'BOSS') {
        ctx.fillRect(e.x, e.y, e.width, e.height);
        // Boss health bar
        ctx.fillStyle = '#333';
        ctx.fillRect(e.x, e.y - 15, e.width, 8);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(e.x, e.y - 15, (e.health / e.maxHealth) * e.width, 8);
      } else {
        ctx.beginPath();
        switch (e.shape) {
          case 'TRIANGLE':
            ctx.moveTo(e.x + e.width / 2, e.y + e.height);
            ctx.lineTo(e.x, e.y);
            ctx.lineTo(e.x + e.width, e.y);
            break;
          case 'SQUARE':
            ctx.rect(e.x, e.y, e.width, e.height);
            break;
          case 'CIRCLE':
            ctx.arc(e.x + e.width / 2, e.y + e.height / 2, e.width / 2, 0, Math.PI * 2);
            break;
          case 'DIAMOND':
            ctx.moveTo(e.x + e.width / 2, e.y);
            ctx.lineTo(e.x + e.width, e.y + e.height / 2);
            ctx.lineTo(e.x + e.width / 2, e.y + e.height);
            ctx.lineTo(e.x, e.y + e.height / 2);
            break;
        }
        ctx.closePath();
        ctx.fill();
      }
    });

    // Bullets
    bulletsRef.current.forEach(b => {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
    });

    // Power-ups
    powerUpsRef.current.forEach(pu => {
      ctx.fillStyle = pu.color;
      ctx.fillRect(pu.x, pu.y, pu.width, pu.height);
      // Icon or letter
      ctx.fillStyle = 'white';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      const text = pu.type === 'HEAL' ? 'H' : pu.type === 'FIRE_RATE' ? 'F' : pu.type === 'MULTI_SHOT' ? 'M' : 'S';
      ctx.fillText(text, pu.x + pu.width / 2, pu.y + pu.height / 2 + 6);
    });

    // Particles
    particlesRef.current.forEach(part => {
      ctx.globalAlpha = part.life;
      ctx.fillStyle = part.color;
      ctx.fillRect(part.x, part.y, part.size, part.size);
    });
    ctx.globalAlpha = 1;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keysRef.current[e.key] = true;
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current[e.key] = false;
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(requestRef.current);
    };
  }, []);

  useEffect(() => {
    if (gameState === 'PLAYING') {
      requestRef.current = requestAnimationFrame(update);
    } else {
      cancelAnimationFrame(requestRef.current);
    }
  }, [gameState]);

  // --- Actions ---

  const startGame = (stage: number) => {
    setCurrentStage(stage);
    initStage(stage);
    if (stage === 1) {
      setGameState('STORY');
    } else {
      setGameState('PLAYING');
    }
  };

  const nextStage = () => {
    const next = currentStage + 1;
    if (next <= MAX_STAGES) {
      saveProgress(next);
      setUnlockedStage(next);
      startGame(next);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white font-sans overflow-hidden flex flex-col items-center justify-center p-4">
      {/* Game Container */}
      <div className="relative bg-black rounded-xl shadow-2xl border border-slate-800 overflow-hidden" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block"
        />

        {/* HUD */}
        {gameState === 'PLAYING' && (
          <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start pointer-events-none">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-blue-400 font-mono text-xl drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]">
                <Trophy size={20} />
                <span>{score.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2 text-yellow-400 font-mono text-lg drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]">
                <Star size={18} fill="currentColor" />
                <span>${money.toLocaleString()}</span>
              </div>
              <div className="text-slate-500 text-[10px] uppercase tracking-[0.3em] font-bold">Sector {currentStage}</div>
            </div>
            
            <div className="w-64 space-y-2">
              <div className="flex justify-between items-end">
                <div className="flex items-center gap-1.5 text-blue-400">
                  <Shield size={14} />
                  <span className="text-[10px] uppercase tracking-widest font-bold">Hull Integrity</span>
                </div>
                <span className="text-xs font-mono font-bold">{Math.ceil(playerRef.current.health)}%</span>
              </div>
              <div className="h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5">
                <motion.div 
                  className={`h-full rounded-full ${playerRef.current.health > 30 ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse'}`}
                  initial={{ width: '100%' }}
                  animate={{ width: `${playerRef.current.health}%` }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.2 }}
                />
              </div>
              {!bossSpawnedRef.current && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[8px] uppercase tracking-tighter text-slate-500">
                    <span>Sector Progress</span>
                    <span>{Math.floor(stageProgressRef.current)}%</span>
                  </div>
                  <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-slate-600 transition-all duration-300" 
                      style={{ width: `${stageProgressRef.current}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Overlays */}
        <AnimatePresence>
          {gameState === 'STORY' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-12 z-50"
            >
              <div className="max-w-md text-center space-y-6">
                <div className="flex justify-center mb-4">
                  <div className="p-4 bg-blue-500/20 rounded-full border border-blue-500/50">
                    <Rocket className="text-blue-400" size={48} />
                  </div>
                </div>
                <h2 className="text-2xl font-bold text-blue-400 uppercase tracking-widest">The Lackey</h2>
                <div className="space-y-4 text-slate-300 font-medium leading-relaxed">
                  <p>
                    They thought I was just a low-level pilot. A mere lackey in their grand design.
                  </p>
                  <p className="text-white italic">
                    "The Big Boss took her. He took my waifu."
                  </p>
                  <p>
                    They left me with nothing but this ship and a burning rage. 
                    I'm not stopping until every sector is cleared and she's back.
                  </p>
                </div>
                <button 
                  onClick={() => setGameState('PLAYING')}
                  className="mt-8 px-12 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full transition-all flex items-center gap-2 mx-auto"
                >
                  <Play size={20} fill="currentColor" />
                  BEGIN REVENGE
                </button>
              </div>
            </motion.div>
          )}

          {gameState === 'BOSS_INTRO' && (
            <motion.div 
              initial={{ opacity: 0, scale: 1.2 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-red-900/20 backdrop-blur-sm flex flex-col items-center justify-center z-50"
            >
              <motion.div 
                initial={{ y: 50 }}
                animate={{ y: 0 }}
                className="text-center"
              >
                <div className="text-red-500 mb-4 flex justify-center">
                  <Skull size={64} />
                </div>
                <h2 className="text-5xl font-black italic text-white mb-4 tracking-tighter">
                  "YOU, I WILL DESTROY!"
                </h2>
                <p className="text-red-400 uppercase tracking-[0.3em] text-sm mb-8">Boss Signature Detected</p>
                <button 
                  onClick={() => setGameState('PLAYING')}
                  className="px-10 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-all"
                >
                  ENGAGE
                </button>
              </motion.div>
            </motion.div>
          )}

          {gameState === 'MENU' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 z-10"
            >
              <motion.div
                initial={{ y: -20 }}
                animate={{ y: 0 }}
                className="text-center mb-12"
              >
                <h1 className="text-6xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 mb-2">
                  GALACTIC VANGUARD
                </h1>
                <p className="text-slate-400 text-sm tracking-[0.3em] uppercase">Sector Defense Initiative</p>
              </motion.div>

              <div className="grid grid-cols-3 gap-4 mb-12">
                {Array.from({ length: MAX_STAGES }).map((_, i) => {
                  const stageNum = i + 1;
                  const isUnlocked = stageNum <= unlockedStage;
                  return (
                    <button
                      key={stageNum}
                      onClick={() => isUnlocked && startGame(stageNum)}
                      disabled={!isUnlocked}
                      className={`
                        w-16 h-16 rounded-lg flex flex-col items-center justify-center transition-all
                        ${isUnlocked 
                          ? 'bg-slate-800 hover:bg-blue-600 border border-slate-700 cursor-pointer' 
                          : 'bg-slate-900 opacity-40 border border-transparent cursor-not-allowed'}
                      `}
                    >
                      <span className="text-xs text-slate-500 mb-1">STG</span>
                      <span className="text-xl font-bold">{stageNum}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col items-center gap-4">
                <button 
                  onClick={() => startGame(unlockedStage)}
                  className="group relative px-12 py-4 bg-white text-black font-bold rounded-full overflow-hidden transition-all hover:scale-105 active:scale-95"
                >
                  <div className="absolute inset-0 bg-blue-400 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  <span className="relative z-10 flex items-center gap-2">
                    <Play size={20} fill="currentColor" />
                    CONTINUE MISSION
                  </span>
                </button>
                <div className="text-slate-500 text-xs flex items-center gap-2">
                  <Star size={12} className="text-yellow-500" />
                  High Score: {highScore.toLocaleString()}
                </div>
              </div>

              <div className="absolute bottom-8 text-[10px] text-slate-600 uppercase tracking-widest flex gap-8">
                <span>WASD / Arrows to Move</span>
                <span>Space / Enter to Fire</span>
              </div>
            </motion.div>
          )}

          {gameState === 'STAGE_CLEAR' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 bg-blue-900/40 backdrop-blur-md flex flex-col items-center justify-center z-20"
            >
              <div className="bg-black/80 p-12 rounded-3xl border border-blue-500/30 text-center shadow-2xl">
                <motion.div 
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(59,130,246,0.5)]"
                >
                  <Trophy size={40} />
                </motion.div>
                <h2 className="text-4xl font-black mb-2 italic">STAGE {currentStage} CLEAR</h2>
                <p className="text-blue-400 font-bold uppercase tracking-widest text-sm mb-4">Sector Secured</p>
                <motion.p 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="text-slate-300 italic mb-8 text-lg"
                >
                  "{encouragement}"
                </motion.p>
                
                <div className="flex gap-4">
                  <button 
                    onClick={() => setGameState('MENU')}
                    className="p-4 bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors"
                  >
                    <Home size={24} />
                  </button>
                  <button 
                    onClick={nextStage}
                    className="flex-1 px-8 py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
                  >
                    NEXT SECTOR
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {gameState === 'GAME_OVER' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-red-950/60 backdrop-blur-xl flex flex-col items-center justify-center z-20"
            >
              <div className="text-center">
                <Skull size={80} className="text-red-500 mx-auto mb-6 animate-pulse" />
                <h2 className="text-6xl font-black italic mb-2">MISSION FAILED</h2>
                <p className="text-red-400 uppercase tracking-[0.4em] text-sm mb-12">Vessel Destroyed</p>
                
                <div className="flex flex-col gap-4 items-center">
                  <button 
                    onClick={() => startGame(currentStage)}
                    className="px-12 py-4 bg-white text-black font-bold rounded-full hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"
                  >
                    <RotateCcw size={20} />
                    RETRY MISSION
                  </button>
                  <button 
                    onClick={() => setGameState('MENU')}
                    className="text-slate-400 hover:text-white text-sm uppercase tracking-widest transition-colors"
                  >
                    Return to Command
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {gameState === 'VICTORY' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-gradient-to-b from-blue-900 to-black flex flex-col items-center justify-center z-30"
            >
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ repeat: Infinity, duration: 4 }}
                className="text-center"
              >
                <div className="relative inline-block mb-8">
                  <Star size={120} className="text-yellow-400 fill-yellow-400" />
                  <div className="absolute inset-0 animate-ping opacity-20">
                    <Star size={120} className="text-yellow-400 fill-yellow-400" />
                  </div>
                </div>
                <h2 className="text-7xl font-black italic mb-4">TOTAL VICTORY</h2>
                <p className="text-blue-300 uppercase tracking-[0.5em] text-sm mb-12">Galaxy Liberated</p>
                
                <button 
                  onClick={() => setGameState('MENU')}
                  className="px-12 py-4 bg-white text-black font-bold rounded-full hover:scale-110 transition-all"
                >
                  RETURN TO BASE
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer Info */}
      <div className="mt-8 flex gap-12 text-slate-500 text-[10px] uppercase tracking-[0.2em]">
        <div className="flex items-center gap-2">
          <Shield size={14} />
          <span>Offline Mode Active</span>
        </div>
        <div className="flex items-center gap-2">
          <Zap size={14} />
          <span>Progress Auto-Saved</span>
        </div>
      </div>
    </div>
  );
}
