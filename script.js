// Configuration
const margin = {top: 80, right: 150, bottom: 60, left: 80};
const cellWidth = 80;
const cellHeight = 60;
const cellSpacing = 6; // Spacing between cells
const chartWidth = 60;
const chartHeight = 40;
const chartMargin = 5;

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// State: show max (true) or min (false) temperature
let showMax = true;
let monthlyData = [];
let dailyData = [];
let monthlyLookup = {};
let dailyLookup = {};
let colorScale;
let minTemp, maxTemp;
let cells, tooltip, svg, g;
let cellElements = [];

// Helper function to adjust color brightness for better visibility
function adjustColorBrightness(color, factor) {
    // Convert hex to rgb
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Adjust brightness (factor > 1 = lighter, < 1 = darker)
    const newR = Math.min(255, Math.max(0, Math.round(r * factor)));
    const newG = Math.min(255, Math.max(0, Math.round(g * factor)));
    const newB = Math.min(255, Math.max(0, Math.round(b * factor)));
    
    return `rgb(${newR}, ${newG}, ${newB})`;
}

// Helper function to get darker/more visible version of color for lines
function getLineColor(baseColor, isMax) {
    // Convert color to RGB values
    let r, g, b;
    
    if (baseColor.startsWith('rgb')) {
        // Handle rgb() format from D3 color scale
        const rgb = baseColor.match(/\d+/g);
        r = parseInt(rgb[0]);
        g = parseInt(rgb[1]);
        b = parseInt(rgb[2]);
    } else if (baseColor.startsWith('#')) {
        // Handle hex format
        const hex = baseColor.replace('#', '');
        r = parseInt(hex.substr(0, 2), 16);
        g = parseInt(hex.substr(2, 2), 16);
        b = parseInt(hex.substr(4, 2), 16);
    } else {
        // Fallback to darker colors
        return isMax ? '#1a4a7a' : '#2a6a8a';
    }
    
    // Make lines darker and more visible against the background
    // For max line: darker (factor 0.35) - more contrast
    // For min line: darker (factor 0.45) - slightly lighter than max for distinction
    const factor = isMax ? 0.35 : 0.45;
    
    const newR = Math.min(255, Math.max(0, Math.round(r * factor)));
    const newG = Math.min(255, Math.max(0, Math.round(g * factor)));
    const newB = Math.min(255, Math.max(0, Math.round(b * factor)));
    
    return `rgb(${newR}, ${newG}, ${newB})`;
}

// Screen reader announcements
function announceToScreenReader(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    setTimeout(() => document.body.removeChild(announcement), 1000);
}

// Load and process data
d3.csv("temperature_daily.csv").then(function(data) {
    // Parse dates and filter last 10 years (2008-2017)
    data.forEach(d => {
        d.date = new Date(d.date);
        d.year = d.date.getFullYear();
        d.month = d.date.getMonth() + 1;
        d.day = d.date.getDate();
        d.max_temperature = +d.max_temperature;
        d.min_temperature = +d.min_temperature;
    });
    
    const last10Years = data.filter(d => d.year >= 2008 && d.year <= 2017);
    
    // Group by year and month for monthly aggregates
    const monthlyMap = new Map();
    last10Years.forEach(d => {
        const key = `${d.year}-${d.month}`;
        if (!monthlyMap.has(key)) {
            monthlyMap.set(key, {
                year: d.year,
                month: d.month,
                max_temps: [],
                min_temps: []
            });
        }
        monthlyMap.get(key).max_temps.push(d.max_temperature);
        monthlyMap.get(key).min_temps.push(d.min_temperature);
    });
    
    // Calculate monthly means
    monthlyData = Array.from(monthlyMap.values()).map(d => ({
        year: d.year,
        month: d.month,
        max_temp_mean: d3.mean(d.max_temps),
        min_temp_mean: d3.mean(d.min_temps)
    }));
    
    // Store daily data
    dailyData = last10Years;
    
    // Create lookups
    monthlyLookup = {};
    monthlyData.forEach(d => {
        const key = `${d.year}-${d.month}`;
        monthlyLookup[key] = d;
    });
    
    dailyLookup = {};
    dailyData.forEach(d => {
        const key = `${d.year}-${d.month}`;
        if (!dailyLookup[key]) dailyLookup[key] = [];
        dailyLookup[key].push(d);
    });
    
    // Calculate color scale domain using actual max/min from daily data
    let tempValues = [];
    dailyData.forEach(d => {
        tempValues.push(d.max_temperature, d.min_temperature);
    });
    minTemp = d3.min(tempValues);
    maxTemp = d3.max(tempValues);
    
    // Create color scale
    colorScale = d3.scaleSequential(d3.interpolateRdYlBu)
        .domain([maxTemp, minTemp]);
    
    // Initialize visualization
    initVisualization();
    setupToggleButton();
}).catch(function(error) {
    console.error("Error loading data:", error);
    const container = document.getElementById("matrix-container");
    container.innerHTML = 
        "<div class='error-message' role='alert'><strong>Error loading data</strong><p>Please ensure temperature_daily.csv is in the same directory and accessible.</p><p>If you're opening this file directly, you need to use a local web server (e.g., <code>python -m http.server 8000</code>).</p></div>";
    announceToScreenReader("Error loading temperature data. Please check the console for details.");
});

function initVisualization() {
    // Clear loading message
    d3.select("#matrix-container").selectAll("*").remove();
    const container = document.getElementById("matrix-container");
    container.setAttribute('aria-busy', 'false');
    
    // Get unique years
    const years = [...new Set(monthlyData.map(d => d.year))].sort((a, b) => a - b);
    
    // Calculate dimensions (account for spacing between cells)
    const width = years.length * (cellWidth + cellSpacing) - cellSpacing + margin.left + margin.right;
    const height = months.length * (cellHeight + cellSpacing) - cellSpacing + margin.top + margin.bottom;
    
    // Create SVG with ARIA attributes
    svg = d3.select("#matrix-container")
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .attr("role", "img")
        .attr("aria-label", `Temperature matrix showing ${years.length} years and 12 months. Use Tab to navigate, Enter or Space to toggle view.`);
    
    g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Create cells with keyboard navigation support
    const cellData = years.flatMap(year => 
        months.map(month => ({
            year,
            month,
            key: `${year}-${month}`,
            data: monthlyLookup[`${year}-${month}`] || null
        }))
    );
    
    cells = g.selectAll(".cell")
        .data(cellData)
        .enter()
        .append("g")
        .attr("class", "cell")
        .attr("transform", d => `translate(${years.indexOf(d.year) * (cellWidth + cellSpacing)},${months.indexOf(d.month) * (cellHeight + cellSpacing)})`)
        .attr("tabindex", "0")
        .attr("role", "button")
        .attr("aria-label", d => {
            if (!d.data) return `${monthNames[d.month - 1]} ${d.year}, no data available`;
            // Use actual max/min from daily data
            const cellDaily = dailyLookup[d.key] || [];
            if (cellDaily.length === 0) return `${monthNames[d.month - 1]} ${d.year}, no data available`;
            
            let temp;
            if (showMax) {
                temp = d3.max(cellDaily.map(day => day.max_temperature));
            } else {
                temp = d3.min(cellDaily.map(day => day.min_temperature));
            }
            const tempType = showMax ? "maximum" : "minimum";
            return `${monthNames[d.month - 1]} ${d.year}, ${tempType} temperature ${temp.toFixed(1)} degrees Celsius. Press Enter or Space to switch view.`;
        });
    
    // Store cell elements for keyboard navigation
    cellElements = cells.nodes();
    
    // Add cell background with rounded corners
    cells.append("rect")
        .attr("width", cellWidth)
        .attr("height", cellHeight)
        .attr("rx", 6)
        .attr("ry", 6)
        .attr("fill", d => {
            if (!d.data) return "#1a1a1a";
            // Use actual max/min from daily data, not monthly averages
            const cellDaily = dailyLookup[d.key] || [];
            if (cellDaily.length === 0) return "#1a1a1a";
            
            let temp;
            if (showMax) {
                // Get the maximum of all max temperatures for this month
                temp = d3.max(cellDaily.map(day => day.max_temperature));
            } else {
                // Get the minimum of all min temperatures for this month
                temp = d3.min(cellDaily.map(day => day.min_temperature));
            }
            return colorScale(temp);
        })
        .attr("stroke", "#404040")
        .attr("stroke-width", 1)
        .style("cursor", "pointer");
    
    // Click handler - switches between showing maximum and minimum temperatures
    cells.on("click", function(event, d) {
        event.stopPropagation();
        showMax = !showMax;
        updateVisualization();
        updateToggleButton();
        announceToScreenReader(`Switched to ${showMax ? 'maximum' : 'minimum'} temperature view`);
    });
    
    // Keyboard navigation (WCAG 2.1.1, 2.1.2)
    cells.on("keydown", function(event, d) {
        const currentIndex = cellElements.indexOf(this);
        let newIndex = currentIndex;
        
        switch(event.key) {
            case 'Enter':
            case ' ':
                event.preventDefault();
                showMax = !showMax;
                updateVisualization();
                updateToggleButton();
                announceToScreenReader(`Switched to ${showMax ? 'maximum' : 'minimum'} temperature view`);
                break;
            case 'ArrowRight':
                event.preventDefault();
                newIndex = Math.min(currentIndex + 1, cellElements.length - 1);
                cellElements[newIndex].focus();
                break;
            case 'ArrowLeft':
                event.preventDefault();
                newIndex = Math.max(currentIndex - 1, 0);
                cellElements[newIndex].focus();
                break;
            case 'ArrowDown':
                event.preventDefault();
                newIndex = Math.min(currentIndex + years.length, cellElements.length - 1);
                cellElements[newIndex].focus();
                break;
            case 'ArrowUp':
                event.preventDefault();
                newIndex = Math.max(currentIndex - years.length, 0);
                cellElements[newIndex].focus();
                break;
        }
    });
    
    // Mouse hover and focus with tooltip
    cells.on("mouseover", function(event, d) {
        if (!d.data) return;
        showTooltip(event, d);
    })
    .on("focus", function(event, d) {
        if (!d.data) return;
        showTooltip(event, d);
    })
    .on("mouseout", function() {
        hideTooltip();
    })
    .on("blur", function() {
        // Keep tooltip visible for keyboard users until next focus
    });
    
    // Add mini line charts
    cells.each(function(d) {
        if (!d.data) return;
        
        const cellDaily = dailyLookup[d.key] || [];
        if (cellDaily.length === 0) return;
        
        // Sort by day
        cellDaily.sort((a, b) => a.day - b.day);
        
        // Create mini chart group
        const chartG = d3.select(this)
            .append("g")
            .attr("transform", `translate(${chartMargin},${chartMargin})`)
            .attr("aria-hidden", "true");
        
        // Scale for mini chart
        const xScale = d3.scaleLinear()
            .domain([1, d3.max(cellDaily, d => d.day)])
            .range([0, chartWidth]);
        
        // Calculate combined domain for both max and min temperatures
        const maxTemps = cellDaily.map(d => d.max_temperature);
        const minTemps = cellDaily.map(d => d.min_temperature);
        const allTemps = [...maxTemps, ...minTemps];
        const yScale = d3.scaleLinear()
            .domain(d3.extent(allTemps))
            .range([chartHeight, 0]);
        
        // Line generators for both max and min
        const maxLine = d3.line()
            .x(d => xScale(d.day))
            .y(d => yScale(d.max_temperature))
            .curve(d3.curveMonotoneX);
        
        const minLine = d3.line()
            .x(d => xScale(d.day))
            .y(d => yScale(d.min_temperature))
            .curve(d3.curveMonotoneX);
        
        // Calculate max and min temperatures for color coding
        const maxTempValue = d3.max(maxTemps);
        const minTempValue = d3.min(minTemps);
        
        // Get base colors from color scale
        const baseMinColor = colorScale(minTempValue);
        const baseMaxColor = colorScale(maxTempValue);
        
        // Draw min temperature line with adjusted color for visibility
        chartG.append("path")
            .datum(cellDaily)
            .attr("fill", "none")
            .attr("stroke", getLineColor(baseMinColor, false))
            .attr("stroke-width", 1.5)
            .attr("class", "min-line")
            .attr("d", minLine);
        
        // Draw max temperature line with adjusted color for visibility
        chartG.append("path")
            .datum(cellDaily)
            .attr("fill", "none")
            .attr("stroke", getLineColor(baseMaxColor, true))
            .attr("stroke-width", 1.5)
            .attr("class", "max-line")
            .attr("d", maxLine);
    });
    
    // Add year labels (x-axis)
    g.selectAll(".year-label")
        .data(years)
        .enter()
        .append("text")
        .attr("class", "year-label")
        .attr("x", d => years.indexOf(d) * (cellWidth + cellSpacing) + cellWidth / 2)
        .attr("y", -10)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .style("font-weight", "bold")
        .style("fill", "#e0e0e0")
        .attr("aria-hidden", "true")
        .text(d => d);
    
    // Add month labels (y-axis)
    g.selectAll(".month-label")
        .data(months)
        .enter()
        .append("text")
        .attr("class", "month-label")
        .attr("x", -10)
        .attr("y", d => months.indexOf(d) * (cellHeight + cellSpacing) + cellHeight / 2)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .style("font-size", "12px")
        .style("font-weight", "bold")
        .style("fill", "#e0e0e0")
        .attr("aria-hidden", "true")
        .text(d => monthNames[d - 1]);
    
    // Create tooltip (use existing element from HTML)
    tooltip = d3.select("#tooltip");
    
    // Create legend
    createLegend(width);
    
    // Title (removed mode indicator - now using HTML button)
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", 30)
        .attr("text-anchor", "middle")
        .style("font-size", "18px")
        .style("font-weight", "bold")
        .style("fill", "#e0e0e0")
        .text("Hong Kong Monthly Temperature Matrix (2008-2017)");
    
    // Announce to screen reader
    announceToScreenReader(`Temperature matrix loaded. Showing ${years.length} years of data. Use Tab to navigate cells, Enter or Space to toggle view.`);
}

function setupToggleButton() {
    const toggleButton = document.getElementById('toggle-view-btn');
    if (toggleButton) {
        toggleButton.addEventListener('click', function() {
            showMax = !showMax;
            updateVisualization();
            updateToggleButton();
            announceToScreenReader(`Switched to ${showMax ? 'maximum' : 'minimum'} temperature view`);
        });
        
        // Keyboard support
        toggleButton.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleButton.click();
            }
        });
        
        updateToggleButton();
    }
}

function updateToggleButton() {
    const toggleButton = document.getElementById('toggle-view-btn');
    const viewText = document.getElementById('view-text');
    const viewIcon = document.getElementById('view-icon');
    
    if (toggleButton && viewText && viewIcon) {
        const viewLabel = showMax ? 'Maximum Temperature' : 'Minimum Temperature';
        viewText.textContent = viewLabel;
        viewIcon.textContent = showMax ? '🌡️' : '❄️';
        toggleButton.setAttribute('aria-label', `Toggle between maximum and minimum temperature view. Currently showing ${viewLabel.toLowerCase()}.`);
        toggleButton.setAttribute('aria-pressed', showMax.toString());
    }
}

function showTooltip(event, d) {
    if (!d.data) return;
    
    const cellDaily = dailyLookup[d.key] || [];
    const dailyCount = cellDaily.length;
    
    // Calculate actual max/min temperatures
    let temp, maxTemp, minTemp;
    if (showMax) {
        temp = cellDaily.length > 0 ? d3.max(cellDaily.map(day => day.max_temperature)).toFixed(1) : 'N/A';
        maxTemp = cellDaily.length > 0 ? d3.max(cellDaily.map(day => day.max_temperature)).toFixed(1) : 'N/A';
        minTemp = cellDaily.length > 0 ? d3.min(cellDaily.map(day => day.max_temperature)).toFixed(1) : 'N/A';
    } else {
        temp = cellDaily.length > 0 ? d3.min(cellDaily.map(day => day.min_temperature)).toFixed(1) : 'N/A';
        maxTemp = cellDaily.length > 0 ? d3.max(cellDaily.map(day => day.min_temperature)).toFixed(1) : 'N/A';
        minTemp = cellDaily.length > 0 ? d3.min(cellDaily.map(day => day.min_temperature)).toFixed(1) : 'N/A';
    }
    const tempType = showMax ? "Maximum" : "Minimum";
    const date = `${monthNames[d.month - 1]} ${d.year}`;
    
    tooltip
        .attr("aria-hidden", "false")
        .style("opacity", 1)
        .html(`
            <strong>${date}</strong>
            <div style="margin-top: 8px;">
                <div style="margin-bottom: 4px;">${tempType} Temperature: <strong>${temp}°C</strong></div>
                <div style="font-size: 0.9em; color: #b0b0b0;">
                    Range: ${minTemp}°C - ${maxTemp}°C<br/>
                    ${dailyCount} days of data
                </div>
            </div>
        `)
        .style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY - 10) + "px");
}

function hideTooltip() {
    tooltip
        .attr("aria-hidden", "true")
        .style("opacity", 0);
}

function updateVisualization() {
    // Update cell background colors - switch between max and min temperature visualization
    cells.select("rect")
        .attr("fill", d => {
            if (!d.data) return "#1a1a1a";
            // Use actual max/min from daily data, not monthly averages
            const cellDaily = dailyLookup[d.key] || [];
            if (cellDaily.length === 0) return "#1a1a1a";
            
            let temp;
            if (showMax) {
                // Get the maximum of all max temperatures for this month
                temp = d3.max(cellDaily.map(day => day.max_temperature));
            } else {
                // Get the minimum of all min temperatures for this month
                temp = d3.min(cellDaily.map(day => day.min_temperature));
            }
            return colorScale(temp);
        });
    
    // Update ARIA labels
    cells.attr("aria-label", d => {
        if (!d.data) return `${monthNames[d.month - 1]} ${d.year}, no data available`;
        // Use actual max/min from daily data
        const cellDaily = dailyLookup[d.key] || [];
        if (cellDaily.length === 0) return `${monthNames[d.month - 1]} ${d.year}, no data available`;
        
        let temp;
        if (showMax) {
            temp = d3.max(cellDaily.map(day => day.max_temperature));
        } else {
            temp = d3.min(cellDaily.map(day => day.min_temperature));
        }
        const tempType = showMax ? "maximum" : "minimum";
        return `${monthNames[d.month - 1]} ${d.year}, ${tempType} temperature ${temp.toFixed(1)} degrees Celsius. Press Enter or Space to switch view.`;
    });
    
    // Update mini charts
    cells.each(function(d) {
        if (!d.data) return;
        
        const cellDaily = dailyLookup[d.key] || [];
        if (cellDaily.length === 0) return;
        
        const chartG = d3.select(this).select("g");
        if (chartG.empty()) return;
        
        // Update scales - use combined domain for both max and min
        const maxTemps = cellDaily.map(d => d.max_temperature);
        const minTemps = cellDaily.map(d => d.min_temperature);
        const allTemps = [...maxTemps, ...minTemps];
        const yScale = d3.scaleLinear()
            .domain(d3.extent(allTemps))
            .range([chartHeight, 0]);
        
        // Calculate max and min temperatures for color coding
        const maxTempValue = d3.max(maxTemps);
        const minTempValue = d3.min(minTemps);
        
        // Line generators for both max and min
        const xScale = d3.scaleLinear()
            .domain([1, d3.max(cellDaily, d => d.day)])
            .range([0, chartWidth]);
        
        const maxLine = d3.line()
            .x(d => xScale(d.day))
            .y(d => yScale(d.max_temperature))
            .curve(d3.curveMonotoneX);
        
        const minLine = d3.line()
            .x(d => xScale(d.day))
            .y(d => yScale(d.min_temperature))
            .curve(d3.curveMonotoneX);
        
        // Get base colors from color scale
        const baseMinColor = colorScale(minTempValue);
        const baseMaxColor = colorScale(maxTempValue);
        
        // Update both lines with adjusted colors for visibility
        chartG.select(".min-line")
            .datum(cellDaily)
            .attr("stroke", getLineColor(baseMinColor, false))
            .attr("d", minLine);
        
        chartG.select(".max-line")
            .datum(cellDaily)
            .attr("stroke", getLineColor(baseMaxColor, true))
            .attr("d", maxLine);
    });
    
    // Update toggle button
    updateToggleButton();
}

function createLegend(width) {
    const legendWidth = 20;
    const legendHeight = 200;
    const legendX = width - margin.right + 20;
    const legendY = margin.top;
    
    const legendSvg = svg.append("g")
        .attr("transform", `translate(${legendX},${legendY})`)
        .attr("role", "group")
        .attr("aria-label", `Temperature legend. Range from ${minTemp.toFixed(1)} to ${maxTemp.toFixed(1)} degrees Celsius`);
    
    // Legend gradient
    const defs = svg.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "temp-gradient")
        .attr("x1", "0%")
        .attr("x2", "0%")
        .attr("y1", "0%")
        .attr("y2", "100%");
    
    const numStops = 10;
    for (let i = 0; i <= numStops; i++) {
        const t = i / numStops;
        const temp = minTemp + (maxTemp - minTemp) * (1 - t);
        gradient.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", colorScale(temp));
    }
    
    // Legend rectangle
    legendSvg.append("rect")
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .style("fill", "url(#temp-gradient)")
        .style("stroke", "#808080")
        .style("stroke-width", 1)
        .attr("aria-hidden", "true");
    
    // Legend labels
    const legendScale = d3.scaleLinear()
        .domain([minTemp, maxTemp])
        .range([legendHeight, 0]);
    
    const legendAxis = d3.axisRight(legendScale)
        .ticks(5)
        .tickFormat(d => d.toFixed(1) + "°C");
    
    legendSvg.append("g")
        .attr("transform", `translate(${legendWidth}, 0)`)
        .attr("aria-hidden", "true")
        .call(legendAxis)
        .style("font-size", "10px")
        .style("fill", "#e0e0e0");
    
    // Legend title
    legendSvg.append("text")
        .attr("x", legendWidth / 2)
        .attr("y", -10)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .style("font-weight", "bold")
        .style("fill", "#e0e0e0")
        .attr("aria-hidden", "true")
        .text("Temperature (°C)");
}
