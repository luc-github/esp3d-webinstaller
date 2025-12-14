<?php
/**
 * ESP Flash Logger - Secured Version
 * 
 * Security layers:
 * 1. Secret key file verification (sanity check)
 * 2. Rate limiting by IP
 * 3. Input validation
 * 4. File size limits
 * 5. Origin/Referer check
 * 6. Honeypot field detection
 */

// ============================================
// CONFIGURATION
// ============================================
$config = [
    // Secret key file location - Choose one option:
    // 
    // OPTION A (Recommended): Outside web root
    // If your web root is /var/www/webinstaller/, place secret_files at /var/www/secret_files/
    'secret_key_file' => dirname(__DIR__) . '/secret_files/mykey.txt',
    'rate_limit_file' => dirname(__DIR__) . '/secret_files/rate_limits.json',
    //
    // OPTION B: Inside web root (requires .htaccess or nginx config to block access)
    // 'secret_key_file' => __DIR__ . '/secret_files/mykey.txt',
    // 'rate_limit_file' => __DIR__ . '/secret_files/rate_limits.json',
    
    // Data files (in web root, need write access)
    'counts_file' => __DIR__ . '/flash-counts.json',
    'errors_file' => __DIR__ . '/flash-errors.json',
    'max_requests_per_minute' => 10,
    'max_requests_per_hour' => 50,
    
    // File size limits (in bytes)
    'max_counts_file_size' => 1048576,  // 1 MB
    'max_errors_file_size' => 5242880,  // 5 MB
    'max_error_entries' => 500,
    
    // Allowed origins (add your domains)
    'allowed_origins' => [
        'localhost',
        '127.0.0.1',
        'webinstaller.esp3d.io',
        // Add your domain here, e.g.:
        // 'yourdomain.com',
        // 'www.yourdomain.com',
    ],
    
    // Enable/disable security checks (set to false for debugging)
    'check_secret_key' => true,
    'check_rate_limit' => true,
    'check_origin' => true,
    'check_honeypot' => true,
];

// ============================================
// HEADERS
// ============================================
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Only allow POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ============================================
// SECURITY FUNCTIONS
// ============================================

/**
 * Verify secret key file exists (sanity check)
 * This ensures the script is running on the legitimate server
 */
function verifySecretKey($config) {
    if (!$config['check_secret_key']) {
        return true;
    }
    
    $keyFile = $config['secret_key_file'];
    
    // Check if secret file exists and is readable
    if (!file_exists($keyFile) || !is_readable($keyFile)) {
        error_log("ESP Flash Logger: Secret key file not found or not readable");
        return false;
    }
    
    // Optionally verify content (must not be empty)
    $content = trim(file_get_contents($keyFile));
    if (empty($content)) {
        error_log("ESP Flash Logger: Secret key file is empty");
        return false;
    }
    
    return true;
}

/**
 * Rate limiting by IP address
 */
function checkRateLimit($config) {
    if (!$config['check_rate_limit']) {
        return true;
    }
    
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $ipHash = md5($ip); // Hash IP for privacy
    $now = time();
    
    $rateLimitFile = $config['rate_limit_file'];
    $limits = [];
    
    // Load existing rate limits
    if (file_exists($rateLimitFile)) {
        $limits = json_decode(file_get_contents($rateLimitFile), true) ?? [];
    }
    
    // Clean old entries (older than 1 hour)
    foreach ($limits as $hash => $data) {
        if ($now - ($data['first_request'] ?? 0) > 3600) {
            unset($limits[$hash]);
        }
    }
    
    // Initialize or update IP entry
    if (!isset($limits[$ipHash])) {
        $limits[$ipHash] = [
            'first_request' => $now,
            'minute_count' => 0,
            'minute_start' => $now,
            'hour_count' => 0,
        ];
    }
    
    $entry = &$limits[$ipHash];
    
    // Reset minute counter if minute passed
    if ($now - $entry['minute_start'] > 60) {
        $entry['minute_count'] = 0;
        $entry['minute_start'] = $now;
    }
    
    // Reset hour counter if hour passed
    if ($now - $entry['first_request'] > 3600) {
        $entry['hour_count'] = 0;
        $entry['first_request'] = $now;
    }
    
    // Check limits
    if ($entry['minute_count'] >= $config['max_requests_per_minute']) {
        error_log("ESP Flash Logger: Rate limit exceeded (minute) for IP hash: $ipHash");
        return false;
    }
    
    if ($entry['hour_count'] >= $config['max_requests_per_hour']) {
        error_log("ESP Flash Logger: Rate limit exceeded (hour) for IP hash: $ipHash");
        return false;
    }
    
    // Increment counters
    $entry['minute_count']++;
    $entry['hour_count']++;
    
    // Save rate limits
    file_put_contents($rateLimitFile, json_encode($limits), LOCK_EX);
    
    return true;
}

/**
 * Verify request origin
 */
function checkOrigin($config) {
    if (!$config['check_origin']) {
        return true;
    }
    
    // Check Referer header
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    
    $checkUrl = $referer ?: $origin;
    
    if (empty($checkUrl)) {
        // No referer/origin - might be direct request or privacy mode
        // Allow but log
        error_log("ESP Flash Logger: Request without Referer/Origin header");
        return true; // Be lenient, other checks will catch abuse
    }
    
    $parsedUrl = parse_url($checkUrl);
    $host = $parsedUrl['host'] ?? '';
    
    foreach ($config['allowed_origins'] as $allowed) {
        if ($host === $allowed || str_ends_with($host, '.' . $allowed)) {
            return true;
        }
    }
    
    error_log("ESP Flash Logger: Invalid origin: $host");
    return false;
}

/**
 * Check for honeypot field (bots often fill hidden fields)
 */
function checkHoneypot($data, $config) {
    if (!$config['check_honeypot']) {
        return true;
    }
    
    // If honeypot field exists and is filled, it's likely a bot
    if (isset($data['website']) && !empty($data['website'])) {
        error_log("ESP Flash Logger: Honeypot triggered");
        return false;
    }
    
    if (isset($data['email']) && !empty($data['email'])) {
        error_log("ESP Flash Logger: Honeypot triggered");
        return false;
    }
    
    return true;
}

/**
 * Validate and sanitize input data
 */
function validateInput($data) {
    // Required fields
    if (!isset($data['project']) || empty($data['project'])) {
        return ['valid' => false, 'error' => 'Missing project name'];
    }
    
    // Sanitize project name (max 100 chars, alphanumeric + spaces + basic punctuation)
    $project = substr($data['project'], 0, 100);
    $project = preg_replace('/[^a-zA-Z0-9\s\.\-\_\(\)]/', '', $project);
    
    if (empty($project)) {
        return ['valid' => false, 'error' => 'Invalid project name'];
    }
    
    // Validate success field
    $success = isset($data['success']) ? (bool)$data['success'] : true;
    
    // Validate action field
    $action = isset($data['action']) ? substr($data['action'], 0, 50) : 'flash';
    $action = preg_replace('/[^a-zA-Z0-9\_]/', '', $action);
    
    // Sanitize error message if present
    $error = null;
    if (isset($data['error'])) {
        $error = substr($data['error'], 0, 500); // Max 500 chars
        $error = htmlspecialchars($error, ENT_QUOTES, 'UTF-8');
    }
    
    // Sanitize error category
    $errorCategory = null;
    $allowedCategories = ['user_cancel', 'port_busy', 'connection_timeout', 'download_failed', 'hardware_error', 'wrong_browser', 'flash_error', 'unknown'];
    if (isset($data['errorCategory']) && in_array($data['errorCategory'], $allowedCategories)) {
        $errorCategory = $data['errorCategory'];
    }
    
    // Sanitize context if present
    $context = null;
    if (isset($data['context']) && is_array($data['context'])) {
        $context = [
            'browser' => isset($data['context']['browser']) ? array_map(function($v) {
                return substr(htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'), 0, 50);
            }, array_slice($data['context']['browser'], 0, 5)) : null,
            'stage' => isset($data['context']['stage']) ? substr(preg_replace('/[^a-zA-Z0-9\_]/', '', $data['context']['stage']), 0, 30) : null,
        ];
    }
    
    return [
        'valid' => true,
        'data' => [
            'project' => $project,
            'success' => $success,
            'action' => $action,
            'error' => $error,
            'errorCategory' => $errorCategory,
            'context' => $context,
            'timestamp' => date('c'),
        ]
    ];
}

/**
 * Check file size before writing
 */
function checkFileSize($file, $maxSize) {
    if (!file_exists($file)) {
        return true;
    }
    
    return filesize($file) < $maxSize;
}

// ============================================
// MAIN LOGIC
// ============================================

// 1. Verify secret key (sanity check)
if (!verifySecretKey($config)) {
    http_response_code(503);
    echo json_encode(['error' => 'Service unavailable']);
    exit;
}

// 2. Check rate limit
if (!checkRateLimit($config)) {
    http_response_code(429);
    echo json_encode(['error' => 'Too many requests']);
    exit;
}

// 3. Get and parse POST data
$rawData = file_get_contents('php://input');

// Check raw input size (max 10KB)
if (strlen($rawData) > 10240) {
    http_response_code(413);
    echo json_encode(['error' => 'Payload too large']);
    exit;
}

$data = json_decode($rawData, true);

if (!$data) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}

// 4. Check honeypot
if (!checkHoneypot($data, $config)) {
    // Silently accept but don't process (confuse bots)
    http_response_code(200);
    echo json_encode(['success' => true]);
    exit;
}

// 5. Check origin
if (!checkOrigin($config)) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

// 6. Validate input
$validation = validateInput($data);
if (!$validation['valid']) {
    http_response_code(400);
    echo json_encode(['error' => $validation['error']]);
    exit;
}

$cleanData = $validation['data'];

// 7. Check file sizes before writing
if (!checkFileSize($config['counts_file'], $config['max_counts_file_size'])) {
    error_log("ESP Flash Logger: Counts file size limit reached");
    http_response_code(507);
    echo json_encode(['error' => 'Storage limit reached']);
    exit;
}

if (!checkFileSize($config['errors_file'], $config['max_errors_file_size'])) {
    error_log("ESP Flash Logger: Errors file size limit reached");
    // Don't fail, just skip error logging
}

// ============================================
// UPDATE COUNTS
// ============================================
$counts = [];
if (file_exists($config['counts_file'])) {
    $counts = json_decode(file_get_contents($config['counts_file']), true) ?? [];
}

$projectName = $cleanData['project'];

if (!isset($counts[$projectName])) {
    $counts[$projectName] = [
        'total' => 0,
        'success' => 0,
        'failed' => 0
    ];
}

$counts[$projectName]['total']++;
if ($cleanData['success']) {
    $counts[$projectName]['success']++;
} else {
    $counts[$projectName]['failed']++;
}

$countResult = file_put_contents(
    $config['counts_file'],
    json_encode($counts, JSON_PRETTY_PRINT),
    LOCK_EX
);

// ============================================
// LOG ERRORS (if applicable)
// ============================================
if (!$cleanData['success'] && $cleanData['error'] && checkFileSize($config['errors_file'], $config['max_errors_file_size'])) {
    $errors = [];
    if (file_exists($config['errors_file'])) {
        $errors = json_decode(file_get_contents($config['errors_file']), true) ?? [];
    }
    
    if (!isset($errors['entries'])) {
        $errors = [
            'lastUpdated' => date('c'),
            'totalErrors' => 0,
            'categoryCounts' => [],
            'entries' => []
        ];
    }
    
    $errorEntry = [
        'id' => uniqid('err_'),
        'timestamp' => $cleanData['timestamp'],
        'project' => $cleanData['project'],
        'action' => $cleanData['action'],
        'error' => $cleanData['error'],
        'category' => $cleanData['errorCategory'] ?? 'unknown'
    ];
    
    if ($cleanData['context']) {
        $errorEntry['context'] = $cleanData['context'];
    }
    
    array_unshift($errors['entries'], $errorEntry);
    
    // Keep only max entries
    if (count($errors['entries']) > $config['max_error_entries']) {
        $errors['entries'] = array_slice($errors['entries'], 0, $config['max_error_entries']);
    }
    
    $category = $errorEntry['category'];
    if (!isset($errors['categoryCounts'][$category])) {
        $errors['categoryCounts'][$category] = 0;
    }
    $errors['categoryCounts'][$category]++;
    
    $errors['lastUpdated'] = date('c');
    $errors['totalErrors']++;
    
    file_put_contents(
        $config['errors_file'],
        json_encode($errors, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
}

// ============================================
// RESPONSE
// ============================================
if ($countResult === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to save']);
    exit;
}

http_response_code(200);
echo json_encode([
    'success' => true,
    'counts' => $counts[$projectName]
]);
