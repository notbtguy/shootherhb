// ==========================================
// CONTROLLER LOGIC (PHONE)
// ==========================================
function initController(hostPeerId) {
    document.getElementById('controller-ui').style.display = 'flex';
    const statusEl = document.getElementById('ctrl-status');
    const debugEl = document.getElementById('gyro-debug');

    document.getElementById('btn-start-gyro').addEventListener('click', async () => {
        statusEl.innerText = "Requesting permissions...";
        statusEl.className = "mt-4 text-sm font-bold text-blue-500";

        // CRITICAL: Requesting permission for iOS 13+ devices.
        // Android normally skips this branch entirely and grants access
        // as soon as deviceorientation is listened to over HTTPS.
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                if (permissionState !== 'granted') {
                    alert('Gyroscope permission is required to play. Please allow it or check your device settings.');
                    statusEl.innerText = "Permission denied.";
                    statusEl.className = "mt-4 text-sm font-bold text-red-500";
                    return;
                }
            } catch (e) {
                console.error("Error requesting DeviceOrientation:", e);
                alert("Could not request gyroscope permission. Make sure you are on HTTPS.");
                return;
            }
        }

        statusEl.innerText = "Connecting to Laptop...";

        peer = new Peer(peerConfig);

        peer.on('open', (myId) => {
            statusEl.innerText = "Signaling OK (" + myId.slice(0, 6) + "...). Opening data channel...";
            conn = peer.connect(hostPeerId, { reliable: true });

            // FIX: without a timeout, a failed connection just hangs on
            // "Connecting to Laptop..." forever with no feedback.
            const connectTimeout = setTimeout(() => {
                if (!conn.open) {
                    const iceState = conn.peerConnection ? conn.peerConnection.iceConnectionState : 'unknown';
                    statusEl.innerHTML = `Couldn't reach the laptop.<br>ICE state: <b>${iceState}</b><br>Try both devices on the same WiFi to test.`;
                    statusEl.className = "mt-4 text-sm font-bold text-red-500";
                }
            }, 12000);

            conn.on('open', () => {
                clearTimeout(connectTimeout);
                activateControllerUI();
            });

            // Watch the raw ICE state so we can see exactly where it's stuck
            // (checking / failed / disconnected) instead of just "not working".
            conn.on('iceStateChanged', (state) => {
                console.log('ICE state:', state);
                if (!conn.open) {
                    statusEl.innerText = "Negotiating connection... (" + state + ")";
                }
            });

            // Listen for handshake from host just in case local 'open' is slow
            conn.on('data', (data) => {
                if (data.type === 'handshake' && data.status === 'ready') {
                    clearTimeout(connectTimeout);
                    activateControllerUI();
                }
            });

            conn.on('error', (err) => {
                console.error("Connection error:", err);
                statusEl.innerText = "Connection error: " + (err.type || err.message || err);
                statusEl.className = "mt-4 text-sm font-bold text-red-500";
            });

            conn.on('close', () => {
                statusEl.innerText = "Disconnected from laptop.";
                statusEl.className = "mt-4 text-sm font-bold text-red-500";
            });
        });

        peer.on('error', (err) => {
            console.error("Peer error:", err);
            statusEl.innerText = "Failed to connect: " + err.type;
            statusEl.className = "mt-4 text-sm font-bold text-red-500";
        });

        peer.on('disconnected', () => {
            statusEl.innerText = "Lost connection to signaling server, retrying...";
            peer.reconnect();
        });
    });

    function activateControllerUI() {
        document.getElementById('controller-setup').style.display = 'none';
        document.getElementById('controller-active').style.display = 'flex';

        // Add the listener for device orientation
        window.addEventListener('deviceorientation', handleOrientation);

        // Warn the user if no motion data ever arrives (sensor blocked, etc.)
        gyroDebugTimeout = setTimeout(() => {
            if (!hasReceivedGyroData) {
                debugEl.innerHTML = "<span class='text-red-500 font-bold'>No motion detected!</span><br>Check if auto-rotate is on or if your browser blocks sensors.";
            }
        }, 3000);
    }

    document.getElementById('btn-recalibrate').addEventListener('click', () => {
        isCalibrated = false;
        debugEl.innerText = "Recalibrating...";
    });

    // --- FIRE BUTTON ---
    const btnShoot = document.getElementById('btn-shoot');
    btnShoot.addEventListener('touchstart', (e) => { e.preventDefault(); fireLaser(); });
    btnShoot.addEventListener('mousedown', fireLaser);

    function fireLaser() {
        if (conn && conn.open) conn.send({ type: 'action', action: 'fire' });
    }

    // --- ACCELERATOR & BRAKE BUTTONS ---
    const btnAccel = document.getElementById('btn-accel');
    const btnBrake = document.getElementById('btn-brake');

    function sendThrottle(accel, brake) {
        if (conn && conn.open) {
            conn.send({ type: 'throttle', accelerate: accel, brake: brake });
        }
    }

    // Accel Events
    btnAccel.addEventListener('touchstart', (e) => { e.preventDefault(); sendThrottle(true, false); });
    btnAccel.addEventListener('touchend', (e) => { e.preventDefault(); sendThrottle(false, false); });
    btnAccel.addEventListener('mousedown', () => { sendThrottle(true, false); });
    btnAccel.addEventListener('mouseup', () => { sendThrottle(false, false); });

    // Brake Events
    btnBrake.addEventListener('touchstart', (e) => { e.preventDefault(); sendThrottle(false, true); });
    btnBrake.addEventListener('touchend', (e) => { e.preventDefault(); sendThrottle(false, false); });
    btnBrake.addEventListener('mousedown', () => { sendThrottle(false, true); });
    btnBrake.addEventListener('mouseup', () => { sendThrottle(false, false); });

    // --- GYROSCOPE ORIENTATION ---
    function handleOrientation(event) {
        // If we get here with valid data, the gyroscope is working
        if (event.beta === null || event.gamma === null) return;

        if (!hasReceivedGyroData) {
            hasReceivedGyroData = true;
            clearTimeout(gyroDebugTimeout);
        }

        let beta = event.beta;   // Front/back tilt [-180, 180]
        let gamma = event.gamma; // Left/right tilt [-90, 90]

        // Update debug UI so you can see raw values live on the phone
        document.getElementById('gyro-debug').innerText = `Pitch: ${Math.round(beta)}° | Roll: ${Math.round(gamma)}°`;

        if (!conn || !conn.open) return;

        if (!isCalibrated) {
            baseBeta = beta;
            baseGamma = gamma;
            isCalibrated = true;
            return;
        }

        // Calculate difference from the center (calibrated) point
        let diffBeta = beta - baseBeta;
        let diffGamma = gamma - baseGamma;

        conn.send({
            type: 'orientation',
            pitch: diffBeta,
            roll: diffGamma
        });
    }
}
