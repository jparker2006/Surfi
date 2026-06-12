import GUI from 'lil-gui'
import { consts } from './physics/constants'

// lil-gui tuning panel. Mutates the shared constants object directly so every
// slider is live. Toggled with backtick or F3, hidden by default.

export class DebugPanel {
  readonly state = {
    fly: false,
    wireframes: false,
    fps: 0,
  }

  private readonly gui: GUI
  private visible = false

  constructor(onWireframes: (on: boolean) => void, onFovChange: () => void) {
    this.gui = new GUI({ title: 'surfi debug' })

    const phys = this.gui.addFolder('physics')
    phys.add(consts, 'gravity', 0, 2000, 10)
    phys.add(consts, 'airAccelerate', 0, 500, 1)
    phys.add(consts, 'airSpeedCap', 0, 200, 1)
    phys.add(consts, 'maxVelocity', 100, 10000, 50)
    phys.add(consts, 'friction', 0, 20, 0.1)
    phys.add(consts, 'groundAccelerate', 0, 20, 0.1)
    phys.add(consts, 'maxGroundSpeed', 0, 1000, 10)
    phys.add(consts, 'jumpImpulse', 0, 1000, 1)

    const view = this.gui.addFolder('view')
    view.add(consts, 'fov', 60, 140, 1).onChange(onFovChange)
    view.add(consts, 'sensitivity', 0.001, 0.2, 0.001)

    this.gui.add(this.state, 'fly').name('fly / noclip')
    this.gui.add(this.state, 'wireframes').name('collision wireframes').onChange(onWireframes)
    this.gui.add(this.state, 'fps').listen().disable()

    this.gui.hide()
  }

  setFps(fps: number): void {
    this.state.fps = fps
  }

  toggle(): void {
    this.visible = !this.visible
    if (this.visible) this.gui.show()
    else this.gui.hide()
  }
}
