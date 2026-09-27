// Braille spinners for the task line, square ones only (one cell, or two: 4x4 dots); a wider strip reads as a progress bar.
// braille to diagswipe are from unicode-animations (github.com/gunnargray-dev/unicode-animations, MIT); comet, half and fill go
// round the cell's ring of eight dots. name: [ms per frame, frames]. spinner(el) plays a random one in el, a little slower than
// written, and returns its stop.
const SPINNERS = {
  braille: [80, ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']],
  orbit: [100, ['⠃', '⠉', '⠘', '⠰', '⢠', '⣀', '⡄', '⠆']],
  breathe: [100, ['⠀', '⠂', '⠌', '⡑', '⢕', '⢝', '⣫', '⣟', '⣿', '⣟', '⣫', '⢝', '⢕', '⡑', '⠌', '⠂', '⠀']],
  snake: [80, ['⣁⡀', '⣉⠀', '⡉⠁', '⠉⠉', '⠈⠙', '⠀⠛', '⠐⠚', '⠒⠒', '⠖⠂', '⠶⠀', '⠦⠄', '⠤⠤', '⠠⢤', '⠀⣤', '⢀⣠', '⣀⣀']],
  fillsweep: [100, ['⣀⣀', '⣤⣤', '⣶⣶', '⣿⣿', '⣿⣿', '⣿⣿', '⣶⣶', '⣤⣤', '⣀⣀', '⠀⠀', '⠀⠀']],
  diagswipe: [60, ['⠁⠀', '⠋⠀', '⠟⠁', '⡿⠋', '⣿⠟', '⣿⡿', '⣿⣿', '⣿⣿', '⣾⣿', '⣴⣿', '⣠⣾', '⢀⣴', '⠀⣠', '⠀⢀', '⠀⠀', '⠀⠀']],
  comet: [100, ['⠇', '⠋', '⠙', '⠸', '⢰', '⣠', '⣄', '⡆']],
  half: [100, ['⠹', '⢸', '⣰', '⣤', '⣆', '⡇', '⠏', '⠛']],
  fill: [100, ['⠁', '⠉', '⠙', '⠹', '⢹', '⣹', '⣽', '⣿', '⣾', '⣶', '⣦', '⣆', '⡆', '⠆', '⠂', '⠀']]
}
const PACE = 1.6 // the task line is small and quiet; the library's speed reads as hurried there
const spinner = el => {
  const [ms, frames] = Object.values(SPINNERS)[Math.random() * Object.keys(SPINNERS).length | 0]
  let k = 0
  el.textContent = frames[0]
  if (calm.matches) return () => {} // motion off: its first frame, still
  const t = setInterval(() => el.textContent = frames[++k % frames.length], ms * PACE)
  return () => clearInterval(t)
}
