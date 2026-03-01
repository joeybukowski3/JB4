const world = document.getElementById("world");
const collectFeedback = document.getElementById("collect-feedback");
const inventorySlots = Array.from(document.querySelectorAll(".inventory-bar .slot"));
const craftButtons = Array.from(document.querySelectorAll(".craft-grid button"));

const WORLD_COLS = 14;
const WORLD_ROWS = 8;
const worldCells = [];
const keyState = {};
const inventory = new Map();
const itemOrder = [];
let audioContext;
let playerX = 40;
let playerY = 40;
const playerSize = 22;
const playerSpeed = 150;
let lastTimestamp = performance.now();

const player = document.createElement("div");
player.className = "player";
world.appendChild(player);

function showFeedback(message) {
    collectFeedback.textContent = message;
}

function playPopSound() {
    try {
        audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.1);
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
        // Keep gameplay functional even when audio is blocked.
    }
}

function renderInventory() {
    inventorySlots.forEach((slot) => {
        slot.textContent = "";
        delete slot.dataset.item;
    });

    const entries = itemOrder
        .map((item) => [item, inventory.get(item) || 0])
        .filter((entry) => entry[1] > 0)
        .slice(0, inventorySlots.length);

    entries.forEach(([item, count], index) => {
        const slot = inventorySlots[index];
        slot.dataset.item = item;
        slot.textContent = `${item.slice(0, 4)} ${count}`;
        slot.title = `${item} x${count}`;
    });
}

function addItem(itemName, amount) {
    const nextValue = (inventory.get(itemName) || 0) + amount;
    inventory.set(itemName, nextValue);
    if (!itemOrder.includes(itemName)) {
        itemOrder.push(itemName);
    }
    renderInventory();
}

function removeItem(itemName, amount) {
    const current = inventory.get(itemName) || 0;
    if (current < amount) {
        return false;
    }
    const nextValue = current - amount;
    if (nextValue === 0) {
        inventory.delete(itemName);
    } else {
        inventory.set(itemName, nextValue);
    }
    renderInventory();
    return true;
}

function buildWorld() {
    const dirtSet = new Set([
        "2,2", "3,2", "8,1", "10,2", "5,4", "6,4", "9,5", "11,6", "4,6", "1,5",
    ]);

    for (let row = 0; row < WORLD_ROWS; row += 1) {
        for (let col = 0; col < WORLD_COLS; col += 1) {
            const cell = document.createElement("div");
            cell.className = "cell";
            cell.dataset.x = String(col);
            cell.dataset.y = String(row);
            if (dirtSet.has(`${col},${row}`)) {
                cell.classList.add("dirt");
            }
            world.appendChild(cell);
            worldCells.push(cell);
        }
    }
}

function getCellAtPoint(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!target || !(target instanceof HTMLElement)) {
        return null;
    }
    if (!target.classList.contains("cell")) {
        return null;
    }
    return target;
}

function rectsTouch(rectA, rectB) {
    return !(
        rectA.right < rectB.left ||
        rectA.left > rectB.right ||
        rectA.bottom < rectB.top ||
        rectA.top > rectB.bottom
    );
}

function positionPlayer() {
    const worldRect = world.getBoundingClientRect();
    const maxX = worldRect.width - playerSize;
    const maxY = worldRect.height - playerSize;
    playerX = Math.max(0, Math.min(playerX, maxX));
    playerY = Math.max(0, Math.min(playerY, maxY));
    player.style.left = `${playerX}px`;
    player.style.top = `${playerY}px`;
}

function gameLoop(timestamp) {
    const delta = Math.min(0.05, (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;
    let moveX = 0;
    let moveY = 0;

    if (keyState.KeyW) {
        moveY -= 1;
    }
    if (keyState.KeyS) {
        moveY += 1;
    }
    if (keyState.KeyA) {
        moveX -= 1;
    }
    if (keyState.KeyD) {
        moveX += 1;
    }

    if (moveX !== 0 || moveY !== 0) {
        const length = Math.hypot(moveX, moveY);
        moveX /= length;
        moveY /= length;
        playerX += moveX * playerSpeed * delta;
        playerY += moveY * playerSpeed * delta;
        positionPlayer();
    }

    requestAnimationFrame(gameLoop);
}

function setupMovement() {
    window.addEventListener("keydown", (event) => {
        if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
            keyState[event.code] = true;
            event.preventDefault();
        }
    });

    window.addEventListener("keyup", (event) => {
        if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
            keyState[event.code] = false;
        }
    });

    window.addEventListener("blur", () => {
        Object.keys(keyState).forEach((key) => {
            keyState[key] = false;
        });
    });

    window.addEventListener("resize", () => {
        positionPlayer();
    });
}

function handleWorldClick(event) {
    const cell = getCellAtPoint(event.clientX, event.clientY);
    if (!cell) {
        return;
    }

    const playerRect = player.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    if (cell.classList.contains("dirt")) {
        if (!rectsTouch(playerRect, cellRect)) {
            showFeedback("Move closer to break this dirt block.");
            return;
        }

        cell.classList.remove("dirt");
        addItem("DIRT", 1);
        showFeedback("Pop! Broke dirt and collected DIRT.");
        playPopSound();
        return;
    }

    if ((inventory.get("DIRT") || 0) <= 0) {
        showFeedback("No DIRT in inventory to place.");
        return;
    }

    if (rectsTouch(playerRect, cellRect)) {
        showFeedback("Cannot place a block on your character.");
        return;
    }

    cell.classList.add("dirt");
    removeItem("DIRT", 1);
    showFeedback("Pop! Placed a dirt block.");
    playPopSound();
}

function handleCraftButtonClick(action) {
    if (action === "collect-wood") {
        addItem("WOOD", 1);
        showFeedback("Pop! Collected WOOD.");
        playPopSound();
        return;
    }

    if (action === "collect-stone") {
        addItem("STONE", 1);
        showFeedback("Pop! Collected STONE.");
        playPopSound();
        return;
    }

    if (action === "craft-planks") {
        if ((inventory.get("WOOD") || 0) < 4) {
            showFeedback("Need 4 WOOD to craft PLANKS.");
            return;
        }
        removeItem("WOOD", 4);
        addItem("PLANKS", 1);
        showFeedback("Pop! Crafted PLANKS from 4 WOOD.");
        playPopSound();
    }
}

function init() {
    buildWorld();
    positionPlayer();
    setupMovement();
    renderInventory();
    showFeedback("Collect resources and build.");

    world.addEventListener("click", handleWorldClick);
    craftButtons.forEach((button) => {
        button.addEventListener("click", () => {
            handleCraftButtonClick(button.dataset.action || "");
        });
    });

    requestAnimationFrame((timestamp) => {
        lastTimestamp = timestamp;
        gameLoop(timestamp);
    });
}

init();
