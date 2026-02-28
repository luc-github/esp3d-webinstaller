<?php
/**
 * Get Flash Errors
 * Returns detailed error logs with optional filtering
 * 
 * Query parameters:
 * - category: Filter by error category (user_cancel, port_busy, connection_timeout, etc.)
 * - projectId: Filter by project ID (new)
 * - project: Filter by project ID (alias for backward compatibility)
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
$projectId = $_GET['projectId'] ?? $_GET['project'] ?? null; // Support both for backward compatibility
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
        // Support both old format (project) and new format (projectId)
        $projId = $entry['projectId'] ?? $entry['project'] ?? 'unknown';
        if (!isset($projectStats[$projId])) {
            $projectStats[$projId] = [];
        }
        $cat = $entry['category'];
        if (!isset($projectStats[$projId][$cat])) {
            $projectStats[$projId][$cat] = 0;
        }
        $projectStats[$projId][$cat]++;
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

if ($projectId) {
    $filtered = array_filter($filtered, function($entry) use ($projectId) {
        // Support both old format (project) and new format (projectId)
        $entryProjectId = $entry['projectId'] ?? $entry['project'] ?? null;
        return $entryProjectId === $projectId;
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
        'projectId' => $projectId
    ],
    'entries' => $paginated
];

echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
