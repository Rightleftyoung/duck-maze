const canvas = document.getElementById('maze');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const regenBtn = document.getElementById('regen');
const sizeSelect = document.getElementById('size');
const speedSelect = document.getElementById('speed');
const intelligenceSelect = document.getElementById('intelligence');
const touchButtons = document.querySelectorAll('.touch-controls button');
const appEl = document.querySelector('.app');
const mazeAreaEl = document.querySelector('.maze-area');
const pointsEl = document.getElementById('points');
const stunBtn = document.getElementById('stun');
const reverseRolesToggle = document.getElementById('reverseRoles');
const speedLabelEl = document.getElementById('speedLabel');
const intelligenceLabelEl = document.getElementById('intelligenceLabel');
const roleHintEl = document.getElementById('roleHint');

const DIRS = {
  top: { dr: -1, dc: 0 },
  right: { dr: 0, dc: 1 },
  bottom: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 }
};

const KEY_TO_DIR = {
  ArrowUp: 'top',
  ArrowDown: 'bottom',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'top',
  s: 'bottom',
  a: 'left',
  d: 'right'
};

let maze = [];
let mazeSize = parseInt(sizeSelect.value, 10);
let duck = { row: 0, col: 0 };
let goal = { row: mazeSize - 1, col: mazeSize - 1 };
let cat = { row: mazeSize - 1, col: 0 };
let playerCharacter = 'duck';
let gameWon = false;
let gameLost = false;
let catMoveTimeoutId = null;
let catMovesTaken = 0;
let catBaseDelay = 520;
let catMinDelay = 160;
let suppressNextRegenClick = false;
let canvasDisplaySize = 600;
let touchStartPoint = null;
let lastPlayerDirection = 'right';
let catIntelligenceProfile;
let points = 0;
let catStunnedUntil = 0;

const SPEED_PRESETS = {
  chill: { base: 860, min: 320 },
  normal: { base: 520, min: 160 },
  furious: { base: 420, min: 110 }
};
const INTELLIGENCE_PROFILES = {
  simple: { predictionDivisor: 10, dashDistanceDivisor: 3, goalFocus: 0.35, dashSteps: 1 },
  smart: { predictionDivisor: 5, dashDistanceDivisor: 4, goalFocus: 0.6, dashSteps: 2 },
  hunter: { predictionDivisor: 3, dashDistanceDivisor: 5, goalFocus: 0.95, dashSteps: 3 }
};
const MAX_CANVAS_SIZE = 900;
const DASH_DISTANCE_THRESHOLD = 3;
const STUN_COST = 500;
const STUN_DURATION_MS = 5000;
const POINTS_STORAGE_KEY = 'duckMazePoints';
const BASE_REWARD_POINTS = 120;
const SPEED_REWARD_MULTIPLIERS = { chill: 0.85, normal: 1, furious: 1.25 };
const INTELLIGENCE_REWARD_MULTIPLIERS = { simple: 0.9, smart: 1.15, hunter: 1.35 };

function updateRoleLabels() {
  const chaserLabel = getAICharacterDisplayName(true);
  if (speedLabelEl) {
    speedLabelEl.textContent = `${chaserLabel} Speed`;
  }
  if (intelligenceLabelEl) {
    intelligenceLabelEl.textContent = `${chaserLabel} Intelligence`;
  }
  if (stunBtn) {
    stunBtn.textContent = `Stun ${chaserLabel} (${STUN_COST} pts)`;
  }
  updateRoleHint();
}

catIntelligenceProfile = INTELLIGENCE_PROFILES.smart;
points = loadStoredPoints();
updatePointsDisplay();
updateRoleLabels();

function updateRoleHint() {
  if (!roleHintEl) return;
  const hint = playerControlsDuck()
    ? 'You are the duck — reach the pond before the cat.'
    : 'You are the cat — hunt the duck before it escapes.';
  roleHintEl.textContent = hint;
}

function getSelectedIntelligenceKey() {
  return intelligenceSelect?.value ?? 'smart';
}

function playerControlsDuck() {
  return playerCharacter === 'duck';
}

function getPlayerPosition() {
  return playerControlsDuck() ? duck : cat;
}

function setPlayerPosition(position) {
  if (playerControlsDuck()) {
    duck = position;
  } else {
    cat = position;
  }
}

function getAIPosition() {
  return playerControlsDuck() ? cat : duck;
}

function setAIPosition(position) {
  if (playerControlsDuck()) {
    cat = position;
  } else {
    duck = position;
  }
}

function capitalize(word) {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function getAICharacterDisplayName(capitalizeName = false) {
  const name = playerControlsDuck() ? 'cat' : 'duck';
  return capitalizeName ? capitalize(name) : name;
}


function loadStoredPoints() {
  try {
    const stored = localStorage.getItem(POINTS_STORAGE_KEY);
    const value = parseInt(stored, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function persistPoints() {
  try {
    localStorage.setItem(POINTS_STORAGE_KEY, String(points));
  } catch {
    // Ignore storage failures; points just won't persist this round.
  }
}

function updatePointsDisplay() {
  if (pointsEl) {
    pointsEl.textContent = points.toString();
  }
  updateStunButtonState();
}

function isCatStunned() {
  return Date.now() < catStunnedUntil;
}

function updateStunButtonState() {
  if (!stunBtn) return;
  const playable = !gameWon && !gameLost;
  const available = !isCatStunned();
  stunBtn.disabled = !(playable && available && points >= STUN_COST);
}

function calculateWinReward() {
  const sizeFactor = Math.max(1, mazeSize / 10);
  const speedFactor = SPEED_REWARD_MULTIPLIERS[speedSelect.value] ?? 1;
  const intelligenceFactor = INTELLIGENCE_REWARD_MULTIPLIERS[getSelectedIntelligenceKey()] ?? 1;
  const reward = Math.round(BASE_REWARD_POINTS * sizeFactor * speedFactor * intelligenceFactor);
  return Math.max(40, reward);
}

function awardWinPoints() {
  const reward = calculateWinReward();
  points += reward;
  persistPoints();
  updatePointsDisplay();
  return reward;
}

function handleStunClick() {
  if (!stunBtn || stunBtn.disabled || points < STUN_COST || gameWon || gameLost) return;
  points -= STUN_COST;
  persistPoints();
  catStunnedUntil = Date.now() + STUN_DURATION_MS;
  const chaserName = getAICharacterDisplayName(true);
  statusEl.textContent = `Zap! The ${chaserName} is stunned — make a run for it!`;
  updatePointsDisplay();
  setTimeout(() => {
    updateStunButtonState();
    if (!gameWon && !gameLost && !isCatStunned()) {
      const refreshedName = getAICharacterDisplayName(true);
      statusEl.textContent = `The ${refreshedName} shook it off! Keep moving!`;
    }
  }, STUN_DURATION_MS);
}

function createGrid(size) {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => ({
      row,
      col,
      walls: { top: true, right: true, bottom: true, left: true },
      visited: false
    }))
  );
}

function carvePassages(size) {
  const grid = createGrid(size);
  const stack = [];
  let current = grid[0][0];
  current.visited = true;
  let visitedCount = 1;

  while (visitedCount < size * size) {
    const neighbors = [];
    const { row, col } = current;

    if (row > 0 && !grid[row - 1][col].visited) neighbors.push({ cell: grid[row - 1][col], direction: 'top' });
    if (col < size - 1 && !grid[row][col + 1].visited) neighbors.push({ cell: grid[row][col + 1], direction: 'right' });
    if (row < size - 1 && !grid[row + 1][col].visited) neighbors.push({ cell: grid[row + 1][col], direction: 'bottom' });
    if (col > 0 && !grid[row][col - 1].visited) neighbors.push({ cell: grid[row][col - 1], direction: 'left' });

    if (neighbors.length) {
      const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
      removeWalls(current, pick.cell, pick.direction);
      stack.push(current);
      current = pick.cell;
      current.visited = true;
      visitedCount += 1;
    } else {
      current = stack.pop();
    }
  }

  return grid.map(row => row.map(cell => ({
    row: cell.row,
    col: cell.col,
    walls: { ...cell.walls }
  })));
}

function addAlternateRoute(grid) {
  if (!grid.length) return;
  const cells = grid.flat().slice();
  cells.sort(() => Math.random() - 0.5);

  for (const cell of cells) {
    const options = [];
    if (cell.row > 0 && cell.walls.top) options.push({ dir: 'top', neighbor: grid[cell.row - 1][cell.col] });
    if (cell.col < grid.length - 1 && cell.walls.right) options.push({ dir: 'right', neighbor: grid[cell.row][cell.col + 1] });
    if (cell.row < grid.length - 1 && cell.walls.bottom) options.push({ dir: 'bottom', neighbor: grid[cell.row + 1][cell.col] });
    if (cell.col > 0 && cell.walls.left) options.push({ dir: 'left', neighbor: grid[cell.row][cell.col - 1] });

    if (!options.length) continue;
    const pick = options[Math.floor(Math.random() * options.length)];
    removeWalls(cell, pick.neighbor, pick.dir);
    return;
  }
}

function ensureStartFork(grid) {
  if (grid.length < 2) return;
  const start = grid[0][0];
  const candidates = [];
  if (grid[0][1]) candidates.push({ dir: 'right', neighbor: grid[0][1] });
  if (grid[1]?.[0]) candidates.push({ dir: 'bottom', neighbor: grid[1][0] });

  const openNeighbors = candidates.filter(option => !start.walls[option.dir]);
  if (openNeighbors.length >= 2 || !candidates.length) return;

  const closed = candidates.filter(option => start.walls[option.dir]);
  if (!closed.length) return;
  const pick = closed[Math.floor(Math.random() * closed.length)];
  removeWalls(start, pick.neighbor, pick.dir);
}

function removeWalls(current, next, direction) {
  if (direction === 'top') {
    current.walls.top = false;
    next.walls.bottom = false;
  }
  if (direction === 'right') {
    current.walls.right = false;
    next.walls.left = false;
  }
  if (direction === 'bottom') {
    current.walls.bottom = false;
    next.walls.top = false;
  }
  if (direction === 'left') {
    current.walls.left = false;
    next.walls.right = false;
  }
}

function posKey(pos) {
  return `${pos.row},${pos.col}`;
}

function getNeighbors(pos) {
  const neighbors = [];
  const cell = maze[pos.row]?.[pos.col];
  if (!cell) return neighbors;

  Object.entries(DIRS).forEach(([dir, delta]) => {
    if (!cell.walls[dir]) {
      neighbors.push({ row: pos.row + delta.dr, col: pos.col + delta.dc });
    }
  });

  return neighbors;
}

function nextStepTowards(start, target) {
  if (start.row === target.row && start.col === target.col) {
    return start;
  }

  const queue = [start];
  const visited = new Set([posKey(start)]);
  const parent = new Map();
  let foundKey = null;

  while (queue.length) {
    const current = queue.shift();
    const currentKey = posKey(current);
    if (current.row === target.row && current.col === target.col) {
      foundKey = currentKey;
      break;
    }

    const neighbors = getNeighbors(current);
    neighbors.forEach(neighbor => {
      const key = posKey(neighbor);
      if (visited.has(key)) return;
      visited.add(key);
      parent.set(key, currentKey);
      queue.push(neighbor);
    });
  }

  if (!foundKey) return start;
  const path = [];
  let currentKey = foundKey;
  while (currentKey !== posKey(start)) {
    path.unshift(currentKey);
    currentKey = parent.get(currentKey);
    if (!currentKey) return start;
  }

  const [row, col] = path[0].split(',').map(Number);
  return { row, col };
}

function manhattan(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function stepFrom(position, direction) {
  const cell = maze[position.row]?.[position.col];
  if (!cell || cell.walls[direction]) return null;
  const { dr, dc } = DIRS[direction];
  const nextRow = position.row + dr;
  const nextCol = position.col + dc;
  if (!maze[nextRow]?.[nextCol]) return null;
  return { row: nextRow, col: nextCol };
}

function greedyStepToward(start, target) {
  const neighbors = getNeighbors(start);
  if (!neighbors.length) return null;
  neighbors.sort((a, b) => manhattan(a, target) - manhattan(b, target));
  return neighbors[0];
}

function predictPlayerPosition() {
  if (!playerControlsDuck()) {
    return getPlayerPosition();
  }
  const divisor = catIntelligenceProfile?.predictionDivisor ?? 6;
  const predictionSteps = divisor >= 999 ? 0 : Math.max(1, Math.floor(mazeSize / divisor));
  const playerPos = getPlayerPosition();
  let simulated = { ...playerPos };
  for (let i = 0; i < predictionSteps; i += 1) {
    const next = stepFrom(simulated, lastPlayerDirection);
    if (!next) break;
    simulated = next;
  }
  if (simulated.row === playerPos.row && simulated.col === playerPos.col) {
    const greedy = greedyStepToward(simulated, goal);
    if (greedy) {
      simulated = greedy;
    }
  }
  return simulated;
}

function getChaserTarget() {
  if (!playerControlsDuck()) {
    return goal;
  }
  const predicted = predictPlayerPosition();
  const playerPos = getPlayerPosition();
  const playerDistanceToGoal = manhattan(playerPos, goal);
  const ai = getAIPosition();
  const chaserDistanceToGoal = manhattan(ai, goal);
  const focus = catIntelligenceProfile?.goalFocus ?? 0.5;
  if (focus > 0 && playerDistanceToGoal < chaserDistanceToGoal * focus) {
    return goal;
  }
  return predicted;
}

function shouldCatDash() {
  if (!playerControlsDuck()) return false;
  const ai = getAIPosition();
  const playerPos = getPlayerPosition();
  const distance = manhattan(ai, playerPos);
  const divisor = catIntelligenceProfile?.dashDistanceDivisor ?? 5;
  return distance <= Math.max(DASH_DISTANCE_THRESHOLD, Math.floor(mazeSize / divisor));
}

function drawMaze() {
  const size = maze.length;
  const cellSize = canvasDisplaySize / size;
  ctx.clearRect(0, 0, canvasDisplaySize, canvasDisplaySize);

  ctx.strokeStyle = '#1f1b0d';
  ctx.lineWidth = Math.max(1.5, canvasDisplaySize / (size * 18));
  ctx.lineCap = 'round';

  maze.forEach(row => {
    row.forEach(cell => {
      const x = cell.col * cellSize;
      const y = cell.row * cellSize;
      ctx.beginPath();
      if (cell.walls.top) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + cellSize, y);
      }
      if (cell.walls.right) {
        ctx.moveTo(x + cellSize, y);
        ctx.lineTo(x + cellSize, y + cellSize);
      }
      if (cell.walls.bottom) {
        ctx.moveTo(x + cellSize, y + cellSize);
        ctx.lineTo(x, y + cellSize);
      }
      if (cell.walls.left) {
        ctx.moveTo(x, y + cellSize);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  });
  
  drawGoal(cellSize);
  drawCat(cellSize);
  drawDuck(cellSize);
  drawPlayerIndicator(cellSize);
}

function drawDuck(cellSize) {
  const x = duck.col * cellSize + cellSize / 2;
  const y = duck.row * cellSize + cellSize / 2;
  const radius = cellSize * 0.3;

  ctx.fillStyle = '#ffe066';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f25f2c';
  ctx.beginPath();
  ctx.moveTo(x + radius * 0.4, y - radius * 0.2);
  ctx.lineTo(x + radius * 0.9, y);
  ctx.lineTo(x + radius * 0.4, y + radius * 0.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#1f1b0d';
  ctx.beginPath();
  ctx.arc(x - radius * 0.2, y - radius * 0.3, radius * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function drawGoal(cellSize) {
  const x = goal.col * cellSize + cellSize / 2;
  const y = goal.row * cellSize + cellSize / 2;
  const radius = cellSize * 0.35;

  const gradient = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius);
  gradient.addColorStop(0, '#c1f1ff');
  gradient.addColorStop(1, '#1e90ff');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawCat(cellSize) {
  const x = cat.col * cellSize + cellSize / 2;
  const y = cat.row * cellSize + cellSize / 2;
  const radius = cellSize * 0.28;

  ctx.fillStyle = '#6d5d6e';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // ears
  ctx.fillStyle = '#4c3b4d';
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.6, y - radius * 0.1);
  ctx.lineTo(x - radius * 0.3, y - radius * 0.7);
  ctx.lineTo(x - radius * 0.1, y - radius * 0.05);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + radius * 0.6, y - radius * 0.1);
  ctx.lineTo(x + radius * 0.3, y - radius * 0.7);
  ctx.lineTo(x + radius * 0.1, y - radius * 0.05);
  ctx.closePath();
  ctx.fill();

  // eyes
  ctx.fillStyle = '#fefefe';
  ctx.beginPath();
  ctx.arc(x - radius * 0.25, y - radius * 0.1, radius * 0.15, 0, Math.PI * 2);
  ctx.arc(x + radius * 0.25, y - radius * 0.1, radius * 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1f1b0d';
  ctx.beginPath();
  ctx.arc(x - radius * 0.25, y - radius * 0.1, radius * 0.07, 0, Math.PI * 2);
  ctx.arc(x + radius * 0.25, y - radius * 0.1, radius * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // nose
  ctx.fillStyle = '#f25f2c';
  ctx.beginPath();
  ctx.arc(x, y + radius * 0.1, radius * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayerIndicator(cellSize) {
  const playerPos = getPlayerPosition();
  const x = playerPos.col * cellSize + cellSize / 2;
  const y = playerPos.row * cellSize + cellSize / 2;
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = Math.max(2, cellSize * 0.05);
  ctx.beginPath();
  ctx.arc(x, y, cellSize * 0.42, 0, Math.PI * 2);
  ctx.stroke();
}

function moveAICharacter() {
  if (!maze.length || gameWon || gameLost) return;
  if (playerControlsDuck()) {
    moveCatHunter();
  } else {
    moveDuckEscapee();
  }
}

function moveCatHunter() {
  const profileDashSteps = catIntelligenceProfile?.dashSteps ?? 2;
  const stepsToTake = shouldCatDash() ? profileDashSteps : 1;
  let moved = false;

  for (let i = 0; i < stepsToTake; i += 1) {
    const ai = getAIPosition();
    const target = getChaserTarget();
    const next = nextStepTowards(ai, target);
    if (!next || (next.row === ai.row && next.col === ai.col)) break;
    setAIPosition(next);
    moved = true;
    if (checkCatchStatesAfterAIMove()) {
      drawMaze();
      return;
    }
  }

  if (moved) {
    drawMaze();
    checkCatchStatesAfterAIMove();
  }
}

function moveDuckEscapee() {
  const duckPos = getAIPosition();
  const next = nextStepTowards(duckPos, goal);
  if (!next || (next.row === duckPos.row && next.col === duckPos.col)) return;
  setAIPosition(next);
  drawMaze();
  checkCatchStatesAfterAIMove();
}

function getCatDelay() {
  const tension = catAggressionFactor();
  const dynamicDelay = catBaseDelay - tension * 320;
  return Math.max(catMinDelay, dynamicDelay);
}

function catAggressionFactor() {
  const maxDistance = (mazeSize - 1) * 2 || 1;
  const referencePos = playerControlsDuck() ? getPlayerPosition() : getAIPosition();
  const distance = Math.abs(referencePos.row - goal.row) + Math.abs(referencePos.col - goal.col);
  const progressTowardGoal = 1 - distance / maxDistance;
  const timeFactor = Math.min(1, catMovesTaken / (mazeSize * mazeSize || 1));
  return Math.max(progressTowardGoal, timeFactor);
}

function scheduleCatMove() {
  if (!maze.length || gameWon || gameLost) return;
  catMoveTimeoutId = setTimeout(() => {
    if (!maze.length || gameWon || gameLost) return;
    if (isCatStunned()) {
      updateStunButtonState();
      scheduleCatMove();
      return;
    }
    moveAICharacter();
    catMovesTaken += 1;
    scheduleCatMove();
  }, getCatDelay());
}

function startCatChase() {
  stopCatChase();
  catMovesTaken = 0;
  scheduleCatMove();
}

function stopCatChase() {
  if (catMoveTimeoutId) {
    clearTimeout(catMoveTimeoutId);
    catMoveTimeoutId = null;
  }
}

function checkPlayerCaughtByAI() {
  if (!playerControlsDuck()) return false;
  const playerPos = getPlayerPosition();
  const aiPos = getAIPosition();
  if (playerPos.row === aiPos.row && playerPos.col === aiPos.col) {
    gameLost = true;
    stopCatChase();
    const aiName = getAICharacterDisplayName(true);
    statusEl.textContent = `Oh no! The ${aiName} caught you. Hit New Maze to try again.`;
    updateStunButtonState();
    return true;
  }
  return false;
}

function checkPlayerCatchesAI() {
  if (playerControlsDuck()) return false;
  const playerPos = getPlayerPosition();
  const aiPos = getAIPosition();
  if (playerPos.row === aiPos.row && playerPos.col === aiPos.col) {
    gameWon = true;
    stopCatChase();
    const reward = awardWinPoints();
    statusEl.textContent = `Nice! You caught the duck and earned ${reward} pts!`;
    updateStunButtonState();
    return true;
  }
  return false;
}

function checkDuckEscaped() {
  if (playerControlsDuck()) return false;
  const aiPos = getAIPosition();
  if (aiPos.row === goal.row && aiPos.col === goal.col) {
    gameLost = true;
    stopCatChase();
    statusEl.textContent = 'The duck escaped to the pond! Try again.';
    updateStunButtonState();
    return true;
  }
  return false;
}

function checkCatchStatesAfterAIMove() {
  if (playerControlsDuck()) {
    return checkPlayerCaughtByAI();
  }
  if (checkDuckEscaped()) return true;
  return checkPlayerCatchesAI();
}

function resizeCanvas(redraw = true) {
  if (!appEl) return;
  const padding = 48;
  const availableWidth = Math.max(260, appEl.clientWidth - padding);
  const availableHeight = Math.max(
    260,
    (mazeAreaEl?.clientHeight || window.innerHeight) - 160
  );
  const size = Math.min(MAX_CANVAS_SIZE, availableWidth, availableHeight);
  const dpr = window.devicePixelRatio || 1;
  canvasDisplaySize = size;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (redraw && maze.length) {
    drawMaze();
  }
}

function handleMove(direction) {
  if (!direction || gameWon || gameLost) return;
  const playerPos = getPlayerPosition();
  const cell = maze[playerPos.row]?.[playerPos.col];
  if (!cell || cell.walls[direction]) return;

  const { dr, dc } = DIRS[direction];
  const nextRow = playerPos.row + dr;
  const nextCol = playerPos.col + dc;
  setPlayerPosition({ row: nextRow, col: nextCol });
  lastPlayerDirection = direction;
  drawMaze();

  const updatedPlayer = getPlayerPosition();
  if (playerControlsDuck() && updatedPlayer.row === goal.row && updatedPlayer.col === goal.col) {
    gameWon = true;
    stopCatChase();
    const reward = awardWinPoints();
    statusEl.textContent = `Nice! You reached the pond and earned ${reward} pts!`;
    updateStunButtonState();
    return;
  }

  if (!playerControlsDuck() && checkPlayerCatchesAI()) return;

  if (checkPlayerCaughtByAI()) return;

  statusEl.textContent = playerControlsDuck() ? 'Keep moving...' : 'Keep chasing...';
  updateStunButtonState();
}

function handleKeydown(event) {
  if (gameWon || gameLost) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (KEY_TO_DIR[key]) {
    event.preventDefault();
    handleMove(KEY_TO_DIR[key]);
  }
}

function handleCanvasTouchStart(event) {
  if (!event.touches.length) return;
  const touch = event.touches[0];
  touchStartPoint = { x: touch.clientX, y: touch.clientY };
  event.preventDefault();
}

function handleCanvasTouchEnd(event) {
  if (!touchStartPoint || !event.changedTouches.length) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStartPoint.x;
  const dy = touch.clientY - touchStartPoint.y;
  const threshold = 24;
  touchStartPoint = null;
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
  const direction = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'right' : 'left')
    : (dy > 0 ? 'bottom' : 'top');
  handleMove(direction);
  event.preventDefault();
}

function startGame() {
  stopCatChase();
  catStunnedUntil = 0;
  mazeSize = parseInt(sizeSelect.value, 10);
  const speedPreset = SPEED_PRESETS[speedSelect.value] || SPEED_PRESETS.normal;
  catBaseDelay = speedPreset.base;
  catMinDelay = speedPreset.min;
  const intelligenceKey = getSelectedIntelligenceKey();
  catIntelligenceProfile = INTELLIGENCE_PROFILES[intelligenceKey] || INTELLIGENCE_PROFILES.smart;
  const reverseRolesSelected = Boolean(reverseRolesToggle?.checked);
  playerCharacter = reverseRolesSelected ? 'cat' : 'duck';
  maze = carvePassages(mazeSize);
  addAlternateRoute(maze);
  addAlternateRoute(maze);
  ensureStartFork(maze);
  duck = { row: 0, col: 0 };
  goal = { row: mazeSize - 1, col: mazeSize - 1 };
  cat = { row: mazeSize - 1, col: 0 };
  lastPlayerDirection = 'right';
  gameWon = false;
  gameLost = false;
  updateRoleLabels();
  const statusMessage = playerControlsDuck()
    ? `Find the pond before the ${getAICharacterDisplayName()} finds you!`
    : 'Chase down the duck before it reaches the pond!';
  statusEl.textContent = statusMessage;
  updateStunButtonState();
  resizeCanvas(false);
  drawMaze();
  startCatChase();
}

regenBtn.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' || event.pointerType === 'pen') {
    event.preventDefault();
    suppressNextRegenClick = true;
    startGame();
  }
});

regenBtn.addEventListener('click', event => {
  event.preventDefault();
  if (suppressNextRegenClick) {
    suppressNextRegenClick = false;
    return;
  }
  startGame();
});
sizeSelect.addEventListener('change', startGame);
speedSelect.addEventListener('change', startGame);
if (intelligenceSelect) {
  intelligenceSelect.addEventListener('change', startGame);
}
if (reverseRolesToggle) {
  reverseRolesToggle.addEventListener('change', startGame);
}
if (stunBtn) {
  stunBtn.addEventListener('click', event => {
    event.preventDefault();
    handleStunClick();
  });
}
window.addEventListener('keydown', handleKeydown);
window.addEventListener('resize', () => resizeCanvas(true));
canvas.addEventListener('touchstart', handleCanvasTouchStart, { passive: false });
canvas.addEventListener('touchend', handleCanvasTouchEnd, { passive: false });

touchButtons.forEach(button => {
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    handleMove(button.dataset.dir);
    button.blur();
  });
});

startGame();
