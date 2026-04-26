# Epicycle Cache

This folder stores pre-computed DFT (Discrete Fourier Transform) data for CSV files to speed up loading.

## How It Works

1. **First Load**: When loading a CSV for the first time:
   - The system computes the DFT (can take several seconds for large files)
   - Console shows: "CACHE DATA READY"
   - Run `downloadCache()` in browser console to download the JSON file
   - Save the downloaded file to this folder

2. **Subsequent Loads**: 
   - System automatically checks for cached file
   - If found, loads instantly without recomputing DFT
   - Console shows: "✓ Loaded cached epicycles"

## Cache Filename Format

Files are named based on parameters:
```
{filename}_r{resolution}_s{scale}_{axisMode}_f{maxFreq}_c{maxCircleSize}_n{circles}.json
```

Example: `subsampled_5k.csv_r10000_s0.5_three_f1000_c1000_n200.json`

## Manual Download Steps

1. Load your CSV file in the browser
2. Wait for DFT computation to complete
3. Open browser console (F12)
4. Run: `downloadCache()`
5. Save the downloaded JSON file to this folder
6. Refresh page - it will now use cached data

## Cache Contents

Each cache file contains:
- `combinedPath`: Transformed coordinates
- `segmentBoundaries`: Path segment information  
- `epicycles1/2/3`: Pre-computed DFT coefficients
- `metadata`: Parameters used for computation

## When to Clear Cache

Delete cache files when:
- CSV source data changes
- You want different resolution/quality settings
- Parameters like maxFreq or circles change
