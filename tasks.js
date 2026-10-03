// The header's task line, left of the tabs: what main.js is doing (task), newest first, with a ring while anything runs. A result
// or error (note) takes the line for a few seconds, then it goes back to what still runs, or away. ✕ stops the one on the line,
// when it can stop (a pull, lookups, tagging).
const tasksUI = $('#tasks'), taskLine = tasksUI.children[1], stopUI = tasksUI.querySelector('.stop')
let running = [], noted = null, noteTimer
let stopSpin // while busy, a spinner (spinners.js), a new one picked each time the line starts running
const spinning = on => { if (on !== !!stopSpin) { stopSpin?.(); stopSpin = on ? spinner(tasksUI.firstElementChild) : null } }
const drawTasks = () => {
  const now = running.at(-1)
  tasksUI.hidden = !now && !noted
  tasksUI.classList.toggle('busy', !!now)
  spinning(!!now)
  tasksUI.classList.toggle('error', !!noted?.error)
  taskLine.textContent = noted?.text ?? (now?.text ?? '') + (running.length > 1 ? `  +${running.length - 1}` : '')
  tasksUI.title = [noted?.text, ...running.toReversed().map(t => t.text)].filter(Boolean).join('\n')
  stopUI.hidden = !!noted || !now?.stop
  stopUI.onclick = () => api.stopTask(now.id)
}
api.onTasks(l => { running = l; drawTasks() })
api.onNote(n => { noted = n; clearTimeout(noteTimer); noteTimer = setTimeout(() => { noted = null; drawTasks() }, n.error ? 10000 : 5000); drawTasks() })

// A crowded right side (tasks, selection, tabs, and Windows' caption buttons in the padding; macOS's are in the left one) past
// 60% of the bar: the title's quote or explanation steps aside for it rather than show a stub.
const head = $('header'), crowd = () => { const s = getComputedStyle(head); document.body.classList.toggle('crowded',
  $('.pills').offsetWidth + $('header nav').offsetWidth + parseFloat(s.paddingRight) > head.clientWidth * .6) }
const fit = new ResizeObserver(crowd)
fit.observe(head); fit.observe($('.pills'))
