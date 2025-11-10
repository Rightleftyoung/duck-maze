const canvas = document.getElementById('maze');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const regenBtn = document.getElementById('regen');
const sizeSelect = document.getElementById('size');
const touchButtons = document.querySelectorAll('.touch-controls button');
const appEl = document.querySelector('.app');

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
let player = { row: 0, col: 0 };
let goal = { row: mazeSize - 1, col: mazeSize - 1 };
let cat = { row: mazeSize - 1, col: 0 };
let gameWon = false;
let gameLost = false;
let catMoveTimeoutId = null;
let catMovesTaken = 0;
let suppressNextRegenClick = false;
const CAT_BASE_DELAY = 620;
const CAT_MIN_DELAY = 230;

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

function carvePathCells(path) {
  for (let i = 0; i < path.length - 1; i += 1) {
    const current = path[i];
    const next = path[i + 1];
    const dr = next.row - current.row;
    const dc = next.col - current.col;

    let direction = null;
    if (dr === -1) direction = 'top';
    else if (dr === 1) direction = 'bottom';
    else if (dc === -1) direction = 'left';
    else if (dc === 1) direction = 'right';

    if (direction) {
      removeWalls(current, next, direction);
    }
  }
}

function ensureSecondRouteToExit(grid) {
  const size = grid.length;
  if (size < 2) return;

  const topThenDown = [];
  for (let col = 0; col < size; col += 1) {
    topThenDown.push(grid[0][col]);
  }
  for (let row = 1; row < size; row += 1) {
    topThenDown.push(grid[row][size - 1]);
  }

  const leftThenRight = [];
  for (let row = 0; row < size; row += 1) {
    leftThenRight.push(grid[row][0]);
  }
  for (let col = 1; col < size; col += 1) {
    leftThenRight.push(grid[size - 1][col]);
  }

  [topThenDown, leftThenRight].forEach(path => carvePathCells(path));
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

function drawMaze() {
  const size = maze.length;
  const cellSize = canvas.width / size;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#1f1b0d';
  ctx.lineWidth = 2;
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
}

function drawDuck(cellSize) {
  const x = player.col * cellSize + cellSize / 2;
  const y = player.row * cellSize + cellSize / 2;
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

function moveCatTowardPlayer() {
  if (!maze.length || gameWon || gameLost) return;
  const next = nextStepTowards(cat, player);
  if (!next || (next.row === cat.row && next.col === cat.col)) return;
  cat = next;
  drawMaze();
  checkCatCatch();
}

function getCatDelay() {
  const tension = catAggressionFactor();
  const dynamicDelay = CAT_BASE_DELAY - tension * 300;
  return Math.max(CAT_MIN_DELAY, dynamicDelay);
}

function catAggressionFactor() {
  const maxDistance = (mazeSize - 1) * 2 || 1;
  const distance = Math.abs(player.row - goal.row) + Math.abs(player.col - goal.col);
  const progressTowardGoal = 1 - distance / maxDistance;
  const timeFactor = Math.min(1, catMovesTaken / (mazeSize * mazeSize || 1));
  return Math.max(progressTowardGoal, timeFactor);
}

function scheduleCatMove() {
  if (!maze.length || gameWon || gameLost) return;
  catMoveTimeoutId = setTimeout(() => {
    moveCatTowardPlayer();
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

function checkCatCatch() {
  if (player.row === cat.row && player.col === cat.col) {
    gameLost = true;
    stopCatChase();
    statusEl.textContent = 'Oh no! The cat caught you. Hit New Maze to try again.';
    return true;
  }
  return false;
}

function resizeCanvas(redraw = true) {
  if (!appEl) return;
  const padding = 48;
  const available = Math.max(220, appEl.clientWidth - padding);
  const size = Math.min(600, available);
  canvas.width = size;
  canvas.height = size;
  if (redraw && maze.length) {
    drawMaze();
  }
}

function handleMove(direction) {
  if (!direction || gameWon || gameLost) return;
  const cell = maze[player.row]?.[player.col];
  if (!cell || cell.walls[direction]) return;

  const { dr, dc } = DIRS[direction];
  player = { row: player.row + dr, col: player.col + dc };
  drawMaze();

  if (player.row === goal.row && player.col === goal.col) {
    gameWon = true;
    statusEl.textContent = 'Quack! You found the pond! You escaped the cat!';
    stopCatChase();
    return;
  }

  if (checkCatCatch()) return;

  statusEl.textContent = 'Keep waddling...';
}

function handleKeydown(event) {
  if (gameWon || gameLost) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (KEY_TO_DIR[key]) {
    event.preventDefault();
    handleMove(KEY_TO_DIR[key]);
  }
}

function startGame() {
  stopCatChase();
  mazeSize = parseInt(sizeSelect.value, 10);
  maze = carvePassages(mazeSize);
  addAlternateRoute(maze);
  ensureStartFork(maze);
  ensureSecondRouteToExit(maze);
  player = { row: 0, col: 0 };
  goal = { row: mazeSize - 1, col: mazeSize - 1 };
  cat = { row: mazeSize - 1, col: 0 };
  gameWon = false;
  gameLost = false;
  statusEl.textContent = 'Find the pond before the cat finds you!';
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
window.addEventListener('keydown', handleKeydown);
window.addEventListener('resize', () => resizeCanvas(true));

touchButtons.forEach(button => {
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    handleMove(button.dataset.dir);
    button.blur();
  });
});

startGame();
