/**
 * The core of the Vuetify kit: the Vue app, the theme from the frame variables, the
 * language of `<html lang>` and the styles of the dependencies. Components are in the
 * other subpaths (`…/vuetify/choice` and so on); each `mount…` returns `Mounted`.
 */
export { mountComponent, type Mounted } from './mount.ts';
export { vuetifyOf, type FrameVuetify } from './instance.ts';
export { OVERLAY_EVENT, requestOverlayHeight } from './overlay.ts';
