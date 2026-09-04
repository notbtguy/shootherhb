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
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(10, 20, 10);
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

    scene.add(shipGroup);

    const lasers = [];

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);

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

        // Ship movement from controller data
        const targetPitchZ = THREE.MathUtils.clamp(shipPitch / 30, -1.5, 1.5);
        const targetY = THREE.MathUtils.clamp(-shipPitch / 3, -10, 10);

        const targetRollZ = THREE.MathUtils.clamp(-shipRoll / 30, -1.5, 1.5);
        const targetX = THREE.MathUtils.clamp(shipRoll / 3, -15, 15);

        shipGroup.position.x += (targetX - shipGroup.position.x) * 0.1;
        shipGroup.position.y += (targetY - shipGroup.position.y) * 0.1;

        shipGroup.rotation.z += (targetRollZ - shipGroup.rotation.z) * 0.1;
        shipGroup.rotation.x += (targetPitchZ - shipGroup.rotation.x) * 0.1;

        // Shooting
        if (isFiring) {
            createLaser();
            isFiring = false;
        }

        for (let i = lasers.length - 1; i >= 0; i--) {
            lasers[i].position.z -= (planeSpeed + 2);
            if (lasers[i].position.z < -100) {
                scene.remove(lasers[i]);
                lasers.splice(i, 1);
            }
        }

        // Camera follow
        camera.position.x = shipGroup.position.x * 0.5;
        camera.position.y = 5 + (shipGroup.position.y * 0.2);
        camera.lookAt(0, 0, -50);

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

        scene.add(laserL);
        scene.add(laserR);
        lasers.push(laserL, laserR);
    }

    animate();
}
