import { createApp } from 'vue'
import App from './App.vue'
import { setIconFont, setIcons } from './icons/registry'
import { setDpiRequirement } from './host/dpiRequirement'
import { setScanLicense } from './scan/license'
import './style.css'

if (window.tiffViewerIcons) setIcons(window.tiffViewerIcons)
if (window.tiffViewerIconFont) setIconFont(window.tiffViewerIconFont)
if (window.tiffViewerScanLicense !== undefined) setScanLicense(window.tiffViewerScanLicense)
if (window.tiffViewerDpiRequirement !== undefined) setDpiRequirement(window.tiffViewerDpiRequirement)

createApp(App).mount('#app')
