// Entry point — mounts the root Svelte component into the #app div in index.html.
// app.css is imported here so it applies globally to the entire application.
import { mount } from 'svelte'
// Open Sans is bundled locally (no third-party font requests at runtime)
import '@fontsource/open-sans/400.css'
import '@fontsource/open-sans/600.css'
import '@fontsource/open-sans/700.css'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app'),
})

export default app
