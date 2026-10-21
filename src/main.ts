import { createApp } from 'vue'
import App from './App.vue'
import { setIcons } from './icons/registry'
import { setDpiRequirement } from './host/dpiRequirement'
import { setScanLicense } from './scan/license'
import './style.css'

if (window.tiffViewerIcons) setIcons(window.tiffViewerIcons)
if (window.tiffViewerScanLicense !== undefined) setScanLicense(window.tiffViewerScanLicense)
if (window.tiffViewerDpiRequirement !== undefined) setDpiRequirement(window.tiffViewerDpiRequirement)

createApp(App).mount('#app')
