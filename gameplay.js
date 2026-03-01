import * as THREE from "https://unpkg.com/three@0.162.0/build/three.module.js";
import { PointerLockControls } from "https://unpkg.com/three@0.162.0/examples/jsm/controls/PointerLockControls.js";

const root = document.getElementById("game-root");
const hint = document.getElementById("hint");
const invSlot1 = document.getElementById("inv-slot-1");
const modeBtn = document.getElementById("mode-btn");
const hearts = document.getElementById("hearts");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x79c6ff);
scene.fog = new THREE.Fog(0x79c6ff, 35, 200);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 16, 10);

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

const hemi = new THREE.HemisphereLight(0xa9d8ff, 0x6b4a2a, 0.65);
scene.add(hemi);

const sunLight = new THREE.DirectionalLight(0xfff3bf, 1.0);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -90;
sunLight.shadow.camera.right = 90;
sunLight.shadow.camera.top = 90;
sunLight.shadow.camera.bottom = -90;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 260;
scene.add(sunLight);

const sunSphere = new THREE.Mesh(
    new THREE.SphereGeometry(3, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffef9b })
);
scene.add(sunSphere);

const keyState = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    Space: false,
    ShiftLeft: false,
};

const velocity = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();

const chunkGroups = new Map();
const blockMeshes = [];
const blockMeshSet = new Set();
const modifiedColumns = new Map();

const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;
const EYE_HEIGHT = 1.7;
const GRAVITY = 28;
const JUMP_SPEED = 11;
const WALK_SPEED = 10;
const FLY_SPEED = 13;
const SEED = 1337;

let mode = "SURVIVAL";
let canJump = false;
let currentChunkX = null;
let currentChunkZ = null;

function mulberry32(seed) {
    return function random() {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildPermutation(seed) {
    const rand = mulberry32(seed);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i += 1) {
        p[i] = perm[i & 255];
    }
    return p;
}

const permutation = buildPermutation(SEED);

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
    return a + t * (b - a);
}

function grad(hash, x, y) {
    const h = hash & 3;
    if (h === 0) {
        return x + y;
    }
    if (h === 1) {
        return -x + y;
    }
    if (h === 2) {
        return x - y;
    }
    return -x - y;
}

function perlin2(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = permutation[permutation[xi] + yi];
    const ab = permutation[permutation[xi] + yi + 1];
    const ba = permutation[permutation[xi + 1] + yi];
    const bb = permutation[permutation[xi + 1] + yi + 1];

    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
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
    for (let i = 0; i < 260; i += 1) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(Math.random() * size);
        ctx.fillStyle = `rgb(${35 + Math.floor(Math.random() * 20)}, ${125 + Math.floor(Math.random() * 80)}, ${35 + Math.floor(Math.random() * 30)})`;
        ctx.fillRect(x, y, 2, 2);
    }
});

const dirtTexture = makePixelTexture((ctx, size) => {
    ctx.fillStyle = "#7b4b2a";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 250; i += 1) {
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
    for (let i = 0; i < 200; i += 1) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(Math.random() * size);
        const isTop = y < size * 0.35;
        if (isTop) {
            ctx.fillStyle = `rgb(${30 + Math.floor(Math.random() * 25)}, ${130 + Math.floor(Math.random() * 70)}, ${30 + Math.floor(Math.random() * 25)})`;
        } else {
            const shade = 84 + Math.floor(Math.random() * 55);
            ctx.fillStyle = `rgb(${shade + 30}, ${shade}, ${shade - 20})`;
        }
        ctx.fillRect(x, y, 2, 2);
    }
});

const sandTexture = makePixelTexture((ctx, size) => {
    ctx.fillStyle = "#d8c27a";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 220; i += 1) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(Math.random() * size);
        const c = 180 + Math.floor(Math.random() * 55);
        ctx.fillStyle = `rgb(${c}, ${c - 18}, ${100 + Math.floor(Math.random() * 50)})`;
        ctx.fillRect(x, y, 2, 2);
    }
});

const plankTexture = makePixelTexture((ctx, size) => {
    ctx.fillStyle = "#b7834e";
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 8) {
        ctx.fillStyle = "rgba(78, 48, 26, 0.55)";
        ctx.fillRect(0, y, size, 2);
    }
    for (let i = 0; i < 60; i += 1) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(Math.random() * size);
        ctx.fillStyle = "rgba(90, 58, 34, 0.4)";
        ctx.fillRect(x, y, 2, 2);
    }
});

const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const dirtMaterial = new THREE.MeshLambertMaterial({ map: dirtTexture });
const sandMaterial = new THREE.MeshLambertMaterial({ map: sandTexture });
const plankMaterial = new THREE.MeshLambertMaterial({ map: plankTexture });
const grassMaterials = [
    new THREE.MeshLambertMaterial({ map: grassSideTexture }),
    new THREE.MeshLambertMaterial({ map: grassSideTexture }),
    new THREE.MeshLambertMaterial({ map: grassTopTexture }),
    new THREE.MeshLambertMaterial({ map: dirtTexture }),
    new THREE.MeshLambertMaterial({ map: grassSideTexture }),
    new THREE.MeshLambertMaterial({ map: grassSideTexture }),
];

function getBiome(x, z) {
    const biomeNoise = perlin2((x + 4200) * 0.006, (z - 1300) * 0.006);
    return biomeNoise > 0.2 ? "DESERT" : "PLAINS";
}

function getSurfaceHeight(x, z) {
    const plains = perlin2(x * 0.02, z * 0.02) * 4;
    const rolling = perlin2(x * 0.006, z * 0.006) * 10;
    const mountainMask = Math.max(0, perlin2((x + 1000) * 0.0035, (z - 1000) * 0.0035));
    const mountain = Math.pow(Math.max(0, perlin2(x * 0.012, z * 0.012)), 2) * 22 * mountainMask;
    return Math.floor(9 + plains + rolling + mountain);
}

function getSurfaceBlock(x, z) {
    return getBiome(x, z) === "DESERT" ? "SAND" : "GRASS";
}

function columnKey(x, z) {
    return `${x},${z}`;
}

function getColumnOverride(x, z) {
    return modifiedColumns.get(columnKey(x, z));
}

function setColumnOverride(x, z, data) {
    modifiedColumns.set(columnKey(x, z), data);
}

function getCurrentColumnState(x, z) {
    const override = getColumnOverride(x, z);
    if (override) {
        return override;
    }
    return {
        height: getSurfaceHeight(x, z),
        topBlock: getSurfaceBlock(x, z),
    };
}

function getGroundAt(x, z) {
    return getCurrentColumnState(Math.round(x), Math.round(z)).height;
}

function groundAt(x, z) {
    return getGroundAt(x, z);
}

function addBlockMesh(group, x, y, z, blockName) {
    let material = dirtMaterial;
    if (blockName === "GRASS") {
        material = grassMaterials;
    } else if (blockName === "SAND") {
        material = sandMaterial;
    } else if (blockName === "PLANK") {
        material = plankMaterial;
    }

    const mesh = new THREE.Mesh(cubeGeometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.blockName = blockName;
    mesh.userData.gridX = x;
    mesh.userData.gridY = y;
    mesh.userData.gridZ = z;
    group.add(mesh);
    blockMeshes.push(mesh);
    blockMeshSet.add(mesh);
}

function addVillageHouse(group, baseX, baseY, baseZ) {
    for (let x = 0; x < 5; x += 1) {
        for (let z = 0; z < 5; z += 1) {
            addBlockMesh(group, baseX + x, baseY, baseZ + z, "PLANK");
        }
    }
    for (let y = 1; y <= 3; y += 1) {
        for (let x = 0; x < 5; x += 1) {
            addBlockMesh(group, baseX + x, baseY + y, baseZ, "PLANK");
            addBlockMesh(group, baseX + x, baseY + y, baseZ + 4, "PLANK");
        }
        for (let z = 1; z < 4; z += 1) {
            addBlockMesh(group, baseX, baseY + y, baseZ + z, "PLANK");
            addBlockMesh(group, baseX + 4, baseY + y, baseZ + z, "PLANK");
        }
    }
    for (let x = -1; x <= 5; x += 1) {
        for (let z = -1; z <= 5; z += 1) {
            addBlockMesh(group, baseX + x, baseY + 4, baseZ + z, "PLANK");
        }
    }
}

function chunkVillageSeed(chunkX, chunkZ) {
    const n = Math.sin((chunkX + 37) * 12.9898 + (chunkZ - 23) * 78.233 + SEED) * 43758.5453;
    return n - Math.floor(n);
}

function generateChunk(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    if (chunkGroups.has(key)) {
        return;
    }

    const group = new THREE.Group();
    group.userData.chunkKey = key;

    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;

    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
            const x = startX + lx;
            const z = startZ + lz;
            const col = getCurrentColumnState(x, z);
            const h = col.height;
            const topBlock = col.topBlock;

            for (let y = h - 4; y <= h; y += 1) {
                if (y < 0) {
                    continue;
                }
                const isTop = y === h;
                const blockType = isTop ? topBlock : (topBlock === "SAND" ? "SAND" : "DIRT");
                addBlockMesh(group, x, y, z, blockType);
            }
        }
    }

    const villageRoll = chunkVillageSeed(chunkX, chunkZ);
    if (villageRoll > 0.92) {
        const houseX = startX + 4;
        const houseZ = startZ + 4;
        const baseY = getSurfaceHeight(houseX, houseZ) + 1;
        addVillageHouse(group, houseX, baseY, houseZ);
    }

    chunkGroups.set(key, group);
    scene.add(group);
}

function unloadChunk(key) {
    const group = chunkGroups.get(key);
    if (!group) {
        return;
    }

    group.traverse((obj) => {
        if (obj.isMesh && blockMeshSet.has(obj)) {
            blockMeshSet.delete(obj);
            const idx = blockMeshes.indexOf(obj);
            if (idx >= 0) {
                blockMeshes.splice(idx, 1);
            }
        }
    });

    scene.remove(group);
    chunkGroups.delete(key);
}

function updateChunkWindow() {
    const px = controls.getObject().position.x;
    const pz = controls.getObject().position.z;
    const chunkX = Math.floor(px / CHUNK_SIZE);
    const chunkZ = Math.floor(pz / CHUNK_SIZE);
    if (chunkX === currentChunkX && chunkZ === currentChunkZ) {
        return;
    }
    currentChunkX = chunkX;
    currentChunkZ = chunkZ;

    const needed = new Set();
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx += 1) {
        for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz += 1) {
            const cx = chunkX + dx;
            const cz = chunkZ + dz;
            const key = `${cx},${cz}`;
            needed.add(key);
            generateChunk(cx, cz);
        }
    }

    Array.from(chunkGroups.keys()).forEach((key) => {
        if (!needed.has(key)) {
            unloadChunk(key);
        }
    });
}

function applySpawnFloor() {
    for (let x = -50; x < 50; x += 1) {
        for (let z = -50; z < 50; z += 1) {
            setColumnOverride(x, z, {
                height: 0,
                topBlock: "GRASS",
            });
        }
    }
}

function setMode(nextMode) {
    mode = nextMode;
    modeBtn.textContent = `Mode: ${mode}`;
    if (mode === "CREATIVE") {
        hearts.style.opacity = "0.35";
        hint.textContent = "CREATIVE enabled: Fly with Space/Shift. Click to mine.";
        velocity.set(0, 0, 0);
    } else {
        hearts.style.opacity = "1";
        hint.textContent = "SURVIVAL enabled: Gravity and hearts active.";
    }
}

function toggleMode() {
    if (mode === "SURVIVAL") {
        setMode("CREATIVE");
    } else {
        setMode("SURVIVAL");
    }
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
    }

    const speed = mode === "CREATIVE" ? FLY_SPEED : WALK_SPEED;
    controls.moveRight(moveDirection.x * speed * delta);
    controls.moveForward(-moveDirection.z * speed * delta);

    if (mode === "CREATIVE") {
        if (keyState.Space) {
            controls.getObject().position.y += speed * delta;
        }
        if (keyState.ShiftLeft) {
            controls.getObject().position.y -= speed * delta;
        }
    } else {
        velocity.y -= GRAVITY * delta;
        controls.getObject().position.y += velocity.y * delta;

        const floor = getGroundAt(controls.getObject().position.x, controls.getObject().position.z) + EYE_HEIGHT;
        if (controls.getObject().position.y <= floor) {
            controls.getObject().position.y = floor;
            velocity.y = 0;
            canJump = true;
        }
    }
}

function animateSky(t) {
    const radius = 95;
    const angle = t * 0.05;
    const sunX = Math.cos(angle) * radius;
    const sunY = 42 + Math.sin(angle) * 30;
    const sunZ = Math.sin(angle) * radius;

    sunLight.position.set(sunX, sunY, sunZ);
    sunSphere.position.set(sunX, sunY, sunZ);

    const dayMix = THREE.MathUtils.clamp((sunY - 8) / 42, 0.1, 1);
    scene.background = new THREE.Color().setRGB(0.25 * dayMix, 0.52 * dayMix + 0.17, 0.95 * dayMix + 0.05);
    scene.fog.color.copy(scene.background);
    sunLight.intensity = 0.35 + dayMix * 0.85;
}

function mineCenteredBlock() {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(blockMeshes, false);
    if (hits.length === 0) {
        return;
    }

    const mesh = hits[0].object;
    if (!mesh || !blockMeshSet.has(mesh)) {
        return;
    }

    const blockName = mesh.userData.blockName || "BLOCK";
    const gx = mesh.userData.gridX;
    const gz = mesh.userData.gridZ;
    const gy = mesh.userData.gridY;

    scene.remove(mesh);
    blockMeshSet.delete(mesh);
    const idx = blockMeshes.indexOf(mesh);
    if (idx >= 0) {
        blockMeshes.splice(idx, 1);
    }

    const col = getCurrentColumnState(gx, gz);
    if (gy >= col.height) {
        setColumnOverride(gx, gz, {
            height: gy - 1,
            topBlock: gy - 1 >= 0 ? (blockName === "SAND" ? "SAND" : "DIRT") : "DIRT",
        });
    }

    invSlot1.textContent = blockName;
    invSlot1.title = blockName;
    hint.textContent = `Mined ${blockName}.`;
}

function onKeyDown(event) {
    if (event.code in keyState) {
        keyState[event.code] = true;
        event.preventDefault();
    }

    if (mode === "SURVIVAL" && event.code === "Space") {
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
            return;
        }
        mineCenteredBlock();
    });

    modeBtn.addEventListener("click", () => {
        toggleMode();
    });

    controls.addEventListener("lock", () => {
        hint.textContent = mode === "CREATIVE"
            ? "Mouse locked. CREATIVE flight active."
            : "Mouse locked. SURVIVAL active.";
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
    updateChunkWindow();
    animateSky(elapsed);
    renderer.render(scene, camera);
}

function init() {
    setMode("SURVIVAL");
    applySpawnFloor();
    window.__groundAt = groundAt;
    controls.getObject().position.set(0, 5, 0);
    updateChunkWindow();
    setupEvents();
    animate();
}

init();
