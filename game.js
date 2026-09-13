// ==========================================
// THREE.JS 3D GAME LOGIC (HOST ONLY)
// ==========================================
function init3DGame() {
    const container = document.getElementById('canvas-container');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.003);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 20);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // Softer flat ambient now that hemisphere + shadowed directional light do
    // most of the work below - keeps the old light but stops it flattening shadows.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);

    // Hemisphere light gives a natural sky-blue / ground-green color gradient
    // on unlit surfaces instead of flat white - a big cheap realism win.
    const hemiLight = new THREE.HemisphereLight(0xaee2ff, 0x336633, 0.6);
    scene.add(hemiLight);

    const directionalLight = new THREE.DirectionalLight(0xfff4e0, 1.3);
    directionalLight.position.set(40, 60, 20);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(1024, 1024);
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 400;
    directionalLight.shadow.camera.left = -120;
    directionalLight.shadow.camera.right = 120;
    directionalLight.shadow.camera.top = 120;
    directionalLight.shadow.camera.bottom = -120;
    scene.add(directionalLight);

    // Air/speed line particles
    const particleGeo = new THREE.BufferGeometry();
    const particleCount = 600;
    const posArray = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i++) {
        posArray[i] = (Math.random() - 0.5) * 200;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particleMat = new THREE.PointsMaterial({
        size: 0.8,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // ==========================================
    // GROUND & SKY DRESSING (depth cues that make speed/turns read as real)
    // ==========================================
    function createGroundTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3a6b3f';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 2;
        const cell = 32;
        for (let x = 0; x <= size; x += cell) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
        for (let y = 0; y <= size; y += cell) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(40, 100);
        return texture;
    }

    const groundGeo = new THREE.PlaneGeometry(600, 1500);
    const groundMat = new THREE.MeshStandardMaterial({ map: createGroundTexture(), roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -18, -300);
    ground.receiveShadow = true;
    scene.add(ground);

    // Soft radial-gradient sprite texture, reused for clouds, muzzle flashes and explosions
    function createGlowTexture(rgb) {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gradient.addColorStop(0, `rgba(${rgb}, 0.95)`);
        gradient.addColorStop(0.5, `rgba(${rgb}, 0.4)`);
        gradient.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(canvas);
    }

    const glowTextureWhite = createGlowTexture('255,255,255');
    const glowTextureOrange = createGlowTexture('255,150,40');
    const glowTextureYellow = createGlowTexture('255,230,120');

    const cloudMat = new THREE.SpriteMaterial({ map: glowTextureWhite, transparent: true, opacity: 0.85, depthWrite: false });
    const clouds = [];
    const CLOUD_COUNT = 24;
    const CLOUD_MIN_Z = -320;
    const CLOUD_MAX_Z = -60;
    const CLOUD_DESPAWN_Z = 40;

    function randomCloudSpot() {
        return {
            x: (Math.random() - 0.5) * 260,
            y: 15 + Math.random() * 55,
            z: CLOUD_MIN_Z + Math.random() * (CLOUD_MAX_Z - CLOUD_MIN_Z)
        };
    }

    for (let i = 0; i < CLOUD_COUNT; i++) {
        const cloud = new THREE.Sprite(cloudMat);
        const scale = 18 + Math.random() * 30;
        cloud.scale.set(scale, scale * 0.55, 1);
        const spot = randomCloudSpot();
        cloud.position.set(spot.x, spot.y, spot.z);
        scene.add(cloud);
        clouds.push(cloud);
    }

    // ==========================================
    // LIGHTWEIGHT SPRITE FX SYSTEM (exhaust trail, muzzle flash, explosions)
    // ==========================================
    const effectSprites = [];

    function spawnEffectSprite(texture, position, opts = {}) {
        const mat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: opts.opacity ?? 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(position);
        const startScale = opts.startScale ?? 1;
        sprite.scale.set(startScale, startScale, 1);
        scene.add(sprite);
        effectSprites.push({
            sprite,
            velocity: opts.velocity ? opts.velocity.clone() : new THREE.Vector3(),
            life: opts.life ?? 0.5,
            maxLife: opts.life ?? 0.5,
            growth: opts.growth ?? 1
        });
    }

    function updateEffectSprites(dt) {
        for (let i = effectSprites.length - 1; i >= 0; i--) {
            const fx = effectSprites[i];
            fx.life -= dt;
            if (fx.life <= 0) {
                scene.remove(fx.sprite);
                effectSprites.splice(i, 1);
                continue;
            }
            fx.sprite.position.addScaledVector(fx.velocity, dt);
            const newScale = Math.max(0.01, fx.sprite.scale.x + fx.growth * dt);
            fx.sprite.scale.set(newScale, newScale, 1);
            fx.sprite.material.opacity = Math.max(0, fx.life / fx.maxLife);
        }
    }

    function spawnExplosion(position) {
        const count = 10;
        for (let k = 0; k < count; k++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 4 + Math.random() * 6;
            const dir = new THREE.Vector3(Math.cos(angle), (Math.random() - 0.5) * 1.5, Math.sin(angle)).multiplyScalar(speed);
            spawnEffectSprite(k % 2 === 0 ? glowTextureOrange : glowTextureYellow, position, {
                velocity: dir,
                life: 0.4 + Math.random() * 0.3,
                startScale: 1.2,
                growth: 3
            });
        }
    }

    // The Airplane
    const shipGroup = new THREE.Group();

    const bodyGeo = new THREE.CylinderGeometry(0.8, 1.2, 6, 16);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    shipGroup.add(body);

    const wingGeo = new THREE.BoxGeometry(8, 0.2, 2);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xdd2222 });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    wings.position.set(0, 0, 1);
    shipGroup.add(wings);

    const tailGeo = new THREE.BoxGeometry(0.2, 2, 1.5);
    const tail = new THREE.Mesh(tailGeo, wingMat);
    tail.position.set(0, 1, 2.5);
    shipGroup.add(tail);

    // Cockpit canopy - glassy dome for a real-aircraft silhouette
    const cockpitGeo = new THREE.SphereGeometry(0.7, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const cockpitMat = new THREE.MeshPhysicalMaterial({
        color: 0x224466, roughness: 0.1, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.85
    });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 0.9, -1.5);
    shipGroup.add(cockpit);

    // Wingtip navigation lights - the red/green cue that sells "real plane" at a glance
    const navLightGeo = new THREE.SphereGeometry(0.15, 8, 8);
    const navLightLeft = new THREE.Mesh(navLightGeo, new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 2 }));
    navLightLeft.position.set(-4, 0, 1);
    shipGroup.add(navLightLeft);
    const navLightRight = new THREE.Mesh(navLightGeo, new THREE.MeshStandardMaterial({ color: 0x22ff22, emissive: 0x00ff00, emissiveIntensity: 2 }));
    navLightRight.position.set(4, 0, 1);
    shipGroup.add(navLightRight);

    // Engine exhaust glow + a faint point light so it actually lights nearby surfaces
    const engineGlowGeo = new THREE.CylinderGeometry(0.5, 0.3, 1, 12);
    engineGlowGeo.rotateX(Math.PI / 2);
    const engineGlow = new THREE.Mesh(engineGlowGeo, new THREE.MeshStandardMaterial({ color: 0xff8800, emissive: 0xff5500, emissiveIntensity: 1.5 }));
    engineGlow.position.set(0, 0, 3.3);
    shipGroup.add(engineGlow);

    const engineLight = new THREE.PointLight(0xff6600, 1.2, 15);
    engineLight.position.set(0, 0, 3.3);
    shipGroup.add(engineLight);

    // Every solid part of the plane now casts a real shadow onto the ground
    shipGroup.traverse((obj) => { if (obj.isMesh) obj.castShadow = true; });

    scene.add(shipGroup);

    const lasers = [];
    const clock = new THREE.Clock();
    let cameraShake = 0;
    let cameraRoll = 0;
    let exhaustSpawnTimer = 0;

    // ==========================================
    // SHOOTABLE TARGETS & SCORING
    // ==========================================
    const scoreHudEl = document.getElementById('score-hud');
    scoreHudEl.style.display = 'block';
    score = 0;
    scoreHudEl.innerText = `Score: ${score}`;

    function addScore(points) {
        score += points;
        scoreHudEl.innerText = `Score: ${score}`;
        if (typeof sendScoreToController === 'function') sendScoreToController(score);
    }

    const TARGET_COUNT = 12;
    const TARGET_RADIUS = 2.0;
    const HIT_RADIUS = TARGET_RADIUS + 0.6;
    const TARGET_SPAWN_MIN_Z = -220;
    const TARGET_SPAWN_MAX_Z = -80;
    const TARGET_DESPAWN_Z = 25;

    const targetGeo = new THREE.IcosahedronGeometry(TARGET_RADIUS, 0);
    const targetMat = new THREE.MeshStandardMaterial({
        color: 0xffcc00,
        emissive: 0x996600,
        roughness: 0.3,
        metalness: 0.5
    });

    const targets = [];

    function randomTargetSpot() {
        return {
            x: (Math.random() - 0.5) * 26,
            y: (Math.random() - 0.5) * 14,
            z: TARGET_SPAWN_MIN_Z + Math.random() * (TARGET_SPAWN_MAX_Z - TARGET_SPAWN_MIN_Z)
        };
    }

    function spawnTarget() {
        const mesh = new THREE.Mesh(targetGeo, targetMat);
        const spot = randomTargetSpot();
        mesh.position.set(spot.x, spot.y, spot.z);
        scene.add(mesh);
        targets.push(mesh);
    }

    for (let i = 0; i < TARGET_COUNT; i++) spawnTarget();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);
        const dt = Math.min(clock.getDelta(), 0.1);

        // --- Acceleration / Braking ---
        if (isAccelerating) {
            planeSpeed += 0.1;
            if (planeSpeed > 6.0) planeSpeed = 6.0;
        } else if (isBraking) {
            planeSpeed -= 0.1;
            if (planeSpeed < 0.5) planeSpeed = 0.5;
        } else {
            if (planeSpeed > 2.0) planeSpeed -= 0.05;
            if (planeSpeed < 2.0) planeSpeed += 0.05;
        }

        // Forward-flight particle motion
        const positions = particles.geometry.attributes.position.array;
        for (let i = 2; i < particleCount * 3; i += 3) {
            positions[i] += planeSpeed;
            if (positions[i] > 50) positions[i] = -150;
        }
        particles.geometry.attributes.position.needsUpdate = true;

        // Cloud parallax drift, slower than targets so it reads as background depth
        for (let i = 0; i < clouds.length; i++) {
            const c = clouds[i];
            c.position.z += planeSpeed * 0.35;
            if (c.position.z > CLOUD_DESPAWN_Z) {
                const spot = randomCloudSpot();
                c.position.set(spot.x, spot.y, spot.z);
            }
        }

        // Engine exhaust trail - small glowing puffs streaming off the tail
        exhaustSpawnTimer -= dt;
        if (exhaustSpawnTimer <= 0) {
            exhaustSpawnTimer = 0.05;
            const enginePos = new THREE.Vector3(0, 0, 3.3).add(shipGroup.position);
            spawnEffectSprite(glowTextureOrange, enginePos, {
                velocity: new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, planeSpeed * 2 + 2),
                life: 0.5,
                startScale: 0.7,
                growth: 1.5
            });
        }

        // Move targets toward the plane; recycle once they pass behind it
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            t.position.z += planeSpeed;
            t.rotation.x += 0.02;
            t.rotation.y += 0.03;
            if (t.position.z > TARGET_DESPAWN_Z) {
                const spot = randomTargetSpot();
                t.position.set(spot.x, spot.y, spot.z);
            }
        }

        // Ship movement from controller data
        const targetPitchZ = THREE.MathUtils.clamp(shipPitch / 30, -1.5, 1.5);
        const targetY = THREE.MathUtils.clamp(-shipPitch / 3, -10, 10);

        const targetRollZ = THREE.MathUtils.clamp(-shipRoll / 30, -1.5, 1.5);
        const targetX = THREE.MathUtils.clamp(shipRoll / 3, -15, 15);

        shipGroup.position.x += (targetX - shipGroup.position.x) * 0.1;
        shipGroup.position.y += (targetY - shipGroup.position.y) * 0.1;

        shipGroup.rotation.z += (targetRollZ - shipGroup.rotation.z) * 0.1;
        shipGroup.rotation.x += (targetPitchZ - shipGroup.rotation.x) * 0.1;

        // Cosmetic yaw: a real plane's nose swings into a bank instead of just
        // tilting in place, so this makes turns read as carving rather than sliding.
        const targetYaw = THREE.MathUtils.clamp(shipRoll / 60, -0.3, 0.3);
        shipGroup.rotation.y += (targetYaw - shipGroup.rotation.y) * 0.08;

        // Tiny engine-vibration jitter so the plane never looks perfectly static
        shipGroup.rotation.x += Math.sin(clock.elapsedTime * 8) * 0.003;

        // Shooting
        if (isFiring) {
            createLaser();
            isFiring = false;
        }

        for (let i = lasers.length - 1; i >= 0; i--) {
            const laser = lasers[i];
            laser.position.z -= (planeSpeed + 2);

            let hitTarget = false;
            for (let j = 0; j < targets.length; j++) {
                if (laser.position.distanceTo(targets[j].position) < HIT_RADIUS) {
                    spawnExplosion(targets[j].position);
                    const spot = randomTargetSpot();
                    targets[j].position.set(spot.x, spot.y, spot.z);
                    addScore(10);
                    hitTarget = true;
                    break;
                }
            }

            if (hitTarget || laser.position.z < -100) {
                scene.remove(laser);
                lasers.splice(i, 1);
            }
        }

        // Camera follow
        camera.position.x = shipGroup.position.x * 0.5;
        camera.position.y = 5 + (shipGroup.position.y * 0.2);
        camera.lookAt(0, 0, -50);

        // Bank the camera itself with the turn, and widen the FOV with speed -
        // both are classic flight-sim tricks that sell velocity and G-force.
        // lookAt() resets rotation.z to ~0 every frame, so the smoothed roll
        // has to be tracked in its own variable rather than lerped from
        // camera.rotation.z (which would never accumulate).
        const targetRoll = -shipGroup.rotation.z * 0.4;
        cameraRoll += (targetRoll - cameraRoll) * 0.1;
        camera.rotation.z = cameraRoll;

        const targetFov = 75 + THREE.MathUtils.clamp((planeSpeed - 2) * 2, -5, 12);
        if (Math.abs(camera.fov - targetFov) > 0.05) {
            camera.fov += (targetFov - camera.fov) * 0.05;
            camera.updateProjectionMatrix();
        }

        // Firing recoil shake, decaying back to a steady camera
        if (cameraShake > 0) {
            camera.position.x += (Math.random() - 0.5) * cameraShake;
            camera.position.y += (Math.random() - 0.5) * cameraShake;
            cameraShake = Math.max(0, cameraShake - dt * 2);
        }

        updateEffectSprites(dt);

        renderer.render(scene, camera);
    }

    function createLaser() {
        const laserGeo = new THREE.CylinderGeometry(0.1, 0.1, 2, 8);
        laserGeo.rotateX(Math.PI / 2);
        const laserMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

        const laserL = new THREE.Mesh(laserGeo, laserMat);
        laserL.position.copy(shipGroup.position);
        laserL.position.x -= 3;

        const laserR = new THREE.Mesh(laserGeo, laserMat);
        laserR.position.copy(shipGroup.position);
        laserR.position.x += 3;

        // A glow sprite riding on each tracer makes it read as an energy bolt
        // instead of a plain solid stick - it moves with the laser for free
        // since it's parented to it.
        [laserL, laserR].forEach((laser) => {
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTextureYellow, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false
            }));
            glow.scale.set(1.2, 1.2, 1);
            laser.add(glow);
        });

        scene.add(laserL);
        scene.add(laserR);
        lasers.push(laserL, laserR);

        // Muzzle flash pop + a bit of recoil shake for weight
        spawnEffectSprite(glowTextureYellow, laserL.position, { life: 0.12, startScale: 2.5, growth: -8 });
        spawnEffectSprite(glowTextureYellow, laserR.position, { life: 0.12, startScale: 2.5, growth: -8 });
        cameraShake = 0.15;
    }

    animate();
}
