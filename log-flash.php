<?php
/**
 * ESP Flash Counter
 * Simple counter per project stored in JSON
 */

// Configuration
$dataFile = __DIR__ . '/flash-counts.json';

// Get POST data
$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['project'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid data']);
    exit;
}

$projectName = $data['project'];
$success = $data['success'] ?? true;

// Load existing counts
$counts = [];
if (file_exists($dataFile)) {
    $json = file_get_contents($dataFile);
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
$result = file_put_contents(
    $dataFile,
    json_encode($counts, JSON_PRETTY_PRINT),
    LOCK_EX
);

if ($result === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to save']);
    exit;
}

// Return success
http_response_code(200);
echo json_encode([
    'success' => true,
    'counts' => $counts[$projectName]
]);
