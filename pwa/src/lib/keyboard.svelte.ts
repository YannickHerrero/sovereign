/**
 * Height of the on-screen keyboard, derived from the visual viewport. Bottom-anchored
 * elements add it to their offset so they stay above the keyboard on iOS.
 */
let height = $state(0);

const vv = window.visualViewport;

function measure() {
  if (!vv) return;
  const covered = window.innerHeight - vv.height - vv.offsetTop;
  height = covered > 40 ? covered : 0;
}

vv?.addEventListener('resize', measure);
vv?.addEventListener('scroll', measure);

export const keyboard = {
  get height() {
    return height;
  },
};
