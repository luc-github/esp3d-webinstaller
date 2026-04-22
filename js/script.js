// Web Installer - ESPLoader.js Version
// Full control over UI/UX, no Shadow DOM, no imposed dialogs
// Version is defined in version.js

let currentLang = 'en';
let config = null;
let pageConfig = null;
let selectedProject = null;
let selectedProjectVersion = null;
let preferredVersionId = null;
let allProjects = [];
let translations = {}; // Will be loaded from lang files
let esploader = null; // ESPLoader instance
let port = null; // Serial port
let monitorPort = null; // Serial port for monitor
let monitorReader = null; // Monitor reader reference
let monitorRunning = false; // Monitor state flag
let firstUserInteractionDone = false; // Track first click for browser check audio
let browserErrorSoundPlayed = false; // Track if browser error sound already played

// Audio queue system to prevent sound overlap
let audioQueue = [];
let isPlayingAudio = false;

// Process audio queue
async function processAudioQueue() {
    if (isPlayingAudio || audioQueue.length === 0) {
        return;
    }
    
    isPlayingAudio = true;
    const { soundPath, volume, event } = audioQueue.shift();
    
    // Log what's playing
    console.log(`🔊 Playing audio: ${event} | Path: ${soundPath} | Volume: ${volume} | Queue remaining: ${audioQueue.length}`);
    
    try {
        const audio = new Audio(soundPath);
        audio.volume = volume;
        
        // Wait for audio to finish playing
        await new Promise((resolve, reject) => {
            audio.onended = () => {
                console.log(`✅ Finished audio: ${event}`);
                resolve();
            };
            audio.onerror = reject;
            audio.play().catch(reject);
        });
    } catch (error) {
        console.log(`❌ Could not play audio for ${event}:`, error);
    }
    
    isPlayingAudio = false;
    
    // Process next sound in queue
    if (audioQueue.length > 0) {
        processAudioQueue();
    }
}

// Unified audio feedback system with verbosity levels
// Plays audio at different stages of the flash process based on verbosity setting
function playAudioFeedback(event) {
    // Check if audio feedback is enabled
    if (!pageConfig?.audio_feedback?.enabled) {
        return;
    }
    
    const verbosity = pageConfig.audio_feedback.verbosity || 'normal';
    const volume = pageConfig.audio_feedback.volume || 0.7;
    const events = pageConfig.audio_feedback.events || {};
    
    // Define verbosity levels - which events play at each level
    const verbosityLevels = {
        minimal: ['start', 'success', 'error'],
        normal: ['start', 'boot_prompt', 'connected', 'erasing', 'flashing_start', 'success', 'error'],
        verbose: ['start', 'dialog_open', 'port_selected', 'boot_prompt', 'connecting', 'connected', 
                  'erasing', 'erase_complete', 'flashing_start', 'flashing_progress', 
                  'writing_complete', 'rebooting', 'success', 'error']
    };
    
    // Check if this event should play at current verbosity level
    const allowedEvents = verbosityLevels[verbosity] || verbosityLevels.normal;
    if (!allowedEvents.includes(event) && !event.startsWith('error_')) {
        return;
    }
    
    // Get sound path for this event
    let soundPath = events[event];
    
    // If event is an error category, check for specific error sound
    if (event.startsWith('error_')) {
        const category = event.replace('error_', '');
        soundPath = events[`error_${category}`] || events.error || 'sounds/error.mp3';
    }
    
    // Trim whitespace and check if sound path is valid
    if (soundPath && typeof soundPath === 'string') {
        soundPath = soundPath.trim();
    }
    
    // If no sound configured or empty string, skip
    if (!soundPath || soundPath === "") {
        return;
    }
    
    // Replace [lang] placeholder with current language code
    if (soundPath.includes('[lang]')) {
        const langCode = currentLang || 'en'; // Fallback to 'en' if not set
        soundPath = soundPath.split('[lang]').join(langCode); // Simple string replacement
        console.log(`Audio path resolved: ${soundPath} (language: ${langCode})`);
    }
    
    // Add to queue instead of playing immediately
    audioQueue.push({ soundPath, volume, event });
    processAudioQueue();
}

// Legacy function wrappers for backward compatibility
function playCongratulationsSound() {
    playAudioFeedback('success');
}

function playStartSound() {
    playAudioFeedback('start');
}

function playErrorSound(errorMessage) {
    const category = categorizeError(errorMessage);
    playAudioFeedback(`error_${category}`);
}

function getSelectedFlashBaudrate() {
    const flashBaudrateSelect = document.getElementById('flashBaudrateSelect');
    const selected = flashBaudrateSelect ? parseInt(flashBaudrateSelect.value, 10) : NaN;
    return Number.isFinite(selected) && selected > 0 ? selected : 921600;
}

function initFlashBaudrateSelector() {
    const flashBaudrateSelect = document.getElementById('flashBaudrateSelect');
    if (!flashBaudrateSelect) return;

    const savedBaudrate = localStorage.getItem('flashBaudrate');
    if (savedBaudrate && Array.from(flashBaudrateSelect.options).some(opt => opt.value === savedBaudrate)) {
        flashBaudrateSelect.value = savedBaudrate;
    }

    flashBaudrateSelect.addEventListener('change', () => {
        localStorage.setItem('flashBaudrate', flashBaudrateSelect.value);
    });
}

function isVersionSelectorEnabled() {
    return pageConfig?.firmware_versions?.enabled !== false;
}

function getProjectVersions(project) {
    if (!project || !Array.isArray(project.versions)) return [];
    return project.versions.filter(v => v && v.enabled !== false);
}

function getVersionById(project, versionId) {
    if (!versionId) return null;
    const versions = getProjectVersions(project);
    return versions.find((v, idx) => (v.id || v.version || `v${idx}`) === versionId) || null;
}

function getActiveProjectVersion(project) {
    const versions = getProjectVersions(project);
    if (versions.length === 0) return null;
    return versions.find(v => v.active === true) || versions[0];
}

function getCurrentProjectVersion(project) {
    if (project && selectedProject === project && selectedProjectVersion) {
        return selectedProjectVersion;
    }
    const globalPreferred = getVersionById(project, preferredVersionId);
    if (globalPreferred) return globalPreferred;

    return getActiveProjectVersion(project);
}

function getProjectDisplayVersion(project) {
    const currentVersion = getCurrentProjectVersion(project);
    if (currentVersion?.version) return currentVersion.version;
    const activeVersion = getActiveProjectVersion(project);
    if (activeVersion?.version) return activeVersion.version;
    return project?.version || '';
}

function getProjectReleaseNotes(project) {
    const currentVersion = getCurrentProjectVersion(project);
    if (currentVersion?.releaseNotes) return currentVersion.releaseNotes;
    const activeVersion = getActiveProjectVersion(project);
    if (activeVersion?.releaseNotes) return activeVersion.releaseNotes;
    return project?.releaseNotes || '';
}

function getProjectDownloadFirmware(project) {
    const currentVersion = getCurrentProjectVersion(project);
    if (currentVersion?.downloadFirmware) {
        return currentVersion.downloadFirmware;
    }
    const root = currentVersion?.firmware?.root;
    if (root) {
        return `firmware/${root}/esp3dfw.bin`;
    }
    return project?.downloadFirmware || '';
}

function inferLegacyVersionId(projectId) {
    const legacyMap = {
        btpendantfluidnc8bt: '2.0.0a12',
        btpendantfluidnc8wifi: '2.0.0a12',
        btpendantfluidnc4bt: '2.0.0a12',
        btpendantfluidnc4wifi: '2.0.0a12'
    };
    return legacyMap[projectId] || null;
}

function resolveVersionCounts(project, projectCounts, currentVersion) {
    if (!projectCounts) return null;
    const versionsMap = projectCounts.versions;
    if (!versionsMap || typeof versionsMap !== 'object') {
        return null;
    }

    const candidateIds = [
        currentVersion?.id || null,
        currentVersion?.version || null
    ].filter(Boolean);

    for (const id of candidateIds) {
        if (versionsMap[id]) {
            console.log(`[FlashCounts] ${project?.id}: matched versions key "${id}"`);
            return versionsMap[id];
        }
    }

    const byVersionField = Object.values(versionsMap).find(v => v?.version && candidateIds.includes(v.version));
    if (byVersionField) {
        console.log(`[FlashCounts] ${project?.id}: matched by inner version field`);
        return byVersionField;
    }

    console.log(`[FlashCounts] ${project?.id}: no version match for candidates`, candidateIds);
    return null;
}

function buildVersionBadgeElement(project) {
    const displayVersion = getProjectDisplayVersion(project);
    const releaseNotes = getProjectReleaseNotes(project);
    if (!displayVersion) return null;

    if (releaseNotes) {
        const versionLink = document.createElement('a');
        versionLink.className = 'project-version project-version-link';
        versionLink.href = releaseNotes;
        versionLink.target = '_blank';
        versionLink.rel = 'noopener';
        versionLink.title = translate('whatsNew') || "What's New";
        versionLink.innerHTML = `<span class="version-text">Version: ${displayVersion}</span><span class="version-icon">📋</span>`;
        return versionLink;
    }

    const version = document.createElement('span');
    version.className = 'project-version';
    version.textContent = `Version: ${displayVersion}`;
    return version;
}

function refreshProjectVersionInCarousel(projectIndex) {
    if (projectIndex < 0 || projectIndex >= carouselProjects.length) return;
    const project = carouselProjects[projectIndex];
    const cards = document.querySelectorAll(`.project-card[data-project-index="${projectIndex}"]`);

    cards.forEach(card => {
        const badgesContainer = card.querySelector('.project-badges-row');
        if (!badgesContainer) return;

        const currentVersionEl = badgesContainer.querySelector('.project-version');
        if (currentVersionEl) {
            currentVersionEl.remove();
        }

        const versionEl = buildVersionBadgeElement(project);
        if (versionEl) {
            badgesContainer.appendChild(versionEl);
        }

        const downloadLink = card.querySelector('.firmware-download-link');
        if (downloadLink) {
            const downloadHref = getProjectDownloadFirmware(project);
            if (downloadHref) {
                downloadLink.href = downloadHref;
                downloadLink.style.display = '';
            } else {
                downloadLink.style.display = 'none';
            }
        }
    });
}

function updateSelectedProjectInfo(project) {
    if (!project) return;

    const nameEl = document.getElementById('selectedProjectName');
    const versionEl = document.getElementById('selectedProjectVersion');
    const descEl = document.getElementById('selectedProjectDesc');

    if (nameEl) {
        nameEl.textContent = project.name;
    }

    const selectedVersionText = getProjectDisplayVersion(project);
    if (versionEl) {
        versionEl.textContent = selectedVersionText ? `${translate('version')}: ${selectedVersionText}` : '';
    }

    if (descEl) {
        const description = project.description[currentLang] || project.description.en;
        descEl.textContent = description;
    }

}

function applyProjectVersionDefaults() {
    if (!config?.projects || !Array.isArray(config.projects)) return;
    config.projects.forEach(project => {
        const activeVersion = getActiveProjectVersion(project);
        if (!activeVersion) return;
        if (!project.version && activeVersion.version) {
            project.version = activeVersion.version;
        }
        if (!project.releaseNotes && activeVersion.releaseNotes) {
            project.releaseNotes = activeVersion.releaseNotes;
        }
        if (!project.firmware && activeVersion.firmware) {
            project.firmware = activeVersion.firmware;
        }
    });
}

function collectAvailableVersionOptions(projects) {
    const map = new Map();
    (projects || []).forEach(project => {
        getProjectVersions(project).forEach((versionItem, index) => {
            const optionId = versionItem.id || versionItem.version || `v${index}`;
            if (!map.has(optionId)) {
                map.set(optionId, {
                    id: optionId,
                    label: versionItem.label || versionItem.version || optionId
                });
            }
        });
    });
    return Array.from(map.values());
}

function getDefaultCatalogVersionId(projects, options) {
    const activeCounts = {};
    (projects || []).forEach(project => {
        const activeVersion = getActiveProjectVersion(project);
        const activeId = activeVersion ? (activeVersion.id || activeVersion.version) : null;
        if (!activeId) return;
        activeCounts[activeId] = (activeCounts[activeId] || 0) + 1;
    });

    let bestId = null;
    let bestCount = -1;
    Object.entries(activeCounts).forEach(([id, count]) => {
        if (count > bestCount) {
            bestId = id;
            bestCount = count;
        }
    });

    if (bestId && options.some(o => o.id === bestId)) {
        return bestId;
    }
    return options.length > 0 ? options[0].id : null;
}

function projectSupportsVersion(project, versionId) {
    if (!versionId) return true;
    const versions = getProjectVersions(project);
    if (versions.length === 0) return true;
    return !!getVersionById(project, versionId);
}

function updateFirmwareVersionSelector() {
    const wrapper = document.getElementById('firmwareVersionOption');
    const select = document.getElementById('firmwareVersionSelect');
    if (!wrapper || !select) return;

    const options = collectAvailableVersionOptions(allProjects);
    if (!isVersionSelectorEnabled() || options.length < 2) {
        wrapper.style.display = 'none';
        preferredVersionId = null;
        select.innerHTML = '';
        return;
    }

    wrapper.style.display = 'flex';
    select.innerHTML = '';

    options.forEach(versionItem => {
        const option = document.createElement('option');
        option.value = versionItem.id;
        option.textContent = versionItem.label;
        select.appendChild(option);
    });

    const validPreferred = options.some(o => o.id === preferredVersionId);
    const selectedOptionId = validPreferred
        ? preferredVersionId
        : getDefaultCatalogVersionId(allProjects, options);
    preferredVersionId = selectedOptionId;
    select.value = selectedOptionId;

    select.onchange = () => {
        preferredVersionId = select.value || null;
        initCarousel();
        loadFlashCounts();
        addLog(`🔁 Firmware version selected: ${preferredVersionId}`, 'info');
    };
}

// Flash event logging to server
// Called ONLY at the very end of flash process (after reset + port close)
// Only works when analytics is enabled (requires PHP backend)
async function logFlashEvent(projectId, projectName, action, success, errorMsg = null, errorCategory = null) {
    // Skip logging if analytics disabled
    if (!pageConfig?.analytics) {
        return;
    }
    
    try {
        const logData = {
            projectId: projectId,
            projectName: projectName,
            action: action,
            success: success,
            timestamp: new Date().toISOString()
        };
        if (selectedProjectVersion) {
            logData.projectVersionId = selectedProjectVersion.id || selectedProjectVersion.version || null;
            logData.projectVersion = selectedProjectVersion.version || selectedProjectVersion.id || null;
        }
        
        if (errorMsg) {
            const category = errorCategory || categorizeError(errorMsg);
            
            // Check if this error category should be logged
            const errorLogging = pageConfig?.error_logging;
            if (errorLogging?.enabled !== false) {
                // If error_logging.categories exists, check if this category is enabled
                if (errorLogging?.categories && errorLogging.categories[category] === false) {
                    console.log(`Skipping error logging for category "${category}" (disabled in config)`);
                    return;
                }
            }
            
            logData.error = errorMsg;
            logData.errorCategory = category;
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
        'browser_check',
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
        let counts = null;

        // Preferred path: PHP endpoint (when backend is available)
        try {
            const response = await fetch('get-flash-counts.php');
            if (response.ok) {
                counts = await response.json();
                console.log('[FlashCounts] loaded from get-flash-counts.php');
            } else {
                console.warn(`[FlashCounts] get-flash-counts.php returned ${response.status}, trying flash-counts.json`);
            }
        } catch (endpointError) {
            console.warn('[FlashCounts] get-flash-counts.php unavailable, trying flash-counts.json', endpointError);
        }

        // Fallback path: direct JSON file (static hosting / no PHP)
        if (!counts) {
            const response = await fetch('flash-counts.json');
            if (!response.ok) {
                console.warn(`[FlashCounts] flash-counts.json returned ${response.status}`);
                return;
            }
            counts = await response.json();
            console.log('[FlashCounts] loaded from flash-counts.json');
        }
        console.log('[FlashCounts] counts payload loaded:', counts);
        
        // Update each card with flash count badge
        const cards = document.querySelectorAll('.project-card');
        cards.forEach(card => {
            const projectIndex = parseInt(card.dataset.index);
            if (projectIndex >= 0 && projectIndex < carouselProjects.length) {
                const project = carouselProjects[projectIndex];
                const projectCounts = counts[project.id];
                const currentVersion = getCurrentProjectVersion(project);
                const versionCounts = resolveVersionCounts(project, projectCounts, currentVersion);
                let successCount = versionCounts?.success ?? 0;

                // Legacy fallback: historical totals before versioning belong to a12
                const legacyVersionId = inferLegacyVersionId(project.id);
                const currentVersionId = currentVersion ? (currentVersion.id || currentVersion.version) : null;
                if (!versionCounts && legacyVersionId && currentVersionId === legacyVersionId) {
                    successCount = projectCounts?.success ?? 0;
                    console.log(`[FlashCounts] ${project.id}: using legacy fallback for ${legacyVersionId}, success=${successCount}`);
                }

                console.log(`[FlashCounts] ${project.id}: currentVersion=${currentVersionId || 'none'}, success=${successCount}, hasProjectCounts=${!!projectCounts}`);
                
                if (projectCounts && successCount > 0) {
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
                        <span>${successCount.toLocaleString()}</span>
                    `;
                    const versionLabel = currentVersion?.version ? ` (${currentVersion.version})` : '';
                    flashBadge.title = `${successCount} successful flashes${versionLabel}`;
                    console.log(`[FlashCounts] ${project.id}: badge shown with success=${successCount}${versionLabel}`);
                } else {
                    const flashBadge = card.querySelector('.flash-count-badge');
                    if (flashBadge) {
                        flashBadge.remove();
                        console.log(`[FlashCounts] ${project.id}: badge removed (success=${successCount})`);
                    }
                }
            }
        });
    } catch (error) {
        console.warn('Could not load flash counts:', error);
        console.warn('[FlashCounts] loadFlashCounts failed:', error);
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
        
        // Insert button above firmware version selector (or before language selector fallback)
        const firmwareVersionSelector = actionsContainer.querySelector('#firmwareVersionOption');
        const languageSelector = actionsContainer.querySelector('.language-selector');
        if (firmwareVersionSelector) {
            actionsContainer.insertBefore(githubBtn, firmwareVersionSelector);
        } else if (languageSelector) {
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
    
    const footer = document.getElementById('footer');
    const footerText = document.getElementById('footerText');
    const footerLinks = document.getElementById('footerLinks');
    
    // Show footer if configured
    if (pageConfig.footer.enabled) {
        footer.style.display = 'block';
    }
    
    // Create footer content with version
    const versionSpan = document.createElement('span');
    versionSpan.id = 'version-info';
    versionSpan.className = 'version-info';
    versionSpan.textContent = 'Loading...';
    
    // Footer text with version - use translation
    footerText.innerHTML = '';
    footerText.appendChild(versionSpan);
    
    const separator1 = document.createElement('span');
    separator1.className = 'footer-separator';
    separator1.textContent = ' • ';
    footerText.appendChild(separator1);
    
    const copyrightSpan = document.createElement('span');
    copyrightSpan.textContent = translate('footerCopyright');
    footerText.appendChild(copyrightSpan);
    
    // Footer links - use translations with keys
    footerLinks.innerHTML = '';
    if (pageConfig.footer.links && pageConfig.footer.links.length > 0) {
        pageConfig.footer.links.forEach((link, index) => {
            if (index > 0) {
                const sep = document.createElement('span');
                sep.className = 'footer-separator';
                sep.textContent = ' • ';
                footerLinks.appendChild(sep);
            }
            
            const a = document.createElement('a');
            a.href = link.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = translate(link.key);
            footerLinks.appendChild(a);
        });
    }
    
    // Update version info after creating the element
    updateFooterVersion();
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
        if (!response.ok) throw new Error('config.json: ' + response.status);
        config = await response.json();
        if (!config || !config.projects || !Array.isArray(config.projects)) {
            throw new Error('config.json: invalid format (missing projects array)');
        }
        applyProjectVersionDefaults();
        allProjects = config.projects;
        updateFirmwareVersionSelector();
        initCarousel();
        addLog(translate('configLoaded'), 'success');
    } catch (error) {
        console.error('Failed to load config:', error);
        addLog('Failed to load configuration', 'error');
        const container = document.getElementById('projectCards');
        if (container) {
            container.innerHTML = '<p class="alert alert-error">Could not load config.json. Use <strong>http://localhost:8181/</strong> (not file://).</p>';
        }
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
        if (project.icon_left || project.icon) {
            const iconSrc = project.icon_left || project.icon;
            iconHtml = `<img src="${iconSrc}" alt="${project.name || ''}" class="project-icon" onerror="this.style.display='none'">`;
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
    
    // Check browser compatibility FIRST - if not supported, don't allow selection
    if (!navigator.serial) {
        // Play error sound on first click
        if (!firstUserInteractionDone) {
            firstUserInteractionDone = true;
            console.log('%c⚠️ Browser not supported - Web Serial API not available', 'color: #ff5555; font-weight: bold;');
            playAudioFeedback('error_wrong_browser');
        }
        
        // Show warning in console but don't select project
        const consoleContainer = document.getElementById('consoleContainer');
        consoleContainer.innerHTML = '';
        addLog('⚠️ Browser not supported. Please use Chrome, Edge, or Opera.', 'error');
        addLog('Web Serial API is required for flashing ESP32 devices.', 'warning');
        
        // Hide flash section
        document.getElementById('flashSection').classList.remove('active');
        document.getElementById('flashInstruction').classList.remove('active');
        
        return; // Don't proceed with project selection
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
    updateSelectedProjectInfo(project);
    
    // Update instruction text with actual project name
    const instructionText2 = translate('instructionText2').replace('[project name]', project.name);
    document.getElementById('instructionText2').innerHTML = instructionText2;
    
    // Clear and reset console
    const consoleContainer = document.getElementById('consoleContainer');
    consoleContainer.innerHTML = '';
    addLog(`Project selected: ${project.name}`, 'info');
    addLog('Ready to flash. Click "Connect & Flash" when ready.', 'warning');
}

// ===== ESPLoader.js Flash Functions =====

// Main flash function - called when user clicks flash button
async function startFlash() {
    if (!selectedProject) {
        alert(translate('errorNoProjectSelected'));
        return;
    }
    
    // Prevent flashing while monitor is running
    if (monitorRunning) {
        addLog('⚠️ Stop the serial monitor before flashing', 'warning');
        return;
    }
    
    // Auto-expand console if collapsed (needed for browser port dialog interaction)
    if (consoleCollapsed) {
        toggleConsole();
    }
    
    // Hide flash button and hide monitor button during process
    const flashBtn = document.getElementById('flashButton');
    const monitorBtn = document.getElementById('monitorButton');
    flashBtn.style.display = 'none';
    if (monitorBtn) monitorBtn.style.display = 'none';
    
    // Play start sound
    playStartSound();
    
    try {
        await flashESP32();
        flashBtn.style.display = 'block';
    } catch (error) {
        flashBtn.style.display = 'block';
    } finally {
        if (monitorBtn) monitorBtn.style.display = 'block';
    }
}

// ESPLoader.js flash implementation
async function flashESP32() {
    // Show progress bar
    showProgress();
    updateProgress(0, 'Preparing...', 'Ready to start');
    
    addLog('🔌 Requesting serial port access...', 'info');
    addLog('⚠️ Browser will ask you to select a COM port', 'warning');
    
    // Audio: Dialog opening
    playAudioFeedback('dialog_open');
    
    let transport = null;
    
    try {
        // Step 1: Request port from user (NO modal yet - let user select port first)
        currentStage = 'connecting';
        port = await navigator.serial.requestPort();
        addLog('✅ Port selected', 'success');
        updateProgress(5, 'Port selected', 'Connecting to ESP32...');
        
        // Audio: Port selected
        playAudioFeedback('port_selected');
        
        // Check if no_reset mode is selected (device already in download mode)
        const noResetCheckbox = document.getElementById('noResetCheckbox');
        const noResetMode = noResetCheckbox && noResetCheckbox.checked;
        
        if (noResetMode) {
            // No reset mode: show instructions modal and wait for user to confirm
            addLog('🔧 No Reset mode selected', 'info');
            await showNoResetModal();
            addLog('🔧 User confirmed device is in download mode', 'info');
        } else {
            // Normal mode: show BOOT modal - user needs to hold BOOT for connection
            showBootModal();
            
            // Audio: Boot button prompt
            playAudioFeedback('boot_prompt');
        }
        
        // Step 2: Create transport (don't open port yet - ESPLoader will do it)
        transport = new esptooljs.Transport(port);
        
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
        
        const flashBaudrate = getSelectedFlashBaudrate();
        addLog(`⚙️ Flash baudrate: ${flashBaudrate}`, 'info');

        // Step 4: Create ESPLoader
        // IMPORTANT: ESPLoader will open the port automatically
        esploader = new esptooljs.ESPLoader({
            transport: transport,
            baudrate: flashBaudrate,
            terminal: terminal,
            romBaudrate: 115200,
            debugLogging: false
        });
        
        // Resolve firmware options from config (supports legacy + new format)
        const firmwareConfig = resolveFirmwareConfig(selectedProject);
        const firmwareMeta = firmwareConfig.meta || {};

        // Step 5: Connect to chip
        const connectMode = noResetMode ? "no_reset" : (firmwareMeta.before || "default_reset");
        addLog('🔌 Connecting to ESP32...', 'info');
        if (noResetMode) {
            addLog('🔧 No Reset: hold BOOT + press RESET before clicking flash, then release BOOT', 'warning');
        } else {
            addLog('⚠️ HOLD the BOOT button NOW until you see "Connected"!', 'warning');
        }
        updateProgress(10, 'Connecting...', noResetMode ? 'No Reset mode' : 'Hold BOOT button now!');
        
        // Audio: Connecting
        playAudioFeedback('connecting');
        
        const chip = await esploader.main(connectMode);
        if (firmwareMeta.chip && !String(chip).toLowerCase().includes(String(firmwareMeta.chip).toLowerCase())) {
            addLog(`⚠️ Config chip "${firmwareMeta.chip}" does not match detected "${chip}"`, 'warning');
        }
        
        // Close modal on successful connection
        closeBootModal();
        
        addLog(`✅ Connected to ${chip}!`, 'success');
        addLog('👍 You can release the BOOT button now', 'success');
        updateProgress(15, 'Connected!', 'ESP32 detected successfully');
        
        // Audio: Connected successfully
        playAudioFeedback('connected');
        
        // Step 6: Prepare firmware files
        currentStage = 'downloading';
        addLog('📥 Preparing firmware files...', 'info');
        updateProgress(15, 'Downloading...', 'Fetching firmware files');
        
        const fileArray = await prepareFirmwareFiles(selectedProject);
        
        // Diagnostic: log details for each file before flashing
        addLog(`📋 ${fileArray.length} file(s) ready to flash:`, 'info');
        for (let i = 0; i < fileArray.length; i++) {
            const f = fileArray[i];
            addLog(`  [${i}] ${f.path} | addr=0x${f.address.toString(16)} | size=${f.data.length} bytes`, 'info');
        }
        
        // Validate partition table file integrity (magic bytes 0xAA 0x50)
        const partFile = fileArray.find(f => f.path && f.path.toLowerCase().includes('partition'));
        if (partFile) {
            const magic1 = partFile.data.charCodeAt(0);
            const magic2 = partFile.data.charCodeAt(1);
            addLog(`🔍 Partition table check: size=${partFile.data.length}, magic=0x${magic1.toString(16).padStart(2,'0')} 0x${magic2.toString(16).padStart(2,'0')}`, 'info');
            if (magic1 !== 0xAA || magic2 !== 0x50) {
                addLog('⚠️ WARNING: Partition table magic bytes invalid! Expected 0xAA 0x50', 'error');
            } else {
                addLog('✅ Partition table magic bytes OK', 'success');
            }
        } else {
            addLog('⚠️ WARNING: No partition table file found in firmware list!', 'error');
        }
        
        updateProgress(20, 'Ready to flash', 'All files downloaded');
        
        // Step 7: Flash firmware
        currentStage = 'erasing';
        addLog('🔄 Starting flash process...', 'info');
        addLog('🗑️ Erasing flash memory...', 'info');
        updateProgress(20, 'Erasing flash...', 'This may take a few seconds');
        
        // Audio: Erasing flash
        playAudioFeedback('erasing');
        
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
        
        let flashingStartAudioPlayed = false;  // Flag to play audio only once
        let eraseCompleteAudioPlayed = false;  // Flag for erase complete audio
        let lastProgressMilestone = -1;  // Track last milestone played (-1 = none, 0 = 25%, 1 = 50%, 2 = 75%)
        
        // Diagnostic: track erase timing and per-file write status
        const eraseStartTime = Date.now();
        let firstWriteTime = null;
        let lastFileIndex = -1;  // Track file transitions during write
        
        addLog(`⏱️ writeFlash() starting at ${new Date().toLocaleTimeString()} (eraseAll=${eraseAll})`, 'info');
        
        try {
            await esploader.writeFlash({
                fileArray: fileArray,
                flashSize: "keep",
                flashMode: firmwareMeta.flash_mode || "keep",
                flashFreq: firmwareMeta.flash_freq || "keep",
                eraseAll: eraseAll,  // Use checkbox value
                compress: true,
                reportProgress: (fileIndex, written, total) => {
                    const percent = Math.floor((written / total) * 100);
                    
                    // Diagnostic: measure time between erase start and first actual write
                    if (!firstWriteTime && written > 0) {
                        firstWriteTime = Date.now();
                        const eraseDuration = ((firstWriteTime - eraseStartTime) / 1000).toFixed(1);
                        addLog(`⏱️ Erase→first write: ${eraseDuration}s (eraseAll=${eraseAll})`, 'info');
                    }
                    
                    // Diagnostic: log when a new file starts being written
                    if (fileIndex !== lastFileIndex) {
                        if (lastFileIndex >= 0) {
                            const prevFile = fileArray[lastFileIndex];
                            addLog(`✅ File [${lastFileIndex}] ${prevFile.path} write completed`, 'success');
                        }
                        const curFile = fileArray[fileIndex];
                        addLog(`📝 File [${fileIndex}] starting: ${curFile.path} (${curFile.data.length} bytes at 0x${curFile.address.toString(16)})`, 'info');
                        lastFileIndex = fileIndex;
                    }
                    
                    // Audio: Erase complete (only once, when writing actually starts)
                    if (!eraseCompleteAudioPlayed && fileIndex === 0 && written > 0) {
                        playAudioFeedback('erase_complete');
                        eraseCompleteAudioPlayed = true;
                    }
                    
                    // Audio: Flashing start (right after erase complete)
                    if (!flashingStartAudioPlayed && fileIndex === 0 && written > 0) {
                        playAudioFeedback('flashing_start');
                        flashingStartAudioPlayed = true;
                    }
                    
                    // Update global progress
                    writtenBytes = fileArray.slice(0, fileIndex).reduce((sum, f) => sum + f.data.length, 0) + written;
                    const globalPercent = calculateGlobalProgress();
                    updateProgress(globalPercent, 'Writing firmware...', `File ${fileIndex + 1}/${fileArray.length} - ${percent}%`);
                    
                    // Audio: Progress milestones based on GLOBAL progress (25%, 50%, 75%)
                    // Only play each milestone once
                    if (globalPercent >= 75 && lastProgressMilestone < 2) {
                        lastProgressMilestone = 2;
                        playAudioFeedback('flashing_progress');
                    } else if (globalPercent >= 50 && lastProgressMilestone < 1) {
                        lastProgressMilestone = 1;
                        playAudioFeedback('flashing_progress');
                    } else if (globalPercent >= 25 && lastProgressMilestone < 0) {
                        lastProgressMilestone = 0;
                        playAudioFeedback('flashing_progress');
                    }
                    
                    // Only log every 10%
                    if (percent % 10 === 0 && written > 0) {
                        const fileName = fileArray[fileIndex].path || `file ${fileIndex}`;
                        addLog(`📝 Writing ${fileName}... ${percent}%`, 'info');
                    }
                }
            });
        } catch (flashError) {
            // Diagnostic: detailed error with progress context
            const elapsed = ((Date.now() - eraseStartTime) / 1000).toFixed(1);
            addLog(`❌ writeFlash() FAILED after ${elapsed}s`, 'error');
            addLog(`📊 Progress at failure: ${writtenBytes}/${totalBytes} bytes (${lastFileIndex >= 0 ? fileArray[lastFileIndex].path : 'before first write'})`, 'error');
            if (!firstWriteTime) {
                addLog(`⚠️ Failure occurred DURING ERASE (no write started yet)`, 'error');
            }
            throw flashError;  // Re-throw to hit the outer catch
        }
        
        // Diagnostic: log last file completion and summary
        if (lastFileIndex >= 0) {
            const lastFile = fileArray[lastFileIndex];
            addLog(`✅ File [${lastFileIndex}] ${lastFile.path} write completed`, 'success');
        }
        const totalDuration = ((Date.now() - eraseStartTime) / 1000).toFixed(1);
        addLog(`📊 writeFlash() completed: ${fileArray.length} files, ${totalBytes} bytes in ${totalDuration}s`, 'success');
        
        currentStage = 'done';
        updateProgress(100, 'Flash complete!', 'Firmware written successfully');
        
        // Audio: Writing complete
        playAudioFeedback('writing_complete');
        
        addLog('🎉 Flash completed successfully!', 'success');
        
        addLog('🔄 Rebooting ESP32...', 'success');
        
        // Audio: Rebooting (BEFORE success sound so order is correct in queue)
        playAudioFeedback('rebooting');
        
        // Step 8: Hard reset - force RTS toggle to reboot the chip
        // In no_reset mode, esploader.after() may not reset properly,
        // so we also do a manual RTS toggle via the transport
        try {
            await esploader.after(firmwareMeta.after || "hard_reset");
        } catch (e) {
            // Fallback: manual RTS toggle for hard reset
        }
        try {
            await transport.setRTS(true);
            await new Promise(r => setTimeout(r, 100));
            await transport.setRTS(false);
        } catch (e) {
            // RTS toggle failed - user will need to manually reset
        }
        
        addLog('✅ Your device is ready to use!', 'success');
        
        // Play congratulations sound (AFTER reboot is done)
        playCongratulationsSound();
        addLog('👉 You can disconnect the USB cable', 'info');
        
        // Step 9: Cleanup - disconnect transport first to release reader/writer locks
        try {
            await transport.disconnect();
        } catch (e) {
            // Transport may already be disconnected
        }
        try {
            await port.close();
        } catch (e) {
            // Port may already be closed by transport.disconnect()
        }
        port = null;
        addLog('✓ Serial port closed', 'info');
        
        // Log flash success ONLY at the very end (after everything complete)
        logFlashEvent(selectedProject.id, selectedProject.name, 'flash', true);
        
    } catch (error) {
        // Close modals on error
        closeBootModal();
        confirmNoResetReady();
        
        addLog(`❌ Error: ${error.message}`, 'error');
        console.error('Flash error:', error);
        
        // Play error sound with category
        playErrorSound(error.message);
        
        // Log flash failure to server
        logFlashEvent(
            selectedProject ? selectedProject.id : 'unknown',
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
            if (typeof transport !== 'undefined' && transport) {
                await transport.disconnect();
            }
        } catch (e) {
            // Transport cleanup failed, try direct port close
        }
        try {
            if (port) {
                await port.close();
            }
        } catch (e) {
            // Port may already be closed
        }
        port = null;
        
        throw error;
    }
}

// Prepare firmware files for flashing
async function prepareFirmwareFiles(project) {
    const baseUrl = window.location.origin + 
                   window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
    
    const fileArray = [];
    
    // Determine if single or multi-file (supports legacy + new format)
    const firmwareConfig = resolveFirmwareConfig(project);
    const firmwareList = firmwareConfig.files;
    
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

// Normalize firmware config across supported formats:
// - Legacy string: "firmware.bin"
// - Legacy array: [{ path, offset }]
// - New object: { meta, root, files: [{ file|path, offset }] }
function resolveFirmwareConfig(project) {
    const selectedVersion = getCurrentProjectVersion(project);
    const firmware = selectedVersion?.firmware || project?.firmware;

    // New format
    if (firmware && typeof firmware === 'object' && !Array.isArray(firmware) && Array.isArray(firmware.files)) {
        const rootRaw = typeof firmware.root === 'string' ? firmware.root.trim() : '';
        const root = rootRaw.replace(/\/+$/, '');
        const files = firmware.files.map(entry => {
            const fileName = (entry.file || entry.path || '').replace(/^\/+/, '');
            const path = root ? `${root}/${fileName}` : fileName;
            return {
                path: path,
                offset: entry.offset || '0x0'
            };
        });

        return {
            meta: firmware.meta || {},
            files: files
        };
    }

    // Legacy array
    if (Array.isArray(firmware)) {
        return { meta: {}, files: firmware };
    }

    // Legacy single file
    return { meta: {}, files: [{ path: firmware, offset: '0x0' }] };
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
    if (bootModalText) bootModalText.innerHTML = translate('bootModalText');
    if (bootModalButton) bootModalButton.textContent = translate('bootModalButton');
    
    // Update no reset modal texts
    const noResetModalTitle = document.getElementById('noResetModalTitle');
    const noResetModalText = document.getElementById('noResetModalText');
    const noResetModalButton = document.getElementById('noResetModalButton');
    if (noResetModalTitle) noResetModalTitle.textContent = translate('noResetModalTitle');
    if (noResetModalText) noResetModalText.innerHTML = translate('noResetModalText');
    if (noResetModalButton) noResetModalButton.textContent = translate('noResetModalButton');
    
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

    // Update flash baudrate option texts
    const flashBaudrateLabel = document.getElementById('flashBaudrateLabel');
    const flashBaudrateHint = document.getElementById('flashBaudrateHint');
    if (flashBaudrateLabel) flashBaudrateLabel.textContent = translate('flashBaudrateLabel');
    if (flashBaudrateHint) flashBaudrateHint.textContent = translate('flashBaudrateHint');

    // Update firmware version selector texts
    const firmwareVersionLabel = document.getElementById('firmwareVersionLabel');
    const firmwareVersionHint = document.getElementById('firmwareVersionHint');
    if (firmwareVersionLabel) firmwareVersionLabel.textContent = translate('firmwareVersionLabel');
    if (firmwareVersionHint) firmwareVersionHint.textContent = translate('firmwareVersionHint');
    
    // Update no reset option texts
    const noResetLabel = document.getElementById('noResetLabel');
    const noResetHint = document.getElementById('noResetHint');
    if (noResetLabel) noResetLabel.textContent = translate('noResetLabel');
    if (noResetHint) noResetHint.textContent = translate('noResetHint');
    
    // Update monitor button text (only if not actively monitoring)
    if (!monitorRunning) {
        const monitorButton = document.getElementById('monitorButton');
        if (monitorButton) monitorButton.textContent = translate('monitorButton');
    }
    
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
        updateSelectedProjectInfo(selectedProject);
        updateFirmwareVersionSelector();
        
        // Update instruction with project name (if element exists)
        const instructionText2El = document.getElementById('instructionText2');
        if (instructionText2El) {
            const instructionText2 = translate('instructionText2').replace('[project name]', selectedProject.name);
            instructionText2El.innerHTML = instructionText2;
        }
    }
}

// Setup language selector based on config
function setupLanguageSelector(languages) {
    const languageSelect = document.getElementById('languageSelect');
    const languageSelectorDiv = document.querySelector('.language-selector');
    
    if (!languageSelect || !languageSelectorDiv) {
        return;
    }
    
    // If only one language, hide the selector completely
    if (languages.length <= 1) {
        languageSelectorDiv.style.display = 'none';
        return;
    }
    
    // Clear existing options
    languageSelect.innerHTML = '';
    
    // Add options from config
    languages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.code;
        option.textContent = lang.name;
        languageSelect.appendChild(option);
    });
    
    // Set selected value
    languageSelect.value = currentLang;
    
    // Show the selector
    languageSelectorDiv.style.display = 'block';
}

// Initialize
async function initialize() {
    // Load page configuration first
    await loadPageConfig();
    
    // Load languages from config
    const languages = pageConfig?.languages || [
        { code: 'en', name: 'English', default: true }
    ];
    
    // Load all configured language files
    for (const lang of languages) {
        await loadTranslations(lang.code);
    }
    
    // Set initial language (from localStorage or default from config)
    const defaultLang = languages.find(l => l.default)?.code || languages[0].code;
    const savedLang = localStorage.getItem('language') || defaultLang;
    currentLang = savedLang;
    
    // Setup language selector
    setupLanguageSelector(languages);
    initFlashBaudrateSelector();
    
    // Load project config
    await loadConfig();
    
    // Apply translations and page config
    changeLanguage();
    
    // Load flash counts and display badges
    loadFlashCounts();
    
    // Update footer with version info
    updateFooterVersion();
    
    // Log version info
    console.log(`%c🚀 Web Installer v${WEBINSTALLER_VERSION}`, 'font-weight: bold; font-size: 14px; color: #667eea;');
    console.log(`%c📅 Build: ${WEBINSTALLER_BUILD_DATE}`, 'color: #888;');
    console.log(`%c🌍 Language: ${currentLang}`, 'color: #888;');
    if (typeof WEBINSTALLER_CODENAME !== 'undefined' && WEBINSTALLER_CODENAME) {
        console.log(`%c✨ Codename: ${WEBINSTALLER_CODENAME}`, 'color: #888;');
    }
    
    addLog('Web Installer ready (ESPLoader.js)', 'success');
}

// Update footer with version information
function updateFooterVersion() {
    const versionElement = document.getElementById('version-info');
    if (versionElement) {
        let versionText = `v${WEBINSTALLER_VERSION}`;
        if (typeof WEBINSTALLER_BUILD_DATE !== 'undefined' && WEBINSTALLER_BUILD_DATE) {
            versionText += ` - ${WEBINSTALLER_BUILD_DATE}`;
        }
        versionElement.textContent = versionText;
        versionElement.title = `Web Installer ${WEBINSTALLER_VERSION}` + 
                                (typeof WEBINSTALLER_CODENAME !== 'undefined' && WEBINSTALLER_CODENAME ? ` "${WEBINSTALLER_CODENAME}"` : '');
    }
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);

// Track first real user click (not programmatic)
document.addEventListener('click', () => {
    if (!firstUserInteractionDone) {
        firstUserInteractionDone = true;
        console.log('✅ First user interaction detected');
    }
}, { capture: true }); // Use capture to catch before other handlers

// ===== SERIAL MONITOR FUNCTIONS =====

// Start or stop serial monitor
async function toggleSerialMonitor() {
    if (monitorRunning) {
        await stopSerialMonitor();
    } else {
        await startSerialMonitor();
    }
}

// Start serial monitor - opens port and reads incoming data
async function startSerialMonitor() {
    // Auto-expand console if collapsed
    if (consoleCollapsed) {
        toggleConsole();
    }
    
    const monitorBtn = document.getElementById('monitorButton');
    
    try {
        addLog('🔌 Opening serial monitor...', 'info');
        addLog('⚠️ Browser will ask you to select a COM port', 'warning');
        
        // Request port from user
        monitorPort = await navigator.serial.requestPort();
        
        // Get baudrate from config or default to 115200
        const monitorBaudrate = pageConfig?.serial_monitor?.baudrate || 115200;
        
        // Try to open port - it may already be open from a failed flash
        try {
            await monitorPort.open({ baudRate: monitorBaudrate });
        } catch (openError) {
            if (openError.message.includes('already open')) {
                // Port is still open from a previous operation - try to close and reopen
                addLog('⚠️ Port was still open, reconnecting...', 'warning');
                try {
                    await monitorPort.close();
                } catch (e) {
                    // Ignore close errors
                }
                await monitorPort.open({ baudRate: monitorBaudrate });
            } else {
                throw openError;
            }
        }
        
        addLog(`✅ Serial monitor connected at ${monitorBaudrate} baud`, 'success');
        addLog('📡 Listening... (click "Stop Monitor" to disconnect)', 'info');
        
        // Update button to show "Stop" state
        monitorRunning = true;
        updateMonitorButton();
        
        // Start reading loop
        monitorReader = monitorPort.readable.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = '';
        
        while (monitorRunning) {
            try {
                const { value, done } = await monitorReader.read();
                if (done) {
                    break;
                }
                if (value) {
                    // Decode bytes and handle line-by-line output
                    lineBuffer += decoder.decode(value, { stream: true });
                    
                    // Split on newlines and log complete lines
                    const lines = lineBuffer.split('\n');
                    // Keep last incomplete line in buffer
                    lineBuffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        const trimmed = line.replace(/\r$/, '');
                        if (trimmed.length > 0) {
                            addLog(trimmed, 'info');
                        }
                    }
                }
            } catch (readError) {
                if (monitorRunning) {
                    // Unexpected read error
                    addLog(`❌ Monitor read error: ${readError.message}`, 'error');
                }
                break;
            }
        }
        
        // Flush remaining buffer
        if (lineBuffer.trim().length > 0) {
            addLog(lineBuffer.trim(), 'info');
        }
        
    } catch (error) {
        if (error.message.includes('No port selected')) {
            addLog('ℹ️ Monitor cancelled - no port selected', 'warning');
        } else {
            addLog(`❌ Monitor error: ${error.message}`, 'error');
        }
    } finally {
        await cleanupMonitor();
    }
}

// Stop serial monitor gracefully
async function stopSerialMonitor() {
    addLog('🔌 Stopping serial monitor...', 'info');
    monitorRunning = false;
    
    // Cancel the reader to break the read loop
    if (monitorReader) {
        try {
            await monitorReader.cancel();
        } catch (e) {
            // Ignore cancel errors
        }
    }
}

// Cleanup monitor resources
async function cleanupMonitor() {
    monitorRunning = false;
    
    // Release reader
    if (monitorReader) {
        try {
            monitorReader.releaseLock();
        } catch (e) {
            // Ignore
        }
        monitorReader = null;
    }
    
    // Close port
    if (monitorPort) {
        try {
            await monitorPort.close();
            addLog('✅ Serial monitor disconnected', 'success');
        } catch (e) {
            // Port may already be closed
        }
        monitorPort = null;
    }
    
    updateMonitorButton();
}

// Update monitor button text and style based on state
function updateMonitorButton() {
    const monitorBtn = document.getElementById('monitorButton');
    const flashBtn = document.getElementById('flashButton');
    if (!monitorBtn) return;
    
    if (monitorRunning) {
        monitorBtn.textContent = translate('monitorButtonStop') || 'Stop Monitor';
        monitorBtn.classList.add('monitor-active');
        // Hide flash button while monitoring
        if (flashBtn) flashBtn.style.display = 'none';
    } else {
        monitorBtn.textContent = translate('monitorButton') || 'Serial Monitor';
        monitorBtn.classList.remove('monitor-active');
        // Restore flash button
        if (flashBtn) flashBtn.style.display = 'block';
    }
}

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

// ===== NO RESET MODAL FUNCTIONS =====

// Promise resolve callback - set when modal is shown, called when user clicks OK
let noResetModalResolve = null;

// Show no-reset modal and return a promise that resolves when user clicks "Done"
function showNoResetModal() {
    return new Promise((resolve) => {
        noResetModalResolve = resolve;
        const modal = document.getElementById('noResetModal');
        modal.classList.add('show');
    });
}

// Called when user clicks "Done, Ready to Connect"
function confirmNoResetReady() {
    const modal = document.getElementById('noResetModal');
    modal.classList.remove('show');
    if (noResetModalResolve) {
        noResetModalResolve();
        noResetModalResolve = null;
    }
}

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
let carouselKeyboardSetupDone = false;
let carouselSwipeSetupDone = false;

// Initialize carousel
function initCarousel() {
    if (!allProjects || allProjects.length === 0) return;
    
    carouselProjects = allProjects.filter(project => projectSupportsVersion(project, preferredVersionId));
    if (carouselProjects.length === 0) {
        carouselProjects = allProjects;
    }
    currentCarouselIndex = 0;
    
    try {
        buildCarousel();
        updateCarouselPositions();
        selectProjectByIndex(0);
        if (!carouselKeyboardSetupDone) {
            setupCarouselKeyboard();
            carouselKeyboardSetupDone = true;
        }
        if (!carouselSwipeSetupDone) {
            setupCarouselSwipe();
            carouselSwipeSetupDone = true;
        }
    } catch (err) {
        console.error('Carousel init error:', err);
        const container = document.getElementById('projectCards');
        if (container) {
            container.innerHTML = '<p class="alert alert-error">Failed to load project cards. Check console (F12).</p>';
        }
    }
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
    
    // Card image with optional badge overlay (bottom-right, 25% height)
    if (project.image || project.badgeImage) {
        const imageWrap = document.createElement('div');
        imageWrap.className = 'project-image-wrapper';
        if (project.image) {
            const img = document.createElement('img');
            img.className = 'project-image';
            img.src = project.image;
            img.alt = project.name || '';
            imageWrap.appendChild(img);
        }
        if (project.badgeImage) {
            const badgeImg = document.createElement('img');
            badgeImg.className = 'project-badge-image';
            badgeImg.src = project.badgeImage;
            badgeImg.alt = '';
            badgeImg.onerror = () => { badgeImg.style.display = 'none'; };
            imageWrap.appendChild(badgeImg);
        }
        card.appendChild(imageWrap);
    }
    
    // Card content - Title, Badge, Version at top
    const content = document.createElement('div');
    content.className = 'project-content';
    
    // Title
    const title = document.createElement('h3');
    title.className = 'project-title';
    title.textContent = project.name || '';
    content.appendChild(title);
    
    // Badges container (for badge, version, flash count on same line)
    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'project-badges-row';
    
    // Badge
    if (project.badge && typeof project.badge === 'object') {
        const badgeEl = document.createElement('span');
        badgeEl.className = 'project-badge';
        badgeEl.textContent = project.badge[currentLang] || project.badge.en || '';
        badgesContainer.appendChild(badgeEl);
    }
    
    // Version (clickable with icon if releaseNotes exists)
    const versionEl = buildVersionBadgeElement(project);
    if (versionEl) {
        badgesContainer.appendChild(versionEl);
    }
    
    // Flash count badge will be added here by loadFlashCounts()
    
    content.appendChild(badgesContainer);
    
    card.appendChild(content);
    
    // Description below title/badge/version
    const description = document.createElement('p');
    description.className = 'project-description';
    const descObj = project.description && typeof project.description === 'object' ? project.description : {};
    const rawDesc = descObj[currentLang] || descObj.en || '';
    // Support \"\\n\" sequences in JSON as real line breaks
    description.textContent = rawDesc.replace(/\\n/g, '\n');
    card.appendChild(description);
    
    // Project icon_left/icon and icon_right/badgeRadio (same size, icon_right to the right of icon_left)
    const iconLeft = project.icon_left || project.icon;
    const iconRight = project.icon_right || project.badgeRadio;
    if (iconLeft || iconRight) {
        const iconContainer = document.createElement('div');
        iconContainer.className = 'project-icon-container';
        const iconRow = document.createElement('div');
        iconRow.className = 'project-icon-row';
        if (iconLeft) {
            const icon = document.createElement('img');
            icon.className = 'project-icon project-icon-left';
            icon.src = iconLeft;
            icon.alt = '';
            icon.onerror = () => { icon.style.display = 'none'; };
            iconRow.appendChild(icon);
        }
        if (iconRight) {
            const iconRightEl = document.createElement('img');
            iconRightEl.className = 'project-icon project-icon-right';
            iconRightEl.src = iconRight;
            iconRightEl.alt = '';
            iconRightEl.onerror = () => { iconRightEl.style.display = 'none'; };
            iconRow.appendChild(iconRightEl);
        }
        iconContainer.appendChild(iconRow);
        
        // Firmware download link (below icon row)
        if (project.downloadFirmware) {
            const downloadLink = document.createElement('a');
            const downloadHref = getProjectDownloadFirmware(project);
            downloadLink.href = downloadHref;
            downloadLink.download = '';
            downloadLink.className = 'firmware-download-link';
            downloadLink.title = translate('downloadFirmware') || 'Download firmware for offline use';
            downloadLink.innerHTML = `<svg class="firmware-download-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>`;
            if (!downloadHref) {
                downloadLink.style.display = 'none';
            }
            iconContainer.appendChild(downloadLink);
        }
        
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
        selectedProjectVersion = null;
        
        // Hide flash section for disabled projects
        if (flashSection) {
            flashSection.classList.remove('active');
        }
        
        // No console spam - user sees disabled card, that's enough
        return;
    }
    
    // Check browser compatibility - if not supported, treat like disabled project
    if (!navigator.serial) {
        // Play error sound ONLY if:
        // 1. User has actually clicked something (not on automatic selection at page load)
        // 2. Sound has not been played yet
        if (firstUserInteractionDone && !browserErrorSoundPlayed) {
            playAudioFeedback('error_wrong_browser');
            browserErrorSoundPlayed = true; // Mark as played, won't play again
        } else if (!firstUserInteractionDone) {
            // Mark that we need to play sound on first real interaction
            console.log('%c⚠️ Browser not supported - Web Serial API not available', 'color: #ff5555; font-weight: bold;');
        }
        
        // Don't select project
        selectedProject = null;
        selectedProjectVersion = null;
        
        // Hide flash section
        if (flashSection) {
            flashSection.classList.remove('active');
        }
        
        // Show warning in console
        const consoleContainer = document.getElementById('consoleContainer');
        if (consoleContainer) {
            consoleContainer.innerHTML = '';
            addLog('⚠️ Browser not supported. Please use Chrome, Edge, or Opera.', 'error');
            addLog('Web Serial API is required for flashing ESP32 devices.', 'warning');
        }
        
        return;
    }
    
    selectedProject = project;
    selectedProjectVersion = getCurrentProjectVersion(project) || getActiveProjectVersion(project);
    refreshProjectVersionInCarousel(index);
    
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
    updateSelectedProjectInfo(project);

    updateFirmwareVersionSelector();
    loadFlashCounts();
    
    // Add visual feedback
    const selectedVersionText = selectedProjectVersion?.version || project.version || 'n/a';
    addLog(`📦 ${translate('projectSelected') || 'Project selected'}: ${project.name} (${selectedVersionText})`, 'info');
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
            const descObj = typeof project.description === 'object' ? project.description : {};
            const rawDesc = descObj[currentLang] || descObj.en || '';
            description.textContent = rawDesc.replace(/\\n/g, '\n');
        }
        
        // Update badge (singular, not badges)
        const badge = card.querySelector('.project-badge');
        if (badge && project.badge) {
            badge.textContent = project.badge[currentLang] || project.badge.en;
        }
    });
}
