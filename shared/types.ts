export type SwingView = 'face_on' | 'down_the_line'
export type SwingPhase = 'address' | 'takeaway' | 'top' | 'transition' | 'impact' | 'finish'
export const PHASES: SwingPhase[] = ['address', 'takeaway', 'top', 'transition', 'impact', 'finish']

export interface SwingMetrics {
  handedness: 'right' | 'left'
  view?: SwingView
  phaseTimes: Partial<Record<SwingPhase, number>> // seconds into clip
  tempoRatio?: number // backswing time / downswing time (tour avg ~3:1)

  // Down-the-line (camera behind the golfer). Distances are % of torso length so they don't depend on camera distance.
  spineAngleDeg?: Partial<Record<SwingPhase, number>> // forward lean of the torso from vertical
  spineChangeDeg?: number // impact minus address; negative = stood up
  earlyExtensionPct?: number // hips toward the ball, address to impact (negative = away)
  headToTop?: { toward: number; down: number } // address to top
  headToImpact?: { toward: number; down: number } // address to impact
  leadArmDeg?: number // elbow angle at top (180 = straight)
  handsAtTopPct?: number // hands above the shoulder line at the top (negative = below)
  quality?: { bodyInFrame: boolean; visibility: number }
  /** Tracked joints per position for the overlay: [x, y] pairs in 0..1, index order = POSE_POINTS. */
  pose?: Partial<Record<SwingPhase, number[][]>>

  // Older swings (before from-behind metrics)
  spineTiltDeg?: Partial<Record<SwingPhase, number>>
  shoulderTurnDeg?: Partial<Record<SwingPhase, number>>
  hipTurnDeg?: Partial<Record<SwingPhase, number>>
  headSway?: { x: number; y: number }

  framesWithPose: number
  framesSampled: number
}

/** MediaPipe landmark indices stored in `pose`, and the bones drawn between them (indices into this list). */
export const POSE_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
export const POSE_BONES: [number, number][] = [[1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [7, 9], [9, 11], [8, 10], [10, 12]]

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
  /** Only asked when the green was missed: did you get up and down? */
  upDown?: boolean
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

/** Normalised launch-monitor metrics. Speeds in mph, distances in yards, angles in degrees, spin in rpm. */
export type R10Metric =
  | 'clubSpeed' | 'ballSpeed' | 'smash' | 'carry' | 'total' | 'attack' | 'path' | 'face' | 'faceToPath'
  | 'launch' | 'launchDir' | 'spin' | 'spinAxis' | 'apex' | 'offline' | 'tempo'

export interface R10Shot {
  id?: string
  sessionDate: string // YYYY-MM-DD
  hitAt: string | null
  club: string | null
  m: Partial<Record<R10Metric, number>>
}

export interface CourseHole { hole: number; par: number; hcp?: number }
export interface CourseTee { name: string; rating?: number; slope?: number; totalYards?: number; yards?: number[] }
export interface Course {
  id: string
  name: string
  city: string | null
  state: string | null
  source: 'manual' | 'osm' | 'golfcourseapi' | 'opengolf'
  holes: CourseHole[]
  tees: CourseTee[]
  /** True when pars came from a source that may be incomplete. Shown as "check pars". */
  unverified?: boolean
}
/** A course found online that isn't saved yet. */
export interface CourseCandidate {
  source: 'osm' | 'golfcourseapi' | 'opengolf'
  /** Every source that listed this course. The row itself is the one with the most detail. */
  tags?: ('osm' | 'golfcourseapi' | 'opengolf')[]
  /** The same course under the other sources, used as fallbacks on import. */
  alts?: { source: 'osm' | 'golfcourseapi' | 'opengolf'; externalId: string }[]
  externalId: string
  name: string
  city: string | null
  state: string | null
  lat?: number
  lon?: number
  /** Straight-line km from the search point, when known. */
  distanceKm?: number
  /** Set when this course is already saved, so picking it needs no import. */
  savedId?: string
}

/** Who the player is, so the coach can speak to them and work with their body. Everything is optional plain data. */
export interface Profile {
  heightIn?: number
  weightLb?: number
  age?: number
  handedness?: 'right' | 'left'
  handicap?: number
  /** Usual miss, e.g. "slice", "pull", "thin". */
  typicalMiss?: string
  /** Injuries or physical limits, free text. */
  limits?: string
  goals?: string
  /** Clubs in the bag. */
  clubs?: string[]
}

export const CLUB_CHOICES = ['Driver', '3 Wood', '5 Wood', '7 Wood', '3 Hybrid', '4 Hybrid', '5 Hybrid', '3 Iron', '4 Iron', '5 Iron', '6 Iron', '7 Iron', '8 Iron', '9 Iron', 'PW', 'GW', 'SW', 'LW', 'Putter'] as const
export const MISS_CHOICES = ['Slice', 'Fade', 'Hook', 'Draw', 'Push', 'Pull', 'Thin', 'Fat', 'Top', 'Straight'] as const
