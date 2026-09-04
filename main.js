// ==========================================
// ENTRY POINT
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode');
const hostPeerId = urlParams.get('host');

if (mode === 'controller' && hostPeerId) {
    initController(hostPeerId);
} else {
    initHost();
}
