// ==========================================
// HOST LOGIC (LAPTOP / SCREEN)
// ==========================================
function initHost() {
    document.getElementById('host-lobby').style.display = 'flex';

    peer = new Peer(peerConfig);

    peer.on('open', (id) => {
        console.log('Host ID:', id);
        const controllerUrl = `${window.location.origin}${window.location.pathname}?mode=controller&host=${id}`;

        new QRCode(document.getElementById("qrcode"), {
            text: controllerUrl,
            width: 200,
            height: 200,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    });

    peer.on('connection', (connection) => {
        conn = connection;
        document.getElementById('connection-status').innerText = "Controller Connected! Starting flight...";
        document.getElementById('connection-status').className = "text-sm font-bold text-green-600";

        // Tell the controller we received the connection
        conn.on('open', () => {
            conn.send({ type: 'handshake', status: 'ready' });
        });

        setTimeout(() => {
            document.getElementById('host-lobby').style.display = 'none';
            init3DGame();
        }, 1000);

        conn.on('data', (data) => {
            if (data.type === 'orientation') {
                shipPitch = data.pitch;
                shipRoll = data.roll;
            } else if (data.type === 'action' && data.action === 'fire') {
                isFiring = true;
            } else if (data.type === 'throttle') {
                isAccelerating = data.accelerate;
                isBraking = data.brake;
            }
        });

        conn.on('close', () => {
            document.getElementById('connection-status').innerText = "Controller disconnected.";
        });
    });

    peer.on('error', (err) => {
        console.error("Host peer error:", err);
        document.getElementById('connection-status').innerText = "Connection Error. Refresh page.";
        document.getElementById('connection-status').className = "text-red-600 font-bold text-sm";
    });
}
