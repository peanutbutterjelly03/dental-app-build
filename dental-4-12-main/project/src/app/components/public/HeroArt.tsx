import { BarChart3, CalendarCheck, ClipboardList, WifiOff } from 'lucide-react';
import { TOOTH_PATH } from './PublicLayout';

// Decorative hero picture: the Floral tooth with its flower, ringed and glowing, with
// feature chips floating around it. Drawn, not a photo, and it carries no data.
const PETAL = 'M 0,3.00 C 10.80,13.15 1.80,30.26 0,32.00 C -1.80,30.26 -10.80,13.15 0,3.00 Z';

const Chip = ({ icon: Icon, label, className }: { icon: typeof WifiOff; label: string; className: string }) => (
  <div className={`absolute flex items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-3.5 py-2 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(3,10,40,0.35)] backdrop-blur-md motion-safe:animate-[float_6s_ease-in-out_infinite] ${className}`}>
    <Icon className="h-4 w-4 text-sky-300" />{label}
  </div>
);

export const HeroArt = () => (
  <div className="relative mx-auto aspect-square w-full max-w-[520px]" aria-hidden="true">
    <style>{'@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}'}</style>
    <svg viewBox="0 0 240 240" className="absolute inset-0 h-full w-full">
      <defs>
        <radialGradient id="ha-glow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#38BDF8" stopOpacity="0.55" /><stop offset="100%" stopColor="#38BDF8" stopOpacity="0" /></radialGradient>
        <linearGradient id="ha-tooth" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0%" stopColor="#FFFFFF" /><stop offset="100%" stopColor="#B6E3FB" /></linearGradient>
        <linearGradient id="ha-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#7DD3FC" stopOpacity="0.7" /><stop offset="100%" stopColor="#7DD3FC" stopOpacity="0.05" /></linearGradient>
      </defs>
      <circle cx="120" cy="120" r="118" fill="url(#ha-glow)" />
      <circle cx="120" cy="120" r="104" fill="none" stroke="url(#ha-ring)" strokeWidth="1" />
      <circle cx="120" cy="120" r="86" fill="rgba(255,255,255,0.05)" stroke="url(#ha-ring)" strokeWidth="1" strokeDasharray="2 5" />
      <circle cx="120" cy="120" r="68" fill="rgba(255,255,255,0.06)" stroke="url(#ha-ring)" strokeWidth="1" />
      <g transform="translate(120 122) scale(0.78) translate(-120 -116)">
        <path d={TOOTH_PATH} fill="url(#ha-tooth)" />
        <path d="M 96,52 C 88,62 84,78 86,96" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
        <g fill="#1E40AF" transform="translate(120 78) rotate(-7) scale(1 0.74)">
          {[0, 72, 144, 216, 288].map((a) => <path key={a} d={PETAL} transform={`rotate(${a})`} />)}
          <circle r="4.5" fill="#38BDF8" />
        </g>
      </g>
      <g fill="#fff" opacity="0.7"><circle cx="34" cy="70" r="1.8" /><circle cx="206" cy="58" r="1.4" /><circle cx="198" cy="190" r="2" /><circle cx="44" cy="176" r="1.4" /><circle cx="120" cy="12" r="1.6" /></g>
    </svg>
    <Chip icon={ClipboardList} label="Student records" className="left-0 top-[16%]" />
    <Chip icon={CalendarCheck} label="Appointments" className="right-0 top-[8%] [animation-delay:-2s]" />
    <Chip icon={BarChart3} label="DOH reports" className="right-[2%] bottom-[18%] [animation-delay:-4s]" />
    <Chip icon={WifiOff} label="Works offline" className="bottom-[8%] left-[4%] [animation-delay:-1s]" />
  </div>
);
