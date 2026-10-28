import type { ReactNode } from "react";

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-b border-white/10 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-red-300/90 select-none">
        {title}
        <span className="text-white/40 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-xs text-white/70">
        <span>{label}</span>
        <span className="font-mono text-white/90">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-red-500"
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-white/85">
      <span>
        {label}
        {hint && <span className="block text-[11px] text-white/45">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-red-600" : "bg-white/15"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="block text-xs text-white/70">
      <span className="mb-1 block">{label}</span>
      <select
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
        className="w-full rounded-md border border-white/15 bg-black/60 px-2 py-1.5 text-sm text-white outline-none focus:border-red-500"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Btn({ children, onClick, variant = "default", className = "" }: { children: ReactNode; onClick?: () => void; variant?: "default" | "danger" | "primary"; className?: string }) {
  const styles = {
    default: "bg-white/10 hover:bg-white/20 text-white",
    danger: "bg-red-900/60 hover:bg-red-800 text-red-100",
    primary: "bg-red-600 hover:bg-red-500 text-white",
  }[variant];
  return (
    <button type="button" onClick={onClick} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${styles} ${className}`}>
      {children}
    </button>
  );
}
