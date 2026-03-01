import * as THREE from "https://unpkg.com/three@0.162.0/build/three.module.js";
import { PointerLockControls } from "https://unpkg.com/three@0.162.0/examples/jsm/controls/PointerLockControls.js";

const root = document.getElementById("game-root");
const hint = document.getElementById("hint");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x79c6ff);
scene.fog = new THREE.Fog(0x79c6ff, 25, 90);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 6, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambientLight);

const hemi = new THREE.HemisphereLight(0xa9d8ff, 0x4f3d2a, 0.55);
scene.add(hemi);

const sunLight = new THREE.DirectionalLight(0xfff3bf, 1.05);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -50;
sunLight.shadow.camera.right = 50;
sunLight.shadow.camera.top = 50;
sunLight.shadow.camera.bottom = -50;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 130;
scene.add(sunLight);

const sunSphere = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffee88 })
);
scene.add(sunSphere);

const keyState = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
};

const velocity = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const clock = new THREE.Clock();
const worldHeights = new Map();

let canJump = false;

const EYE_HEIGHT = 1.7;
const GRAVITY = 28;
const JUMP_SPEED = 11;
const WALK_SPEED = 8;
const WORLD_RADIUS = 14;

function hashNoise(x, z) {
    const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

function makePixelTexture(drawFn) {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    drawFn(ctx, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

const grassTopTexture = makePixelTexture((ctx, size) => {
    ctx.fillStyle = "#6fbf3e";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 220; i += 1) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(Math.random() * size);
        const g = 120 + Math.floor(Math.random() * 70);
        ctx.fillStyle = `rgb(${30 + Math.floor(Math.random() * 25)}, ${g}, ${35 + Math.floor(Math.random() * 30)})`;
        ctx.fillRect(x, y, 2, 2);
    }
});

const dirtTexture = makePixelTexture((ctx, size) => {
    ctx.fillStyle = "#7b4b2a";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 230; i += 1) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(Math.random() * size);
        const shade = 80 + Math.floor(Math.random() * 60);
        ctx.fillStyle = `rgb(${shade + 35}, ${shade}, ${shade - 20})`;
        ctx.fillRect(x, y, 2, 2);
    }
});

const grassSideTexture = makePixelTexture((ctx, size) => {
    ctx.fillStyle = "#7b4b2a";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#6fbf3e";
    ctx.fillRect(0, 0, size, Math.floor(size * 0.35));

    for (let i = 0; i < 160; i += 1) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(Math.random() * (size * 0.35));
        ctx.fillStyle = `rgb(${30 + Math.floor(Math.random() * 30)}, ${140 + Math.floor(Math.random() * 75)}, ${30 + Math.floor(Math.random() * 30)})`;
        ctx.fillRect(x, y, 2, 2);
    }
    for (let i = 0; i < 150; i += 1) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(size * 0.35 + Math.random() * size * 0.65);
        const shade = 85 + Math.floor(Math.random() * 55);
        ctx.fillStyle = `rgb(${shade + 32}, ${shade}, ${shade - 20})`;
        ctx.fillRect(x, y, 2, 2);
    }
});

const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const dirtMaterial = new THREE.MeshLambertMaterial({ map: dirtTexture });
const grassMaterials = [
    new THREE.MeshLambertMaterial({ map: grassSideTexture }),
    new THREE.MeshLambertMaterial({ map: grassSideTexture }),
    new THREE.MeshLambertMaterial({ map: grassTopTexture }),
    new THREE.MeshLambertMaterial({ map: dirtTexture }),
    new THREE.MeshLambertMaterial({ map: grassSideTexture }),
    new THREE.MeshLambertMaterial({ map: grassSideTexture }),
];

function addBlock(x, y, z, topIsGrass) {
    const mesh = new THREE.Mesh(cubeGeometry, topIsGrass ? grassMaterials : dirtMaterial);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
}

function generateTerrain() {
    for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
        for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
            const h1 = Math.floor(hashNoise(x * 0.7, z * 0.7) * 3);
            const h2 = Math.floor(hashNoise(x * 1.2 + 30, z * 1.2 + 80) * 2);
            const surfaceY = h1 + h2;
            worldHeights.set(`${x},${z}`, surfaceY);

            for (let y = -2; y <= surfaceY; y += 1) {
                addBlock(x, y, z, y === surfaceY);
            }
        }
    }
}

function groundAt(x, z) {
    const gx = Math.round(x);
    const gz = Math.round(z);
    const value = worldHeights.get(`${gx},${gz}`);
    if (typeof value === "number") {
        return value;
    }
    return -50;
}

function clampWorldBounds(position) {
    const limit = WORLD_RADIUS - 0.3;
    position.x = Math.max(-limit, Math.min(limit, position.x));
    position.z = Math.max(-limit, Math.min(limit, position.z));
}

function updateMovement(delta) {
    if (!controls.isLocked) {
        return;
    }

    moveDirection.set(0, 0, 0);
    if (keyState.KeyW) {
        moveDirection.z -= 1;
    }
    if (keyState.KeyS) {
        moveDirection.z += 1;
    }
    if (keyState.KeyA) {
        moveDirection.x -= 1;
    }
    if (keyState.KeyD) {
        moveDirection.x += 1;
    }
    if (moveDirection.lengthSq() > 0) {
        moveDirection.normalize();
        controls.moveRight(moveDirection.x * WALK_SPEED * delta);
        controls.moveForward(-moveDirection.z * WALK_SPEED * delta);
    }

    velocity.y -= GRAVITY * delta;
    controls.getObject().position.y += velocity.y * delta;

    const floor = groundAt(controls.getObject().position.x, controls.getObject().position.z) + EYE_HEIGHT;
    if (controls.getObject().position.y <= floor) {
        controls.getObject().position.y = floor;
        velocity.y = 0;
        canJump = true;
    }

    clampWorldBounds(controls.getObject().position);
}

function animateSky(t) {
    const radius = 55;
    const angle = t * 0.1;
    const sunX = Math.cos(angle) * radius;
    const sunY = 25 + Math.sin(angle) * 18;
    const sunZ = Math.sin(angle) * radius;

    sunLight.position.set(sunX, sunY, sunZ);
    sunSphere.position.set(sunX, sunY, sunZ);

    const dayMix = THREE.MathUtils.clamp((sunY - 6) / 28, 0.15, 1);
    scene.background = new THREE.Color().setRGB(0.3 * dayMix, 0.55 * dayMix + 0.2, 0.9 * dayMix + 0.1);
    sunLight.intensity = 0.45 + dayMix * 0.8;
}

function onKeyDown(event) {
    if (event.code in keyState) {
        keyState[event.code] = true;
        event.preventDefault();
    }

    if (event.code === "Space") {
        if (controls.isLocked && canJump) {
            velocity.y = JUMP_SPEED;
            canJump = false;
        }
        event.preventDefault();
    }
}

function onKeyUp(event) {
    if (event.code in keyState) {
        keyState[event.code] = false;
    }
}

function setupEvents() {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    renderer.domElement.addEventListener("click", () => {
        if (!controls.isLocked) {
            controls.lock();
        }
    });

    controls.addEventListener("lock", () => {
        hint.textContent = "Mouse locked. Explore your world.";
    });

    controls.addEventListener("unlock", () => {
        hint.textContent = "Click to lock mouse. Move: W A S D | Jump: Space";
    });

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(0.05, clock.getDelta());
    const elapsed = clock.elapsedTime;

    updateMovement(delta);
    animateSky(elapsed);
    renderer.render(scene, camera);
}

function init() {
    generateTerrain();
    controls.getObject().position.set(0, groundAt(0, 0) + EYE_HEIGHT, 6);
    setupEvents();
    animate();
}

init();
