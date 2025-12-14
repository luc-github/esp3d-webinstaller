<?php
/**
 * ESP Flash Logger
 * Handles both simple counts and detailed error logging
 * 
 * - flash-counts.json: Simple counters per project (success only displayed)
 * - flash-errors.json: Detailed error logs with categorization
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Configuration
$countsFile = __DIR__ . '/flash-counts.json';
$errorsFile = __DIR__ . '/flash-errors.json';
$maxErrorLogs = 500; // Keep last 500 error entries

// Get POST data
$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['project'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid data']);
    exit;
}

$projectName = $data['project'];
$success = $data['success'] ?? true;
$action = $data['action'] ?? 'flash';
$timestamp = $data['timestamp'] ?? date('c');

// ============================================
// Update simple counts (flash-counts.json)
// ============================================
$counts = [];
if (file_exists($countsFile)) {
    $json = file_get_contents($countsFile);
    $counts = json_decode($json, true) ?? [];
}

// Initialize project if doesn't exist
if (!isset($counts[$projectName])) {
    $counts[$projectName] = [
        'total' => 0,
        'success' => 0,
        'failed' => 0
    ];
}

// Increment counters
$counts[$projectName]['total']++;
if ($success) {
    $counts[$projectName]['success']++;
} else {
    $counts[$projectName]['failed']++;
}

// Save counts
$countResult = file_put_contents(
    $countsFile,
    json_encode($counts, JSON_PRETTY_PRINT),
    LOCK_EX
);

// ============================================
// Log detailed errors (flash-errors.json)
// ============================================
if (!$success && isset($data['error'])) {
    // Load existing errors
    $errors = [];
    if (file_exists($errorsFile)) {
        $json = file_get_contents($errorsFile);
        $errors = json_decode($json, true) ?? [];
    }
    
    // Initialize structure if needed
    if (!isset($errors['entries'])) {
        $errors = [
            'lastUpdated' => date('c'),
            'totalErrors' => 0,
            'categoryCounts' => [],
            'entries' => []
        ];
    }
    
    // Create error entry
    $errorEntry = [
        'id' => uniqid('err_'),
        'timestamp' => $timestamp,
        'project' => $projectName,
        'action' => $action,
        'error' => $data['error'],
        'category' => $data['errorCategory'] ?? 'unknown'
    ];
    
    // Add context if available
    if (isset($data['context'])) {
        $errorEntry['context'] = $data['context'];
    }
    
    // Add to entries (prepend for newest first)
    array_unshift($errors['entries'], $errorEntry);
    
    // Keep only last N entries
    if (count($errors['entries']) > $maxErrorLogs) {
        $errors['entries'] = array_slice($errors['entries'], 0, $maxErrorLogs);
    }
    
    // Update category counts
    $category = $errorEntry['category'];
    if (!isset($errors['categoryCounts'][$category])) {
        $errors['categoryCounts'][$category] = 0;
    }
    $errors['categoryCounts'][$category]++;
    
    // Update metadata
    $errors['lastUpdated'] = date('c');
    $errors['totalErrors']++;
    
    // Save errors
    file_put_contents(
        $errorsFile,
        json_encode($errors, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
}

// ============================================
// Return response
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
