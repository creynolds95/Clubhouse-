export type SwingView = 'face_on' | 'down_the_line'
export type SwingPhase = 'address' | 'takeaway' | 'top' | 'transition' | 'impact' | 'finish'
export const PHASES: SwingPhase[] = ['address', 'takeaway', 'top', 'transition', 'impact', 'finish']

export interface SwingMetrics {
  handedness: 'right' | 'left'
  phaseTimes: Partial<Record<SwingPhase, number>> // seconds into clip
  tempoRatio?: number // backswing time / downswing time (tour avg ~3:1)
  spineTiltDeg: Partial<Record<SwingPhase, number>>
  shoulderTurnDeg: Partial<Record<SwingPhase, number>> // shoulder line vs address
  hipTurnDeg: Partial<Record<SwingPhase, number>>
  leadArmDeg?: number // elbow angle at top (180 = straight)
  headSway?: { x: number; y: number } // address→impact, in shoulder-widths
  framesWithPose: number
  framesSampled: number
}

export interface Swing {
  id: string
  createdAt: string
  takenAt: string | null
  club: string | null
  view: SwingView | null
  note: string | null
  hasVideo: boolean
  frames: SwingPhase[]
  metrics: SwingMetrics | null
  feedback: string | null
}

export interface HoleScore {
  hole: number
  par: number
  strokes: number
  putts?: number
  fairway?: 'hit' | 'left' | 'right' | 'na'
  gir?: boolean
  penalties?: number
}

export interface Round {
  id: string
  playedOn: string
  course: string
  tees: string | null
  holes: HoleScore[]
  total: number
  source: 'manual' | 'garmin_export' | 'garmin_sync'
}
