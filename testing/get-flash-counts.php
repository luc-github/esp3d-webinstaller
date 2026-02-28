<?php
/**
 * Get Flash Counts
 * Returns flash counts for all projects
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$dataFile = __DIR__ . '/flash-counts.json';

// Load counts
$counts = [];
if (file_exists($dataFile)) {
    $json = file_get_contents($dataFile);
    $counts = json_decode($json, true) ?? [];
}

// Return counts
echo json_encode($counts, JSON_PRETTY_PRINT);
