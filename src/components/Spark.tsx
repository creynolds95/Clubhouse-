/** Tiny trend line. `lowerIsBetter` only affects which direction the end dot's tone suggests; no axes, no junk. */
export function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 24 - ((v - min) / span) * 20 - 2])
  const last = pts[pts.length - 1]
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill="var(--brass)" />
    </svg>
  )
}
