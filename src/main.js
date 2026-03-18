// Entry point — mounts the root Svelte component into the #app div in index.html.
// app.css is imported here so it applies globally to the entire application.
import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app'),
})

export default app
