// Decorative hero picture: three layered glass cards sketching appointments, treatment
// services and risk classification. Drawn shapes only. It carries no student data and
// the ticks and bars are not measurements. Everything glows sky blue on the navy page.
const BOOKED = new Set([4, 10, 16, 17, 23]);
const SOFT = new Set([5, 11, 24]);
const SERVICES = ['Oral prophylaxis', 'Fluoride varnish', 'Pit and fissure sealant', 'Tooth restoration'] as const;
const BARS: ReadonlyArray<readonly [string, string]> = [['22%', '#F87171'], ['46%', '#FBBF24'], ['62%', '#4ADE80']];

const card = 'absolute rounded-[22px] border border-sky-200/40 bg-gradient-to-br from-white/20 to-white/[0.06] p-[4%] text-white shadow-[0_0_44px_rgba(56,189,248,0.38),0_24px_50px_rgba(3,10,40,0.45),inset_0_0_26px_rgba(125,211,252,0.12)] backdrop-blur-xl';
const title = 'mb-[0.9em] text-[0.8em] font-bold uppercase tracking-wider text-blue-200';

export const HeroArt = () => (
  <div aria-hidden="true" className="relative mx-auto aspect-square w-full max-w-[520px] [container-type:inline-size]">
    <div className="pointer-events-none absolute -inset-[8%] rounded-full bg-[radial-gradient(closest-side,rgba(56,189,248,0.42),rgba(99,102,241,0.18)_55%,transparent)] blur-2xl" />
    <div className="absolute inset-0 [perspective:1100px]" style={{ fontSize: 'clamp(9px, 2.7cqw, 14px)' }}>
      <div className={`${card} left-[2%] top-[4%] w-[58%]`} style={{ transform: 'rotateY(14deg) rotateZ(-5deg)' }}>
        <h4 className={title}>Appointments</h4>
        <div className="grid grid-cols-7 gap-[0.45em]">
          {Array.from({ length: 28 }, (_, i) => (
            <i key={i} className={`aspect-square rounded-[0.5em] ${BOOKED.has(i) ? 'bg-sky-400 shadow-[0_0_14px_rgba(56,189,248,0.95)]' : SOFT.has(i) ? 'bg-sky-400/45' : 'bg-white/15'}`} />
          ))}
        </div>
      </div>

      <div className={`${card} right-0 top-[30%] w-[60%]`} style={{ transform: 'rotateY(-12deg) rotateZ(4deg)' }}>
        <h4 className={title}>Treatment Services</h4>
        {SERVICES.map((s, i) => (
          <div key={s} className="flex items-center gap-[0.8em] border-b border-white/15 py-[0.5em]">
            <u className={`grid h-[1.4em] w-[1.4em] shrink-0 place-items-center rounded-[0.4em] border-[1.5px] text-[0.8em] no-underline ${i < 3 ? 'border-sky-400 bg-sky-400 text-[#06204A] shadow-[0_0_12px_rgba(56,189,248,0.9)]' : 'border-sky-300'}`}>{i < 3 ? '✓' : ''}</u>
            {s}
          </div>
        ))}
      </div>

      <div className={`${card} bottom-[2%] left-[8%] w-[56%]`} style={{ transform: 'rotateY(10deg) rotateZ(-2deg)' }}>
        <h4 className={title}>Risk classification</h4>
        <div className="grid gap-[0.7em]">
          {BARS.map(([w, c]) => (
            <div key={c} className="h-[0.9em] rounded-full bg-white/15"><div className="h-full rounded-full" style={{ width: w, background: c, boxShadow: `0 0 14px ${c}` }} /></div>
          ))}
        </div>
        <span className="mt-[0.9em] inline-block rounded-full border border-sky-300/50 bg-sky-400/20 px-[0.9em] py-[0.3em] text-[0.9em] font-bold text-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.55)]">Dentist validates</span>
      </div>
    </div>
  </div>
);
