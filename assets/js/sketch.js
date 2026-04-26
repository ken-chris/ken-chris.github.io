// Debug flag for visualizing transitions
const DEBUG_TRANSITIONS = false;

// In-memory session cache — avoids recomputing configs already loaded this session
const sessionEpicycleCache = {};

// Cache management functions
function getCacheKey(filename, resolution, scale, axisMode, maxFreq, maxCircleSize, circles) {
    // Generate cache key from parameters
    const params = `${filename}_r${resolution}_s${scale}_${axisMode}_f${maxFreq}_c${maxCircleSize}_n${circles}`;
    return params.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function saveCacheData(cacheKey, data) {
    // Save into session cache for instant reuse within the same page load
    sessionEpicycleCache[cacheKey] = data;

    // Save cache data as downloadable JSON
    const json = JSON.stringify(data, null, 2);
    console.log('=== CACHE DATA READY ===');
    console.log('Save this to: assets/epicycle-cache/' + cacheKey + '.json');
    console.log('To download, run: downloadCache()');

    // Store in window for download
    window.cacheData = { key: cacheKey, json: json };
}

function downloadCache() {
    if (!window.cacheData) {
        console.error('No cache data available. Run the animation first.');
        return;
    }

    const blob = new Blob([window.cacheData.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = window.cacheData.key + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('Cache file downloaded!');
}

async function loadCacheData(cacheKey) {
    // Check in-memory session cache first (populated after any computation this session)
    if (sessionEpicycleCache[cacheKey]) {
        console.log('✓ Loaded cached epicycles from session cache:', cacheKey);
        return sessionEpicycleCache[cacheKey];
    }
    try {
        const response = await fetch(`/assets/epicycle-cache/${cacheKey}.json`);
        if (!response.ok) return null;
        const data = await response.json();
        // Populate session cache so future switches to this config are instant
        sessionEpicycleCache[cacheKey] = data;
        console.log('✓ Loaded cached epicycles from:', cacheKey + '.json');
        return data;
    } catch (error) {
        console.log('No cache found for:', cacheKey);
        return null;
    }
}

// Parse SVG path d attribute into points using native browser API
function parseSVGPath(svgString, targetSamples = 1500) {
    console.log('parseSVGPath: Starting with target samples:', targetSamples);
    const points = [];

    // Create a temporary SVG path element
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', svgString);

    // Get total length
    const totalLength = path.getTotalLength();
    console.log('parseSVGPath: Total path length:', totalLength.toFixed(2));

    if (totalLength === 0) {
        console.warn('Path has zero length');
        return points;
    }

    // Parse SVG path string to identify transition ranges (between Z and M commands)
    console.time('Parse transition ranges');
    // Split into commands while preserving the command letter
    const commands = svgString.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) || [];
    console.log('parseSVGPath: Found', commands.length, 'commands in path');

    const transitionRanges = [];
    let cumulativePath = '';
    let transitionStartLength = null;
    let inTransition = false;
    let prevLength = 0;

    for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i].trim();
        const cmdLetter = cmd[0].toUpperCase();

        // Build cumulative path
        cumulativePath += ' ' + cmd;

        // Measure length at this command
        const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tempPath.setAttribute('d', cumulativePath.trim());
        const lengthHere = tempPath.getTotalLength();

        if (cmdLetter === 'Z') {
            // Start transition at end of previous drawing command (before Z)
            transitionStartLength = prevLength;
            inTransition = true;
        } else if (cmdLetter === 'M' && inTransition && i > 0) {
            // M command - continue transition
        } else if (inTransition && transitionStartLength !== null && cmdLetter !== 'Z' && cmdLetter !== 'M') {
            // First drawing command after M - end transition at beginning of this command
            transitionRanges.push({
                start: transitionStartLength,
                end: prevLength
            });
            transitionStartLength = null;
            inTransition = false;
        }

        prevLength = lengthHere;
    }
    console.timeEnd('Parse transition ranges');

    // Extend zero-width or very small transitions to ensure we capture sample points
    const numSamples = Math.max(100, Math.min(5000, targetSamples));
    const step = totalLength / numSamples;
    const minTransitionWidth = step * 2; // Ensure at least 2 sample points

    transitionRanges.forEach(range => {
        const width = range.end - range.start;
        if (width < minTransitionWidth) {
            // Extend the range symmetrically
            const extension = (minTransitionWidth - width) / 2;
            range.start = Math.max(0, range.start - extension);
            range.end = Math.min(totalLength, range.end + extension);
        }
    });

    console.log('Found', transitionRanges.length, 'transition ranges (Z to M)');
    console.log('Will sample', numSamples, 'points with step size:', step.toFixed(2));

    // Sample points along the path
    console.time('Sample points along path');

    let pointsWithLowOpacity = 0;
    for (let i = 0; i <= totalLength; i += step) {
        const point = path.getPointAtLength(i);

        // Check if this position falls within a transition range
        let opacity = 1.0;
        for (const range of transitionRanges) {
            if (i >= range.start && i <= range.end) {
                opacity = 0.05;
                pointsWithLowOpacity++;
                break;
            }
        }

        points.push({ x: point.x, y: point.y, opacity });
    }
    console.timeEnd('Sample points along path');

    console.log('Points with low opacity:', pointsWithLowOpacity);

    // Ensure we get the last point
    if (points.length > 0) {
        const lastPoint = path.getPointAtLength(totalLength);
        const prevPoint = points[points.length - 1];
        if (Math.abs(lastPoint.x - prevPoint.x) > 0.01 || Math.abs(lastPoint.y - prevPoint.y) > 0.01) {
            points.push({ x: lastPoint.x, y: lastPoint.y, opacity: 1.0 });
        }
    }

    console.log('Parsed', points.length, 'points from path of length', totalLength.toFixed(2));

    return points;
}

// Normalize path to [0,1] range and apply offsets
function normalizeAndOffsetPath(points, offsetX, offsetY) {
    if (points.length === 0) return points;

    // Find global min/max across both X and Y
    let minVal = Infinity;
    let maxVal = -Infinity;

    points.forEach(p => {
        minVal = Math.min(minVal, p.x, p.y);
        maxVal = Math.max(maxVal, p.x, p.y);
    });

    const range = maxVal - minVal;

    // Avoid division by zero
    if (range === 0) {
        console.warn('Path has zero range, skipping normalization');
        return points;
    }

    // Normalize to [0, 1] and apply offsets
    return points.map(p => ({
        x: (p.x - minVal) / range + offsetX,
        y: (p.y - minVal) / range + offsetY,
        opacity: p.opacity !== undefined ? p.opacity : 1.0
    }));
}

class FourierInitials {
    constructor(canvasId, mode = 'kc', customPath = null, speed = 0.3, linewidth = 3, numCircles = 100, maxFreq = Infinity, maxCircleSize = Infinity, axisMode = 'three', rotationMode = 'rotating', segmentBoundaries = null, offsetX = 0, offsetY = 0, globalOffsetX = 0, globalOffsetY = 0, skipDFT = false) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.mode = mode;
        this.customPath = customPath;
        this.speed = speed;
        this.linewidth = linewidth;
        this.numCircles = numCircles;
        this.maxFreq = maxFreq;
        this.maxCircleSize = maxCircleSize;
        this.axisMode = axisMode;
        this.rotationMode = rotationMode;
        this.segmentBoundaries = segmentBoundaries;
        this.offsetX = offsetX;
        this.offsetY = offsetY;
        this.globalOffsetX = globalOffsetX;
        this.globalOffsetY = globalOffsetY;
        this.isDrawing = false;
        this.drawnPoints = [];

        // Set canvas size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        // Mobile browsers fire visualViewport resize when the address bar slides in/out
        // without triggering window resize — causing centerX/Y to drift
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => this.resizeCanvas());
        }

        this.centerX = this.canvas.width / 2;
        this.centerY = this.canvas.height / 2;

        // Setup drawing if in draw mode
        if (mode === 'draw') {
            this.setupDrawing();
            return; // Don't start animation yet
        }

        // Handle multi-path mode (CSV with pen control)
        if (mode === 'csv-multi' && Array.isArray(customPath)) {
            this.initializeMultiPath(customPath);
            return;
        }

        // Get path based on mode
        if (mode === 'svg' && customPath) {
            this.kcPath = customPath;
        } else {
            this.kcPath = this.createKCInitials();
        }

        // Skip DFT if loading from cache
        if (skipDFT) {
            console.log('Skipping DFT computation (loading from cache)');
            this.time = 0;
            this.path = [];
            this.connectionLines = [];
            this.animationId = null;
            // Don't call animate() yet - epicycles will be loaded after constructor
            return;
        }

        // Decompose using FFT/DFT - support both two-axis and three-axis modes
        console.log('Starting DFT decomposition for', this.kcPath.length, 'points in', this.axisMode, 'axis mode');

        // Store opacity values for each point
        this.opacityMap = this.kcPath.map(p => p.opacity !== undefined ? p.opacity : 1.0);

        // Debug: Log opacity values
        const zeroOpacityCount = this.opacityMap.filter(op => op < 0.5).length;
        console.log('OpacityMap: Total points:', this.opacityMap.length, 'Points with opacity < 0.5:', zeroOpacityCount);
        if (zeroOpacityCount > 0) {
            console.log('First few opacity values:', this.opacityMap.slice(0, 10));
            // Find first zero opacity point
            const firstZeroIndex = this.opacityMap.findIndex(op => op < 0.5);
            console.log('First zero opacity at index:', firstZeroIndex, 'value:', this.opacityMap[firstZeroIndex]);
        }

        if (this.axisMode === 'two' || this.axisMode === 'two_true') {
            // Two separate real-valued DFTs (one for X, one for Y)
            console.time('Project onto axes');
            const compX = this.kcPath.map(p => p.x);
            const compY = this.kcPath.map(p => p.y);
            console.timeEnd('Project onto axes');

            console.time('DFT Component X');
            this.epicycles1 = this.dft(compX);
            console.timeEnd('DFT Component X');
            console.log('Component X: Generated', this.epicycles1.length, 'epicycles');

            console.time('DFT Component Y');
            this.epicycles2 = this.dft(compY);
            console.timeEnd('DFT Component Y');
            console.log('Component Y: Generated', this.epicycles2.length, 'epicycles');

            // Filter out high frequency components
            console.time('Filter by frequency');
            this.epicycles1 = this.epicycles1.filter(ep => ep.freq <= this.maxFreq);
            this.epicycles2 = this.epicycles2.filter(ep => ep.freq <= this.maxFreq);
            console.timeEnd('Filter by frequency');
            console.log('After filtering: Component X:', this.epicycles1.length, 'Component Y:', this.epicycles2.length);

            // Filter by circle size (amplitude)
            console.time('Filter by circle size');
            this.epicycles1 = this.epicycles1.filter(ep => ep.amp <= this.maxCircleSize);
            this.epicycles2 = this.epicycles2.filter(ep => ep.amp <= this.maxCircleSize);
            console.timeEnd('Filter by circle size');
            console.log('After size filtering: Component X:', this.epicycles1.length, 'Component Y:', this.epicycles2.length);

            // Sort by amplitude (larger circles first)
            console.time('Sort by amplitude');
            this.epicycles1.sort((a, b) => b.amp - a.amp);
            this.epicycles2.sort((a, b) => b.amp - a.amp);
            console.timeEnd('Sort by amplitude');

        } else {
            // Three axes at 120° intervals (triangular decomposition)
            const angle1 = 0;
            const angle2 = (2 * Math.PI / 3); // 120°
            const angle3 = (4 * Math.PI / 3); // 240°

            // Project each point onto the three axes
            console.time('Project onto axes');
            const comp1 = this.kcPath.map(p => p.x * Math.cos(angle1) + p.y * Math.sin(angle1));
            const comp2 = this.kcPath.map(p => p.x * Math.cos(angle2) + p.y * Math.sin(angle2));
            const comp3 = this.kcPath.map(p => p.x * Math.cos(angle3) + p.y * Math.sin(angle3));
            console.timeEnd('Project onto axes');

            console.time('DFT Component 1');
            this.epicycles1 = this.dft(comp1);
            console.timeEnd('DFT Component 1');
            console.log('Component 1: Generated', this.epicycles1.length, 'epicycles');

            console.time('DFT Component 2');
            this.epicycles2 = this.dft(comp2);
            console.timeEnd('DFT Component 2');
            console.log('Component 2: Generated', this.epicycles2.length, 'epicycles');

            console.time('DFT Component 3');
            this.epicycles3 = this.dft(comp3);
            console.timeEnd('DFT Component 3');
            console.log('Component 3: Generated', this.epicycles3.length, 'epicycles');

            // Filter out high frequency components
            console.time('Filter by frequency');
            this.epicycles1 = this.epicycles1.filter(ep => ep.freq <= this.maxFreq);
            this.epicycles2 = this.epicycles2.filter(ep => ep.freq <= this.maxFreq);
            this.epicycles3 = this.epicycles3.filter(ep => ep.freq <= this.maxFreq);
            console.timeEnd('Filter by frequency');
            console.log('After filtering: Component 1:', this.epicycles1.length, 'Component 2:', this.epicycles2.length, 'Component 3:', this.epicycles3.length);

            // Filter by circle size (amplitude)
            console.time('Filter by circle size');
            this.epicycles1 = this.epicycles1.filter(ep => ep.amp <= this.maxCircleSize);
            this.epicycles2 = this.epicycles2.filter(ep => ep.amp <= this.maxCircleSize);
            this.epicycles3 = this.epicycles3.filter(ep => ep.amp <= this.maxCircleSize);
            console.timeEnd('Filter by circle size');
            console.log('After size filtering: Component 1:', this.epicycles1.length, 'Component 2:', this.epicycles2.length, 'Component 3:', this.epicycles3.length);

            // Sort by amplitude (larger circles first)
            console.time('Sort by amplitude');
            this.epicycles1.sort((a, b) => b.amp - a.amp);
            this.epicycles2.sort((a, b) => b.amp - a.amp);
            this.epicycles3.sort((a, b) => b.amp - a.amp);
            console.timeEnd('Sort by amplitude');
        }

        this.time = 0;
        this.path = [];
        this.connectionLines = []; // Store connection lines with timestamps
        this.animationId = null; // Store animation frame ID for cleanup

        this.animate();
    }

    initializeMultiPath(paths) {
        console.log('Initializing multi-path mode with', paths.length, 'paths');
        console.log('Path lengths:', paths.map(p => p.length));

        this.paths = paths;
        this.currentPathIndex = 0;
        this.pathEpicycles = []; // Will store epicycles for each path

        // Find the SMALLEST path to use as reference
        // Smaller N values produce larger amplitudes, which appear correct
        const minPathLength = Math.min(...paths.map(p => p.length));
        console.log('Min path length (reference):', minPathLength);

        // Process each path
        paths.forEach((path, pathIndex) => {
            console.log('Processing path', pathIndex, ':', path.length, 'points in', this.axisMode, 'axis mode');

            // Scale factor: use square root to apply gentler correction
            // Smaller N values produce larger amplitudes, which appear correct
            const scaleFactor = Math.sqrt(path.length / minPathLength);
            console.log(`Path ${pathIndex} scale factor:`, scaleFactor.toFixed(3));

            const pathData = {
                originalPath: path,
                scaleFactor: scaleFactor,
                epicycles1: null,
                epicycles2: null,
                epicycles3: null
            };

            if (this.axisMode === 'two' || this.axisMode === 'two_true') {
                // Two orthogonal axes at 0° and 90° (X and Y)
                const compX = path.map(p => p.x);
                const compY = path.map(p => p.y);

                console.time(`DFT Path ${pathIndex} - X`);
                pathData.epicycles1 = this.dft(compX);
                console.timeEnd(`DFT Path ${pathIndex} - X`);

                console.time(`DFT Path ${pathIndex} - Y`);
                pathData.epicycles2 = this.dft(compY);
                console.timeEnd(`DFT Path ${pathIndex} - Y`);

                // Filter and sort
                pathData.epicycles1 = pathData.epicycles1
                    .filter(ep => ep.freq <= this.maxFreq && ep.amp <= this.maxCircleSize)
                    .sort((a, b) => b.amp - a.amp);

                pathData.epicycles2 = pathData.epicycles2
                    .filter(ep => ep.freq <= this.maxFreq && ep.amp <= this.maxCircleSize)
                    .sort((a, b) => b.amp - a.amp);

                console.log(`Path ${pathIndex}: X=${pathData.epicycles1.length}, Y=${pathData.epicycles2.length} epicycles`);

            } else {
                // Three axes at 120° intervals
                const angle1 = 0;
                const angle2 = (2 * Math.PI / 3);
                const angle3 = (4 * Math.PI / 3);

                const comp1 = path.map(p => p.x * Math.cos(angle1) + p.y * Math.sin(angle1));
                const comp2 = path.map(p => p.x * Math.cos(angle2) + p.y * Math.sin(angle2));
                const comp3 = path.map(p => p.x * Math.cos(angle3) + p.y * Math.sin(angle3));

                console.time(`DFT Path ${pathIndex} - Comp1`);
                pathData.epicycles1 = this.dft(comp1);
                console.timeEnd(`DFT Path ${pathIndex} - Comp1`);

                console.time(`DFT Path ${pathIndex} - Comp2`);
                pathData.epicycles2 = this.dft(comp2);
                console.timeEnd(`DFT Path ${pathIndex} - Comp2`);

                console.time(`DFT Path ${pathIndex} - Comp3`);
                pathData.epicycles3 = this.dft(comp3);
                console.timeEnd(`DFT Path ${pathIndex} - Comp3`);

                // Apply scale factor to normalize amplitudes across different path lengths
                pathData.epicycles1.forEach(ep => ep.amp *= scaleFactor);
                pathData.epicycles2.forEach(ep => ep.amp *= scaleFactor);
                pathData.epicycles3.forEach(ep => ep.amp *= scaleFactor);

                // Filter and sort
                pathData.epicycles1 = pathData.epicycles1
                    .filter(ep => ep.freq <= this.maxFreq && ep.amp <= this.maxCircleSize)
                    .sort((a, b) => b.amp - a.amp);

                pathData.epicycles2 = pathData.epicycles2
                    .filter(ep => ep.freq <= this.maxFreq && ep.amp <= this.maxCircleSize)
                    .sort((a, b) => b.amp - a.amp);

                pathData.epicycles3 = pathData.epicycles3
                    .filter(ep => ep.freq <= this.maxFreq && ep.amp <= this.maxCircleSize)
                    .sort((a, b) => b.amp - a.amp);

                console.log(`Path ${pathIndex}: Comp1=${pathData.epicycles1.length}, Comp2=${pathData.epicycles2.length}, Comp3=${pathData.epicycles3.length} epicycles`);
            }

            this.pathEpicycles.push(pathData);
        });

        // Set up for first path
        this.switchToPath(0);

        this.time = 0;
        this.path = [];
        this.connectionLines = [];
        this.animationId = null;

        this.animate();
    }

    switchToPath(pathIndex) {
        console.log('Switching to path', pathIndex);
        this.currentPathIndex = pathIndex;
        const pathData = this.pathEpicycles[pathIndex];

        this.kcPath = pathData.originalPath;
        this.currentPathScaleFactor = pathData.scaleFactor;
        this.epicycles1 = pathData.epicycles1;
        this.epicycles2 = pathData.epicycles2;
        if (this.axisMode === 'three') {
            this.epicycles3 = pathData.epicycles3;
        }
    }

    setupDrawing() {
        this.canvas.style.cursor = 'crosshair';

        this.canvas.addEventListener('mousedown', (e) => {
            this.isDrawing = true;
            this.drawnPoints = [];
            const rect = this.canvas.getBoundingClientRect();
            this.drawnPoints.push({
                x: e.clientX - rect.left - this.centerX,
                y: e.clientY - rect.top - this.centerY
            });
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isDrawing) return;
            const rect = this.canvas.getBoundingClientRect();
            this.drawnPoints.push({
                x: e.clientX - rect.left - this.centerX,
                y: e.clientY - rect.top - this.centerY
            });
            this.drawPreview();
        });

        this.canvas.addEventListener('mouseup', () => {
            if (this.isDrawing && this.drawnPoints.length > 10) {
                this.isDrawing = false;
                this.finishDrawing();
            }
        });

        // Clear canvas
        this.ctx.fillStyle = '#2c3e50';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawPreview() {
        this.ctx.fillStyle = '#2c3e50';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.strokeStyle = '#3498db';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.drawnPoints.forEach((p, i) => {
            if (i === 0) {
                this.ctx.moveTo(p.x + this.centerX, p.y + this.centerY);
            } else {
                this.ctx.lineTo(p.x + this.centerX, p.y + this.centerY);
            }
        });
        this.ctx.stroke();
    }

    finishDrawing() {
        this.kcPath = this.drawnPoints;

        // Store opacity (user-drawn paths have full opacity)
        this.opacityMap = this.kcPath.map(() => 1.0);

        this.time = 0;
        this.path = [];
        this.connectionLines = [];
        this.canvas.style.cursor = 'default';
        document.getElementById('clearBtn').style.display = 'inline-block';
        this.animate();
    }

    parseSVGPath(svgString) {
        return parseSVGPath(svgString);
    }

    resizeCanvas() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
        this.centerX = this.canvas.width / 2;
        this.centerY = this.canvas.height / 2;
    }

    // Helper: smooth bezier stroke
    smoothStroke(startX, startY, endX, endY, curveX, curveY, steps) {
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const smooth = t * t * (3 - 2 * t);
            const u = 1 - smooth;
            const mx = (startX + endX) / 2 + curveX;
            const my = (startY + endY) / 2 + curveY;
            const x = u*u*startX + 2*u*smooth*mx + smooth*smooth*endX;
            const y = u*u*startY + 2*u*smooth*my + smooth*smooth*endY;
            points.push({ x, y });
        }
        return points;
    }

    // Helper: circular arc stroke
    arcStroke(cx, cy, radius, angleStart, angleEnd, steps) {
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const angle = angleStart + (angleEnd - angleStart) * t;
            points.push({
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius
            });
        }
        return points;
    }

    createKCInitials() {
        const points = [];
        const s = 45; // scale

        // Draw cursive K using natural pen strokes

        // 1. Entry flourish (bottom left)
        let stroke = this.arcStroke(-2.5*s, 0.9*s, 0.35*s, Math.PI*1.2, Math.PI*0.5, 15);
        points.push(...stroke);
        let last = stroke[stroke.length-1];

        // 2. Upstroke to top
        stroke = this.smoothStroke(last.x, last.y, -2.0*s, -1.3*s, -0.3*s, -0.5*s, 25);
        points.push(...stroke.slice(1));
        last = stroke[stroke.length-1];

        // 3. Top loop
        stroke = this.arcStroke(last.x+0.4*s, last.y-0.1*s, 0.4*s, Math.PI, 0, 18);
        points.push(...stroke.slice(1));
        last = stroke[stroke.length-1];

        // 4. Main diagonal downstroke
        stroke = this.smoothStroke(last.x, last.y, 0.3*s, 1.3*s, -0.2*s, 0.3*s, 30);
        points.push(...stroke.slice(1));
        last = stroke[stroke.length-1];

        // 5. Curve and return up for upper branch
        stroke = this.smoothStroke(last.x, last.y, -0.5*s, -0.3*s, -0.3*s, 0.2*s, 25);
        points.push(...stroke.slice(1));
        last = stroke[stroke.length-1];

        // 6. Upper diagonal branch
        stroke = this.smoothStroke(last.x, last.y, 0.8*s, -1.0*s, 0.3*s, -0.8*s, 20);
        points.push(...stroke.slice(1));
        last = stroke[stroke.length-1];

        // 7. Curl at end
        stroke = this.arcStroke(last.x-0.2*s, last.y-0.2*s, 0.25*s, -Math.PI*0.3, Math.PI*0.5, 12);
        points.push(...stroke.slice(1));
        last = stroke[stroke.length-1];

        // 8. Transition to C
        stroke = this.smoothStroke(last.x, last.y, 1.8*s, -0.7*s, 0.3*s, -0.2*s, 18);
        points.push(...stroke.slice(1));
        last = stroke[stroke.length-1];

        // 9. C main arc
        stroke = this.arcStroke(2.2*s, 0.1*s, 1.0*s, Math.PI*0.6, -Math.PI*0.9, 40);
        points.push(...stroke.slice(1));
        last = stroke[stroke.length-1];

        // 10. C exit flourish
        stroke = this.arcStroke(last.x-0.2*s, last.y, 0.3*s, -Math.PI, -Math.PI*1.4, 12);
        points.push(...stroke.slice(1));
        last = stroke[stroke.length-1];

        // 11. Close path
        stroke = this.smoothStroke(last.x, last.y, points[0].x, points[0].y, -1.0*s, 1.2*s, 25);
        points.push(...stroke.slice(1));

        return points;
    }

    dft(values) {
        // DFT on a single array of values (either X or Y coordinates)
        const X = [];
        const N = values.length;

        console.log('DFT: Processing', N, 'points (', (N * N / 1000000).toFixed(1), 'M operations)');

        for (let k = 0; k < N; k++) {
            // Progress indicator for large DFTs
            if (N > 3000 && k % 500 === 0) {
                console.log('DFT progress:', ((k / N) * 100).toFixed(1) + '%');
            }

            let re = 0;
            let im = 0;

            for (let n = 0; n < N; n++) {
                const phi = (Math.PI * 2 * k * n) / N;
                re += values[n] * Math.cos(phi);
                im += -values[n] * Math.sin(phi);
            }

            re = re / N;
            im = im / N;

            const freq = k;
            const amp = Math.sqrt(re * re + im * im);
            const phase = Math.atan2(im, re);

            X.push({ re, im, freq, amp, phase });
        }

        return X;
    }

    complexDft(xValues, yValues) {
        // Complex DFT: treats path as z(t) = x(t) + i*y(t)
        const X = [];
        const N = xValues.length;

        console.log('Complex DFT: Processing', N, 'points (', (N * N / 1000000).toFixed(1), 'M operations)');

        for (let k = 0; k < N; k++) {
            // Progress indicator for large DFTs
            if (N > 3000 && k % 500 === 0) {
                console.log('Complex DFT progress:', ((k / N) * 100).toFixed(1) + '%');
            }

            let re = 0;
            let im = 0;

            for (let n = 0; n < N; n++) {
                const phi = (Math.PI * 2 * k * n) / N;
                const cosval = Math.cos(phi);
                const sinval = Math.sin(phi);

                // Complex multiplication: (x + iy) * (cos(phi) - i*sin(phi))
                re += xValues[n] * cosval + yValues[n] * sinval;
                im += yValues[n] * cosval - xValues[n] * sinval;
            }

            re = re / N;
            im = im / N;

            const freq = k;
            const amp = Math.sqrt(re * re + im * im);
            const phase = Math.atan2(im, re);

            X.push({ re, im, freq, amp, phase });
        }

        return X;
    }

    getEpicycleValue(epicycles, time) {
        // Calculate the value from one epicycle chain
        let value = 0;

        for (let i = 0; i < Math.min(this.numCircles, epicycles.length); i++) {
            const ep = epicycles[i];
            const angle = ep.freq * time + ep.phase;
            value += ep.amp * Math.cos(angle);
        }

        return value;
    }

    getColor(index) {
        const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
        return colors[index % colors.length];
    }

    update() {
        const dt = (Math.PI * 2) / this.kcPath.length;
        const prevTime = this.time;
        this.time += dt * this.speed;

        // Fixed sample rate: maintain consistent quality regardless of speed
        // Target: ~5000 samples per full cycle for smooth rendering
        const targetSamplesPerCycle = 5000;
        const timeProgress = this.time - prevTime;
        const numSamples = Math.max(1, Math.ceil((timeProgress / (Math.PI * 2)) * targetSamplesPerCycle));

        // Add multiple samples between prevTime and currentTime for smooth rendering
        for (let s = 0; s < numSamples; s++) {
            const t = prevTime + (this.time - prevTime) * (s + 1) / numSamples;
            let x, y;

            if (this.axisMode === 'two_true') {
                // Axis-aligned epicycle chains
                const largeRadius = Math.min(this.canvas.width, this.canvas.height) * 0.35;

                // Chain positions match draw()
                // Red (X-chain): at bottom edge
                const chain1StartX = this.centerX;
                const chain1StartY = this.centerY + largeRadius;

                // Blue (Y-chain): at left edge
                const chain2StartX = this.centerX - largeRadius;
                const chain2StartY = this.centerY;

                // Get axis-aligned endpoints at time t
                const endpoint1 = this.getAxisAlignedChainEndpoint(this.epicycles1, chain1StartX, chain1StartY, 'horizontal', t);
                const endpoint2 = this.getAxisAlignedChainEndpoint(this.epicycles2, chain2StartX, chain2StartY, 'vertical', t);

                // Intersection: X from red (horizontal), Y from blue (vertical)
                x = endpoint1.x;
                y = endpoint2.y;

                // Debug: log first few points
                if (this.path.length < 5) {
                    console.log(`Update Point ${this.path.length}: red_end=(${endpoint1.x.toFixed(1)}, ${endpoint1.y.toFixed(1)}), blue_end=(${endpoint2.x.toFixed(1)}, ${endpoint2.y.toFixed(1)}), intersection=(${x.toFixed(1)}, ${y.toFixed(1)})`);
                }

            } else if (this.axisMode === 'two') {
                // Standard two-axis - separate X/Y reconstruction
                const valX = this.getEpicycleValue(this.epicycles1, t);
                const valY = this.getEpicycleValue(this.epicycles2, t);

                x = this.centerX + valX;
                y = this.centerY + valY;

            } else {
                // Three axes at 120° intervals
                const val1 = this.getEpicycleValue(this.epicycles1, t);
                const val2 = this.getEpicycleValue(this.epicycles2, t);
                const val3 = this.getEpicycleValue(this.epicycles3, t);

                // Reconstruct position from three components at 120° intervals
                const angle1 = 0;
                const angle2 = (2 * Math.PI / 3);
                const angle3 = (4 * Math.PI / 3);

                // Each component contributes along its axis direction
                x = this.centerX + 1.5 * (
                    val1 * Math.cos(angle1) +
                    val2 * Math.cos(angle2) +
                    val3 * Math.cos(angle3)
                );
                y = this.centerY + 1.5 * (
                    val1 * Math.sin(angle1) +
                    val2 * Math.sin(angle2) +
                    val3 * Math.sin(angle3)
                );
            }

            // Determine opacity based on segment boundaries (for CSV with transitions)
            let opacity = 1.0;
            if (this.segmentBoundaries && this.segmentBoundaries.length > 0) {
                // Calculate current index in the path based on time
                const timeIndex = Math.floor((t / (Math.PI * 2)) * this.kcPath.length);

                // Check if we're inside any segment
                let inSegment = false;
                const transitionMargin = 5; // Points to fade near boundaries

                for (const segment of this.segmentBoundaries) {
                    // Add margin to segment boundaries for smoother transitions
                    if (timeIndex >= segment.start - transitionMargin && timeIndex <= segment.end + transitionMargin) {
                        inSegment = true;

                        // Fade in/out near boundaries
                        const distToStart = timeIndex - segment.start;
                        const distToEnd = segment.end - timeIndex;

                        if (distToStart < transitionMargin) {
                            opacity = Math.min(1.0, distToStart / transitionMargin);
                        } else if (distToEnd < transitionMargin) {
                            opacity = Math.min(1.0, distToEnd / transitionMargin);
                        }
                        break;
                    }
                }

                // If not in any segment, we're in a transition - set opacity to 0
                if (!inSegment) {
                    opacity = 0.01;
                }
            }

            this.path.push({ x, y, opacity });
        }

        // Reset when complete
        if (this.time > Math.PI * 2) {
            if (this.mode === 'csv-multi' && this.pathEpicycles) {
                // Multi-path mode: switch to next path
                this.currentPathIndex++;
                if (this.currentPathIndex >= this.pathEpicycles.length) {
                    // All paths complete, loop back to start and clear
                    this.currentPathIndex = 0;
                    this.path = [];
                } else {
                    // Switch to next path but keep accumulated drawing
                    // Don't clear this.path
                }
                this.switchToPath(this.currentPathIndex);
            } else {
                // Single path mode: clear and restart
                this.path = [];
            }

            this.time = 0;
        }

        // Return the last sampled point
        return this.path[this.path.length - 1] || { x: this.centerX, y: this.centerY, opacity: 1.0 };
    }

    draw() {
        // Clear with fade
        this.ctx.fillStyle = 'rgba(44, 62, 80, 0.5)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply offsets for all subsequent drawing
        this.ctx.save();
        this.ctx.translate(this.globalOffsetX, this.globalOffsetY);

        const point = this.update();

        // Large encompassing circle radius
        const largeRadius = Math.min(this.canvas.width, this.canvas.height) * 0.35;

        // Draw large encompassing circle
        this.ctx.globalAlpha = 0.15;
        this.ctx.beginPath();
        this.ctx.arc(this.centerX, this.centerY, largeRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = '#ecf0f1';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Get current time for connection line management
        const now = Date.now();
        const fadeTime = 500; // milliseconds

        if (this.axisMode === 'two_true') {
            // Geometrically correct two-axis: intersection visualization
            const baseAngle = this.rotationMode === 'rotating' ? this.time : 0;

            // Position chains for visualization
            // Red (X-chain): at bottom edge
            const chain1StartX = this.centerX;
            const chain1StartY = this.centerY + largeRadius;

            // Blue (Y-chain): at left edge
            const chain2StartX = this.centerX - largeRadius;
            const chain2StartY = this.centerY;

            // Draw axis-aligned epicycle chains
            this.drawEpicycleChainAxisAligned(
                this.epicycles1,
                chain1StartX,
                chain1StartY,
                '#e74c3c', // Red (X)
                'horizontal'
            );

            this.drawEpicycleChainAxisAligned(
                this.epicycles2,
                chain2StartX,
                chain2StartY,
                '#3498db', // Blue (Y)
                'vertical'
            );

            // Get chain endpoints using axis-aligned calculation
            // Red chain moves horizontally (controls X)
            // Blue chain moves vertically (controls Y)
            const redEndpoint = this.getAxisAlignedChainEndpoint(this.epicycles1, chain1StartX, chain1StartY, 'horizontal');
            const blueEndpoint = this.getAxisAlignedChainEndpoint(this.epicycles2, chain2StartX, chain2StartY, 'vertical');

            // Intersection: X from red (horizontal chain), Y from blue (vertical chain)
            const intersectionX = redEndpoint.x;
            const intersectionY = blueEndpoint.y;

            // Debug: check intersection
            if (Math.random() < 0.01) { // Log occasionally
                console.log(`Draw: point=(${point.x.toFixed(1)}, ${point.y.toFixed(1)}), intersection=(${intersectionX.toFixed(1)}, ${intersectionY.toFixed(1)}), red_end=(${redEndpoint.x.toFixed(1)}, ${redEndpoint.y.toFixed(1)}), blue_end=(${blueEndpoint.x.toFixed(1)}, ${blueEndpoint.y.toFixed(1)})`);
            }

            // Draw axis-aligned lines from chain endpoints to intersection
            // Vertical line from blue endpoint to intersection
            this.connectionLines.push(
                {
                    from: { x: blueEndpoint.x, y: blueEndpoint.y },
                    to: { x: intersectionX, y: intersectionY },
                    timestamp: now
                }
            );

            // Horizontal line from red endpoint to intersection
            this.connectionLines.push(
                {
                    from: { x: redEndpoint.x, y: redEndpoint.y },
                    to: { x: intersectionX, y: intersectionY },
                    timestamp: now
                }
            );

        } else if (this.axisMode === 'two') {
            // Standard two-axis: direct connection lines
            const baseAngle = this.rotationMode === 'rotating' ? this.time : 0;

            // Chain 1 (X-axis) at 0°
            const chain1Angle = baseAngle;
            const chain1StartX = this.centerX + largeRadius * Math.cos(chain1Angle);
            const chain1StartY = this.centerY + largeRadius * Math.sin(chain1Angle);

            // Chain 2 (Y-axis) at 90°
            const chain2Angle = baseAngle + (Math.PI / 2);
            const chain2StartX = this.centerX + largeRadius * Math.cos(chain2Angle);
            const chain2StartY = this.centerY + largeRadius * Math.sin(chain2Angle);

            // Draw two epicycle chains
            this.drawEpicycleChain(
                this.epicycles1,
                chain1StartX,
                chain1StartY,
                '#e74c3c' // Red (X)
            );

            this.drawEpicycleChain(
                this.epicycles2,
                chain2StartX,
                chain2StartY,
                '#3498db' // Blue (Y)
            );

            // Get chain endpoints
            const endpoint1 = this.getChainEndpoint(this.epicycles1, chain1StartX, chain1StartY);
            const endpoint2 = this.getChainEndpoint(this.epicycles2, chain2StartX, chain2StartY);

            // Draw direct connection lines from endpoints to traced point
            this.connectionLines.push(
                { from: endpoint1, to: point, timestamp: now },
                { from: endpoint2, to: point, timestamp: now }
            );

        } else {
            // Three chains at 120° intervals (0°, 120°, 240°)
            // Determine if chains rotate or stay fixed
            const baseAngle = this.rotationMode === 'rotating' ? this.time : 0;

            // Chain 1 at 0°
            const chain1Angle = baseAngle;
            const chain1StartX = this.centerX + largeRadius * Math.cos(chain1Angle);
            const chain1StartY = this.centerY + largeRadius * Math.sin(chain1Angle);

            // Chain 2 at 120°
            const chain2Angle = baseAngle + (2 * Math.PI / 3);
            const chain2StartX = this.centerX + largeRadius * Math.cos(chain2Angle);
            const chain2StartY = this.centerY + largeRadius * Math.sin(chain2Angle);

            // Chain 3 at 240°
            const chain3Angle = baseAngle + (4 * Math.PI / 3);
            const chain3StartX = this.centerX + largeRadius * Math.cos(chain3Angle);
            const chain3StartY = this.centerY + largeRadius * Math.sin(chain3Angle);

            // Draw three epicycle chains
            this.drawEpicycleChain(
                this.epicycles1,
                chain1StartX,
                chain1StartY,
                '#e74c3c' // Red
            );

            this.drawEpicycleChain(
                this.epicycles2,
                chain2StartX,
                chain2StartY,
                '#3498db' // Blue
            );

            this.drawEpicycleChain(
                this.epicycles3,
                chain3StartX,
                chain3StartY,
                '#2ecc71' // Green
            );

            // Draw connection lines from chain endpoints to final point
            const endpoint1 = this.getChainEndpoint(this.epicycles1, chain1StartX, chain1StartY);
            const endpoint2 = this.getChainEndpoint(this.epicycles2, chain2StartX, chain2StartY);
            const endpoint3 = this.getChainEndpoint(this.epicycles3, chain3StartX, chain3StartY);

            // Store new connection lines with timestamp
            this.connectionLines.push(
                { from: endpoint1, to: point, timestamp: now },
                { from: endpoint2, to: point, timestamp: now },
                { from: endpoint3, to: point, timestamp: now }
            );
        }

        // Remove connection lines older than 0.5 seconds
        this.connectionLines = this.connectionLines.filter(line => now - line.timestamp < fadeTime);

        // Draw all connection lines with fading alpha
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeStyle = '#ecf0f1';

        this.connectionLines.forEach(line => {
            const age = now - line.timestamp;
            const alpha = Math.max(0, 0.075 * (1 - age / fadeTime));

            this.ctx.globalAlpha = alpha;
            this.ctx.beginPath();
            this.ctx.moveTo(line.from.x, line.from.y);
            this.ctx.lineTo(line.to.x, line.to.y);
            this.ctx.stroke();
        });

        this.ctx.setLineDash([]);

        // Draw the traced path
        this.ctx.lineWidth = this.linewidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        for (let i = 1; i < this.path.length; i++) {
            const hue = (i / this.path.length * 360) % 360;
            this.ctx.strokeStyle = `hsl(${hue}, 70%, 60%)`;

            // Use opacity from both endpoints - if either has low opacity, don't draw
            const opacity1 = this.path[i - 1].opacity !== undefined ? this.path[i - 1].opacity : 1.0;
            const opacity2 = this.path[i].opacity !== undefined ? this.path[i].opacity : 1.0;
            const lineOpacity = Math.min(opacity1, opacity2);

            this.ctx.globalAlpha = lineOpacity;

            this.ctx.beginPath();
            this.ctx.moveTo(this.path[i - 1].x, this.path[i - 1].y);
            this.ctx.lineTo(this.path[i].x, this.path[i].y);
            this.ctx.stroke();
        }

        // Draw current point
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.globalAlpha = 0.9;
        this.ctx.fill();

        // Restore context after offset transformations
        this.ctx.restore();
    }

    drawEpicycleChain(epicycles, startX, startY, color) {
        let currentX = startX;
        let currentY = startY;

        this.ctx.globalAlpha = 0.3;

        for (let i = 0; i < Math.min(this.numCircles, epicycles.length); i++) {
            const ep = epicycles[i];
            const angle = ep.freq * this.time + ep.phase;
            const radius = ep.amp;

            // Draw circle centered at current position
            this.ctx.beginPath();
            this.ctx.arc(currentX, currentY, radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            // Calculate next position (intersection point on circle perimeter)
            const nextX = currentX + radius * Math.cos(angle);
            const nextY = currentY + radius * Math.sin(angle);

            // Draw connection line from center to intersection point
            this.ctx.beginPath();
            this.ctx.moveTo(currentX, currentY);
            this.ctx.lineTo(nextX, nextY);
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 0.5;
            this.ctx.stroke();

            // Draw small dot at intersection
            this.ctx.beginPath();
            this.ctx.arc(nextX, nextY, 2, 0, Math.PI * 2);
            this.ctx.fillStyle = color;
            this.ctx.globalAlpha = 0.7;
            this.ctx.fill();

            // Move to next position
            currentX = nextX;
            currentY = nextY;
            this.ctx.globalAlpha = 0.3;
        }
    }

    drawEpicycleChainAxisAligned(epicycles, startX, startY, color, axis) {
        // For geometrically correct two-axis mode
        // axis = 'horizontal' or 'vertical'
        let currentX = startX;
        let currentY = startY;

        this.ctx.globalAlpha = 0.3;

        for (let i = 0; i < Math.min(this.numCircles, epicycles.length); i++) {
            const ep = epicycles[i];
            const angle = ep.freq * this.time + ep.phase;
            const radius = ep.amp;

            // Draw circle centered at current position
            this.ctx.beginPath();
            this.ctx.arc(currentX, currentY, radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            // Calculate the rotating point on the circle
            // For vertical axis, rotate 90° to show cos projection along Y
            let rotatingPointX, rotatingPointY;
            if (axis === 'horizontal') {
                rotatingPointX = currentX + radius * Math.cos(angle);
                rotatingPointY = currentY + radius * Math.sin(angle);
            } else {
                // Vertical: rotate by 90° (cos→Y, sin→X)
                rotatingPointX = currentX + radius * Math.sin(angle);
                rotatingPointY = currentY + radius * Math.cos(angle);
            }

            // Draw line from center to rotating point (shows rotation)
            this.ctx.beginPath();
            this.ctx.moveTo(currentX, currentY);
            this.ctx.lineTo(rotatingPointX, rotatingPointY);
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 0.5;
            this.ctx.stroke();

            // Draw dot at rotating point
            this.ctx.beginPath();
            this.ctx.arc(rotatingPointX, rotatingPointY, 3, 0, Math.PI * 2);
            this.ctx.fillStyle = color;
            this.ctx.globalAlpha = 0.7;
            this.ctx.fill();

            // Next circle's center is at the rotating point (tip-to-tail for visualization)
            currentX = rotatingPointX;
            currentY = rotatingPointY;
            this.ctx.globalAlpha = 0.3;
        }

        this.ctx.globalAlpha = 1.0;
    }

    getChainEndpoint(epicycles, startX, startY, time = null) {
        const t = time !== null ? time : this.time;
        let currentX = startX;
        let currentY = startY;

        for (let i = 0; i < Math.min(this.numCircles, epicycles.length); i++) {
            const ep = epicycles[i];
            const angle = ep.freq * t + ep.phase;
            const radius = ep.amp;

            currentX += radius * Math.cos(angle);
            currentY += radius * Math.sin(angle);
        }

        return { x: currentX, y: currentY };
    }

    getAxisAlignedChainEndpoint(epicycles, startX, startY, axis, time = null) {
        // axis: 'horizontal' for X-chain, 'vertical' for Y-chain
        const t = time !== null ? time : this.time;
        let currentX = startX;
        let currentY = startY;

        for (let i = 0; i < Math.min(this.numCircles, epicycles.length); i++) {
            const ep = epicycles[i];
            const angle = ep.freq * t + ep.phase;
            const displacement = ep.amp * Math.cos(angle);

            if (axis === 'horizontal') {
                currentX += displacement;
                // Y stays constant
            } else {
                currentY += displacement;
                // X stays constant
            }
        }

        return { x: currentX, y: currentY };
    }

    drawComplexEpicycleChain(epicycles, startX, startY, color) {
        // Draw a single epicycle chain where each circle contributes to both X and Y
        let currentX = startX;
        let currentY = startY;

        this.ctx.globalAlpha = 0.3;

        for (let i = 0; i < Math.min(this.numCircles, epicycles.length); i++) {
            const ep = epicycles[i];
            const angle = ep.freq * this.time + ep.phase;
            const radius = ep.amp;

            // Draw circle centered at current position
            this.ctx.beginPath();
            this.ctx.arc(currentX, currentY, radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            // Next position: this epicycle contributes both X and Y
            const nextX = currentX + radius * Math.cos(angle);
            const nextY = currentY + radius * Math.sin(angle);

            // Draw connection line from center to next position
            this.ctx.beginPath();
            this.ctx.moveTo(currentX, currentY);
            this.ctx.lineTo(nextX, nextY);
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 0.5;
            this.ctx.stroke();

            // Draw small dot at next position
            this.ctx.beginPath();
            this.ctx.arc(nextX, nextY, 2, 0, Math.PI * 2);
            this.ctx.fillStyle = color;
            this.ctx.globalAlpha = 0.7;
            this.ctx.fill();

            // Move to next position
            currentX = nextX;
            currentY = nextY;
        }

        this.ctx.globalAlpha = 1.0;
    }

    getComplexChainEndpoint(epicycles, startX, startY, time = null) {
        // Calculate the endpoint of a complex epicycle chain
        const t = time !== null ? time : this.time;
        let currentX = startX;
        let currentY = startY;

        for (let i = 0; i < Math.min(this.numCircles, epicycles.length); i++) {
            const ep = epicycles[i];
            const angle = ep.freq * t + ep.phase;
            const radius = ep.amp;

            currentX += radius * Math.cos(angle);
            currentY += radius * Math.sin(angle);
        }

        return { x: currentX, y: currentY };
    }

    animate() {
        this.draw();
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    pause() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    resume() {
        if (!this.animationId) {
            this.animate();
        }
    }

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}

// Initialize when DOM is ready
let currentAnimation = null;

// Expose animation control globally
window.pauseAnimation = function() {
    if (currentAnimation && currentAnimation.pause) {
        currentAnimation.pause();
    }
};

window.resumeAnimation = function() {
    if (currentAnimation && currentAnimation.resume) {
        currentAnimation.resume();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Draw reference vector
    drawReferenceVector();

    // Read all config from canvas data attributes (set in index.md frontmatter)
    const canvas = document.getElementById('sketchCanvas');
    const svgFile = canvas.getAttribute('data-svg-file');
    const speed = parseFloat(canvas.getAttribute('data-speed')) || 0.3;
    const resolution = parseInt(canvas.getAttribute('data-resolution')) || 1500;
    const scale = parseFloat(canvas.getAttribute('data-scale')) || 1.0;
    const linewidth = parseFloat(canvas.getAttribute('data-linewidth')) || 3;
    const circles = parseInt(canvas.getAttribute('data-circles')) || 100;
    const maxFreq = parseFloat(canvas.getAttribute('data-max-freq')) || Infinity;
    const maxCircleSize = parseFloat(canvas.getAttribute('data-max-circle-size')) || Infinity;
    const axisMode = canvas.getAttribute('data-axis-mode') || 'three';
    const rotationMode = canvas.getAttribute('data-rotation-mode') || 'rotating';
    const offsetX = parseFloat(canvas.getAttribute('data-offset-x')) || 0;
    const offsetY = parseFloat(canvas.getAttribute('data-offset-y')) || 0;
    const globalOffsetX = parseFloat(canvas.getAttribute('data-global-offset-x')) || 0;
    const globalOffsetY = parseFloat(canvas.getAttribute('data-global-offset-y')) || 0;

    // Load SVG if specified, otherwise draw nothing
    if (svgFile && svgFile !== 'null' && svgFile.trim() !== '') {
        // Check file extension to determine format
        if (svgFile.toLowerCase().endsWith('.csv')) {
            loadCSVFile(svgFile, speed, resolution, scale, linewidth, circles, maxFreq, maxCircleSize, axisMode, rotationMode, offsetX, offsetY, globalOffsetX, globalOffsetY);
        } else {
            loadSVGFile(svgFile, speed, resolution, scale, linewidth, circles, maxFreq, maxCircleSize, axisMode, rotationMode, offsetX, offsetY, globalOffsetX, globalOffsetY);
        }
    }
});

function loadSVGFile(filename, speed = 0.3, resolution = 1500, scale = 0.5, linewidth = 3, circles = 100, maxFreq = Infinity, maxCircleSize = Infinity, axisMode = 'three', rotationMode = 'rotating', offsetX = 0, offsetY = 0, globalOffsetX = 0, globalOffsetY = 0) {
    console.log('=== Loading SVG:', filename, '===');
    console.time('Total SVG Load Time');

    const cacheKey = getCacheKey(filename, resolution, scale, axisMode, maxFreq, maxCircleSize, circles);
    console.log('Cache key:', cacheKey);

    loadCacheData(cacheKey).then(cachedData => {
        if (cachedData) {
            console.log('Using cached epicycles for SVG, skipping DFT computation');

            if (currentAnimation) currentAnimation.stop();

            const offsetPath = cachedData.combinedPath;

            const canvas = document.getElementById('sketchCanvas');
            const displayWidth = canvas.offsetWidth || canvas.width;
            const displayHeight = canvas.offsetHeight || canvas.height;
            const largeRadius = Math.min(displayWidth, displayHeight) * 0.35;

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            offsetPath.forEach(p => {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            });
            const maxDimension = Math.max(maxX - minX, maxY - minY);
            const scaleFactor = maxDimension > 0 ? (2 * largeRadius * scale) / maxDimension : 1;

            const scaledPath = scaleToFit(offsetPath, largeRadius * scale);

            currentAnimation = new FourierInitials('sketchCanvas', 'svg', scaledPath, speed, linewidth, circles, maxFreq, maxCircleSize, axisMode, rotationMode, null, offsetX, offsetY, globalOffsetX, globalOffsetY, true);

            currentAnimation.epicycles1 = cachedData.epicycles1.map(ep => ({ ...ep, amp: ep.amp * scaleFactor }));
            currentAnimation.epicycles2 = cachedData.epicycles2.map(ep => ({ ...ep, amp: ep.amp * scaleFactor }));
            if (cachedData.epicycles3) {
                currentAnimation.epicycles3 = cachedData.epicycles3.map(ep => ({ ...ep, amp: ep.amp * scaleFactor }));
            }

            currentAnimation.animate();
            console.timeEnd('Total SVG Load Time');
            drawReferenceVector(scaledPath);
            return;
        }

        // No cache — fetch and compute
        fetch(`/assets/svg/${filename}`)
            .then(response => response.text())
            .then(svgText => {
                console.log('SVG fetched successfully');

                const pathMatches = svgText.matchAll(/\sd="([^"]+)"/g);
                const paths = Array.from(pathMatches).map(match => match[1]);

                console.log('Found', paths.length, 'path(s) in SVG');

                if (paths.length === 0) {
                    console.error('No paths found in SVG file');
                    return;
                }

                if (currentAnimation) currentAnimation.stop();

                const combinedPath = paths.join(' ');

                console.time('Parse SVG Path');
                const points = parseSVGPath(combinedPath, resolution);
                console.timeEnd('Parse SVG Path');

                console.log('Parsed points count:', points.length);

                const nanPoints = points.filter(p => isNaN(p.x) || isNaN(p.y));
                if (nanPoints.length > 0) {
                    console.error('Found', nanPoints.length, 'points with NaN values!');
                }

                console.time('Normalize and center');
                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;
                points.forEach(p => {
                    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                });

                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2;
                const maxRange = Math.max(maxX - minX, maxY - minY);

                const normalizedPoints = points.map(p => ({
                    x: (p.x - centerX) / maxRange,
                    y: (p.y - centerY) / maxRange,
                    opacity: p.opacity !== undefined ? p.opacity : 1.0
                }));
                console.timeEnd('Normalize and center');

                const offsetPoints = normalizedPoints.map(p => ({
                    x: p.x + offsetX,
                    y: p.y + offsetY,
                    opacity: p.opacity
                }));

                const canvas = document.getElementById('sketchCanvas');
                const displayWidth = canvas.offsetWidth || canvas.width;
                const displayHeight = canvas.offsetHeight || canvas.height;
                const largeRadius = Math.min(displayWidth, displayHeight) * 0.35;

                console.time('Scale to Fit');
                const scaledPoints = scaleToFit(offsetPoints, largeRadius * scale);
                console.timeEnd('Scale to Fit');

                console.time('Create FourierInitials');
                currentAnimation = new FourierInitials('sketchCanvas', 'svg', scaledPoints, speed, linewidth, circles, maxFreq, maxCircleSize, axisMode, rotationMode, null, offsetX, offsetY, globalOffsetX, globalOffsetY);
                console.timeEnd('Create FourierInitials');
                console.timeEnd('Total SVG Load Time');

                // Save to cache (un-scale epicycles back to offsetPoints space)
                let offMinX = Infinity, offMaxX = -Infinity, offMinY = Infinity, offMaxY = -Infinity;
                offsetPoints.forEach(p => {
                    offMinX = Math.min(offMinX, p.x); offMaxX = Math.max(offMaxX, p.x);
                    offMinY = Math.min(offMinY, p.y); offMaxY = Math.max(offMaxY, p.y);
                });
                const offMaxDim = Math.max(offMaxX - offMinX, offMaxY - offMinY);
                const saveScaleFactor = offMaxDim > 0 ? (2 * largeRadius * scale) / offMaxDim : 1;

                function unscaleEpicycles(epics) {
                    if (!epics) return null;
                    return epics.map(ep => ({
                        ...ep,
                        re:  ep.re  / saveScaleFactor,
                        im:  ep.im  / saveScaleFactor,
                        amp: ep.amp / saveScaleFactor
                    }));
                }

                const cacheData = {
                    combinedPath: offsetPoints,
                    segmentBoundaries: null,
                    epicycles1: unscaleEpicycles(currentAnimation.epicycles1),
                    epicycles2: unscaleEpicycles(currentAnimation.epicycles2),
                    epicycles3: unscaleEpicycles(currentAnimation.epicycles3) || null,
                    metadata: {
                        filename: filename,
                        resolution: resolution,
                        scale: scale,
                        axisMode: axisMode,
                        maxFreq: maxFreq,
                        maxCircleSize: maxCircleSize,
                        circles: circles,
                        timestamp: new Date().toISOString()
                    }
                };

                saveCacheData(cacheKey, cacheData);
                drawReferenceVector(scaledPoints);
            })
            .catch(error => {
                console.error('Error loading SVG:', error);
            });
    });
}

function loadCSVFile(filename, speed = 0.3, resolution = 1500, scale = 0.5, linewidth = 3, circles = 100, maxFreq = Infinity, maxCircleSize = Infinity, axisMode = 'three', rotationMode = 'rotating', offsetX = 0, offsetY = 0, globalOffsetX = 0, globalOffsetY = 0) {
    console.log('=== Loading CSV:', filename, '===');
    console.time('Total CSV Load Time');

    // Generate cache key
    const cacheKey = getCacheKey(filename, resolution, scale, axisMode, maxFreq, maxCircleSize, circles);
    console.log('Cache key:', cacheKey);

    // Try to load from cache first
    loadCacheData(cacheKey).then(cachedData => {
        if (cachedData) {
            // Use cached data
            console.log('Using cached epicycles, skipping DFT computation');

            if (currentAnimation) currentAnimation.stop();

            const offsetPath = cachedData.combinedPath;
            const segmentBoundaries = cachedData.segmentBoundaries;

            // Apply screen-dependent scaling for current screen size
            const canvas = document.getElementById('sketchCanvas');
            const displayWidth = canvas.offsetWidth || canvas.width;
            const displayHeight = canvas.offsetHeight || canvas.height;
            const largeRadius = Math.min(displayWidth, displayHeight) * 0.35;

            // Calculate scale factor
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            offsetPath.forEach(p => {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            });
            const width = maxX - minX;
            const height = maxY - minY;
            const maxDimension = Math.max(width, height);
            const scaleFactor = maxDimension > 0 ? (2 * largeRadius * scale) / maxDimension : 1;

            console.log('Cache load scale factor:', scaleFactor);

            console.time('Scale cached path to current screen');
            const scaledPath = scaleToFit(offsetPath, largeRadius * scale);
            console.timeEnd('Scale cached path to current screen');

            console.time('Create FourierInitials from cache');
            currentAnimation = new FourierInitials('sketchCanvas', 'svg', scaledPath, speed, linewidth, circles, maxFreq, maxCircleSize, axisMode, rotationMode, segmentBoundaries, offsetX, offsetY, globalOffsetX, globalOffsetY, true);

            // Load and scale pre-computed epicycles
            if (axisMode === 'two' || axisMode === 'two_true') {
                currentAnimation.epicycles1 = cachedData.epicycles1.map(ep => ({
                    ...ep,
                    amp: ep.amp * scaleFactor
                }));
                currentAnimation.epicycles2 = cachedData.epicycles2.map(ep => ({
                    ...ep,
                    amp: ep.amp * scaleFactor
                }));
            } else {
                currentAnimation.epicycles1 = cachedData.epicycles1.map(ep => ({
                    ...ep,
                    amp: ep.amp * scaleFactor
                }));
                currentAnimation.epicycles2 = cachedData.epicycles2.map(ep => ({
                    ...ep,
                    amp: ep.amp * scaleFactor
                }));
                if (axisMode === 'three') {
                    currentAnimation.epicycles3 = cachedData.epicycles3.map(ep => ({
                        ...ep,
                        amp: ep.amp * scaleFactor
                    }));
                }
            }

            // Start animation after epicycles are loaded
            currentAnimation.animate();

            console.timeEnd('Create FourierInitials from cache');
            console.timeEnd('Total CSV Load Time');

            drawReferenceVector(scaledPath);
            return;
        }

        // No cache, compute normally
        computeAndCacheCSV(filename, speed, resolution, scale, linewidth, circles, maxFreq, maxCircleSize, axisMode, rotationMode, cacheKey, offsetX, offsetY, globalOffsetX, globalOffsetY);
    });
}

function computeAndCacheCSV(filename, speed, resolution, scale, linewidth, circles, maxFreq, maxCircleSize, axisMode, rotationMode, cacheKey, offsetX, offsetY, globalOffsetX, globalOffsetY) {

    fetch(`/assets/svg/${filename}`)
        .then(response => {
            console.log('CSV fetch complete, reading response...');
            const contentLength = response.headers.get('content-length');
            if (contentLength) {
                console.log('CSV file size:', (parseInt(contentLength) / 1024).toFixed(2), 'KB');
            }
            return response.text();
        })
        .then(csvText => {
            console.log('CSV text length:', csvText.length, 'characters');
            console.log('CSV line count (approx):', csvText.split('\n').length);

            if (currentAnimation) currentAnimation.stop();

            console.time('Parse CSV');
            const paths = parseCSV(csvText, resolution);
            console.timeEnd('Parse CSV');

            // Find global bounding box across ALL paths
            let globalMinX = Infinity, globalMaxX = -Infinity;
            let globalMinY = Infinity, globalMaxY = -Infinity;

            paths.forEach((path, idx) => {
                let pathMinX = Infinity, pathMaxX = -Infinity;
                let pathMinY = Infinity, pathMaxY = -Infinity;

                path.forEach(p => {
                    pathMinX = Math.min(pathMinX, p.x);
                    pathMaxX = Math.max(pathMaxX, p.x);
                    pathMinY = Math.min(pathMinY, p.y);
                    pathMaxY = Math.max(pathMaxY, p.y);

                    globalMinX = Math.min(globalMinX, p.x);
                    globalMaxX = Math.max(globalMaxX, p.x);
                    globalMinY = Math.min(globalMinY, p.y);
                    globalMaxY = Math.max(globalMaxY, p.y);
                });

                console.log(`Path ${idx} bounds:`, {
                    minX: pathMinX.toFixed(2),
                    maxX: pathMaxX.toFixed(2),
                    minY: pathMinY.toFixed(2),
                    maxY: pathMaxY.toFixed(2),
                    width: (pathMaxX - pathMinX).toFixed(2),
                    height: (pathMaxY - pathMinY).toFixed(2)
                });
            });

            // Calculate global center and scale
            const globalCenterX = (globalMinX + globalMaxX) / 2;
            const globalCenterY = (globalMinY + globalMaxY) / 2;

            const globalWidth = globalMaxX - globalMinX;
            const globalHeight = globalMaxY - globalMinY;
            const globalMaxDimension = Math.max(globalWidth, globalHeight);

            const canvas = document.getElementById('sketchCanvas');
            const displayWidth = canvas.offsetWidth || canvas.width;
            const displayHeight = canvas.offsetHeight || canvas.height;
            const largeRadius = Math.min(displayWidth, displayHeight) * 0.35;

            const globalScale = globalMaxDimension > 0 ? (2 * largeRadius * scale) / globalMaxDimension : 1;

            console.log('Global bounds:', { globalWidth, globalHeight, globalMaxDimension, globalCenterX, globalCenterY, globalScale });

            // Concatenate all paths into one combined path
            // Track segment boundaries to fade transitions later
            const combinedPath = [];
            const segmentBoundaries = [];
            let currentIndex = 0;

            paths.forEach((path, pathIndex) => {
                console.log('Processing path', pathIndex, 'with', path.length, 'points');

                // Check for NaN values
                const nanPoints = path.filter(p => isNaN(p.x) || isNaN(p.y));
                if (nanPoints.length > 0) {
                    console.error('Path', pathIndex, 'has', nanPoints.length, 'points with NaN values!');
                    return;
                }

                // Store segment boundary
                segmentBoundaries.push({
                    start: currentIndex,
                    end: currentIndex + path.length - 1,
                    pathIndex: pathIndex
                });

                // Add raw points to combined path (normalization happens later)
                path.forEach(p => {
                    combinedPath.push({
                        x: p.x,
                        y: p.y
                    });
                });

                currentIndex += path.length;
            });

            console.log('Combined path has', combinedPath.length, 'total points');
            console.log('Segment boundaries:', segmentBoundaries);

            // Find center and normalize with uniform scaling
            console.time('Normalize and center');
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            combinedPath.forEach(p => {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            });

            // Center of data
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            // Use max range to keep uniform scaling
            const rangeX = maxX - minX;
            const rangeY = maxY - minY;
            const maxRange = Math.max(rangeX, rangeY);

            // Center and normalize
            const normalizedPath = combinedPath.map(p => ({
                x: (p.x - centerX) / maxRange,
                y: (p.y - centerY) / maxRange
            }));
            console.timeEnd('Normalize and center');

            // Apply offsets
            const offsetPath = normalizedPath.map(p => ({
                x: p.x + offsetX,
                y: p.y + offsetY,
                opacity: p.opacity
            }));

            // Scale to fit within the large circle
            console.time('Scale to Fit');
            const scaledPath = scaleToFit(offsetPath, largeRadius * scale);
            console.timeEnd('Scale to Fit');

            console.time('Create FourierInitials');
            currentAnimation = new FourierInitials('sketchCanvas', 'svg', scaledPath, speed, linewidth, circles, maxFreq, maxCircleSize, axisMode, rotationMode, segmentBoundaries, offsetX, offsetY, globalOffsetX, globalOffsetY);
            console.timeEnd('Create FourierInitials');
            console.timeEnd('Total CSV Load Time');

            // Save computed data to cache (save offsetPath before screen-dependent scaling)
            // Epicycles were computed from scaledPath (screen-space), so we must un-scale them
            // back to offsetPath space before saving so the load-time scaleFactor is correct.
            let offMinX = Infinity, offMaxX = -Infinity, offMinY = Infinity, offMaxY = -Infinity;
            offsetPath.forEach(p => {
                offMinX = Math.min(offMinX, p.x); offMaxX = Math.max(offMaxX, p.x);
                offMinY = Math.min(offMinY, p.y); offMaxY = Math.max(offMaxY, p.y);
            });
            const offMaxDim = Math.max(offMaxX - offMinX, offMaxY - offMinY);
            const saveScaleFactor = offMaxDim > 0 ? (2 * largeRadius * scale) / offMaxDim : 1;

            function unscaleEpicycles(epics) {
                if (!epics) return null;
                return epics.map(ep => ({
                    ...ep,
                    re:  ep.re  / saveScaleFactor,
                    im:  ep.im  / saveScaleFactor,
                    amp: ep.amp / saveScaleFactor
                }));
            }

            const cacheData = {
                combinedPath: offsetPath,
                segmentBoundaries: segmentBoundaries,
                epicycles1: unscaleEpicycles(currentAnimation.epicycles1),
                epicycles2: unscaleEpicycles(currentAnimation.epicycles2),
                epicycles3: unscaleEpicycles(currentAnimation.epicycles3) || null,
                metadata: {
                    filename: filename,
                    resolution: resolution,
                    scale: scale,
                    axisMode: axisMode,
                    maxFreq: maxFreq,
                    maxCircleSize: maxCircleSize,
                    circles: circles,
                    timestamp: new Date().toISOString()
                }
            };

            saveCacheData(cacheKey, cacheData);

            // Draw reference for combined path
            drawReferenceVector(scaledPath);
        })
        .catch(error => {
            console.error('Error loading CSV:', error);
        });
}

function parseCSV(csvText, resolution) {
    const allPoints = [];
    const lines = csvText.trim().split('\n');

    console.log('CSV has', lines.length, 'lines');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue; // Skip empty lines and comments

        const parts = line.split(',').map(s => s.trim());
        if (parts.length < 3) {
            console.warn('Line', i + 1, 'has fewer than 3 columns, skipping:', line);
            continue;
        }

        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        const penDown = parts[2].toLowerCase() === 'true' || parts[2] === '1';

        if (isNaN(x) || isNaN(y)) {
            console.warn('Line', i + 1, 'has invalid numbers, skipping:', line);
            continue;
        }

        allPoints.push({ x, y, penDown });
    }

    console.log('Parsed', allPoints.length, 'valid points from CSV');

    // Split into separate continuous paths (pen_down=true segments)
    const paths = [];
    let currentPath = [];

    for (let i = 0; i < allPoints.length; i++) {
        const point = allPoints[i];

        if (point.penDown) {
            currentPath.push({ x: point.x, y: point.y });
        } else {
            // Pen is up - end current path if it has points
            if (currentPath.length > 0) {
                paths.push(currentPath);
                currentPath = [];
            }
        }
    }

    // Don't forget the last path
    if (currentPath.length > 0) {
        paths.push(currentPath);
    }

    console.log('Split into', paths.length, 'separate continuous paths');
    paths.forEach((path, i) => {
        console.log('  Path', i, ':', path.length, 'points');
    });

    // Subsample each path if needed
    if (resolution && resolution > 0) {
        const totalPoints = paths.reduce((sum, path) => sum + path.length, 0);
        if (totalPoints > resolution) {
            console.log('⚠️ Total points (' + totalPoints + ') exceeds resolution (' + resolution + '). Subsampling each path...');

            // Subsample each path proportionally
            const subsampledPaths = paths.map((path, i) => {
                const proportion = path.length / totalPoints;
                const targetPathPoints = Math.max(10, Math.round(proportion * resolution));

                if (path.length <= targetPathPoints) {
                    return path;
                }

                const subsampled = [];
                const step = (path.length - 1) / (targetPathPoints - 1);
                for (let j = 0; j < targetPathPoints; j++) {
                    const index = Math.min(Math.round(j * step), path.length - 1);
                    subsampled.push(path[index]);
                }

                console.log('  Path', i, 'subsampled from', path.length, 'to', subsampled.length);
                return subsampled;
            });

            return subsampledPaths;
        }
    }

    return paths;
}

function centerPath(points) {
    // Find bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    points.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    });

    // Calculate center of bounding box
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Translate all points to center around (0, 0)
    const centered = points.map(p => ({
        x: p.x - centerX,
        y: p.y - centerY,
        opacity: p.opacity
    }));

    // Debug: Check opacity preservation
    const lowOpacityBefore = points.filter(p => p.opacity !== undefined && p.opacity < 0.5).length;
    const lowOpacityAfter = centered.filter(p => p.opacity !== undefined && p.opacity < 0.5).length;
    console.log('centerPath: low opacity before:', lowOpacityBefore, 'after:', lowOpacityAfter);

    return centered;
}

function scaleToFit(points, targetRadius) {
    // Find bounding box of centered points
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    points.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    });

    // Calculate the size needed to contain the bounding box
    const width = maxX - minX;
    const height = maxY - minY;
    const maxDimension = Math.max(width, height);

    // Scale so the largest dimension fits within the diameter (2 * targetRadius)
    // But we want the half-extent (from center to edge) to equal targetRadius
    // So maxDimension/2 should equal targetRadius
    const scale = maxDimension > 0 ? (2 * targetRadius) / maxDimension : 1;

    console.log('ScaleToFit debug:', { width, height, maxDimension, targetRadius, scale });

    // Scale all points
    const scaled = points.map(p => ({
        x: p.x * scale,
        y: p.y * scale,
        opacity: p.opacity
    }));

    // Debug: Check opacity preservation
    const lowOpacityBefore = points.filter(p => p.opacity !== undefined && p.opacity < 0.5).length;
    const lowOpacityAfter = scaled.filter(p => p.opacity !== undefined && p.opacity < 0.5).length;
    console.log('scaleToFit: low opacity before:', lowOpacityBefore, 'after:', lowOpacityAfter);

    return scaled;
}

function drawReferenceVector(customPath = null) {
    const canvas = document.getElementById('referenceCanvas');
    const ctx = canvas.getContext('2d');

    canvas.width = 300;
    canvas.height = 150;

    // Clear background
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Only draw if a custom path is provided
    if (!customPath) {
        return;
    }

    const kcPath = customPath;

    // Calculate bounds for centering
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    kcPath.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    });

    const width = maxX - minX;
    const height = maxY - minY;
    const scale = Math.min((canvas.width - 40) / width, (canvas.height - 20) / height);
    const globalOffsetX = canvas.width / 2 - (minX + maxX) / 2 * scale;
    const globalOffsetY = canvas.height / 2 - (minY + maxY) / 2 * scale;

    // Draw the path
    ctx.beginPath();
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    kcPath.forEach((p, i) => {
        const x = p.x * scale + globalOffsetX;
        const y = p.y * scale + globalOffsetY;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();

    // Draw start point
    const startX = kcPath[0].x * scale + globalOffsetX;
    const startY = kcPath[0].y * scale + globalOffsetY;
    ctx.beginPath();
    ctx.arc(startX, startY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#e74c3c';
    ctx.fill();

    // Add label
    ctx.fillStyle = '#ecf0f1';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Target Vector', canvas.width / 2, 15);
}
