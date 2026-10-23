import { render } from 'preact'
import { App } from './App'
import './styles.css'

const root = document.getElementById('app')!
const slot = document.getElementById('hdr-slot')
root.textContent = ''
if (slot) slot.textContent = ''
render(<App />, root)
document.documentElement.classList.add('mounted')
