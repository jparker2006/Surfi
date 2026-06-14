import type { LevelConfig } from './types'
import { acidsurf } from './acidsurf'

// Level registry. The engine binds ONE config at boot (ACTIVE_LEVEL); the
// landing renders a tile per entry in LEVEL_TILES. Runtime multi-level
// switching is out of scope, so today there is one playable tile. Adding a
// future level is: write its config, push a tile here. A 'soon' tile renders
// dimmed and does not launch.

export interface LevelTile {
  id: string
  title: string
  subtitle?: string
  status: 'playable' | 'soon'
  // present only for playable tiles
  config?: LevelConfig
}

// the single config the engine is wired to
export const ACTIVE_LEVEL: LevelConfig = acidsurf

export const LEVEL_TILES: LevelTile[] = [
  {
    id: acidsurf.id,
    title: acidsurf.title,
    subtitle: 'endless psychedelic descent',
    status: 'playable',
    config: acidsurf,
  },
]
