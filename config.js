// ==========================================
// SHARED CONFIG & STATE
// ==========================================

// IMPORTANT FIX: PeerJS/WebRTC requires "urls" (plural), not "url".
// The old "url" key is silently ignored by modern browsers, which is
// why the connection could hang forever on cellular data.
//
// STUN alone often fails when the phone is on 4G/LTE (carrier NAT),
// so a TURN relay is included as a fallback. TURN servers relay all
// the traffic, so they need real bandwidth — the ones below are a
// free tier from Open Relay, good for testing/small projects. If you
// hit reliability limits, sign up for your own at:
// https://www.metered.ca/tools/openrelay
const peerConfig = {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    }
};

let peer;
let conn;

// Calibration
let baseBeta = 0;
let baseGamma = 0;
let isCalibrated = false;

// Flight Physics State (read by game.js, written by host.js from controller data)
let shipPitch = 0;
let shipRoll = 0;
let isFiring = false;
let isAccelerating = false;
let isBraking = false;
let planeSpeed = 2.0; // Starting cruising speed

// Gyro debug tracking
let hasReceivedGyroData = false;
let gyroDebugTimeout = null;

// ==========================================
// GYRO TRACKING TUNING
// ==========================================
// Raw deviceorientation events can fire 60-200Hz depending on the phone and
// are noisy, so we low-pass filter them and only push a value over the wire
// on a fixed timer instead of on every single event. This cuts data-channel
// traffic drastically (efficiency) while making the plane's motion smoother
// and less jittery (tracking quality) at the same time.
const GYRO_SMOOTHING = 0.2;        // 0-1: higher = snappier, lower = smoother
const GYRO_DEADZONE = 0.6;         // degrees of drift around center to ignore
const GYRO_MAX_DIFF = 45;          // clamp sent tilt to a sane, useful range
const GYRO_SEND_INTERVAL_MS = 40;  // ~25Hz network updates

// Score (host-side authoritative, mirrored to controller for display)
let score = 0;
