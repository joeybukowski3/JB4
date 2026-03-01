const world = document.getElementById("world");
const collectFeedback = document.getElementById("collect-feedback");
const inventorySlots = Array.from(document.querySelectorAll(".inventory-bar .slot"));
const craftButtons = Array.from(document.querySelectorAll(".craft-grid button"));
const craftMenu = document.getElementById("craft-menu");
const craftTableBtn = document.getElementById("craft-table-btn");

const WORLD_COLS = 14;
const WORLD_ROWS = 8;
const keyState = {};
const inventory = new Map();
const itemOrder = [];
const placeableItems = new Set(["GRASS", "DIRT", "CRAFTING_TABLE"]);
let selectedItem = null;

let audioContext;
let lastTimestamp = performance.now();
let playerX = 120;
let playerY = 60;
let velocityY = 0;
let onGround = false;

const playerWidth = 22;
const playerHeight = 22;
const horizontalSpeed = 150;
const gravity = 740;
const jumpVelocity = -320;
const maxFallSpeed = 500;

const worldData = [];
const cellElements = [];
let isMining = false;

const player = document.createElement("div");
player.className = "player";
const playerHand = document.createElement("div");
playerHand.className = "player-hand";
player.appendChild(playerHand);
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
        oscillator.frequency.setValueAtTime(680, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.1);
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
        // Audio can fail before user interaction; gameplay should continue.
    }
}

function playCrackSound() {
    try {
        audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(220, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(120, audioContext.currentTime + 0.12);
        gainNode.gain.setValueAtTime(0.07, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.14);
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.14);
    } catch (error) {
        // Audio can fail before user interaction; gameplay should continue.
    }
}

function getCellSize() {
    const rect = world.getBoundingClientRect();
    return {
        width: rect.width / WORLD_COLS,
        height: rect.height / WORLD_ROWS,
    };
}

function getCellType(row, col) {
    if (row < 0 || row >= WORLD_ROWS || col < 0 || col >= WORLD_COLS) {
        return null;
    }
    return worldData[row][col];
}

function setCellType(row, col, type) {
    if (row < 0 || row >= WORLD_ROWS || col < 0 || col >= WORLD_COLS) {
        return;
    }
    worldData[row][col] = type;
    const cell = cellElements[row][col];
    cell.classList.remove("block-grass", "block-dirt", "block-crafting_table");
    if (!type) {
        return;
    }
    cell.classList.add(`block-${type.toLowerCase()}`);
}

function createWorldGrid() {
    for (let row = 0; row < WORLD_ROWS; row += 1) {
        worldData[row] = [];
        cellElements[row] = [];
        for (let col = 0; col < WORLD_COLS; col += 1) {
            const cell = document.createElement("div");
            cell.className = "cell";
            cell.dataset.row = String(row);
            cell.dataset.col = String(col);
            world.appendChild(cell);
            cellElements[row][col] = cell;

            if (row === 5) {
                setCellType(row, col, "GRASS");
            } else if (row > 5) {
                setCellType(row, col, "DIRT");
            } else {
                setCellType(row, col, null);
            }
        }
    }
}

function itemDisplayName(itemName) {
    if (itemName === "CRAFTING_TABLE") {
        return "TABLE";
    }
    return itemName;
}

function renderInventory() {
    inventorySlots.forEach((slot) => {
        slot.textContent = "";
        slot.title = "";
        slot.classList.remove("selected");
        delete slot.dataset.item;
    });

    const entries = itemOrder
        .map((item) => [item, inventory.get(item) || 0])
        .filter((entry) => entry[1] > 0)
        .slice(0, inventorySlots.length);

    entries.forEach(([item, count], index) => {
        const slot = inventorySlots[index];
        slot.dataset.item = item;
        slot.textContent = `${itemDisplayName(item).slice(0, 4)} ${count}`;
        slot.title = `${item} x${count}`;
        if (selectedItem === item) {
            slot.classList.add("selected");
        }
    });

    if (selectedItem && (inventory.get(selectedItem) || 0) <= 0) {
        selectedItem = null;
    }
    renderHeldItem();
}

function renderHeldItem() {
    playerHand.classList.remove("item-grass", "item-dirt", "item-crafting_table");
    if (!selectedItem) {
        playerHand.style.opacity = "0.35";
        return;
    }
    playerHand.style.opacity = "1";
    playerHand.classList.add(`item-${selectedItem.toLowerCase()}`);
}

function ensureSelectedPlaceable() {
    if (selectedItem && placeableItems.has(selectedItem) && (inventory.get(selectedItem) || 0) > 0) {
        renderInventory();
        return;
    }
    selectedItem = null;
    const nextPlaceable = itemOrder.find((item) => placeableItems.has(item) && (inventory.get(item) || 0) > 0);
    if (nextPlaceable) {
        selectedItem = nextPlaceable;
    }
    renderInventory();
}

function addItem(itemName, amount) {
    const nextValue = (inventory.get(itemName) || 0) + amount;
    inventory.set(itemName, nextValue);
    if (!itemOrder.includes(itemName)) {
        itemOrder.push(itemName);
    }
    if (!selectedItem && placeableItems.has(itemName)) {
        selectedItem = itemName;
    }
    ensureSelectedPlaceable();
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
    ensureSelectedPlaceable();
    return true;
}

function setSelectedItemFromSlot(slotIndex) {
    const slot = inventorySlots[slotIndex];
    if (!slot || !slot.dataset.item) {
        return;
    }
    const item = slot.dataset.item;
    if (!placeableItems.has(item)) {
        showFeedback(`${item} cannot be placed as a block.`);
        return;
    }
    selectedItem = item;
    renderInventory();
    showFeedback(`Selected ${item} for placing.`);
}

function clampPlayerToWorld() {
    const rect = world.getBoundingClientRect();
    const maxX = rect.width - playerWidth;
    const maxY = rect.height - playerHeight;
    playerX = Math.max(0, Math.min(playerX, maxX));
    playerY = Math.max(0, Math.min(playerY, maxY));
}

function collidesWithBlocks(x, y) {
    const cellSize = getCellSize();
    const left = Math.floor(x / cellSize.width);
    const right = Math.floor((x + playerWidth - 1) / cellSize.width);
    const top = Math.floor(y / cellSize.height);
    const bottom = Math.floor((y + playerHeight - 1) / cellSize.height);

    for (let row = top; row <= bottom; row += 1) {
        for (let col = left; col <= right; col += 1) {
            if (col < 0 || col >= WORLD_COLS || row >= WORLD_ROWS) {
                return true;
            }
            if (row >= 0 && getCellType(row, col)) {
                return true;
            }
        }
    }
    return false;
}

function moveHorizontally(dx) {
    if (dx === 0) {
        return;
    }

    const step = Math.sign(dx);
    let remaining = Math.abs(dx);

    while (remaining > 0) {
        const delta = Math.min(1, remaining) * step;
        const candidateX = playerX + delta;
        if (collidesWithBlocks(candidateX, playerY)) {
            return;
        }
        playerX = candidateX;
        remaining -= Math.abs(delta);
    }
}

function moveVertically(dy) {
    if (dy === 0) {
        return;
    }

    const step = Math.sign(dy);
    let remaining = Math.abs(dy);
    onGround = false;

    while (remaining > 0) {
        const delta = Math.min(1, remaining) * step;
        const candidateY = playerY + delta;
        if (collidesWithBlocks(playerX, candidateY)) {
            if (step > 0) {
                onGround = true;
            }
            velocityY = 0;
            return;
        }
        playerY = candidateY;
        remaining -= Math.abs(delta);
    }
}

function updatePlayerTransform() {
    clampPlayerToWorld();
    player.style.left = `${playerX}px`;
    player.style.top = `${playerY}px`;
}

function isCraftMenuOpen() {
    return !craftMenu.classList.contains("hidden");
}

function toggleCraftMenu() {
    craftMenu.classList.toggle("hidden");
    showFeedback(isCraftMenuOpen() ? "Crafting menu opened." : "Crafting menu closed.");
}

function handleCraftTable() {
    if ((inventory.get("PLANKS") || 0) < 4) {
        showFeedback("Need 4 PLANKS to craft CRAFTING_TABLE.");
        return;
    }
    removeItem("PLANKS", 4);
    addItem("CRAFTING_TABLE", 1);
    playPopSound();
    showFeedback("Pop! Crafted CRAFTING_TABLE.");
}

function runCraftAction(action) {
    if (action === "collect-wood") {
        addItem("WOOD", 1);
        playPopSound();
        showFeedback("Pop! Collected WOOD.");
        return;
    }

    if (action === "collect-stone") {
        addItem("STONE", 1);
        playPopSound();
        showFeedback("Pop! Collected STONE.");
        return;
    }

    if (action === "craft-planks") {
        if ((inventory.get("WOOD") || 0) < 4) {
            showFeedback("Need 4 WOOD to craft PLANKS.");
            return;
        }
        removeItem("WOOD", 4);
        addItem("PLANKS", 1);
        playPopSound();
        showFeedback("Pop! Crafted PLANKS.");
    }
}

function worldCellFromClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return null;
    }
    if (!target.classList.contains("cell")) {
        return null;
    }
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    if (Number.isNaN(row) || Number.isNaN(col)) {
        return null;
    }
    return { row, col };
}

function handleWorldClick(event) {
    if (isMining) {
        return;
    }

    const cellPos = worldCellFromClick(event);
    if (!cellPos) {
        return;
    }

    const currentType = getCellType(cellPos.row, cellPos.col);
    if (currentType) {
        const cell = cellElements[cellPos.row][cellPos.col];
        isMining = true;
        cell.classList.add("mining");
        playCrackSound();
        showFeedback(`Crack... mining ${currentType}.`);
        window.setTimeout(() => {
            cell.classList.remove("mining");
            setCellType(cellPos.row, cellPos.col, null);
            addItem(currentType, 1);
            playPopSound();
            showFeedback(`Pop! Broke ${currentType}.`);
            isMining = false;
        }, 220);
        return;
    }

    if (!selectedItem) {
        showFeedback("Select a placeable block in inventory first.");
        return;
    }

    if ((inventory.get(selectedItem) || 0) <= 0) {
        showFeedback(`No ${selectedItem} left to place.`);
        return;
    }

    const cellSize = getCellSize();
    const cellLeft = cellPos.col * cellSize.width;
    const cellTop = cellPos.row * cellSize.height;
    const cellRight = cellLeft + cellSize.width;
    const cellBottom = cellTop + cellSize.height;
    const overlap = !(
        playerX + playerWidth <= cellLeft ||
        playerX >= cellRight ||
        playerY + playerHeight <= cellTop ||
        playerY >= cellBottom
    );

    if (overlap) {
        showFeedback("Cannot place a block inside your character.");
        return;
    }

    setCellType(cellPos.row, cellPos.col, selectedItem);
    removeItem(selectedItem, 1);
    playPopSound();
    showFeedback(`Pop! Placed ${selectedItem}.`);
}

function setupInputs() {
    window.addEventListener("keydown", (event) => {
        if (event.code === "KeyE") {
            toggleCraftMenu();
            event.preventDefault();
            return;
        }

        if (["Space", "KeyA", "KeyD"].includes(event.code)) {
            keyState[event.code] = true;
            event.preventDefault();
        }
    });

    window.addEventListener("keyup", (event) => {
        if (["Space", "KeyA", "KeyD"].includes(event.code)) {
            keyState[event.code] = false;
        }
    });

    window.addEventListener("blur", () => {
        Object.keys(keyState).forEach((key) => {
            keyState[key] = false;
        });
    });

    window.addEventListener("resize", () => {
        clampPlayerToWorld();
        updatePlayerTransform();
    });

    inventorySlots.forEach((slot, index) => {
        slot.addEventListener("click", () => {
            setSelectedItemFromSlot(index);
        });
    });
}

function update(delta) {
    if (!isCraftMenuOpen()) {
        let moveX = 0;
        if (keyState.KeyA) {
            moveX -= 1;
        }
        if (keyState.KeyD) {
            moveX += 1;
        }

        if (keyState.Space && onGround) {
            velocityY = jumpVelocity;
            onGround = false;
        }

        moveHorizontally(moveX * horizontalSpeed * delta);
    }

    velocityY = Math.min(maxFallSpeed, velocityY + gravity * delta);
    moveVertically(velocityY * delta);
    updatePlayerTransform();
}

function gameLoop(timestamp) {
    const delta = Math.min(0.05, (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;
    update(delta);
    requestAnimationFrame(gameLoop);
}

function init() {
    createWorldGrid();
    updatePlayerTransform();
    setupInputs();
    ensureSelectedPlaceable();
    showFeedback("Press E for crafting. Break and place blocks to build.");

    world.addEventListener("click", handleWorldClick);
    craftButtons.forEach((button) => {
        button.addEventListener("click", () => {
            runCraftAction(button.dataset.action || "");
        });
    });
    craftTableBtn.addEventListener("click", handleCraftTable);

    requestAnimationFrame((timestamp) => {
        lastTimestamp = timestamp;
        gameLoop(timestamp);
    });
}

init();
