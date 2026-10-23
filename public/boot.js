// Runs synchronously before the app bundle: the memo box is usable on first paint,
// and keeps working (plain form POST to /memo) even if the bundle never loads.
;(function () {
  var t = document.getElementById('memo')
  if (!t) return
  var form = t.form
  var root = document.documentElement
  try {
    var d = localStorage.getItem('meishi.draft')
    if (d) t.value = d
  } catch (e) {}

  function fit() {
    t.style.height = 'auto'
    t.style.height = Math.min(t.scrollHeight, 168) + 'px'
  }
  t.addEventListener('input', function () {
    fit()
    try {
      localStorage.setItem('meishi.draft', t.value)
    } catch (e) {}
  })
  t.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      if (!t.value.trim()) return
      if (form.requestSubmit) form.requestSubmit()
      else form.submit()
    }
  })
  // Before the app mounts, a submit is a real form POST. Keep a copy on the device
  // (same id) so nothing is lost if the visitor is not signed in yet.
  form.addEventListener('submit', function () {
    if (root.classList.contains('mounted')) return
    var id = self.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)
    document.getElementById('memo-id').value = id
    try {
      var now = Date.now()
      var box = JSON.parse(localStorage.getItem('meishi.outbox') || '[]')
      box.unshift({ id: id, memo: t.value.trim(), status: 'inbox', position: -now, createdAt: now, updatedAt: now, pending: true })
      localStorage.setItem('meishi.outbox', JSON.stringify(box))
      localStorage.removeItem('meishi.draft')
    } catch (e) {}
  })

  fit()
  t.focus({ preventScroll: true })

  setTimeout(function () {
    if (!root.classList.contains('mounted')) {
      var s = document.getElementById('slow')
      if (s) s.hidden = false
    }
  }, 8000)

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {})
    })
  }
})()
