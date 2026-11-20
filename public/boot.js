// Runs before first paint (non-inline so CSP can forbid inline script).
(function () {
  var d = document.documentElement
  var standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches
  if (standalone) d.classList.add('app-full')
  try {
    var t = localStorage.getItem('theme')
    if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t)
  } catch (e) {}
})()
