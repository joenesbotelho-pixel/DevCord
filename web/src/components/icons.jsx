// Ícones de linha no estilo do Discord (24x24, herdam a cor do texto).
const Svg = ({ size = 20, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

// Risco diagonal vermelho usado em "mutado"/"ensurdecido".
const Slash = () => <line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" strokeWidth="2.6" />;

export const SpeakerIcon = (p) => (
  <Svg {...p}>
    <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </Svg>
);

export const MicIcon = ({ off, ...p }) => (
  <Svg {...p}>
    <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="22" />
    {off && <Slash />}
  </Svg>
);

export const HeadphonesIcon = ({ off, ...p }) => (
  <Svg {...p}>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" fill="currentColor" />
    {off && <Slash />}
  </Svg>
);

export const HangUpIcon = (p) => (
  <Svg {...p}>
    <path
      d="M3.6 14.3c-.9-.9-.9-2.4.1-3.2C6.1 9.1 9 8 12 8s5.9 1.1 8.3 3.1c1 .8 1 2.3.1 3.2l-1.3 1.3c-.7.7-1.8.7-2.5.1l-1.4-1.1c-.5-.4-.7-1-.6-1.6l.2-1.2a10 10 0 0 0-5.6 0l.2 1.2c.1.6-.1 1.2-.6 1.6l-1.4 1.1c-.7.6-1.8.6-2.5-.1z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);

export const SignalIcon = (p) => (
  <Svg {...p}>
    <line x1="5" y1="20" x2="5" y2="16" />
    <line x1="10" y1="20" x2="10" y2="12" />
    <line x1="15" y1="20" x2="15" y2="8" />
    <line x1="20" y1="20" x2="20" y2="4" />
  </Svg>
);

export const ScreenIcon = (p) => (
  <Svg {...p}>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </Svg>
);

export const LogoutIcon = (p) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </Svg>
);
