<?php
/**
 * Get Flash Errors
 * Returns detailed error logs with optional filtering
 * 
 * Query parameters:
 * - category: Filter by error category (user_cancel, port_busy, connection_timeout, etc.)
 * - project: Filter by project name
 * - limit: Number of entries to return (default: 50, max: 500)
 * - offset: Pagination offset (default: 0)
 * - summary: If "true", return only summary statistics
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$errorsFile = __DIR__ . '/flash-errors.json';

// Load errors
$errors = [
    'lastUpdated' => null,
    'totalErrors' => 0,
    'categoryCounts' => [],
    'entries' => []
];

if (file_exists($errorsFile)) {
    $json = file_get_contents($errorsFile);
    $errors = json_decode($json, true) ?? $errors;
}

// Get query parameters
$category = $_GET['category'] ?? null;
$project = $_GET['project'] ?? null;
$limit = min((int)($_GET['limit'] ?? 50), 500);
$offset = max((int)($_GET['offset'] ?? 0), 0);
$summaryOnly = ($_GET['summary'] ?? '') === 'true';

// Return summary only if requested
if ($summaryOnly) {
    $summary = [
        'lastUpdated' => $errors['lastUpdated'],
        'totalErrors' => $errors['totalErrors'],
        'categoryCounts' => $errors['categoryCounts'],
        'categoryDescriptions' => [
            'user_cancel' => 'User cancelled or did not select port',
            'port_busy' => 'Serial port in use by another application',
            'connection_timeout' => 'Timeout connecting to ESP32 (BOOT button not pressed)',
            'download_failed' => 'Failed to download firmware files',
            'hardware_error' => 'Hardware or chip-related error',
            'wrong_browser' => 'Unsupported browser (no Web Serial API)',
            'flash_error' => 'Generic flash error',
            'unknown' => 'Uncategorized error'
        ]
    ];
    
    // Add per-project stats
    $projectStats = [];
    foreach ($errors['entries'] as $entry) {
        $proj = $entry['project'];
        if (!isset($projectStats[$proj])) {
            $projectStats[$proj] = [];
        }
        $cat = $entry['category'];
        if (!isset($projectStats[$proj][$cat])) {
            $projectStats[$proj][$cat] = 0;
        }
        $projectStats[$proj][$cat]++;
    }
    $summary['projectStats'] = $projectStats;
    
    echo json_encode($summary, JSON_PRETTY_PRINT);
    exit;
}

// Filter entries
$filtered = $errors['entries'];

if ($category) {
    $filtered = array_filter($filtered, function($entry) use ($category) {
        return $entry['category'] === $category;
    });
}

if ($project) {
    $filtered = array_filter($filtered, function($entry) use ($project) {
        return $entry['project'] === $project;
    });
}

// Re-index array after filtering
$filtered = array_values($filtered);

// Get total after filtering
$totalFiltered = count($filtered);

// Apply pagination
$paginated = array_slice($filtered, $offset, $limit);

// Build response
$response = [
    'total' => $totalFiltered,
    'limit' => $limit,
    'offset' => $offset,
    'hasMore' => ($offset + $limit) < $totalFiltered,
    'filters' => [
        'category' => $category,
        'project' => $project
    ],
    'entries' => $paginated
];

echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
