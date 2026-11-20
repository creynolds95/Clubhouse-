const P: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  swing: 'M5 20L16 5m0 0l3 1-1 3M8 20a2 2 0 1 0 0-.01',
  rounds: 'M6 3v18M6 4h11l-3 4 3 4H6',
  practice: 'M4 6h16M4 12h10M4 18h7M18 15l2 2 3-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  stats: 'M5 20V10M12 20V4M19 20v-7',
  r10: 'M4 17h16M7 17V9h10v8M10 13h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 5v4M7 15v4',
  up: 'M6 14l6-6 6 6',
  down: 'M6 10l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
}
export function Icon({ name, size = 24 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  )
}
