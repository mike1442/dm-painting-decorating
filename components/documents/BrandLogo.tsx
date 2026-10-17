// Static version of public/dm-logo.svg. "light" matches the website on dark
// backgrounds; "ink" is for white paper and print.

const palettes = {
  light: { word: "#f1f4f3", strap: "#e8eeee", ridge: "#eef4f2", windows: "#f2f5f4", handle: "#dce5e8" },
  ink: { word: "#0f1c23", strap: "#3b4a51", ridge: "#0f1c23", windows: "#0f1c23", handle: "#c5d2d5" },
};

export function BrandLogo({ tone = "light", className }: { tone?: keyof typeof palettes; className?: string }) {
  const c = palettes[tone];
  return (
    <svg className={className} viewBox="110 10 680 390" role="img" aria-label="D&M Painting & Decorating">
      <path d="M180 178 Q350 150 460 64 L568 146" fill="none" stroke="#78c5be" strokeWidth="23" strokeLinecap="round" />
      <path d="M460 64 580 154" fill="none" stroke={c.ridge} strokeWidth="12" />
      <g fill={c.windows}>
        <rect x="438" y="115" width="18" height="18" />
        <rect x="461" y="115" width="18" height="18" />
        <rect x="438" y="138" width="18" height="18" />
        <rect x="461" y="138" width="18" height="18" />
      </g>
      <g transform="rotate(34 650 95)">
        <rect x="635" y="20" width="30" height="100" rx="13" fill={c.handle} />
        <rect x="630" y="95" width="40" height="18" rx="4" fill="#718e98" />
        <path d="M632 113h36l-5 46h-26z" fill="#78c5be" />
      </g>
      <g fontFamily="Arial,Helvetica,sans-serif" textAnchor="middle">
        <text x="450" y="326" fontSize="164" fontWeight="800" letterSpacing="-10" fill={c.word}>
          D<tspan fill="#78c5be">&amp;</tspan>M
        </text>
        <text x="450" y="386" fontSize="36" letterSpacing="9" fill={c.strap}>
          PAINTING &amp; DECORATING
        </text>
      </g>
    </svg>
  );
}
