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

            // Listen for handshake from host just in case local 'open' is slow,
            // and for score updates so the player can see their score too.
            conn.on('data', (data) => {
                if (data.type === 'handshake' && data.status === 'ready') {
                    clearTimeout(connectTimeout);
                    activateControllerUI();
                } else if (data.type === 'score') {
                    const scoreEl = document.getElementById('ctrl-score');
                    if (scoreEl) scoreEl.innerText = `Score: ${data.score}`;
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

        // Push the latest smoothed orientation on a fixed timer rather than on
        // every raw sensor event. Decouples network send rate from sensor rate
        // (which varies wildly by device) and gives the host a steady stream.
        if (orientationSendTimer) clearInterval(orientationSendTimer);
        orientationSendTimer = setInterval(() => {
            if (pendingOrientation && conn && conn.open) {
                conn.send({
                    type: 'orientation',
                    pitch: pendingOrientation.pitch,
                    roll: pendingOrientation.roll
                });
            }
        }, GYRO_SEND_INTERVAL_MS);
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
    // smoothedBeta/Gamma hold an exponential moving average of the raw sensor
    // values, killing the high-frequency jitter phone gyros are prone to.
    // pendingOrientation holds the latest computed diff; the interval set up
    // in activateControllerUI() is what actually flushes it over the wire.
    let smoothedBeta = null;
    let smoothedGamma = null;
    let pendingOrientation = null;
    let orientationSendTimer = null;

    function handleOrientation(event) {
        // If we get here with valid data, the gyroscope is working
        if (event.beta === null || event.gamma === null) return;

        if (!hasReceivedGyroData) {
            hasReceivedGyroData = true;
            clearTimeout(gyroDebugTimeout);
        }

        const rawBeta = event.beta;   // Front/back tilt [-180, 180]
        const rawGamma = event.gamma; // Left/right tilt [-90, 90]

        // Low-pass filter: ease toward the new reading instead of snapping to it
        if (smoothedBeta === null) {
            smoothedBeta = rawBeta;
            smoothedGamma = rawGamma;
        } else {
            smoothedBeta += (rawBeta - smoothedBeta) * GYRO_SMOOTHING;
            smoothedGamma += (rawGamma - smoothedGamma) * GYRO_SMOOTHING;
        }

        // Update debug UI so you can see live values on the phone
        document.getElementById('gyro-debug').innerText = `Pitch: ${Math.round(smoothedBeta)}° | Roll: ${Math.round(smoothedGamma)}°`;

        if (!conn || !conn.open) return;

        if (!isCalibrated) {
            baseBeta = smoothedBeta;
            baseGamma = smoothedGamma;
            isCalibrated = true;
            return;
        }

        // Calculate difference from the center (calibrated) point
        let diffBeta = smoothedBeta - baseBeta;
        let diffGamma = smoothedGamma - baseGamma;

        // Deadzone: ignore tiny drift so the plane holds still when the phone
        // is held steady, instead of slowly creeping.
        if (Math.abs(diffBeta) < GYRO_DEADZONE) diffBeta = 0;
        if (Math.abs(diffGamma) < GYRO_DEADZONE) diffGamma = 0;

        // Clamp to a useful range so a big tilt can't send a runaway value
        diffBeta = Math.max(-GYRO_MAX_DIFF, Math.min(GYRO_MAX_DIFF, diffBeta));
        diffGamma = Math.max(-GYRO_MAX_DIFF, Math.min(GYRO_MAX_DIFF, diffGamma));

        pendingOrientation = { pitch: diffBeta, roll: diffGamma };
    }
}
