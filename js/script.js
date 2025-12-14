// ESP32 Web Installer - ESPLoader.js Version
// Full control over UI/UX, no Shadow DOM, no imposed dialogs

let currentLang = 'en';
let config = null;
let pageConfig = null;
let selectedProject = null;
let translations = {}; // Will be loaded from lang files
let esploader = null; // ESPLoader instance
let port = null; // Serial port

// Flash event logging to server
// Called ONLY at the very end of flash process (after reset + port close)
// Only works when analytics is enabled (requires PHP backend)
async function logFlashEvent(projectName, action, success, errorMsg = null, errorCategory = null) {
    // Skip logging if analytics disabled
    if (!pageConfig?.analytics) {
        return;
    }
    
    try {
        const logData = {
            project: projectName,
            action: action,
            success: success,
            timestamp: new Date().toISOString()
        };
        
        if (errorMsg) {
            logData.error = errorMsg;
            logData.errorCategory = errorCategory || categorizeError(errorMsg);
            logData.context = {
                browser: getBrowserInfo(),
                stage: currentStage || 'unknown',
                userAgent: navigator.userAgent
            };
        }
        
        console.log(`Logging flash event for "${projectName}"...`);
        
        // Send to PHP logging endpoint
        const response = await fetch('log-flash.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(logData)
        });
        
        if (!response.ok) {
            console.warn('Failed to log flash event:', response.statusText);
        } else {
            console.log(`Flash event logged successfully for "${projectName}"`);
            // After successful log, refresh counts
            loadFlashCounts();
        }
    } catch (error) {
        // Silent fail - don't interrupt user experience
        console.warn('Could not log flash event:', error);
    }
}

// Categorize error based on error message
function categorizeError(errorMsg) {
    const msg = errorMsg.toLowerCase();
    
    // User actions
    if (msg.includes('no port selected') || msg.includes('user cancelled')) {
        return 'user_cancel';
    }
    
    // Port issues
    if (msg.includes('failed to execute \'open\'') || 
        msg.includes('port is already open') ||
        msg.includes('access denied') ||
        msg.includes('port may be in use')) {
        return 'port_busy';
    }
    
    // Connection/timeout issues
    if (msg.includes('timeout') || 
        msg.includes('timed out') ||
        msg.includes('failed to connect') ||
        msg.includes('no response')) {
        return 'connection_timeout';
    }
    
    // Download/network issues
    if (msg.includes('failed to download') || 
        msg.includes('network') ||
        msg.includes('fetch') ||
        msg.includes('http')) {
        return 'download_failed';
    }
    
    // Hardware/chip issues
    if (msg.includes('chip') || 
        msg.includes('flash') ||
        msg.includes('memory') ||
        msg.includes('stub') ||
        msg.includes('bootloader')) {
        return 'hardware_error';
    }
    
    // Browser compatibility
    if (msg.includes('serial') && msg.includes('not supported') ||
        msg.includes('navigator.serial') ||
        msg.includes('undefined')) {
        return 'wrong_browser';
    }
    
    return 'flash_error';
}

// Get browser information for error context
function getBrowserInfo() {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    let version = '';
    
    if (ua.includes('Chrome') && !ua.includes('Edg')) {
        browser = 'Chrome';
        const match = ua.match(/Chrome\/(\d+)/);
        if (match) version = match[1];
    } else if (ua.includes('Edg')) {
        browser = 'Edge';
        const match = ua.match(/Edg\/(\d+)/);
        if (match) version = match[1];
    } else if (ua.includes('Firefox')) {
        browser = 'Firefox';
        const match = ua.match(/Firefox\/(\d+)/);
        if (match) version = match[1];
    } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
        browser = 'Safari';
        const match = ua.match(/Version\/(\d+)/);
        if (match) version = match[1];
    } else if (ua.includes('Opera')) {
        browser = 'Opera';
        const match = ua.match(/Opera\/(\d+)/);
        if (match) version = match[1];
    }
    
    // Detect OS
    let os = 'Unknown';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iOS') || ua.includes('iPhone')) os = 'iOS';
    
    return {
        name: browser,
        version: version,
        os: os,
        webSerial: 'serial' in navigator
    };
}

// Log wrong browser error (called from browser compatibility check)
// Only works when analytics is enabled (requires PHP backend)
function logWrongBrowserError() {
    // Skip if analytics disabled
    if (!pageConfig?.analytics) {
        return;
    }
    
    const browserInfo = getBrowserInfo();
    logFlashEvent(
        'N/A',
        'browser_check',
        false,
        `Unsupported browser: ${browserInfo.name} ${browserInfo.version} on ${browserInfo.os}`,
        'wrong_browser'
    );
}

// Load flash counts from server and update badges
// Only works when analytics is enabled (requires PHP backend)
async function loadFlashCounts() {
    // Skip if analytics disabled
    if (!pageConfig?.analytics) {
        return;
    }
    
    try {
        const response = await fetch('get-flash-counts.php');
        if (!response.ok) return;
        
        const counts = await response.json();
        
        // Update each card with flash count badge
        const cards = document.querySelectorAll('.project-card');
        cards.forEach(card => {
            const projectIndex = parseInt(card.dataset.index);
            if (projectIndex >= 0 && projectIndex < carouselProjects.length) {
                const project = carouselProjects[projectIndex];
                const projectCounts = counts[project.name];
                
                if (projectCounts && projectCounts.success > 0) {
                    // Find or create flash count badge
                    let flashBadge = card.querySelector('.flash-count-badge');
                    
                    if (!flashBadge) {
                        // Create badge if doesn't exist
                        flashBadge = document.createElement('span');
                        flashBadge.className = 'flash-count-badge';
                        
                        // Insert in badges row container
                        const badgesRow = card.querySelector('.project-badges-row');
                        
                        if (badgesRow) {
                            badgesRow.appendChild(flashBadge);
                        } else {
                            // Fallback: insert after version
                            const content = card.querySelector('.project-content');
                            content.appendChild(flashBadge);
                        }
                    }
                    
                    // Update badge content with GitHub-style icon (show only success count)
                    flashBadge.innerHTML = `
                        <svg class="flash-icon" viewBox="0 0 16 16" width="16" height="16">
                            <path fill="currentColor" d="M8 0L0 8l8 8 8-8-8-8zm0 1.5L14.5 8 8 14.5 1.5 8 8 1.5z"/>
                            <path fill="currentColor" d="M8 4L5 8h2v4l3-4H8V4z"/>
                        </svg>
                        <span>${projectCounts.success.toLocaleString()}</span>
                    `;
                    flashBadge.title = `${projectCounts.success} successful flashes`;
                }
            }
        });
    } catch (error) {
        console.warn('Could not load flash counts:', error);
    }
}

// Console logging functions
function addLog(message, type = 'info') {
    const consoleEl = document.getElementById('consoleContainer');
    consoleEl.classList.add('active');
    
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${message}`;
    consoleEl.appendChild(line);
    
    // Force scroll to bottom with smooth behavior
    requestAnimationFrame(() => {
        consoleEl.scrollTo({
            top: consoleEl.scrollHeight,
            behavior: 'smooth'
        });
    });
    
    // Also log to browser console for debugging
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Translation helper
function translate(key) {
    return translations[currentLang]?.[key] || translations['en']?.[key] || key;
}

// Load translation file
async function loadTranslations(lang) {
    try {
        const response = await fetch(`lang/${lang}.json`);
        const data = await response.json();
        translations[lang] = data;
    } catch (error) {
        console.error(`Failed to load ${lang} translations:`, error);
        addLog(`Failed to load ${lang} translations`, 'error');
    }
}

// Load page configuration
async function loadPageConfig() {
    try {
        const response = await fetch('page-config.json');
        pageConfig = await response.json();
        // Don't call applyPageConfig() here - will be called after language setup
    } catch (error) {
        console.error('Failed to load page config:', error);
        pageConfig = null;
    }
}

// Apply page configuration
function applyPageConfig() {
    if (!pageConfig) return;
    
    // Apply branding
    if (pageConfig.branding) {
        // Logo
        if (pageConfig.branding.logo) {
            const logo = document.getElementById('headerLogo');
            logo.src = pageConfig.branding.logo;
            logo.classList.add('visible');
            logo.onerror = () => {
                logo.classList.remove('visible');
            };
        }
        
        // Favicon
        if (pageConfig.branding.favicon) {
            let favicon = document.querySelector('link[rel="icon"]');
            if (!favicon) {
                favicon = document.createElement('link');
                favicon.rel = 'icon';
                document.head.appendChild(favicon);
            }
            favicon.href = pageConfig.branding.favicon;
        }
    }
    
    // Apply links (GitHub button)
    if (pageConfig.links && pageConfig.links.github && pageConfig.links.github.enabled) {
        const actionsContainer = document.getElementById('headerActions');
        
        // Remove only existing buttons (not language selector)
        const existingButtons = actionsContainer.querySelectorAll('.header-btn');
        existingButtons.forEach(btn => btn.remove());
        
        const githubBtn = createHeaderButton(
            pageConfig.links.github.url,
            translate('reportIssue'),
            githubIcon()
        );
        
        // Insert button before language selector
        const languageSelector = actionsContainer.querySelector('.language-selector');
        if (languageSelector) {
            actionsContainer.insertBefore(githubBtn, languageSelector);
        } else {
            actionsContainer.appendChild(githubBtn);
        }
    }
    
    // Apply footer
    if (pageConfig.footer && pageConfig.footer.enabled) {
        const footer = document.getElementById('footer');
        footer.style.display = 'block';
        updateFooter();
    }
    
    // Check browser compatibility
    if (pageConfig.browser_compatibility && pageConfig.browser_compatibility.show_warning) {
        checkBrowserCompatibility();
    }
}

// Create header button
function createHeaderButton(url, text, iconSvg) {
    const btn = document.createElement('a');
    btn.className = 'header-btn';
    btn.href = url;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.innerHTML = iconSvg + '<span>' + text + '</span>';
    return btn;
}

// GitHub icon SVG
function githubIcon() {
    return `<svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>`;
}

// Update footer content
function updateFooter() {
    if (!pageConfig || !pageConfig.footer) return;
    
    const footerText = document.getElementById('footerText');
    const footerLinks = document.getElementById('footerLinks');
    
    // Footer text - use translation
    footerText.textContent = translate('footerCopyright');
    
    // Footer links - use translations with keys
    footerLinks.innerHTML = '';
    if (pageConfig.footer.links && pageConfig.footer.links.length > 0) {
        pageConfig.footer.links.forEach(link => {
            const a = document.createElement('a');
            a.href = link.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = translate(link.key);
            footerLinks.appendChild(a);
        });
    }
}

// Update page texts (title, subtitle, etc.)
function updatePageTexts() {
    // Title and subtitle from lang files
    document.getElementById('title').textContent = translate('title');
    document.getElementById('subtitle').textContent = translate('subtitle');
}

// Check browser compatibility
function checkBrowserCompatibility() {
    if (!('serial' in navigator)) {
        const warning = document.getElementById('browserWarning');
        const warningText = document.getElementById('browserWarningText');
        
        // Use translation from lang file
        warningText.textContent = translate('browserWarning');
        
        warning.classList.add('show');
        
        // Disable flash button
        const flashBtn = document.getElementById('flashButton');
        if (flashBtn) {
            flashBtn.disabled = true;
            flashBtn.textContent = 'Browser Not Supported';
        }
        
        // Log wrong browser error for analytics
        logWrongBrowserError();
    }
}

// Load configuration
async function loadConfig() {
    try {
        const response = await fetch('config.json');
        config = await response.json();
        initCarousel();  // Use 3D carousel instead of grid
        addLog(translate('configLoaded'), 'success');
    } catch (error) {
        console.error('Failed to load config:', error);
        addLog('Failed to load configuration', 'error');
    }
}

// Render projects
function renderProjects() {
    const grid = document.getElementById('projectGrid');
    grid.innerHTML = '';
    
    if (!config || !config.projects) {
        grid.innerHTML = '<p>No projects available.</p>';
        return;
    }
    
    config.projects.forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card';
        
        // Check if project is enabled (default to true if not specified)
        const isEnabled = project.enabled !== false;
        
        // Add disabled class if project is disabled
        if (!isEnabled) {
            card.classList.add('disabled');
        }
        
        // Project image (top of card)
        let imageHtml = '';
        if (project.image) {
            imageHtml = `<img src="${project.image}" alt="${project.name}" class="project-image" onerror="this.style.display='none'">`;
        }
        
        // Description in current language
        const description = project.description[currentLang] || project.description.en;
        
        // Project icon (if available)
        let iconHtml = '';
        if (project.icon) {
            iconHtml = `<img src="${project.icon}" alt="${project.name}" class="project-icon" onerror="this.style.display='none'">`;
        }
        
        // Product link (if available)
        let productLinkHtml = '';
        if (project.url) {
            const linkText = translate('learnMore');
            productLinkHtml = `
                <a href="${project.url}" target="_blank" rel="noopener" class="project-link" onclick="event.stopPropagation()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    ${linkText}
                </a>
            `;
        }
        
        // Badge (if available)
        let badgeHtml = '';
        if (project.badge) {
            const badgeText = project.badge[currentLang] || project.badge.en;
            badgeHtml = `<span class="project-badge">${badgeText}</span>`;
        }
        
        card.innerHTML = `
            ${imageHtml}
            <div class="project-content">
                <div class="project-header">
                    ${iconHtml}
                    <div class="project-title-block">
                        <h3>${project.name}</h3>
                        <span class="project-version">v${project.version}</span>
                    </div>
                </div>
                <p>${description}</p>
                ${productLinkHtml}
                <div class="project-meta">
                    ${badgeHtml}
                </div>
            </div>
        `;
        
        // Only allow selection if project is enabled
        if (isEnabled) {
            card.addEventListener('click', () => selectProject(project));
        } else {
            // Show message when clicking disabled project
            card.addEventListener('click', (e) => {
                e.preventDefault();
                alert(translate('projectDisabled'));
            });
            
            // Add title attribute for tooltip
            card.title = translate('projectDisabled');
        }
        
        grid.appendChild(card);
    });
}

// Select project function
function selectProject(project) {
    // Check if project is enabled
    if (project.enabled === false) {
        alert(translate('projectDisabled'));
        return;
    }
    
    selectedProject = project;
    
    // Update UI - remove all selected classes first
    document.querySelectorAll('.project-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    // Add selected class to clicked card
    event.currentTarget.classList.add('selected');
    
    // Show flash section
    document.getElementById('flashSection').classList.add('active');
    
    // Show flash instruction
    document.getElementById('flashInstruction').classList.add('active');
    
    // Update project info
    const description = project.description[currentLang] || project.description.en;
    document.getElementById('selectedProjectName').textContent = project.name;
    document.getElementById('selectedProjectDesc').textContent = description;
    
    // Update instruction text with actual project name
    const instructionText2 = translate('instructionText2').replace('[project name]', project.name);
    document.getElementById('instructionText2').innerHTML = instructionText2;
    
    // Show/hide documentation link
    const docLinkContainer = document.getElementById('projectDocLink');
    const docLinkButton = document.getElementById('docLinkButton');
    const docLinkText = document.getElementById('docLinkText');
    
    if (project.documentation) {
        docLinkButton.href = project.documentation;
        docLinkText.textContent = translate('documentation');
        docLinkContainer.style.display = 'block';
    } else {
        docLinkContainer.style.display = 'none';
    }
    
    // Clear and reset console
    const consoleContainer = document.getElementById('consoleContainer');
    consoleContainer.innerHTML = '';
    addLog(`Project selected: ${project.name}`, 'info');
    addLog('Ready to flash. Click "Connect & Flash ESP32" when ready.', 'warning');
}

// ===== ESPLoader.js Flash Functions =====

// Main flash function - called when user clicks flash button
async function startFlash() {
    if (!selectedProject) {
        alert(translate('errorNoProjectSelected'));
        return;
    }
    
    // Auto-expand console if collapsed (needed for browser port dialog interaction)
    if (consoleCollapsed) {
        toggleConsole();
    }
    
    // Disable flash button during process
    const flashBtn = document.getElementById('flashButton');
    flashBtn.disabled = true;
    flashBtn.textContent = translate('connecting') || 'Connecting...';
    
    try {
        await flashESP32();
        flashBtn.textContent = translate('flashButton');
        flashBtn.disabled = false;
    } catch (error) {
        flashBtn.textContent = translate('flashButton');
        flashBtn.disabled = false;
    }
}

// ESPLoader.js flash implementation
async function flashESP32() {
    // Show progress bar
    showProgress();
    updateProgress(0, 'Preparing...', 'Ready to start');
    
    addLog('🔌 Requesting serial port access...', 'info');
    addLog('⚠️ Browser will ask you to select a COM port', 'warning');
    
    try {
        // Step 1: Request port from user (NO modal yet - let user select port first)
        currentStage = 'connecting';
        port = await navigator.serial.requestPort();
        addLog('✅ Port selected', 'success');
        updateProgress(5, 'Port selected', 'Connecting to ESP32...');
        
        // NOW show BOOT modal - user needs to hold BOOT for connection
        showBootModal();
        
        // Step 2: Create transport (don't open port yet - ESPLoader will do it)
        const transport = new esptooljs.Transport(port);
        
        // Step 3: Create ESPLoader with custom terminal for our console
        const terminal = {
            clean() {
                // Optional: could clear console here
            },
            write(data) {
                // Write raw data to console
                if (data && data.trim()) {
                    addLog(data.trim(), 'info');
                }
            },
            writeLine(data) {
                // Write line to console
                if (data && data.trim()) {
                    addLog(data.trim(), 'info');
                }
            }
        };
        
        // Step 4: Create ESPLoader
        // IMPORTANT: ESPLoader will open the port automatically
        esploader = new esptooljs.ESPLoader({
            transport: transport,
            baudrate: 115200,
            terminal: terminal,
            romBaudrate: 115200,
            debugLogging: false
        });
        
        // Step 5: Connect to chip (this will open the port internally)
        addLog('🔌 Connecting to ESP32...', 'info');
        addLog('⚠️ HOLD the BOOT button NOW until you see "Connected"!', 'warning');
        updateProgress(10, 'Connecting...', 'Hold BOOT button now!');
        
        const chip = await esploader.main();
        
        // Close modal on successful connection
        closeBootModal();
        
        addLog(`✅ Connected to ${chip}!`, 'success');
        addLog('👍 You can release the BOOT button now', 'success');
        updateProgress(15, 'Connected!', 'ESP32 detected successfully');
        
        // Step 6: Prepare firmware files
        currentStage = 'downloading';
        addLog('📥 Preparing firmware files...', 'info');
        updateProgress(15, 'Downloading...', 'Fetching firmware files');
        
        const fileArray = await prepareFirmwareFiles(selectedProject);
        
        updateProgress(20, 'Ready to flash', 'All files downloaded');
        
        // Step 7: Flash firmware
        currentStage = 'erasing';
        addLog('🔄 Starting flash process...', 'info');
        addLog('🗑️ Erasing flash memory...', 'info');
        updateProgress(20, 'Erasing flash...', 'This may take a few seconds');
        
        // Calculate total bytes for progress
        totalBytes = fileArray.reduce((sum, file) => sum + file.data.length, 0);
        writtenBytes = 0;
        currentStage = 'writing';
        
        // Get erase all option from checkbox
        const eraseAll = document.getElementById('eraseAllCheckbox').checked;
        
        if (eraseAll) {
            addLog('🗑️ Erasing entire flash memory (this will take longer)...', 'warning');
            updateProgress(20, 'Erasing all flash...', 'This may take 10-15 seconds');
        }
        
        await esploader.writeFlash({
            fileArray: fileArray,
            flashSize: "keep",
            flashMode: "keep",
            flashFreq: "keep",
            eraseAll: eraseAll,  // Use checkbox value
            compress: true,
            reportProgress: (fileIndex, written, total) => {
                const percent = Math.floor((written / total) * 100);
                
                // Update global progress
                writtenBytes = fileArray.slice(0, fileIndex).reduce((sum, f) => sum + f.data.length, 0) + written;
                const globalPercent = calculateGlobalProgress();
                updateProgress(globalPercent, 'Writing firmware...', `File ${fileIndex + 1}/${fileArray.length} - ${percent}%`);
                
                // Only log every 10%
                if (percent % 10 === 0 && written > 0) {
                    const fileName = fileArray[fileIndex].path || `file ${fileIndex}`;
                    addLog(`📝 Writing ${fileName}... ${percent}%`, 'info');
                }
            }
        });
        
        currentStage = 'done';
        updateProgress(100, 'Flash complete!', 'Firmware written successfully');
        
        addLog('🎉 Flash completed successfully!', 'success');
        addLog('🔄 Rebooting ESP32...', 'success');
        
        // Step 8: Hard reset
        await esploader.hardReset();
        
        addLog('✅ Your device is ready to use!', 'success');
        addLog('👉 You can disconnect the USB cable', 'info');
        
        // Step 9: Cleanup
        await port.close();
        addLog('✓ Serial port closed', 'info');
        
        // Log flash success ONLY at the very end (after everything complete)
        logFlashEvent(selectedProject.name, 'flash', true);
        
    } catch (error) {
        // Close modal on error
        closeBootModal();
        
        addLog(`❌ Error: ${error.message}`, 'error');
        console.error('Flash error:', error);
        
        // Log flash failure to server
        logFlashEvent(
            selectedProject ? selectedProject.name : 'Unknown',
            'flash',
            false,
            error.message
        );
        
        // Reset progress
        updateProgress(0, 'Error occurred', error.message);
        setTimeout(() => hideProgress(), 3000);
        
        // Provide helpful error messages
        if (error.message.includes('No port selected')) {
            addLog('💡 Tip: You need to select a COM port to continue', 'warning');
        } else if (error.message.includes('Failed to execute \'open\'')) {
            addLog('💡 Tip: Port may be in use by another application', 'warning');
            addLog('💡 Close Arduino IDE, PlatformIO, or other serial monitors', 'warning');
        } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
            addLog('💡 Tip: Make sure you held the BOOT button before clicking OK', 'warning');
            addLog('💡 Try again and hold BOOT earlier', 'warning');
        }
        
        // Try to cleanup
        try {
            if (port && port.readable) {
                await port.close();
            }
        } catch (e) {
            console.error('Cleanup error:', e);
        }
        
        throw error;
    }
}

// Prepare firmware files for flashing
async function prepareFirmwareFiles(project) {
    const baseUrl = window.location.origin + 
                   window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
    
    const fileArray = [];
    
    // Determine if single or multi-file
    const firmwareList = Array.isArray(project.firmware) 
        ? project.firmware 
        : [{ path: project.firmware, offset: '0x0' }];
    
    addLog(`📦 Downloading ${firmwareList.length} file(s)...`, 'info');
    
    for (const fw of firmwareList) {
        const filePath = fw.path || fw;
        const offset = fw.offset || '0x0';
        const url = baseUrl + 'firmware/' + filePath;
        
        addLog(`📥 Downloading ${filePath}...`, 'info');
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Read as arrayBuffer for binary data
            const arrayBuffer = await response.arrayBuffer();
            
            // Convert ArrayBuffer to string (ESPLoader expects string of bytes)
            const uint8Array = new Uint8Array(arrayBuffer);
            let binaryString = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binaryString += String.fromCharCode(uint8Array[i]);
            }
            
            fileArray.push({
                data: binaryString,  // String of raw bytes
                address: parseInt(offset),
                path: filePath
            });
            
            const size = (arrayBuffer.byteLength / 1024).toFixed(1);
            addLog(`✅ Downloaded ${filePath} (${size} KB) at ${offset}`, 'success');
            
        } catch (error) {
            addLog(`❌ Failed to download ${filePath}: ${error.message}`, 'error');
            throw new Error(`Failed to download firmware file: ${filePath}`);
        }
    }
    
    return fileArray;
}

// Change language
function changeLanguage() {
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect) {
        currentLang = languageSelect.value;
        // Save language preference
        localStorage.setItem('language', currentLang);
    }
    
    // Update translations from lang files
    // Note: selectProjectTitle removed, language selector in header now
    document.getElementById('flashTitle').textContent = translate('flashFirmware');
    
    // Update instruction text (if element exists)
    const instructionText1 = document.getElementById('instructionText1');
    if (instructionText1) instructionText1.innerHTML = translate('instructionText1');
    
    // Update console ready message
    const consoleReady = document.getElementById('consoleReady');
    if (consoleReady) consoleReady.textContent = translate('consoleReady');
    
    // Update flash button text
    const flashButton = document.getElementById('flashButton');
    if (flashButton && !flashButton.disabled) {
        flashButton.textContent = translate('flashButton');
    }
    
    // Update modal texts
    const bootModalTitle = document.getElementById('bootModalTitle');
    const bootModalText = document.getElementById('bootModalText');
    const bootModalButton = document.querySelector('.boot-modal-close');
    if (bootModalTitle) bootModalTitle.textContent = translate('bootModalTitle');
    if (bootModalText) bootModalText.textContent = translate('bootModalText');
    if (bootModalButton) bootModalButton.textContent = translate('bootModalButton');
    
    // Update console toggle text
    const consoleToggleText = document.getElementById('consoleToggleText');
    if (consoleToggleText) {
        consoleToggleText.textContent = consoleCollapsed ? translate('showLogs') : translate('hideLogs');
    }
    
    // Update console title
    const consoleTitle = document.querySelector('.console-title');
    if (consoleTitle) consoleTitle.textContent = translate('consoleLogs');
    
    // Update erase all option texts
    const eraseAllLabel = document.getElementById('eraseAllLabel');
    const eraseAllHint = document.getElementById('eraseAllHint');
    if (eraseAllLabel) eraseAllLabel.textContent = translate('eraseAllLabel');
    if (eraseAllHint) eraseAllHint.textContent = translate('eraseAllHint');
    
    // Update page config texts (title, subtitle from page-config.json)
    updatePageTexts();
    
    // Update footer
    if (pageConfig && pageConfig.footer && pageConfig.footer.enabled) {
        updateFooter();
    }
    
    // Re-apply page config to update button labels
    if (pageConfig) {
        applyPageConfig();
    }
    
    // Update carousel language
    updateCarouselLanguage();
    
    // Update selected project info if any
    if (selectedProject) {
        const description = selectedProject.description[currentLang] || selectedProject.description.en;
        document.getElementById('selectedProjectDesc').textContent = description;
        
        // Update instruction with project name (if element exists)
        const instructionText2El = document.getElementById('instructionText2');
        if (instructionText2El) {
            const instructionText2 = translate('instructionText2').replace('[project name]', selectedProject.name);
            instructionText2El.innerHTML = instructionText2;
        }
    }
}

// Initialize
async function initialize() {
    // Load page configuration first
    await loadPageConfig();
    
    // Load both language files
    await loadTranslations('en');
    await loadTranslations('fr');
    
    // Set initial language
    const savedLang = localStorage.getItem('language') || 'en';
    currentLang = savedLang;
    
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect) {
        languageSelect.value = savedLang;
    }
    
    // Load project config
    await loadConfig();
    
    // Apply translations and page config
    changeLanguage();
    
    // Load flash counts and display badges
    loadFlashCounts();
    
    addLog('ESP32 Web Installer ready (ESPLoader.js)', 'success');
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);

// ===== BOOT MODAL FUNCTIONS =====

function showBootModal() {
    const modal = document.getElementById('bootModal');
    modal.classList.add('show');
}

function closeBootModal() {
    const modal = document.getElementById('bootModal');
    modal.classList.remove('show');
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    const modal = document.getElementById('bootModal');
    if (e.target === modal) {
        closeBootModal();
    }
});

// ===== CONSOLE COLLAPSE FUNCTIONS =====

let consoleCollapsed = false;

function toggleConsole() {
    consoleCollapsed = !consoleCollapsed;
    
    const body = document.getElementById('consoleBody');
    const icon = document.getElementById('consoleToggleIcon');
    const text = document.getElementById('consoleToggleText');
    
    if (consoleCollapsed) {
        body.classList.add('collapsed');
        icon.classList.add('collapsed');
        text.textContent = translate('showLogs') || 'Show';
    } else {
        body.classList.remove('collapsed');
        icon.classList.remove('collapsed');
        text.textContent = translate('hideLogs') || 'Hide';
    }
}

// ===== PROGRESS BAR FUNCTIONS =====

let totalBytes = 0;
let writtenBytes = 0;
let currentStage = 'idle'; // idle, downloading, erasing, writing, done

function showProgress() {
    const container = document.getElementById('progressContainer');
    container.classList.add('active');
}

function hideProgress() {
    const container = document.getElementById('progressContainer');
    container.classList.remove('active');
}

function updateProgress(percent, label, status) {
    const fill = document.getElementById('progressBarFill');
    const percentText = document.getElementById('progressPercent');
    const labelText = document.getElementById('progressLabel');
    const statusText = document.getElementById('progressStatus');
    
    fill.style.width = percent + '%';
    percentText.textContent = Math.round(percent) + '%';
    
    if (label) labelText.textContent = label;
    if (status) statusText.textContent = status;
}

function calculateGlobalProgress() {
    // Global progress stages:
    // 1. Downloading: 0-10%
    // 2. Connecting: 10-15%
    // 3. Erasing: 15-20%
    // 4. Writing: 20-100%
    
    let percent = 0;
    
    switch (currentStage) {
        case 'downloading':
            // 0-10%
            percent = 10 * (writtenBytes / totalBytes);
            break;
        case 'connecting':
            percent = 10;
            break;
        case 'erasing':
            percent = 15;
            break;
        case 'writing':
            // 20-100%
            percent = 20 + (80 * (writtenBytes / totalBytes));
            break;
        case 'done':
            percent = 100;
            break;
    }
    
    return Math.min(100, Math.max(0, percent));
}

// ===== 3D CAROUSEL FUNCTIONALITY =====

let currentCarouselIndex = 0;
let carouselProjects = [];
let isAnimating = false;

// Initialize carousel
function initCarousel() {
    if (!config || !config.projects) return;
    
    carouselProjects = config.projects;
    currentCarouselIndex = 0;
    
    // Build carousel HTML
    buildCarousel();
    
    // Set initial positions
    updateCarouselPositions();
    
    // Auto-select first project
    selectProjectByIndex(0);
    
    // Setup keyboard navigation
    setupCarouselKeyboard();
    
    // Setup touch/swipe
    setupCarouselSwipe();
}

// Build carousel HTML structure
function buildCarousel() {
    const container = document.getElementById('projectCards');
    if (!container) return;
    
    // Create carousel wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'carousel-wrapper';
    
    // Create carousel container
    const carouselContainer = document.createElement('div');
    carouselContainer.className = 'carousel-container';
    
    // Create carousel track
    const track = document.createElement('div');
    track.className = 'carousel-track';
    track.id = 'carouselTrack';
    
    const totalProjects = carouselProjects.length;
    
    // Optimize number of copies based on project count
    // ≤3 projects: need 3 copies (all visible at once, need extras for wrap)
    // ≥4 projects: need 2 copies (hidden projects available as next/prev)
    const numCopies = totalProjects <= 3 ? 3 : 2;
    
    console.log(`Creating ${totalProjects} projects × ${numCopies} copies = ${totalProjects * numCopies} cards`);
    
    for (let copy = 0; copy < numCopies; copy++) {
        carouselProjects.forEach((project, index) => {
            const card = createProjectCard(project, index);
            card.setAttribute('data-project-index', index);
            card.setAttribute('data-copy', copy);
            track.appendChild(card);
        });
    }
    
    // Create navigation arrows
    const prevButton = document.createElement('button');
    prevButton.className = 'carousel-nav carousel-nav-prev';
    prevButton.innerHTML = '◀';
    prevButton.onclick = () => rotateCarousel(-1);
    prevButton.setAttribute('aria-label', 'Previous project');
    
    const nextButton = document.createElement('button');
    nextButton.className = 'carousel-nav carousel-nav-next';
    nextButton.innerHTML = '▶';
    nextButton.onclick = () => rotateCarousel(1);
    nextButton.setAttribute('aria-label', 'Next project');
    
    carouselContainer.appendChild(prevButton);
    carouselContainer.appendChild(track);
    carouselContainer.appendChild(nextButton);
    
    wrapper.appendChild(carouselContainer);
    
    // Create indicators
    if (carouselProjects.length > 1) {
        const indicators = createCarouselIndicators();
        wrapper.appendChild(indicators);
    }
    
    // Replace old container
    container.innerHTML = '';
    container.appendChild(wrapper);
}

// Create individual project card
function createProjectCard(project, index) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.index = index;
    
    // Check if project is disabled
    const isEnabled = project.enabled !== false;
    if (!isEnabled) {
        card.classList.add('disabled');
    }
    
    // Click card to make it active (only if enabled)
    card.onclick = () => {
        if (!isEnabled) {
            // Visual feedback (grayed out, cursor not-allowed) is enough
            // No console spam needed
            return;
        }
        if (index !== currentCarouselIndex && !isAnimating) {
            rotateCarouselToIndex(index);
        }
    };
    
    // Card image
    if (project.image) {
        const img = document.createElement('img');
        img.className = 'project-image';
        img.src = project.image;
        img.alt = project.name;
        card.appendChild(img);
    }
    
    // Card content - Title, Badge, Version at top
    const content = document.createElement('div');
    content.className = 'project-content';
    
    // Title
    const title = document.createElement('h3');
    title.className = 'project-title';
    title.textContent = project.name;
    content.appendChild(title);
    
    // Badges container (for badge, version, flash count on same line)
    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'project-badges-row';
    
    // Badge
    if (project.badge) {
        const badgeEl = document.createElement('span');
        badgeEl.className = 'project-badge';
        badgeEl.textContent = project.badge[currentLang] || project.badge.en;
        badgesContainer.appendChild(badgeEl);
    }
    
    // Version
    if (project.version) {
        const version = document.createElement('span');
        version.className = 'project-version';
        version.textContent = `Version: ${project.version}`;
        badgesContainer.appendChild(version);
    }
    
    // Flash count badge will be added here by loadFlashCounts()
    
    content.appendChild(badgesContainer);
    
    card.appendChild(content);
    
    // Description below title/badge/version
    const description = document.createElement('p');
    description.className = 'project-description';
    description.textContent = project.description[currentLang] || project.description.en;
    card.appendChild(description);
    
    // Icon centered between description and links
    if (project.icon) {
        const iconContainer = document.createElement('div');
        iconContainer.className = 'project-icon-container';
        const icon = document.createElement('img');
        icon.className = 'project-icon';
        icon.src = project.icon;
        icon.alt = '';
        iconContainer.appendChild(icon);
        card.appendChild(iconContainer);
    }
    
    // Links (documentation, url) - on same line at bottom
    if (project.documentation || project.url) {
        const linksContainer = document.createElement('div');
        linksContainer.className = 'project-links';
        
        if (project.documentation) {
            const docLink = document.createElement('a');
            docLink.href = project.documentation;
            docLink.target = '_blank';
            docLink.rel = 'noopener';
            docLink.className = 'project-link';
            docLink.innerHTML = '📄 ' + (translate('documentation') || 'Documentation');
            linksContainer.appendChild(docLink);
        }
        
        if (project.url) {
            const urlLink = document.createElement('a');
            urlLink.href = project.url;
            urlLink.target = '_blank';
            urlLink.rel = 'noopener';
            urlLink.className = 'project-link';
            urlLink.innerHTML = '🔗 ' + (translate('learnMore') || 'Learn More');
            linksContainer.appendChild(urlLink);
        }
        
        card.appendChild(linksContainer);  // Add to card, not content
    }
    
    return card;
}

// Create carousel indicators
function createCarouselIndicators() {
    const indicators = document.createElement('div');
    indicators.className = 'carousel-indicators';
    indicators.id = 'carouselIndicators';
    
    carouselProjects.forEach((project, index) => {
        const indicator = document.createElement('button');
        indicator.className = 'carousel-indicator';
        indicator.dataset.index = index;
        indicator.onclick = () => rotateCarouselToIndex(index);
        indicator.setAttribute('aria-label', `Go to ${project.name}`);
        
        if (index === 0) {
            indicator.classList.add('active');
        }
        
        indicators.appendChild(indicator);
    });
    
    return indicators;
}

// Update carousel positions
function updateCarouselPositions() {
    const cards = document.querySelectorAll('.project-card');
    const totalProjects = carouselProjects.length;
    const currentId = currentCarouselIndex;
    
    // Calculate which IDs should be visible at each position
    const leftId = currentId === 0 ? totalProjects - 1 : currentId - 1;
    const centerId = currentId;
    const rightId = currentId === totalProjects - 1 ? 0 : currentId + 1;
    
    console.log(`Current: ${currentId}, Left: ${leftId}, Center: ${centerId}, Right: ${rightId}`);
    
    // Group cards by project index
    const cardsByProject = {};
    cards.forEach(card => {
        const projectIndex = parseInt(card.getAttribute('data-project-index'));
        if (!cardsByProject[projectIndex]) {
            cardsByProject[projectIndex] = [];
        }
        cardsByProject[projectIndex].push(card);
    });
    
    // Function to get current position of a card
    const getCurrentPosition = (card) => {
        for (let pos of [-2, -1, 0, 1, 2]) {
            if (card.classList.contains(`position-${pos}`)) {
                return pos;
            }
        }
        return null; // card is hidden
    };
    
    // Assign positions, preferring cards already close to target
    const assignPosition = (projectIndex, targetPosition) => {
        const candidateCards = cardsByProject[projectIndex];
        if (!candidateCards || candidateCards.length === 0) return null;
        
        // Find card closest to target position (to minimize jump)
        let bestCard = candidateCards[0];
        let bestDistance = Infinity;
        
        candidateCards.forEach(card => {
            const currentPos = getCurrentPosition(card);
            if (currentPos === null) {
                // Hidden cards are far away
                bestCard = bestCard || card;
            } else {
                const distance = Math.abs(currentPos - targetPosition);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestCard = card;
                }
            }
        });
        
        return bestCard;
    };
    
    // Assign cards to positions
    const leftCard = assignPosition(leftId, -1);
    const centerCard = assignPosition(centerId, 0);
    const rightCard = assignPosition(rightId, 1);
    
    const assignedCards = new Set([leftCard, centerCard, rightCard]);
    
    // Update all cards
    cards.forEach(card => {
        const isDisabled = card.classList.contains('disabled');
        card.className = 'project-card';
        if (isDisabled) {
            card.classList.add('disabled');
        }
        
        if (card === leftCard) {
            card.style.display = '';
            card.classList.add('position--1');
            card.style.setProperty('--position', -1);
        } else if (card === centerCard) {
            card.style.display = '';
            card.classList.add('position-0');
            card.style.setProperty('--position', 0);
        } else if (card === rightCard) {
            card.style.display = '';
            card.classList.add('position-1');
            card.style.setProperty('--position', 1);
        } else {
            card.style.display = 'none';
        }
    });
    
    // Update indicators
    updateCarouselIndicators();
}

// Update indicator states
function updateCarouselIndicators() {
    const indicators = document.querySelectorAll('.carousel-indicator');
    indicators.forEach((indicator, index) => {
        if (index === currentCarouselIndex) {
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
    });
}

// Rotate carousel
// Rotate carousel with direction
// Rotate carousel with direction
function rotateCarousel(direction) {
    if (isAnimating) return;
    
    let newIndex = currentCarouselIndex + direction;
    const totalProjects = carouselProjects.length;
    
    // Wrap with modulo
    newIndex = ((newIndex % totalProjects) + totalProjects) % totalProjects;
    
    rotateCarouselToIndex(newIndex);
}

// Rotate to specific index
function rotateCarouselToIndex(targetIndex) {
    if (isAnimating || targetIndex === currentCarouselIndex) return;
    if (targetIndex < 0 || targetIndex >= carouselProjects.length) return;
    
    isAnimating = true;
    currentCarouselIndex = targetIndex;
    
    // Update positions with smooth transition
    updateCarouselPositions();
    
    // Select the project
    selectProjectByIndex(targetIndex);
    
    // Reset animation lock after transition
    setTimeout(() => {
        isAnimating = false;
    }, 700); // Match CSS transition duration
}

// Select project by index
function selectProjectByIndex(index) {
    if (index < 0 || index >= carouselProjects.length) return;
    
    const project = carouselProjects[index];
    
    // Check if project is enabled
    const isEnabled = project.enabled !== false;
    
    const flashSection = document.getElementById('flashSection');
    
    if (!isEnabled) {
        // Don't select disabled projects
        selectedProject = null;
        
        // Hide flash section for disabled projects
        if (flashSection) {
            flashSection.classList.remove('active');
        }
        
        // No console spam - user sees disabled card, that's enough
        return;
    }
    
    selectedProject = project;
    
    // Show flash section for enabled projects
    if (flashSection) {
        flashSection.classList.add('active');
    }
    
    // Update flash button state
    const flashButton = document.getElementById('flashButton');
    if (flashButton) {
        flashButton.disabled = false;
        flashButton.textContent = translate('flashButton');
    }
    
    // Update project info display
    const projectInfo = document.getElementById('projectInfo');
    const selectedProjectName = document.getElementById('selectedProjectName');
    const selectedProjectDesc = document.getElementById('selectedProjectDesc');
    
    if (selectedProjectName) {
        selectedProjectName.textContent = project.name;
    }
    
    if (selectedProjectDesc) {
        const desc = project.description[currentLang] || project.description.en;
        selectedProjectDesc.textContent = desc;
    }
    
    // Show documentation link if available
    const projectDocLink = document.getElementById('projectDocLink');
    const docLinkButton = document.getElementById('docLinkButton');
    
    if (project.documentation && projectDocLink && docLinkButton) {
        projectDocLink.style.display = 'block';
        docLinkButton.href = project.documentation;
    } else if (projectDocLink) {
        projectDocLink.style.display = 'none';
    }
    
    // Add visual feedback
    addLog(`📦 ${translate('projectSelected') || 'Project selected'}: ${project.name}`, 'info');
}

// Keyboard navigation
function setupCarouselKeyboard() {
    document.addEventListener('keydown', (e) => {
        // Only if not typing in input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
        
        switch(e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                rotateCarousel(-1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                rotateCarousel(1);
                break;
            case 'Home':
                e.preventDefault();
                rotateCarouselToIndex(0);
                break;
            case 'End':
                e.preventDefault();
                rotateCarouselToIndex(carouselProjects.length - 1);
                break;
        }
    });
}

// Touch/Swipe support
function setupCarouselSwipe() {
    const container = document.getElementById('carouselTrack');
    if (!container) return;
    
    let touchStartX = 0;
    let touchEndX = 0;
    
    container.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    
    container.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });
    
    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchStartX - touchEndX;
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swiped left - go to next
                rotateCarousel(1);
            } else {
                // Swiped right - go to previous
                rotateCarousel(-1);
            }
        }
    }
}

// Update carousel on language change
function updateCarouselLanguage() {
    const cards = document.querySelectorAll('.project-card');
    
    cards.forEach((card, index) => {
        const project = carouselProjects[index];
        if (!project) return;
        
        // Update description
        const description = card.querySelector('.project-description');
        if (description && project.description) {
            description.textContent = project.description[currentLang] || project.description.en;
        }
        
        // Update badge (singular, not badges)
        const badge = card.querySelector('.project-badge');
        if (badge && project.badge) {
            badge.textContent = project.badge[currentLang] || project.badge.en;
        }
    });
}
